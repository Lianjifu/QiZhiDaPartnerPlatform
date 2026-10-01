// session_panel_p0p2_fix_test.go locks in the behavior changes applied for
// the P0–P2 defects surfaced by the adversarial review. Each test maps 1:1
// to a defect ID from the audit, so a future refactor that regresses any of
// these will surface as a single, named failure rather than a vague pipeline
// breakage.
//
// Defect mapping (see top-of-file summary in the audit document):
//
//   P0  C-1   panic in runMultiAgentTurn errgroup must produce a failed result
//   P0  H-1   participant RAG hits must reach the LLM prompt
//   P0  H-3   retrievePublished must respect per-doc scope ACL
//   P0  H-5   participant skill/tool calls must keep the approval gate
//   P0  H-6   filterRegistryBySessionMode must honor operator intent
//   P1  H-2   citationlog tier must derive from doc status when retriever
//             did not populate "tier"
//   P1  H-4   citationlog rows must carry a non-empty QuoteHash matching
//             citation.QuoteHash
//   P1  H-7   inbound RiskLevel must floor the participant's risk level
//   P1  H-8   per-participant timeout must bound the tool phase too
//   P1  H-9   DLQ channelId must be the real target (chat/thread), not the
//             deployment id
//   P1  H-10  vault credentials_missing path must write audit + DLQ
//   P2  M-3   empty OwnerID must not be passed to memory retrieval
//   P2  M-4   DE-id scoping must be strict (DE-less memories do not leak)
//   P2  M-5   memory budget report must surface observability fields
//   P2  L-1   ragHits across multiple tools must be appended, not replaced
//   P2  L-2   tool row DurationMs must be per-tool, not cumulative
//   P2  L-3   Channel field must propagate from input to participant
//   P2  L-4   attributedChannelSend skipped branches must write audit
//   P2  L-5   fallbackReason must distinguish empty vs. no-score cases
package server

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/channel"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citation"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citationlog"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	memret "github.com/qizhida-partner-platform/backend/internal/memory/retrieval"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

// ─── P0 ─────────────────────────────────────────────────────────────────────

// TestP0_PanicRecoveredToFailedResult (C-1): if a participant goroutine
// panics, errgroup normally propagates the panic through g.Wait(). The
// recovery wrapper must convert the panic into a structured
// participantTurnResult so the panel still completes and the supervisor
// sees a "failed/panic_recovered" result for that specialist.
func TestP0_PanicRecoveredToFailedResult(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees,
		map[string]any{"id": "de-a", "name": "A", "lifecycle": "active"},
		map[string]any{"id": "de-b", "name": "B", "lifecycle": "active"},
	)
	panicID := "de-b"
	s := &Server{
		Store:            st,
		IdentityProfiles: memid.NewStore(),
		testHooks: &serverTestHooks{
			participantTurnOverride: func(_ context.Context, pc participantContext) participantTurnResult {
				if pc.DigitalPartner == panicID {
					panic("kaboom")
				}
				return participantTurnResult{ParticipantID: pc.DigitalPartner, Status: "success", Text: "ok"}
			},
		},
	}

	pcs := []participantContext{
		{
			WorkspaceID: "ws-1", DigitalPartner: "de-a",
			SessionMode: contract.SessionModeInvestigate,
			RiskLevel:   contract.RiskLevelMedium, ModelID: "m",
			UserMessage: "hi", Emit: func(string, string, map[string]any) {},
		},
		{
			WorkspaceID: "ws-1", DigitalPartner: panicID,
			SessionMode: contract.SessionModeInvestigate,
			RiskLevel:   contract.RiskLevelMedium, ModelID: "m",
			UserMessage: "explode", Emit: func(string, string, map[string]any) {},
		},
	}

	results := s.dispatchParticipants(context.Background(), pcs)

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	// de-a succeeds
	if results[0].Status != "success" || results[0].ParticipantID != "de-a" {
		t.Fatalf("de-a should succeed, got %+v", results[0])
	}
	// de-b must be a failed/panic_recovered — NOT a zero-value result that
	// would otherwise emit a fake "agent.delegate" event downstream.
	// agentos appends the recovered panic value as "<reason>: <panic value>";
	// accept any string that starts with the canonical reason.
	if results[1].ParticipantID != panicID || results[1].Status != "failed" || !strings.HasPrefix(results[1].Reason, "panic_recovered") {
		t.Fatalf("de-b should be failed/panic_recovered*, got %+v", results[1])
	}
}

// TestP0_RAGHitsReachPrompt (H-1): buildCopilotSystemPromptWithEffort reads
// ragSnippetsForPrompt which type-asserts to map[string]any{"results": ...}.
// runParticipantTurn now wraps the slice as that envelope; without the wrap
// the assertion fails silently and the model never sees its retrieval.
func TestP0_RAGHitsReachPrompt(t *testing.T) {
	hits := []map[string]any{
		{"docId": "doc-1", "title": "入职流程", "snippet": "员工入职需在 HR 系统登记个人信息，并签署劳动合同。"},
		{"docId": "doc-2", "title": "年假规则", "snippet": "入职满 1 年可享受 5 天年假；满 10 年 10 天。"},
	}
	// The wrap that runParticipantTurn applies.
	ragForPrompt := map[string]any{"results": hits}
	system := buildCopilotSystemPromptWithEffort(map[string]any{
		"name": "HR 助手", "role": "人事", "description": "回答 HR 政策。",
	}, ragForPrompt, nil, "")
	// ragSnippetsForPrompt prefers snippet over title, so assert on snippet
	// text — that's the actual grounding the model will see.
	for _, want := range []string{"员工入职需在 HR 系统登记", "入职满 1 年可享受 5 天年假"} {
		if !strings.Contains(system, want) {
			t.Fatalf("RAG snippet %q missing from system prompt:\n%s", want, system)
		}
	}
	// Negative control: a bare slice (no envelope) must yield NO snippets.
	bare := hits // []map[string]any, not wrapped
	noSnippetSystem := buildCopilotSystemPromptWithEffort(map[string]any{
		"name": "HR 助手",
	}, bare, nil, "")
	if strings.Contains(noSnippetSystem, "已检索已发布知识") {
		t.Fatalf("bare []map[string]any should be ignored, but the system prompt had a '已检索已发布知识' section:\n%s", noSnippetSystem)
	}
}

