package server

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/channel"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citationlog"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

// TestBuildParticipantContextWiresAll5Modules exercises the per-participant
// assembly path: identity + memory + model + skills + channel must all be
// populated without panicking on empty store + missing identity profile.
func TestBuildParticipantContextWiresAll5Modules(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees, map[string]any{
		"id":          "de-sre",
		"name":        "SRE 助手",
		"role":        "运维工程师",
		"department":  "基础设施",
		"lifecycle":   "active",
		"description": "负责发布、值班、缓存。",
		"spec": map[string]any{
			"defaultSessionMode": "execute",
			"defaultRiskLevel":   "medium",
		},
	})
	st.RoutingPolicies = []map[string]any{
		{"id": "rp-test", "workspaceId": "ws-1", "level": "P1", "primaryModelId": "mdl-test", "status": "published"},
	}
	st.ModelProviders = []map[string]any{
		{"id": "mp-test", "workspaceId": "ws-1", "name": "T", "protocol": "openai_compatible", "status": "active", "models": []map[string]any{
			{"id": "mdl-test", "providerId": "mp-test", "name": "t", "status": "available", "capabilities": []string{"chat"}},
		}},
	}
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}

	emit := func(string, string, map[string]any) {}

	emp := map[string]any{
		"id":          "de-sre",
		"name":        "SRE 助手",
		"role":        "运维工程师",
		"department":  "基础设施",
		"description": "负责发布、值班、缓存。",
	}
	pc := s.buildParticipantContext(participantCtxInput{
		WorkspaceID:     "ws-1",
		ConversationID:  "conv-1",
		CorrelationID:   "corr-1",
		OwnerID:         "user-1",
		UserMessage:     "redis 延迟飙升，请协助排查",
		Channel:         contract.ChannelFeishu,
		EnabledTools:    []string{"knowledge.retrieve"},
		Viewer:          &auth.Identity{ID: "user-1"},
		Request:         httptest.NewRequest("POST", "/x", nil),
		Emit:            emit,
		SessionModeHint: "",
		RiskLevelHint:   "",
	}, emp)

	if pc.DigitalPartner != "de-sre" {
		t.Fatalf("DE id not propagated: %q", pc.DigitalPartner)
	}
	if pc.SessionMode != contract.SessionModeExecute {
		t.Fatalf("expected sessionMode=execute from spec, got %q", pc.SessionMode)
	}
	if pc.RiskLevel != contract.RiskLevelMedium {
		t.Fatalf("expected riskLevel=medium from spec, got %q", pc.RiskLevel)
	}
	if pc.Channel != contract.ChannelFeishu {
		t.Fatalf("channel not propagated: %q", pc.Channel)
	}
	if pc.OwnerID != "user-1" {
		t.Fatalf("owner not propagated: %q", pc.OwnerID)
	}
	if pc.ModelID == "" {
		t.Fatalf("modelprov policy routing did not yield a model id")
	}
	if pc.IdentityPresent {
		t.Fatalf("identity should be absent when no profile is configured")
	}
	if pc.MemoryHits == nil {
		// store.NewEmpty() has no memory records, so retrieval returns nil;
		// ensure we never NPE downstream by accepting either nil or empty.
		t.Logf("memory slice is nil (no records in store); callers must tolerate")
	}
	// Tools list is filtered by execute session mode; it must always contain
	// the explicit enable list passed in even when the employee has no
	// responsibilities list.
	if len(pc.Tools) == 0 {
		t.Fatalf("skill registry filtered to empty for execute mode")
	}
}

