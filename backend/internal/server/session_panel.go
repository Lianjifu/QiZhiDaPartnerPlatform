package server

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/channel"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citation"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citationlog"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// logCitationsForRAG writes one citationlog row per hit into the global log
// keyed by turnID (correlationID[:participantID]). Used by both
// runParticipantTools (per-participant) and the supervisor shared retrieve.
//
// QuoteHash uses citation.QuoteHash on the extracted (first-sentence) quote —
// the same input as citation.Build — so dedup + retraction in the downstream
// citation package lines up with the audit trail.
//
// Tier is derived from the hit's status field when the retriever didn't
// populate "tier" directly (the connect_gateway published-memory shape
// only carries {docId, title, snippet, status, score}); without this fallback
// every audit row would store Tier="" and lose the published/review/workspace
// distinction that downstream consumers rely on.
func (s *Server) logCitationsForRAG(ws, turnID string, hits []map[string]any) {
	if len(hits) == 0 || s.Store == nil {
		return
	}
	cl := s.citationLog()
	for _, h := range hits {
		snippet := coalesce(str(h["snippet"]), str(h["title"]))
		quoted, _, _ := citation.ExtractQuote(snippet)
		tier := str(h["tier"])
		if tier == "" {
			tier = string(citationTierFromDocStatus(str(h["status"])))
		}
		cl.Append(citationlog.Record{
			WorkspaceID: ws,
			TurnID:      turnID,
			DocID:       str(h["docId"]),
			ChunkID:     str(h["chunkId"]),
			Tier:        tier,
			QuoteHash:   citation.QuoteHash(quoted),
			Score:       func() float64 { f, _ := asFloat(h["score"]); return f }(),
			CreatedAt:   time.Now().UTC(),
		})
	}
}

// participantCtxInput is the dispatch-side carrier for building a
// participantContext. The Server pulls identity / memory / model / skill /
// channel data per participant.
type participantCtxInput struct {
	WorkspaceID     string
	ConversationID  string
	CorrelationID   string
	OwnerID         string
	UserMessage     string
	Channel         string
	EnabledTools    []string
	Viewer          *auth.Identity
	Request         *http.Request
	Emit            reactEmitFunc
	SessionModeHint string
	RiskLevelHint   string
}

// participantContext is the per-specialist execution context assembled from
// the 5 completed modules. Each participant owns its own:
//
//   - identity profile (Mem5 hard-no guard + preferred name)
//   - memory slice (Mem2/6 hybrid retrieval keyed by participant DE id)
//   - model selection (modelprov risk-floor policy routing)
//   - skill registry filtered by the participant's session mode
//   - delivery channel for outbound (Feishu/WeCom/DingTalk)
type participantContext struct {
	WorkspaceID     string
	ConversationID  string
	CorrelationID   string
	DigitalPartner string
	SessionMode     string
	RiskLevel       string
	ModelID         string
	Identity        memid.Profile
	IdentityPresent bool
	MemoryHits      []memoryHit
	Tools           []registeredTool
	Channel         string
	Viewer          *auth.Identity
	OwnerID         string
	UserMessage     string
	Request         *http.Request
	Emit            reactEmitFunc
}

// participantTurnResult is what runParticipantTurn returns. Status is one of
// success | refused | failed | timed_out.
type participantTurnResult struct {
	ParticipantID string
	Text          string
	ModelID       string
	Status        string
	Reason        string
	DurationMs    int
	HardNoRefusal string // populated when Status=="refused" with the matched hard-no term
	ToolCalls     []map[string]any
}

// buildParticipantContext assembles the per-participant execution view from
// the 5 modules. The supervisor passes the employee record (looked up by
// runMultiAgentTurn) so we don't repeat the workspace scan.
func (s *Server) buildParticipantContext(in participantCtxInput, emp map[string]any) participantContext {
	deID := str(emp["id"])
	pc := participantContext{
		WorkspaceID:     in.WorkspaceID,
		ConversationID:  in.ConversationID,
		CorrelationID:   in.CorrelationID,
		DigitalPartner: deID,
		SessionMode:     coalesce(in.SessionModeHint, s.resolveDefaultSessionMode(deID)),
		RiskLevel:       coalesce(in.RiskLevelHint, s.resolveDefaultRiskLevel(deID)),
		Channel:         in.Channel,
		Viewer:          in.Viewer,
		OwnerID:         in.OwnerID,
		UserMessage:     in.UserMessage,
		Request:         in.Request,
		Emit:            in.Emit,
	}
	// Model selection (modelprov). Multi-agent sub-calls default to P1 so
	// routine expert opinions don't all hit the strongest model.
	pc.ModelID, _, _ = s.resolveModelByPolicyLevel(in.WorkspaceID, "", "P1", pc.RiskLevel)

	// Identity profile (Mem5).
	if prof, err := s.identityStore().Get(in.WorkspaceID, deID); err == nil {
		pc.Identity = prof
		pc.IdentityPresent = true
	}

	// Memory slice (Mem2/6). Lock held by caller if in a hot path; here we
	// take our own RLock for the retrieval.
	s.Store.RLock()
	pc.MemoryHits = s.retrieveMemoryForTurnLocked(in.WorkspaceID, in.OwnerID, deID, in.ConversationID, in.UserMessage, in.Viewer)
	s.Store.RUnlock()

	// Skill registry filtered by participant session mode.
	pc.Tools = buildToolRegistry(emp, in.EnabledTools)
	pc.Tools = filterRegistryBySessionMode(pc.Tools, pc.SessionMode)

	return pc
}