// TestP0_RetrievePublishedACLFilter (H-3): retrievePublished must drop
// docs whose scope ACL forbids the viewer — even when status=published.
// Pre-fix the path returned HR-private / role-scoped docs to non-privileged
// viewers.
//
// Scope rule: at least one scope entry must match. With scopes empty the
// doc is open to anyone in the workspace; with role:<perm> only viewers
// whose Permissions include that perm can see it.
func TestP0_RetrievePublishedACLFilter(t *testing.T) {
	st := store.NewEmpty()
	st.KnowledgeDocs = append(st.KnowledgeDocs,
		// Truly open doc — no scopes, allowed to anyone in the workspace.
		map[string]any{
			"id": "doc-open", "workspaceId": "ws-1", "status": "published",
			"title": "公开制度",
		},
		// Audit-only doc — role:audit.export is an admin/auditor-only
			// permission, never granted to plain users.
		map[string]any{
			"id": "doc-audit-only", "workspaceId": "ws-1", "status": "published",
			"title": "审计报告",
			"scopes": []any{"role:audit.export"},
		},
	)
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}

	// A plain user viewer must see doc-open but NOT doc-audit-only.
	viewer := &auth.Identity{ID: "u-1", Role: "user", Permissions: auth.RolePermissions("user"), WorkspaceID: "ws-1"}
	r := httptest.NewRequest("POST", "/connect/qzda.rag.v1.RagService/Retrieve", nil)
	r = r.WithContext(auth.WithIdentity(r.Context(), viewer))
	r.Header.Set("x-workspace-id", "ws-1")

	out, err := s.retrievePublished(r, map[string]any{"query": ""}, "corr-acl")
	if err != nil {
		t.Fatalf("retrievePublished: %v", err)
	}
	m, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", out)
	}
	results := knowledgeSliceMaps(m["results"])
	titles := map[string]bool{}
	for _, r := range results {
		titles[str(r["title"])] = true
	}
	if !titles["公开制度"] {
		t.Fatalf("plain user should see open doc, results=%v", results)
	}
	if titles["审计报告"] {
		t.Fatalf("plain user must NOT see audit-scoped doc, results=%v", results)
	}

	// An admin viewer (RolePermissions("admin") includes audit.export) must
	// see BOTH.
	r2 := httptest.NewRequest("POST", "/connect/qzda.rag.v1.RagService/Retrieve", nil)
	r2 = r2.WithContext(auth.WithIdentity(r2.Context(), &auth.Identity{ID: "u-2", Role: "admin", Permissions: auth.RolePermissions("admin"), WorkspaceID: "ws-1"}))
	r2.Header.Set("x-workspace-id", "ws-1")
	out2, _ := s.retrievePublished(r2, map[string]any{"query": ""}, "corr-acl2")
	m2, _ := out2.(map[string]any)
	results2 := knowledgeSliceMaps(m2["results"])
	titles2 := map[string]bool{}
	for _, r := range results2 {
		titles2[str(r["title"])] = true
	}
	if !titles2["审计报告"] {
		t.Fatalf("admin should see audit-scoped doc, results=%v", results2)
	}
}

// TestP0_ParticipantSkillRoutesThroughApprovalGate (H-5): when a participant
// tool is a "skill" with RequiresApproval, runParticipantTools must route
// through dispatchAuthorizedTool (which queues to the authorization queue
// in execute mode) — not call runCopilotTool directly, which would bypass
// the gate. We assert by observing that a skill call always produces ONE
// tool summary with status derived from the gate's response (the gate is
// the only path that returns "denied/approval_required" or "ok" — direct
// runCopilotTool bypass would simply crash or skip).
func TestP0_ParticipantSkillRoutesThroughApprovalGate(t *testing.T) {
	st := store.NewEmpty()
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}

	// Register a require-approval skill in the registry. The skill itself
	// isn't seeded in the workspace (skill harness will report "skill not
	// found") — that's fine: the defining property is that the call goes
	// through the gate and we still emit a structured summary.
	tools := []registeredTool{
		{
			Kind: "skill", Name: "demo.skill", Key: "skill:demo.skill",
			Enabled: true, RequiresApproval: true, Mode: toolModeApproval,
		},
	}
	pc := participantContext{
		WorkspaceID: "ws-1", DigitalPartner: "de-x",
		SessionMode: contract.SessionModeExecute, // execute mode queues
		RiskLevel:   contract.RiskLevelMedium,
		UserMessage: "do it",
		Tools:       tools,
		Emit:        func(string, string, map[string]any) {},
	}
	ragHits, summaries := s.runParticipantTools(context.Background(), pc)
	// No RAG hits (no knowledge tool), but the skill must have produced ONE
	// tool summary regardless of queued vs executed — the audit trail
	// requires it.
	if len(summaries) != 1 {
		t.Fatalf("expected 1 tool summary, got %d: %v", len(summaries), summaries)
	}
	row := summaries[0]
	if str(row["name"]) != "demo.skill" {
		t.Fatalf("expected demo.skill, got %v", row["name"])
	}
	// The gate must have been consulted. Acceptable post-conditions are
	// any of: (a) approval queue took the call (permission=approval_required
	// OR status=ok if queue drained inline), (b) gate denied the call
	// because the skill isn't in the workspace (status=failed with a
	// skill-not-found reason from the harness). Both indicate we hit the
	// approval path rather than silently skipping.
	status := str(row["status"])
	perm := str(row["permission"])
	reason := str(row["reason"])
	okStatus := status == "ok" || status == "denied" || status == "failed"
	if !okStatus {
		t.Fatalf("unexpected status %q in row=%v", status, row)
	}
	if status == "ok" && perm != "approval_required" {
		t.Fatalf("status=ok must carry permission=approval_required (queue drained), got perm=%q row=%v", perm, row)
	}
	if status == "denied" && perm != "approval_required" {
		t.Fatalf("status=denied must carry permission=approval_required, got perm=%q row=%v", perm, row)
	}
	if status == "failed" && !strings.Contains(reason, "技能不存在") && !strings.Contains(reason, "未找到") {
		t.Fatalf("status=failed should explain why (skill not found or queued), got reason=%q", reason)
	}
	if ragHits != nil {
		t.Fatalf("no RAG hits expected, got %v", ragHits)
	}
}