// TestRunParticipantTurnRefused verifies Mem5 hard-no short-circuits BEFORE
// any LLM call: status must be "refused", reason must include the matched
// term, and the emit stream must contain a "refused" event.
func TestRunParticipantTurnRefused(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees, map[string]any{
		"id": "de-hr", "name": "HR 助手", "lifecycle": "active",
	})
	prof := memid.NewStore()
	// Salary hard-no.
	if err := prof.Set(memid.Profile{
		WorkspaceID:       "ws-1",
		DigitalPartnerID: "de-hr",
		HardNo:            []string{"工资", "薪资", "薪酬"},
	}); err != nil {
		t.Fatalf("identity Set: %v", err)
	}
	s := &Server{Store: st, IdentityProfiles: prof}

	var events []map[string]any
	emit := func(_ string, _ string, m map[string]any) {
		events = append(events, m)
	}

	pc := participantContext{
		WorkspaceID:     "ws-1",
		DigitalPartner: "de-hr",
		SessionMode:     contract.SessionModeInvestigate,
		RiskLevel:       contract.RiskLevelMedium,
		ModelID:         "model-p0",
		Identity: memid.Profile{
			HardNo: []string{"工资", "薪资", "薪酬"},
		},
		IdentityPresent: true,
		UserMessage:     "请告诉我我的工资",
		Emit:            emit,
	}

	res := s.runParticipantTurn(context.Background(), pc)

	if res.Status != "refused" {
		t.Fatalf("expected status=refused, got %q (reason=%q)", res.Status, res.Reason)
	}
	if res.HardNoRefusal == "" {
		t.Fatalf("expected hard-no refusal reason populated")
	}
	if !strings.Contains(res.Reason, "hard_no:") {
		t.Fatalf("expected Reason to start with hard_no:, got %q", res.Reason)
	}
	if res.Text != "" {
		t.Fatalf("refused result must have empty text, got %q", res.Text)
	}
	// Confirm we emitted a refused event.
	found := false
	for _, e := range events {
		if e["status"] == "refused" && e["participantId"] == "de-hr" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected an agent.multi status=refused event, got %d events", len(events))
	}
}

// TestMergeParticipantOpinions verifies mixed-status results stitch correctly:
// successes become labeled bodies, refusals/timeout/failures become skip
// notes with the matching status phrase.
func TestMergeParticipantOpinions(t *testing.T) {
	results := []participantTurnResult{
		{ParticipantID: "de-a", Status: "success", Text: "这是 a 的专业意见"},
		{ParticipantID: "de-b", Status: "refused", HardNoRefusal: "工资"},
		{ParticipantID: "de-c", Status: "timed_out", Text: ""},
		{ParticipantID: "de-d", Status: "failed", Reason: "model 5xx"},
	}
	opinions := mergeParticipantOpinions(results, 1200)
	if len(opinions) != 4 {
		t.Fatalf("expected 4 opinions, got %d", len(opinions))
	}
	if !strings.Contains(opinions[0], "【de-a】") || !strings.Contains(opinions[0], "这是 a 的专业意见") {
		t.Fatalf("success opinion missing header/body: %q", opinions[0])
	}
	if !strings.Contains(opinions[1], "硬性设定拒答") || !strings.Contains(opinions[1], "工资") {
		t.Fatalf("refused skip note missing terms: %q", opinions[1])
	}
	if !strings.Contains(opinions[2], "调用超时") {
		t.Fatalf("timeout skip note missing: %q", opinions[2])
	}
	if !strings.Contains(opinions[3], "调用失败") || !strings.Contains(opinions[3], "model 5xx") {
		t.Fatalf("failed skip note missing: %q", opinions[3])
	}
}

// TestRunParticipantTurnTimeoutHonored: when the LLM stream never finishes
// the per-participant 30s budget must kick in. We exercise this by using a
// context that is already cancelled; runParticipantTurn should report
// timed_out without panicking.
func TestRunParticipantTurnHonorsParentContextCancellation(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees, map[string]any{
		"id": "de-x", "name": "X", "lifecycle": "active",
	})
	prof := memid.NewStore()
	s := &Server{Store: st, IdentityProfiles: prof}

	pc := participantContext{
		WorkspaceID:     "ws-1",
		DigitalPartner: "de-x",
		SessionMode:     contract.SessionModeInvestigate,
		RiskLevel:       contract.RiskLevelMedium,
		ModelID:         "model-p0",
		IdentityPresent: false,
		UserMessage:     "hello",
		Emit:            func(string, string, map[string]any) {},
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already-cancelled
	res := s.runParticipantTurn(ctx, pc)
	if res.Status != "timed_out" && res.Status != "failed" {
		t.Fatalf("expected timed_out/failed under cancelled ctx, got %q (reason=%q)", res.Status, res.Reason)
	}
}