// participantTurnTimeout is the per-participant LLM budget. Long enough for
// P1-style expert reasoning, short enough that one stuck sub-call doesn't
// stall the whole panel.
const participantTurnTimeout = 30 * time.Second

// runParticipantTools executes the builtin knowledge + memory tools for one
// participant. Returns the RAG hits that should be folded into the LLM call,
// plus a flat list of tool-call summaries for the supervisor toolCalls list.
//
// Citations produced here are stamped with turnID = correlationID + ":" +
// participantID so the per-participant slice can be re-derived for audit.
//
// Approval-gated calls (skill run/write, RequiresApproval tools) are routed
// through dispatchAuthorizedTool so the per-action approval gate that the
// supervisor ReAct path enforces is also enforced inside a panel. Without
// this routing the panel path bypasses skillInvocationNeedsApproval and
// queueToolAuthorization.
func (s *Server) runParticipantTools(ctx context.Context, pc participantContext) ([]map[string]any, []map[string]any) {
	toolCtx := toolRunContext{
		Request:         pc.Request,
		WorkspaceID:     pc.WorkspaceID,
		OwnerID:         pc.OwnerID,
		DigitalPartner: pc.DigitalPartner,
		ConversationID:  pc.ConversationID,
		CorrelationID:   pc.CorrelationID,
		UserMessage:     pc.UserMessage,
		Viewer:          pc.Viewer,
		SessionMode:     pc.SessionMode,
		RiskLevel:       pc.RiskLevel,
	}
	turnID := pc.CorrelationID
	if turnID == "" {
		turnID = pc.ConversationID
	}
	turnID += ":" + pc.DigitalPartner

	var out []map[string]any
	var ragHits []map[string]any
	for _, t := range pc.Tools {
		if !t.Enabled {
			continue
		}
		var call toolCallRequest
		switch {
		case t.Kind == "builtin" && t.Name == "knowledge.retrieve":
			call = toolCallRequest{Name: t.Name, Args: map[string]any{"query": pc.UserMessage}}
		case t.Kind == "builtin" && t.Name == "memory.recall":
			call = toolCallRequest{Name: t.Name, Args: map[string]any{"query": pc.UserMessage}}
		case t.Kind == "skill":
			// Skill invocation: pass through the user message as input and
			// route via dispatchAuthorizedTool so the approval gate
			// (skillInvocationNeedsApproval → queueToolAuthorization) is
			// enforced — the panel path used to bypass it.
			call = toolCallRequest{Name: t.Name, Args: map[string]any{"input": pc.UserMessage}}
		case t.Kind == "tool":
			// Custom tools (CMDB / runtime / pilotdeck). Mirror what
			// runCopilotTool would have done with the parsed args; here we
			// keep it to read-only queries so we don't accidentally mutate
			// state from inside a panel. dispatchAuthorizedTool enforces
			// approval for RequiresApproval tools.
			call = toolCallRequest{Name: t.Name, Args: map[string]any{"query": pc.UserMessage}}
		case t.Kind == "workflow":
			// Workflows require orchestration; the supervisor runCopilotTool
			// path returns "denied not_implemented" today. Surface it in the
			// toolCalls list so the audit trail is honest.
			out = append(out, map[string]any{
				"id":         fmt.Sprintf("tc_%s_%s", pc.DigitalPartner, t.Name),
				"name":       t.Name,
				"args":       map[string]any{"input": pc.UserMessage},
				"status":     "denied",
				"reason":     "workflow_runs_require_workflow_center",
				"durationMs": 0,
			})
			continue
		default:
			continue
		}
		var r toolExecResult
		if t.Kind == "skill" || t.Kind == "tool" {
			// Approval gating lives in dispatchAuthorizedTool; reuse it so
			// panel participants get the same per-action approval queue as
			// the supervisor ReAct path.
			_, r = s.dispatchAuthorizedTool(toolCtx, pc.Tools, call, pc.SessionMode, pc.RiskLevel, pc.Emit)
		} else {
			r = s.runCopilotTool(toolCtx, &t, call)
		}
		hits := ragHitResults(r.Hits)
		// Cite every retrieval hit into the global log so downstream deletes
		// can fail with 409 even if the participant itself didn't survive.
		// Append across tools so a later tool's hits don't silently replace
		// the citations already recorded (and don't displace the grounding
		// already accumulated for the LLM prompt).
		if len(hits) > 0 {
			s.logCitationsForRAG(pc.WorkspaceID, turnID, hits)
			ragHits = append(ragHits, hits...)
		}
		out = append(out, map[string]any{
			"id":         fmt.Sprintf("tc_%s_%s", pc.DigitalPartner, t.Name),
			"name":       t.Name,
			"args":       call.Args,
			"status":     r.Status,
			"result":     truncateRunes(r.Output, 400),
			"durationMs": r.DurationMs, // per-tool; not cumulative
			"reason":     r.Error,
			"permission": r.Permission,
		})
		if pc.Emit != nil {
			pc.Emit("tool", "panel", map[string]any{
				"participantId": pc.DigitalPartner,
				"name":          t.Name,
				"kind":          t.Kind,
				"status":        r.Status,
				"durationMs":    r.DurationMs,
				"hits":          len(hits),
			})
		}
	}
	return ragHits, out
}