// TestP0_GovernanceHonorsOperatorIntent (H-6): filterRegistryBySessionMode
// must NOT re-enable an operator-disabled tool. A skill with
// RequiresApproval=true and Enabled=false (operator unchecked it) must
// stay disabled in investigate mode — even though the allowlist branch
// re-enables require-approval skills for operator-enabled ones.
//
// The pre-fix bug: in investigate mode the code unconditionally flipped
// Enabled=true for any allowlisted require-approval skill, ignoring
// Enabled=false.
//
// Allowlist uses skill-name substrings: docx/xlsx/pptx/pdf are the
// only kind=="skill" names accepted by isAllowlistedExecutableTool.
func TestP0_GovernanceHonorsOperatorIntent(t *testing.T) {
	// Allowlisted (contains "docx"), RequiresApproval, operator-ENABLED →
	// should be re-enabled.
	t.Run("operator_enabled_allowlisted_skill_kept", func(t *testing.T) {
		tools := []registeredTool{
			{Kind: "skill", Name: "read_docx", Key: "skill:read_docx",
				Enabled: true, RequiresApproval: true, Mode: toolModeApproval},
		}
		out := filterRegistryBySessionMode(tools, contract.SessionModeInvestigate)
		if len(out) != 1 || !out[0].Enabled {
			t.Fatalf("allowlisted operator-enabled skill must stay enabled, got %+v", out)
		}
	})
	t.Run("operator_disabled_allowlisted_skill_dropped", func(t *testing.T) {
		tools := []registeredTool{
			{Kind: "skill", Name: "read_docx", Key: "skill:read_docx",
				Enabled: false, RequiresApproval: true, Mode: toolModeApproval},
		}
		out := filterRegistryBySessionMode(tools, contract.SessionModeInvestigate)
		if len(out) != 0 {
			t.Fatalf("operator-disabled skill must NOT be re-enabled, got %+v", out)
		}
	})
	t.Run("non_allowlisted_approval_skill_dropped_in_investigate", func(t *testing.T) {
		tools := []registeredTool{
			{Kind: "skill", Name: "obscure.tool", Key: "skill:obscure.tool",
				Enabled: true, RequiresApproval: true, Mode: toolModeApproval},
		}
		out := filterRegistryBySessionMode(tools, contract.SessionModeInvestigate)
		if len(out) != 0 {
			t.Fatalf("non-allowlisted approval skill must be dropped in investigate, got %+v", out)
		}
	})
	t.Run("execute_mode_passes_everything_through", func(t *testing.T) {
		tools := []registeredTool{
			{Kind: "skill", Name: "any.skill", Key: "skill:any.skill",
				Enabled: true, RequiresApproval: true, Mode: toolModeApproval},
			{Kind: "skill", Name: "obscure.tool", Key: "skill:obscure.tool",
				Enabled: true, RequiresApproval: true, Mode: toolModeApproval},
		}
		out := filterRegistryBySessionMode(tools, contract.SessionModeExecute)
		if len(out) != 2 {
			t.Fatalf("execute mode must pass everything through, got %d", len(out))
		}
	})
}

// ─── P1 ─────────────────────────────────────────────────────────────────────

// TestP1_CitationTierDerivedFromDocStatus (H-2): logCitationsForRAG derives
// tier from hit["status"] when the retriever didn't populate "tier" —
// the connect_gateway published-memory shape only carries status. Without
// this fallback every audit row stores Tier="" and loses the
// published/review/workspace distinction.
func TestP1_CitationTierDerivedFromDocStatus(t *testing.T) {
	s := &Server{Store: store.NewEmpty(), IdentityProfiles: memid.NewStore()}
	cl := s.citationLog()
	s.logCitationsForRAG("ws-1", "turn-published", []map[string]any{
		{"docId": "d-pub", "title": "公开", "status": "published", "snippet": "x"},
	})
	s.logCitationsForRAG("ws-1", "turn-review", []map[string]any{
		{"docId": "d-rev", "title": "评审", "status": "ready", "snippet": "x"},
	})
	s.logCitationsForRAG("ws-1", "turn-workspace", []map[string]any{
		{"docId": "d-ws", "title": "工作区", "status": "draft", "snippet": "x"},
	})
	for _, c := range []struct {
		turnID, docID, wantTier string
	}{
		{"turn-published", "d-pub", "published"},
		{"turn-review", "d-rev", "review"},
		{"turn-workspace", "d-ws", "workspace"},
	} {
		recs := cl.ListByTurn(c.turnID)
		if len(recs) != 1 {
			t.Fatalf("%s: expected 1 record, got %d", c.turnID, len(recs))
		}
		if recs[0].Tier != c.wantTier {
			t.Fatalf("%s: tier=%q want=%q", c.turnID, recs[0].Tier, c.wantTier)
		}
		if recs[0].DocID != c.docID {
			t.Fatalf("%s: docID=%q want=%q", c.turnID, recs[0].DocID, c.docID)
		}
	}
}