// TestAttributedChannelSend verifies Phase 3 real outbound routing:
//
//   - feishu/wecom/dingtalk all resolve through ChannelRegistry.SendText
//     when credentials + deployment + registry are present.
//   - unknown channels emit "skipped no_adapter_for_channel".
//   - missing deployment emits "skipped no_deployment_for_session".
func TestAttributedChannelSend(t *testing.T) {
	// Build a server with vault stub, channel registry, and a real
	// feishu deployment so the happy path can succeed end-to-end.
	makeServer := func(t *testing.T) (*Server, *channel.MockAdapter) {
		t.Helper()
		st := store.NewEmpty()
		// A real feishu deployment keyed off workspace ws-1 + channel feishu.
		st.ChannelDeploys = append(st.ChannelDeploys, map[string]any{
			"id":            "dep-feishu-1",
			"workspaceId":   "ws-1",
			"channel":       "feishu",
			"credentialRef": "vault://ch/dep-feishu-1",
		})
		st.Sessions = append(st.Sessions, map[string]any{
			"id": "sess-1", "workspaceId": "ws-1",
			"conversationId":      "conv-1",
			"channelDeploymentId": "dep-feishu-1",
			"channel":             "feishu",
			"channelThreadId":     "oc_chat_xxx",
			"status":              "active",
		})
		v := vault.NewFromEnv()
		v.PutStub("vault://ch/dep-feishu-1", `{"appId":"x","appSecret":"y"}`)
		mock := channel.NewMock(channel.KindFeishu)
		reg := channel.NewDefaultRegistry()
		reg.Register(mock)
		s := &Server{
			Store:            st,
			IdentityProfiles: memid.NewStore(),
			Vault:            v,
			ChannelRegistry:  reg,
		}
		return s, mock
	}

	t.Run("feishu emits attributed", func(t *testing.T) {
		s, mock := makeServer(t)
		var got capturedEvent
		pc := participantContext{DigitalPartner: "de-x", WorkspaceID: "ws-1", ConversationID: "conv-1", Channel: "feishu"}
		pc.Emit = func(cat, ev string, m map[string]any) { got = capturedEvent{category: cat, event: ev, payload: m} }
		s.attributedChannelSend(context.Background(), pc, "hello world")
		if got.category != "channel" || got.event != "outbound" {
			t.Fatalf("unexpected emit category/event: %s/%s", got.category, got.event)
		}
		if got.payload["status"] != "attributed" {
			t.Fatalf("expected attributed, got %v", got.payload)
		}
		if got.payload["messageId"] == "" {
			t.Fatalf("expected messageId in attributed payload, got %v", got.payload)
		}
		if len(mock.Sent) != 1 {
			t.Fatalf("expected 1 mock send, got %d", len(mock.Sent))
		}
	})

	t.Run("dingtalk emits attributed via default mock", func(t *testing.T) {
		s, _ := makeServer(t)
		var got capturedEvent
		pc := participantContext{DigitalPartner: "de-x", WorkspaceID: "ws-1", ConversationID: "conv-1", Channel: "dingtalk"}
		pc.Emit = func(cat, ev string, m map[string]any) { got = capturedEvent{category: cat, event: ev, payload: m} }
		s.attributedChannelSend(context.Background(), pc, "hi")
		// NewDefaultRegistry seeds all four kinds with mock adapters; since
		// the deployment lookup is by channel deployment row (which our seed
		// doesn't have for dingtalk) we expect a skipped routing decision.
		// If the seed ever grows to include a dingtalk deployment, this
		// test will start asserting "attributed" instead.
		if got.payload["status"] != "skipped" {
			t.Fatalf("expected skipped (no dingtalk deploy seeded), got %v", got.payload)
		}
	})

	t.Run("unknown channel emits skipped", func(t *testing.T) {
		s, _ := makeServer(t)
		var got capturedEvent
		pc := participantContext{DigitalPartner: "de-x", WorkspaceID: "ws-1", ConversationID: "conv-1", Channel: "rocketchat"}
		pc.Emit = func(cat, ev string, m map[string]any) { got = capturedEvent{category: cat, event: ev, payload: m} }
		s.attributedChannelSend(context.Background(), pc, "hi")
		if got.payload["status"] != "skipped" || got.payload["reason"] != "no_adapter_for_channel" {
			t.Fatalf("unexpected payload: %v", got.payload)
		}
	})

	t.Run("missing session emits skipped no_deployment", func(t *testing.T) {
		s, _ := makeServer(t)
		var got capturedEvent
		pc := participantContext{DigitalPartner: "de-x", WorkspaceID: "ws-1", ConversationID: "conv-does-not-exist", Channel: "feishu"}
		pc.Emit = func(cat, ev string, m map[string]any) { got = capturedEvent{category: cat, event: ev, payload: m} }
		s.attributedChannelSend(context.Background(), pc, "hi")
		if got.payload["status"] != "skipped" || got.payload["reason"] != "no_deployment_for_session" {
			t.Fatalf("unexpected payload: %v", got.payload)
		}
	})

	t.Run("no emit when Emit is nil", func(t *testing.T) {
		s, _ := makeServer(t)
		pc := participantContext{DigitalPartner: "de-x", WorkspaceID: "ws-1", ConversationID: "conv-1", Channel: "feishu", Emit: nil}
		s.attributedChannelSend(context.Background(), pc, "hi") // must not panic
	})
}