// runParticipantTurn executes a single specialist within its own context:
//
//   - Mem5 hard-no guard
//   - per-participant 30s timeout
//   - own system prompt (specialist persona + their memory slice)
//   - own model selection
//   - per-participant tool execution (knowledge.retrieve / memory.recall)
//   - per-participant citation log entries
//   - per-participant channel attribution when the inbound had a channel
//
// Returns a participantTurnResult. Never panics; caller decides how to merge
// into the supervisor's aggregate.
func (s *Server) runParticipantTurn(ctx context.Context, pc participantContext) participantTurnResult {
	if s.testHooks != nil && s.testHooks.participantTurnOverride != nil {
		return s.testHooks.participantTurnOverride(ctx, pc)
	}
	started := time.Now()
	res := participantTurnResult{ParticipantID: pc.DigitalPartner, Status: "success"}

	// Mem5: hard-no guard short-circuits before any LLM call.
	if pc.IdentityPresent {
		if reason, hit := pc.Identity.ShouldRefuse(pc.UserMessage); hit {
			res.Status = "refused"
			res.HardNoRefusal = reason
			res.Reason = "hard_no:" + reason
			res.DurationMs = int(time.Since(started).Milliseconds())
			if pc.Emit != nil {
				pc.Emit("agent", "multi", map[string]any{
					"status":        "refused",
					"participantId": pc.DigitalPartner,
					"reason":        reason,
				})
			}
			return res
		}
	}

	// Independent timeout wraps BOTH the tool phase and the LLM stream —
	// previously the 30s budget only covered the LLM call, so a slow
	// knowledge.retrieve could push the participant's wall time well past
	// the advertised SLA and stall the supervisor aggregator.
	pctx, cancel := context.WithTimeout(ctx, participantTurnTimeout)
	defer cancel()

	// Phase 2: run builtins (knowledge/memory) before the LLM so the model
	// sees the specialist's own retrieval slice.
	var ragHits []map[string]any
	var toolSummaries []map[string]any
	if len(pc.Tools) > 0 {
		ragHits, toolSummaries = s.runParticipantTools(pctx, pc)
	}

	empMap := map[string]any{
		"id":          pc.DigitalPartner,
		"name":        pc.Identity.PreferredName,
		"description": pc.Identity.CustomFacts,
	}
	if empMap["name"] == "" {
		empMap["name"] = pc.DigitalPartner
	}
	// ragSnippetsForPrompt type-asserts to map[string]any and reads m["results"],
	// so we must wrap a slice of hits in that wrapper shape. Without the wrap
	// the assertion fails silently and the entire RAG grounding section is
	// skipped from the prompt — the model never sees its own retrievals.
	var ragForPrompt any
	if len(ragHits) > 0 {
		ragForPrompt = map[string]any{"results": ragHits}
	}
	system := buildCopilotSystemPromptWithEffort(empMap, ragForPrompt, pc.MemoryHits, "")

	msgs := []modelprov.ChatMessage{
		{Role: "user", Content: "用户问题：\n" + pc.UserMessage},
	}

	var buf strings.Builder
	text, rt, err := s.streamLLMForCopilot(pctx, pc.Request, pc.WorkspaceID, pc.ModelID, msgs, system, func(chunk, mid string) error {
		if mid != "" {
			res.ModelID = mid
		}
		buf.WriteString(chunk)
		return nil
	})

	if err != nil {
		switch {
		case pctx.Err() == context.DeadlineExceeded:
			res.Status = "timed_out"
			res.Reason = "participant_timeout"
		case pctx.Err() == context.Canceled:
			res.Status = "timed_out"
			res.Reason = "participant_cancelled"
		case buf.Len() == 0 && text == "":
			res.Status = "failed"
			res.Reason = err.Error()
		default:
			// Partial success: keep what we got.
			res.Reason = err.Error()
		}
	} else if pctx.Err() != nil {
		// ctx was cancelled but streamLLMForCopilot returned no error and no
		// content — treat as cancellation so the supervisor sees the panel
		// didn't actually succeed.
		res.Status = "timed_out"
		switch pctx.Err() {
		case context.DeadlineExceeded:
			res.Reason = "participant_timeout"
		case context.Canceled:
			res.Reason = "participant_cancelled"
		}
	}
	if res.Status == "success" && err == nil {
		res.ModelID = coalesce(rt.ModelID, res.ModelID)
	}
	res.Text = strings.TrimSpace(stripToolCallMarkers(coalesce(text, buf.String())))
	res.DurationMs = int(time.Since(started).Milliseconds())
	res.ToolCalls = toolSummaries

	// Phase 2: attribute outbound delivery to the registry when the inbound
	// request had a channel. We never block the panel on outbound — if the
	// adapter returns an error, DLQ via pushChannelDLQ; otherwise emit an
	// event so the supervisor sees the routing attribution.
	if pc.Channel != "" && pc.Emit != nil && res.Status == "success" && res.Text != "" {
		s.attributedChannelSend(ctx, pc, res.Text)
	}

	if pc.Emit != nil {
		pc.Emit("agent", "multi", map[string]any{
			"status":        "delegated",
			"participantId": pc.DigitalPartner,
			"resultStatus":  res.Status,
			"preview":       truncateRunes(res.Text, 160),
			"durationMs":    res.DurationMs,
			"modelId":       res.ModelID,
			"toolCalls":     len(res.ToolCalls),
		})
	}
	return res
}