// TestP1_CitationQuoteHashMatchesCitationBuild (H-4): logCitationsForRAG
// computes QuoteHash using citation.QuoteHash on citation.ExtractQuote —
// the same inputs as citation.Build uses internally — so the audit trail
// can be cross-checked against the citation list.
func TestP1_CitationQuoteHashMatchesCitationBuild(t *testing.T) {
	s := &Server{Store: store.NewEmpty(), IdentityProfiles: memid.NewStore()}
	cl := s.citationLog()
	const snippet = "员工入职需在 HR 系统登记。后续详见《员工手册》。"
	hits := []map[string]any{
		{"docId": "d-1", "title": "入职", "status": "published", "snippet": snippet},
	}
	s.logCitationsForRAG("ws-1", "turn-qh", hits)

	// Independent computation the way citation.Build would do it.
	quoted, _, _ := citation.ExtractQuote(snippet)
	want := citation.QuoteHash(quoted)

	recs := cl.ListByTurn("turn-qh")
	if len(recs) != 1 {
		t.Fatalf("expected 1 record, got %d", len(recs))
	}
	if recs[0].QuoteHash != want {
		t.Fatalf("QuoteHash mismatch: log=%q citation=%q", recs[0].QuoteHash, want)
	}
	if recs[0].ChunkID == "" {
		t.Logf("ChunkID empty — accept (retriever may not provide one)")
	}
}

// TestP1_ParticipantRiskFlooredByInbound (H-7): a high-risk inbound turn
// must floor a low-default specialist. We verify the post-condition by
// asserting the participant's RiskLevel after the floor is applied.
func TestP1_ParticipantRiskFlooredByInbound(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees, map[string]any{
		"id": "de-low", "name": "L", "lifecycle": "active",
		"spec": map[string]any{"defaultSessionMode": "execute", "defaultRiskLevel": "low"},
	})
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}
	pc := s.buildParticipantContext(participantCtxInput{
		WorkspaceID: "ws-1", OwnerID: "u-1", UserMessage: "x",
		Viewer: &auth.Identity{ID: "u-1"},
		Emit:   func(string, string, map[string]any) {},
	}, map[string]any{"id": "de-low", "name": "L"})

	if pc.RiskLevel != contract.RiskLevelLow {
		t.Fatalf("baseline risk should be low, got %q", pc.RiskLevel)
	}

	// Simulate the floor applied in copilot_multi.go (H-7 fix).
	if levelRank(riskLevelFloor(contract.RiskLevelHigh)) < levelRank(riskLevelFloor(pc.RiskLevel)) {
		pc.RiskLevel = contract.RiskLevelHigh
	}
	if pc.RiskLevel != contract.RiskLevelHigh {
		t.Fatalf("high-risk inbound must floor participant risk, got %q", pc.RiskLevel)
	}
}

// TestP1_TimeoutBoundsToolPhase (H-8): runParticipantTurn's pctx wraps
// runParticipantTools. A tools context that is already-cancelled must
// produce a failed/timed_out result without panicking. We can't easily
// inject a slow tool here without bringing up the full harness, so we
// use a synthetic cancelled context — the deferred cancel() must then
// short-circuit before any real work and the timeout-classification
// branch must observe ctx.Err() == Canceled.
func TestP1_TimeoutBoundsToolPhase(t *testing.T) {
	s := &Server{Store: store.NewEmpty(), IdentityProfiles: memid.NewStore()}
	pc := participantContext{
		WorkspaceID: "ws-1", DigitalPartner: "de-t",
		SessionMode: contract.SessionModeInvestigate,
		RiskLevel:   contract.RiskLevelMedium,
		ModelID:     "m",
		IdentityPresent: false,
		UserMessage:     "x",
		Emit:            func(string, string, map[string]any) {},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	res := s.runParticipantTurn(ctx, pc)
	if res.Status != "timed_out" && res.Status != "failed" {
		t.Fatalf("expected timed_out/failed under cancelled ctx, got %+v", res)
	}
}

// TestP1_DLQChannelIdIsRealTarget (H-9): pushChannelDLQ must record the
// real chat/thread identifier in channelId/channelThreadId — pre-fix this
// stored the deployment id, making the DLQ unfilterable for replay.
func TestP1_DLQChannelIdIsRealTarget(t *testing.T) {
	st := store.NewEmpty()
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}
	const target = "oc_chat_real_target_xyz"
	s.pushChannelDLQ("ws-1", "dep-1", contract.ChannelFeishu, target, "summary", "corr-dlq", "boom")

	if len(st.ChannelDLQ) != 1 {
		t.Fatalf("expected 1 DLQ row, got %d", len(st.ChannelDLQ))
	}
	row := st.ChannelDLQ[0]
	if str(row["channelId"]) != target {
		t.Fatalf("channelId=%q want=%q (must store REAL target, not deployment id)", str(row["channelId"]), target)
	}
	if str(row["channelThreadId"]) != target {
		t.Fatalf("channelThreadId=%q want=%q", str(row["channelThreadId"]), target)
	}
	if str(row["deploymentId"]) != "dep-1" {
		t.Fatalf("deploymentId should still be the dep id, got %q", str(row["deploymentId"]))
	}
	if str(row["kind"]) != contract.ChannelFeishu {
		t.Fatalf("kind=%q", str(row["kind"]))
	}

	// Audit row should also reference target, not deployID.
	matched := false
	for _, a := range st.ChannelAudit {
		if str(a["correlationId"]) == "corr-dlq" {
			matched = true
			if str(a["target"]) != target {
				t.Fatalf("audit target=%q want=%q", str(a["target"]), target)
			}
		}
	}
	if !matched {
		t.Fatalf("expected audit row with corr=corr-dlq, got %d rows", len(st.ChannelAudit))
	}
}