// TestRunParticipantToolsEmptyTools: when a participant has zero enabled
// tools, runParticipantTools must return empty slices, not panic, and must
// not write anything to the citation log.
func TestRunParticipantToolsEmptyTools(t *testing.T) {
	s := &Server{Store: store.NewEmpty(), IdentityProfiles: memid.NewStore()}
	pc := participantContext{
		WorkspaceID:     "ws-1",
		DigitalPartner: "de-empty",
		Tools:           nil,
	}
	hits, summaries := s.runParticipantTools(context.Background(), pc)
	if hits != nil {
		t.Fatalf("expected nil ragHits, got %v", hits)
	}
	if summaries != nil {
		t.Fatalf("expected nil summaries, got %v", summaries)
	}
}

// TestRunParticipantToolsCitationInvariant: when a participant's
// knowledge.retrieve produces hits, those hits must show up in the
// citationlog with turnID = corr:participantID and the doc-delete guard
// (EnsureDeleted) must block removing a doc that still has active citations.
//
// This test does NOT exercise the real retriever (which would need a
// working knowledge store); instead it stubs at the boundary by directly
// calling citationLog().Append with the same shape that
// runParticipantTools would produce.
func TestRunParticipantToolsCitationInvariant(t *testing.T) {
	s := &Server{Store: store.NewEmpty(), IdentityProfiles: memid.NewStore()}
	cl := s.citationLog()
	const corr = "corr-inv"
	const participant = "de-hr"
	turnID := corr + ":" + participant

	// Simulate the citation append path.
	cl.Append(citationlog.Record{
		WorkspaceID: "ws-1",
		TurnID:      turnID,
		DocID:       "doc-sensitive",
		ChunkID:     "chunk-1",
		Tier:        "published",
		Score:       0.92,
		CreatedAt:   time.Now().UTC(),
	})

	// Active count should be 1.
	if got := cl.ActiveByDoc("ws-1", "doc-sensitive"); got != 1 {
		t.Fatalf("expected 1 active citation, got %d", got)
	}

	// Doc-delete guard must block.
	if err := cl.EnsureDeleted("ws-1", "doc-sensitive"); !errors.Is(err, citationlog.ErrActiveCitations) {
		t.Fatalf("expected ErrActiveCitations, got %v", err)
	}

	// After retraction, EnsureDeleted must pass.
	if err := cl.Retract("ws-1", "doc-sensitive", "test retraction"); err != nil {
		t.Fatalf("retract: %v", err)
	}
	if err := cl.EnsureDeleted("ws-1", "doc-sensitive"); err != nil {
		t.Fatalf("expected nil after retract, got %v", err)
	}

	// ListByTurn must surface exactly the record we appended (with our
	// participant-scoped turnID).
	records := cl.ListByTurn(turnID)
	if len(records) != 1 {
		t.Fatalf("expected 1 record under turnID=%s, got %d", turnID, len(records))
	}
	if records[0].DocID != "doc-sensitive" {
		t.Fatalf("docId mismatch: %q", records[0].DocID)
	}
}

// --- helpers ---

type capturedEvent struct {
	category string
	event    string
	payload  map[string]any
}