// attributedChannelSend ships a specialist's reply through the channel
// registry when the inbound request had a channel. We resolve the deployment
// credentials via the existing Vault-backed path used by inbound delivery,
// then call ChannelRegistry.SendText directly. Failures go to pushChannelDLQ
// so the supervisor can replay them.
//
// Every "skipped" branch writes a channel_audit row in addition to emitting
// the SSE event — the SSE event is ephemeral and gives ops no replay trail
// when the inbound deployment is missing or Vault returns empty credentials.
func (s *Server) attributedChannelSend(ctx context.Context, pc participantContext, text string) {
	if pc.Emit == nil || pc.Channel == "" {
		return
	}
	kind := channel.ParseKind(pc.Channel)
	if kind == "" {
		pc.Emit("channel", "outbound", map[string]any{
			"status":        "skipped",
			"participantId": pc.DigitalPartner,
			"channel":       pc.Channel,
			"reason":        "no_adapter_for_channel",
		})
		s.appendChannelAuditLocked(pc.WorkspaceID, "panel", "归因渠道跳过", pc.Channel, "failed", "no_adapter_for_channel", pc.CorrelationID)
		return
	}
	// Find the inbound session + deployment to resolve credentials.
	dep, sess := s.findInboundDeployment(pc)
	if dep == nil {
		pc.Emit("channel", "outbound", map[string]any{
			"status":        "skipped",
			"participantId": pc.DigitalPartner,
			"channel":       pc.Channel,
			"reason":        "no_deployment_for_session",
		})
		s.appendChannelAuditLocked(pc.WorkspaceID, "panel", "归因渠道跳过", pc.Channel, "failed", "no_deployment_for_session", pc.CorrelationID)
		return
	}
	// Guard against cross-kind routing: the deployment row's channel must
	// match the request's channel, otherwise the wrong adapter receives the
	// wrong credentials and the message silently goes to the wrong target.
	if str(dep["channel"]) != "" && str(dep["channel"]) != pc.Channel {
		pc.Emit("channel", "outbound", map[string]any{
			"status":        "skipped",
			"participantId": pc.DigitalPartner,
			"channel":       pc.Channel,
			"reason":        "channel_mismatch:deployment=" + str(dep["channel"]),
		})
		s.appendChannelAuditLocked(pc.WorkspaceID, "panel", "归因渠道跳过", pc.Channel, "failed", "channel_mismatch:deployment="+str(dep["channel"]), pc.CorrelationID)
		return
	}
	credRef := str(dep["credentialRef"])
	credJSON := ""
	if s.Vault != nil && credRef != "" {
		if v, err := s.Vault.Resolve(ctx, credRef); err == nil {
			credJSON = v
		}
	}
	if credJSON == "" {
		pc.Emit("channel", "outbound", map[string]any{
			"status":        "skipped",
			"participantId": pc.DigitalPartner,
			"channel":       pc.Channel,
			"reason":        "credentials_missing",
		})
		// Match the SendText-failure path below: audit row + DLQ so the
		// per-participant attribution has a replay path on transient Vault
		// outages (without this the failure was silent).
		deployID := str(dep["id"])
		s.appendChannelAuditLocked(pc.WorkspaceID, "panel", "归因渠道凭据缺失", pc.Channel, "failed", "credentials_missing:"+credRef, pc.CorrelationID)
		s.pushChannelDLQ(pc.WorkspaceID, deployID, pc.Channel, "", truncateRunes(text, 200), pc.CorrelationID, "credentials_missing:"+credRef)
		return
	}
	target := ""
	if sess != nil {
		target = str(sess["channelThreadId"])
	}
	// Fire-and-forget but bound it to the parent ctx so client disconnect
	// cancels an in-flight outbound.
	sctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	msgID, err := s.ChannelRegistry.SendText(sctx, kind, credJSON, target, text)
	if err != nil {
		pc.Emit("channel", "outbound", map[string]any{
			"status":        "failed",
			"participantId": pc.DigitalPartner,
			"channel":       pc.Channel,
			"reason":        err.Error(),
		})
		// Drop into the same DLQ the inbound path uses for replay.
		deployID := str(dep["id"])
		s.pushChannelDLQ(pc.WorkspaceID, deployID, pc.Channel, target, truncateRunes(text, 200), pc.CorrelationID, err.Error())
		return
	}
	pc.Emit("channel", "outbound", map[string]any{
		"status":        "attributed",
		"participantId": pc.DigitalPartner,
		"channel":       pc.Channel,
		"messageId":     msgID,
	})
}