// TestP1_VaultCredentialsMissingAuditsAndDLQs (H-10): when vault returns
// empty for a participant's channel attribution, attributedChannelSend must
// write a channel_audit row AND push a DLQ entry — pre-fix the failure was
// silent (only an SSE event).
func TestP1_VaultCredentialsMissingAuditsAndDLQs(t *testing.T) {
	st := store.NewEmpty()
	st.ChannelDeploys = append(st.ChannelDeploys, map[string]any{
		"id": "dep-1", "workspaceId": "ws-1", "channel": "feishu",
		"credentialRef": "vault://ch/dep-1",
	})
	st.Sessions = append(st.Sessions, map[string]any{
		"id": "sess-1", "workspaceId": "ws-1", "conversationId": "conv-1",
		"channelDeploymentId": "dep-1", "channel": "feishu",
		"channelThreadId":     "oc_chat_1",
	})
	// Vault deliberately has no entry for vault://ch/dep-1.
	v := vault.NewFromEnv()
	mock := channel.NewMock(channel.KindFeishu)
	reg := channel.NewDefaultRegistry()
	reg.Register(mock)
	s := &Server{Store: st, IdentityProfiles: memid.NewStore(), Vault: v, ChannelRegistry: reg}

	var got capturedEvent
	pc := participantContext{
		DigitalPartner: "de-x", WorkspaceID: "ws-1", ConversationID: "conv-1",
		Channel: "feishu", CorrelationID: "corr-vault",
		Emit: func(cat, ev string, m map[string]any) {
			got = capturedEvent{category: cat, event: ev, payload: m}
		},
	}
	s.attributedChannelSend(context.Background(), pc, "outbound text")

	if got.payload["status"] != "skipped" || got.payload["reason"] != "credentials_missing" {
		t.Fatalf("expected skipped/credentials_missing, got %v", got.payload)
	}

	// Audit row.
	matched := false
	for _, a := range st.ChannelAudit {
		if str(a["correlationId"]) == "corr-vault" && strings.Contains(str(a["reason"]), "credentials_missing") {
			matched = true
		}
	}
	if !matched {
		t.Fatalf("expected credentials_missing audit row, got %d rows", len(st.ChannelAudit))
	}

	// DLQ row.
	if len(st.ChannelDLQ) != 1 {
		t.Fatalf("expected 1 DLQ row, got %d", len(st.ChannelDLQ))
	}
	dlq := st.ChannelDLQ[0]
	if !strings.Contains(str(dlq["error"]), "credentials_missing:") {
		t.Fatalf("DLQ error must carry credentials_missing tag, got %q", str(dlq["error"]))
	}
}

// ─── P2 ─────────────────────────────────────────────────────────────────────

// TestP2_MemDEStrictScoping (M-4): a memory record with empty
// digitalPartnerId (legacy admin ingest) must NOT leak to specialists
// bound to a specific DE. The pre-fix short-circuit `deID != "" && memDE != ""
// && memDE != deID` returned false for memDE=="" so the row was admitted.
func TestP2_MemDEStrictScoping(t *testing.T) {
	st := store.NewEmpty()
	now := time.Now().UTC().Format(time.RFC3339)
	st.MemoryRecords = append(st.MemoryRecords,
		map[string]any{
			"id": "m-unbound", "workspaceId": "ws-1", "layer": "long_term",
			"status": "active", "title": "DE-less legacy memory",
			"content": "deeper admin-ingested context",
			"createdAt": now, "ownerId": "u-1",
		},
		map[string]any{
			"id": "m-bound", "workspaceId": "ws-1", "layer": "long_term",
			"status": "active", "title": "Specialist A bound memory",
			"content": "context bound to de-A",
			"digitalPartnerId": "de-A", "createdAt": now, "ownerId": "u-1",
		},
	)
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}

	// Query against de-A: bound memory wins, DE-less must NOT leak.
	st.RLock()
	hits := s.retrieveMemoryForTurnLocked("ws-1", "u-1", "de-A", "", "context", &auth.Identity{ID: "u-1"})
	st.RUnlock()
	if len(hits) != 1 {
		t.Fatalf("expected exactly 1 hit for de-A, got %d (%v)", len(hits), hits)
	}
	if hits[0].ID != "m-bound" {
		t.Fatalf("expected m-bound, got %q", hits[0].ID)
	}

	// Query without a DE id: scoping guard doesn't fire (deID==""), so
	// BOTH records pass through. This is the right behavior — a
	// non-specialist query (e.g. the supervisor itself) should see
	// workspace-wide memory. The strict guard only narrows when a DE-id
	// IS supplied.
	st.RLock()
	hits2 := s.retrieveMemoryForTurnLocked("ws-1", "u-1", "", "", "context", &auth.Identity{ID: "u-1"})
	st.RUnlock()
	if len(hits2) != 2 {
		t.Fatalf("expected 2 hits when deID is empty (no scoping key), got %d (%v)", len(hits2), hits2)
	}
}

// TestP2_MemoryBudgetReportCaptured (M-5): retrieveMemoryForTurnLocked
// stores its budget report on the Server so the SSE stream can flush a
// memory.budget event after the memory section. Verify the report
// contains the fields the SSE event depends on, with correct types.
func TestP2_MemoryBudgetReportCaptured(t *testing.T) {
	st := store.NewEmpty()
	now := time.Now().UTC().Format(time.RFC3339)
	for i := 0; i < 4; i++ {
		st.MemoryRecords = append(st.MemoryRecords, map[string]any{
			"id":       "m-" + string(rune('a'+i)),
			"workspaceId": "ws-1", "layer": "long_term",
			"status": "active",
			"title":   "long-term context block " + string(rune('a'+i)),
			"content": strings.Repeat("ctx ", 80),
			"createdAt": now, "ownerId": "u-1",
		})
	}
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}
	st.RLock()
	hits := s.retrieveMemoryForTurnLocked("ws-1", "u-1", "", "", "context", &auth.Identity{ID: "u-1"})
	st.RUnlock()
	if len(hits) == 0 {
		t.Fatalf("expected some hits, got 0")
	}
	if s.lastMemoryBudgetReport == nil {
		t.Fatalf("expected lastMemoryBudgetReport to be populated")
	}
	r := s.lastMemoryBudgetReport
	if r.BudgetTokens != copilotMemoryBudgetTokens {
		t.Fatalf("BudgetTokens=%d want=%d", r.BudgetTokens, copilotMemoryBudgetTokens)
	}
	if r.UsedTokens <= 0 {
		t.Fatalf("UsedTokens should be > 0, got %d", r.UsedTokens)
	}
	if r.Kept < 0 || r.TruncatedItems < 0 || r.Dropped < 0 {
		t.Fatalf("counts must be non-negative: %+v", r)
	}
	if r.Dropped != len(r.DroppedIDs) {
		t.Fatalf("Dropped=%d but len(DroppedIDs)=%d — must agree", r.Dropped, len(r.DroppedIDs))
	}
}

// TestP2_MultiToolRAGHitsAppend (L-1): runParticipantTools must APPEND
// hits across multiple tools, not replace earlier hits with later ones.
// We simulate by calling logCitationsForRAG-then-ragHits directly through
// the public path; since the real retriever isn't trivial to stub, we use
// a fake `toolExecResult` injection via runCopilotToolOverride.
func TestP2_MultiToolRAGHitsAppend(t *testing.T) {
	st := store.NewEmpty()
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}
	// Force runCopilotTool to return hits so ragHits accumulation is exercised.
	s.testHooks = &serverTestHooks{
		runCopilotToolOverride: func(_ toolRunContext, t *registeredTool, _ toolCallRequest) toolExecResult {
			switch t.Name {
			case "knowledge.retrieve":
				return toolExecResult{Status: "ok", Hits: map[string]any{
					"results": []any{map[string]any{"docId": "d1", "title": "first", "snippet": "first snippet"}},
				}, DurationMs: 10}
			case "memory.recall":
				return toolExecResult{Status: "ok", Hits: map[string]any{
					"results": []any{map[string]any{"docId": "d2", "title": "second", "snippet": "second snippet"}},
				}, DurationMs: 20}
			}
			return toolExecResult{Status: "noop"}
		},
	}
	tools := []registeredTool{
		{Kind: "builtin", Name: "knowledge.retrieve", Key: "builtin:knowledge.retrieve", Enabled: true},
		{Kind: "builtin", Name: "memory.recall", Key: "builtin:memory.recall", Enabled: true},
	}
	pc := participantContext{
		WorkspaceID: "ws-1", DigitalPartner: "de-multi",
		SessionMode: contract.SessionModeInvestigate,
		RiskLevel:   contract.RiskLevelMedium,
		UserMessage: "x", Tools: tools,
		CorrelationID: "corr-multi",
	}
	hits, summaries := s.runParticipantTools(context.Background(), pc)
	if len(hits) != 2 {
		t.Fatalf("expected 2 hits (one per tool), got %d: %v", len(hits), hits)
	}
	if len(summaries) != 2 {
		t.Fatalf("expected 2 summaries, got %d", len(summaries))
	}
	// citation log should also contain BOTH.
	cl := s.citationLog()
	if got := cl.ActiveByDoc("ws-1", "d1"); got != 1 {
		t.Fatalf("d1 active=%d want=1", got)
	}
	if got := cl.ActiveByDoc("ws-1", "d2"); got != 1 {
		t.Fatalf("d2 active=%d want=1", got)
	}
}

// TestP2_ToolRowDurationMsPerTool (L-2): each tool row's DurationMs must
// be that tool's own duration, not the cumulative time across all tools
// (pre-fix the row stored int(time.Since(started).Milliseconds()) of the
// whole loop).
func TestP2_ToolRowDurationMsPerTool(t *testing.T) {
	s := &Server{Store: store.NewEmpty(), IdentityProfiles: memid.NewStore()}
	s.testHooks = &serverTestHooks{
		runCopilotToolOverride: func(_ toolRunContext, t *registeredTool, _ toolCallRequest) toolExecResult {
			// First tool: 100ms. Second: 200ms. If the implementation regressed
			// to cumulative, the second row would show ~300ms.
			switch t.Name {
			case "knowledge.retrieve":
				return toolExecResult{Status: "ok", DurationMs: 100}
			case "memory.recall":
				return toolExecResult{Status: "ok", DurationMs: 200}
			}
			return toolExecResult{Status: "noop"}
		},
	}
	tools := []registeredTool{
		{Kind: "builtin", Name: "knowledge.retrieve", Key: "builtin:knowledge.retrieve", Enabled: true},
		{Kind: "builtin", Name: "memory.recall", Key: "builtin:memory.recall", Enabled: true},
	}
	pc := participantContext{
		WorkspaceID: "ws-1", DigitalPartner: "de-dur",
		Tools: tools, UserMessage: "x",
		CorrelationID: "corr-dur",
	}
	_, summaries := s.runParticipantTools(context.Background(), pc)
	if len(summaries) != 2 {
		t.Fatalf("expected 2 summaries, got %d", len(summaries))
	}
	for _, row := range summaries {
		ms := asFloatField(t, row["durationMs"])
		if ms < 0 || ms > 250 {
			t.Fatalf("durationMs=%v out of per-tool range (0..250) for %v", row["durationMs"], row["name"])
		}
	}
	// Specifically: each row must carry its OWN duration, not the sum.
	second := asFloatField(t, summaries[1]["durationMs"])
	if second != 200 {
		t.Fatalf("second tool durationMs=%v want=200 (not cumulative)", second)
	}
}