// findInboundDeployment walks the store under read lock to find the channel
// deployment + session that produced this participant's inbound. Returns
// (nil, nil) when there's no inbound channel record (e.g. web panels).
func (s *Server) findInboundDeployment(pc participantContext) (map[string]any, map[string]any) {
	if s.Store == nil || pc.WorkspaceID == "" || pc.ConversationID == "" {
		return nil, nil
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	var sess map[string]any
	for _, s2 := range s.Store.Sessions {
		if str(s2["workspaceId"]) != pc.WorkspaceID {
			continue
		}
		if str(s2["conversationId"]) != pc.ConversationID {
			continue
		}
		sess = s2
		break
	}
	if sess == nil {
		return nil, nil
	}
	deployID := str(sess["channelDeploymentId"])
	if deployID == "" {
		return nil, sess
	}
	for _, d := range s.Store.ChannelDeploys {
		if str(d["id"]) == deployID && str(d["workspaceId"]) == pc.WorkspaceID {
			return d, sess
		}
	}
	return nil, sess
}

// mergeParticipantOpinions stitches participantTurnResults into the
// supervisor-aggregate prompt. Truncates each opinion to keep the aggregate
// LLM call within budget.
func mergeParticipantOpinions(results []participantTurnResult, perRunes int) []string {
	out := make([]string, 0, len(results))
	for _, r := range results {
		if r.Status != "success" {
			out = append(out, fmtParticipantSkipNote(r))
			continue
		}
		header := r.ParticipantID
		if r.HardNoRefusal != "" {
			header = r.ParticipantID + " (hard-no:" + r.HardNoRefusal + ")"
		}
		body := truncateRunes(r.Text, perRunes)
		out = append(out, "【"+header+"】\n"+body)
	}
	return out
}

func fmtParticipantSkipNote(r participantTurnResult) string {
	switch r.Status {
	case "refused":
		return "【" + r.ParticipantID + " · 已按硬性设定拒答】原因：" + r.HardNoRefusal
	case "timed_out":
		return "【" + r.ParticipantID + " · 调用超时】"
	case "failed":
		return "【" + r.ParticipantID + " · 调用失败】" + r.Reason
	}
	return "【" + r.ParticipantID + " · 未参与】"
}