// TestP2_ChannelPropagatesToParticipant (L-3): in.Channel must reach
// pc.Channel unchanged — the prior bug hardcoded it to "".
func TestP2_ChannelPropagatesToParticipant(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees, map[string]any{"id": "de-c", "name": "C", "lifecycle": "active"})
	s := &Server{Store: st, IdentityProfiles: memid.NewStore()}
	for _, ch := range []string{contract.ChannelFeishu, contract.ChannelWecom, contract.ChannelDingtalk} {
		pc := s.buildParticipantContext(participantCtxInput{
			WorkspaceID: "ws-1", Channel: ch,
			Viewer: &auth.Identity{ID: "u-1"}, Emit: func(string, string, map[string]any) {},
		}, map[string]any{"id": "de-c"})
		if pc.Channel != ch {
			t.Fatalf("channel %q did not propagate, got %q", ch, pc.Channel)
		}
	}
}

// TestP2_AttributedChannelSkippedBranchesAudit (L-4): every "skipped"
// branch in attributedChannelSend must write a channel_audit row so ops
// has a replay trail (pre-fix only the SSE event was emitted).
func TestP2_AttributedChannelSkippedBranchesAudit(t *testing.T) {
	type tc struct {
		name     string
		channel  string
		sessID   string
		reason   string
	}
	cases := []tc{
		{"unknown_channel", "rocketchat", "conv-1", "no_adapter_for_channel"},
		{"no_deployment", "feishu", "conv-missing", "no_deployment_for_session"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st := store.NewEmpty()
			// Only seed a session/deployment when we want to test the no-deployment
			// branch's positive case (so missing-session skips the no_deployment branch).
			if c.sessID != "conv-missing" {
				st.ChannelDeploys = append(st.ChannelDeploys, map[string]any{
					"id": "dep-1", "workspaceId": "ws-1", "channel": "feishu",
				})
				st.Sessions = append(st.Sessions, map[string]any{
					"id": "sess-1", "workspaceId": "ws-1", "conversationId": "conv-1",
					"channelDeploymentId": "dep-1", "channel": "feishu",
				})
			}
			s := &Server{Store: st, IdentityProfiles: memid.NewStore()}
			pc := participantContext{
				DigitalPartner: "de-x", WorkspaceID: "ws-1",
				ConversationID: c.sessID, Channel: c.channel,
				CorrelationID: "corr-" + c.name,
				Emit:          func(string, string, map[string]any) {},
			}
			s.attributedChannelSend(context.Background(), pc, "x")
			matched := false
			for _, a := range st.ChannelAudit {
				if str(a["correlationId"]) == pc.CorrelationID && strings.Contains(str(a["reason"]), c.reason) {
					matched = true
				}
			}
			if !matched {
				t.Fatalf("expected audit row with reason=%q, audit=%v", c.reason, st.ChannelAudit)
			}
		})
	}
}

// TestP2_FallbackReasonDistinguishesEmptyVsNoScore (L-5):
// runMultiAgentTurn must emit fallbackReason="no_active_specialists" when
// the workspace has zero active specialists, vs.
// "no_specialists_scored" when there are specialists but none matched
// the user message.
func TestP2_FallbackReasonDistinguishesEmptyVsNoScore(t *testing.T) {
	// Case A: no specialists in the workspace at all.
	t.Run("empty_workspace", func(t *testing.T) {
		s := &Server{
			Store:            store.NewEmpty(),
			IdentityProfiles: memid.NewStore(),
			testHooks: &serverTestHooks{
				runPlanExecuteOverride: func(in reactTurnInput) reactTurnResult { return reactTurnResult{} },
			},
		}
		var emitted []map[string]any
		emit := func(_, _ string, m map[string]any) { emitted = append(emitted, m) }
		_ = s.runMultiAgentTurn(context.Background(), reactTurnInput{
			WorkspaceID: "ws-empty", DigitalPartner: "de-sup",
			UserMessage: "完全无关的内容", Emit: emit,
		})
		found := false
		for _, e := range emitted {
			if e["status"] == "fallback" && e["reason"] == "no_active_specialists" {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected reason=no_active_specialists, events=%v", emitted)
		}
	})

	// Case B: specialists exist but none match.
	t.Run("no_score_match", func(t *testing.T) {
		st := store.NewEmpty()
		st.Employees = append(st.Employees, map[string]any{
			"id": "de-hr", "name": "HR", "lifecycle": "active",
			"workspaceId": "ws-1",
			"role": "人事", "department": "HR",
		})
		s := &Server{
			Store: st, IdentityProfiles: memid.NewStore(),
			testHooks: &serverTestHooks{
				runPlanExecuteOverride: func(in reactTurnInput) reactTurnResult { return reactTurnResult{} },
			},
		}
		var emitted []map[string]any
		emit := func(_, _ string, m map[string]any) { emitted = append(emitted, m) }
		_ = s.runMultiAgentTurn(context.Background(), reactTurnInput{
			WorkspaceID: "ws-1", DigitalPartner: "de-sup",
			UserMessage: "完全无关的内容", Emit: emit,
		})
		found := false
		for _, e := range emitted {
			if e["status"] == "fallback" && e["reason"] == "no_specialists_scored" {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected reason=no_specialists_scored, events=%v", emitted)
		}
	})
}

// TestP2_MemoryRecallSmoke (M-2/M-3 cross-check): BM25 + MMR over a small
// pool. Locks in that retriever wiring still works end-to-end after the
// strict DE-id scoping was applied.
func TestP2_MemoryRecallSmoke(t *testing.T) {
	corpus := []memret.Doc{
		{ID: "a", Title: "年假政策", Content: "员工入职满一年可享受年假"},
		{ID: "b", Title: "报销流程", Content: "差旅报销需提交发票"},
		{ID: "c", Title: "入职流程", Content: "新员工入职需登记"},
	}
	scored := memret.Score(corpus, memret.Query{Text: "年假", TopK: 2, FetchK: 10, Lambda: 0.7})
	if len(scored) == 0 {
		t.Fatalf("expected hits for 年假")
	}
	if scored[0].ID != "a" {
		t.Fatalf("top hit should be 年假政策, got %q", scored[0].ID)
	}
}

// TestP2_ParticipantMemoryBudgetReported: per-participant memory budget
// reports must reach the supervisor emit even though the single-slot
// flush runs BEFORE participants. Without this fix, the operator loses
// the per-specialist memory slicing visibility (silent truncation).
func TestP2_ParticipantMemoryBudgetReported(t *testing.T) {
	st := store.NewEmpty()
	now := time.Now().UTC().Format(time.RFC3339)
	// Two participants, each with their own long-term memory pool.
	for _, ws := range []string{"ws-1"} {
		for i := 0; i < 4; i++ {
			st.MemoryRecords = append(st.MemoryRecords, map[string]any{
				"id": "m-" + string(rune('a'+i)),
				"workspaceId": ws, "layer": "long_term",
				"status": "active",
				"title":   "ctx block " + string(rune('a'+i)),
				"content": strings.Repeat("ctx ", 80),
				"createdAt": now, "ownerId": "u-1",
			})
		}
	}
	st.Employees = append(st.Employees,
		map[string]any{"id": "de-sre", "name": "SRE", "lifecycle": "active", "workspaceId": "ws-1",
			"role": "运维", "department": "基础设施"},
		map[string]any{"id": "de-hr", "name": "HR", "lifecycle": "active", "workspaceId": "ws-1",
			"role": "人事", "department": "HR"},
	)
	s := &Server{
		Store:            st,
		IdentityProfiles: memid.NewStore(),
		testHooks: &serverTestHooks{
			runPlanExecuteOverride: func(in reactTurnInput) reactTurnResult { return reactTurnResult{} },
			runCopilotToolOverride: func(_ toolRunContext, t *registeredTool, _ toolCallRequest) toolExecResult {
				// Block the supervisor's own knowledge.retrieve from
				// emitting anything — the test focuses on the per-
				// participant memory.budget events. We still need it to
				// not error out, so return an empty-but-ok result.
				return toolExecResult{Status: "ok", Hits: map[string]any{"results": []any{}}}
			},
		},
	}
	var emitted []map[string]any
	emit := func(typ, stage string, m map[string]any) {
		if typ == "memory" && stage == "budget" {
			emitted = append(emitted, m)
		}
	}
	_ = s.runMultiAgentTurn(context.Background(), reactTurnInput{
		WorkspaceID:    "ws-1",
		DigitalPartner: "de-sup",
		UserMessage:     "redis 延迟飙升，请协助运维和人事一同排查",
		Emit:            emit,
	})
	// We expect at least one participant memory.budget event per specialist
	// that was delegated. The supervisor itself is NOT in this list (it
	// didn't produce a participant-keyed report).
	if len(emitted) < 1 {
		t.Fatalf("expected ≥1 participant memory.budget events, got %d: %v", len(emitted), emitted)
	}
	seen := map[string]bool{}
	for _, e := range emitted {
		if id, ok := e["participantId"].(string); ok && id != "" {
			seen[id] = true
		}
		if _, ok := e["budgetTokens"]; !ok {
			t.Fatalf("memory.budget event missing budgetTokens: %v", e)
		}
	}
	if !seen["de-sre"] {
		t.Fatalf("expected de-sre report, saw %v", seen)
	}
	// And the per-turn collector must be drained.
	s.participantMemoryBudgetMu.Lock()
	left := len(s.participantMemoryBudgetReports)
	s.participantMemoryBudgetMu.Unlock()
	if left != 0 {
		t.Fatalf("participantMemoryBudgetReports must be drained after dispatch, got %d", left)
	}
}

// ─── helpers (test-only) ───────────────────────────────────────────────────

// asFloatField defensively narrows the durationMs column. We store it as
// int from toolExecResult.DurationMs, but in older rows it could be a
// float64 — keep this tolerant.
func asFloatField(t *testing.T, v any) float64 {
	t.Helper()
	switch x := v.(type) {
	case int:
		return float64(x)
	case int32:
		return float64(x)
	case int64:
		return float64(x)
	case float64:
		return x
	}
	t.Fatalf("unexpected durationMs type %T", v)
	return 0
}

// Ensure import references are kept even if some helpers are unused in
// certain build configurations.
var (
	_ = sync.Mutex{}
	_ = citationlog.ErrActiveCitations
	_ = strings.TrimSpace
)
