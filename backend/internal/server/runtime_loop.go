package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	commonv1 "github.com/qizhida-partner-platform/backend/gen/qzda/common/v1"
	runtimev1 "github.com/qizhida-partner-platform/backend/gen/qzda/runtime/v1"
	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

const (
	runtimeModeLocal  = "local"
	runtimeModeRemote = "remote"
)

func runtimeMode() string {
	switch strings.ToLower(strings.TrimSpace(lookupEnv("DE_RUNTIME_MODE"))) {
	case "remote", "sidecar", "python":
		return runtimeModeRemote
	default:
		return runtimeModeLocal
	}
}

func runtimeFailoverLocal() bool {
	return envFlagTrue("DE_RUNTIME_FAILOVER_LOCAL") && !productionLikeEnv()
}

func (s *Server) runtimeHTTPClient() *http.Client {
	if s != nil && s.RuntimeHTTP != nil {
		return s.RuntimeHTTP
	}
	return &http.Client{Timeout: 90 * time.Second}
}

// runRuntimeTurn is the collab → runtime boundary (ADR-013 阶段 2).
// copilotStream 不再直接编 ReAct；Loop 只通过本函数进入。
func (s *Server) runRuntimeTurn(ctx context.Context, in reactTurnInput) reactTurnResult {
	if in.Emit == nil {
		in.Emit = func(string, string, map[string]any) {}
	}
	mode := runtimeMode()
	in.Emit(contract.StreamRoute, "runtime", map[string]any{
		"runtimeMode": mode, "modelId": in.ModelID, "snapshotId": in.SnapshotID,
	})
	if mode == runtimeModeRemote {
		out := s.runRemoteRuntime(ctx, in)
		if out.Err != nil && runtimeFailoverLocal() {
			in.Emit(contract.StreamStage, "runtime", map[string]any{
				"status": "degraded", "runtimeMode": runtimeModeLocal,
				"warning": "remote runtime unavailable, failover local",
			})
			return s.runLocalRuntime(ctx, in)
		}
		return out
	}
	return s.runLocalRuntime(ctx, in)
}

func (s *Server) runLocalRuntime(ctx context.Context, in reactTurnInput) reactTurnResult {
	return s.runHarnessTurn(ctx, in)
}

func (s *Server) runRemoteRuntime(ctx context.Context, in reactTurnInput) reactTurnResult {
	payload, err := json.Marshal(runtimeLoopPayload(in))
	if err != nil {
		return reactTurnResult{Err: apperr.Unavailable(apperr.RuntimeUnavailable, "无法序列化 RunRequest")}
	}
	base := strings.TrimRight(strings.TrimSpace(s.RuntimeURL), "/")
	if base == "" {
		return reactTurnResult{Err: apperr.Unavailable(apperr.RuntimeUnavailable, "未配置 DE_AGENT_RUNTIME_URL")}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/run", bytes.NewReader(payload))
	if err != nil {
		return reactTurnResult{Err: apperr.Unavailable(apperr.RuntimeUnavailable, err.Error())}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	resp, err := s.runtimeHTTPClient().Do(req)
	if err != nil {
		return reactTurnResult{Err: apperr.Unavailable(apperr.RuntimeUnavailable, "agent-runtime 不可达: "+err.Error())}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := strings.TrimSpace(string(b))
		if msg == "" {
			msg = fmt.Sprintf("agent-runtime HTTP %d", resp.StatusCode)
		}
		return reactTurnResult{Err: apperr.Unavailable(apperr.RuntimeUnavailable, msg)}
	}

	var full strings.Builder
	var lastMode, lastModel string
	replyMode := normalizeReplyMode(in.ReplyMode)
	segmentedRemote := replyMode != replyModeSingle
	var sawMessageStart bool
	onEvent := func(typ string, payload map[string]any) {
		if typ == "" {
			typ = str(payload["type"])
		}
		if typ == "" {
			return
		}
		if typ == contract.StreamMessageStart {
			sawMessageStart = true
		}
		stage := coalesce(str(payload["stage"]), "runtime")
		if t := str(payload["text"]); t != "" && (typ == contract.StreamDelta || typ == contract.StreamMessageDelta || typ == contract.StreamDone) {
			if typ == contract.StreamDelta || typ == contract.StreamMessageDelta {
				full.WriteString(t)
			} else if full.Len() == 0 {
				full.WriteString(t)
			}
		}
		if m := str(payload["mode"]); m != "" {
			lastMode = m
		}
		if m := str(payload["modelId"]); m != "" {
			lastModel = m
		}
		if typ == contract.StreamDone {
			if in.Emit != nil {
				in.Emit(contract.StreamStage, "runtime", map[string]any{
					"status": "ok", "runtimeMode": runtimeModeRemote, "modelId": coalesce(lastModel, in.ModelID),
					"snapshotId": in.SnapshotID, "mode": coalesce(lastMode, contract.LoopDirect),
				})
			}
			return
		}
		if segmentedRemote && !sawMessageStart && typ == contract.StreamDelta {
			return
		}
		extra := map[string]any{}
		for k, v := range payload {
			extra[k] = v
		}
		extra["runtimeMode"] = runtimeModeRemote
		if in.SnapshotID != "" && str(extra["snapshotId"]) == "" {
			extra["snapshotId"] = in.SnapshotID
		}
		if in.Emit != nil {
			in.Emit(typ, stage, extra)
		}
	}
	if err := parseRuntimeSSE(resp.Body, onEvent); err != nil && ctx.Err() == nil {
		return reactTurnResult{Err: apperr.Unavailable(apperr.RuntimeUnavailable, err.Error())}
	}
	text := strings.TrimSpace(full.String())
	if text == "" {
		return reactTurnResult{Err: apperr.Unavailable(apperr.RuntimeUnavailable, "agent-runtime 未返回 Loop 文本")}
	}
	out := reactTurnResult{
		Text:    text,
		ModelID: coalesce(lastModel, in.ModelID),
		Mode:    coalesce(lastMode, contract.LoopDirect),
		Resolved: resolvedTurn{
			ProviderID: "de-agent-runtime", Source: runtimeModeRemote, ModelID: coalesce(lastModel, in.ModelID),
		},
		ToolCalls: []map[string]any{},
		ReplyMode: replyMode,
	}
	if segmentedRemote && !sawMessageStart && in.Emit != nil {
		idGen := defaultSegmentIDGen(s)
		out.Segments = streamHarnessAnswer(in.Emit, text, coalesce(lastModel, in.ModelID), out.Resolved, out.Mode, 0, &streamAnswerOpts{
			ReplyMode: replyMode, SegmentPolicy: in.SegmentPolicy, CorrelationID: in.CorrelationID,
			FirstMessageID: in.FirstMessageID, IDGen: idGen,
		})
	}
	return out
}

func runtimeLoopPayload(in reactTurnInput) map[string]any {
	tenant, actor := "", ""
	if in.Viewer != nil {
		tenant, actor = in.Viewer.TenantID, in.Viewer.ID
	}
	tools := enabledToolKeys(in.Registry)
	return map[string]any{
		"input":         in.UserMessage,
		"modelId":       in.ModelID,
		"enabledTools":  tools,
		"maxSteps":      in.MaxSteps,
		"loopMode":      coalesce(in.ModeHint, contract.LoopReact),
		"correlationId": in.CorrelationID,
		"replyMode":     in.ReplyMode,
		"firstMessageId": in.FirstMessageID,
		"envelope": map[string]any{
			"tenantId": tenant, "workspaceId": in.WorkspaceID, "actorId": actor,
			"sessionId": in.ConversationID, "partnerId": in.DigitalPartner,
			"correlationId": in.CorrelationID, "sessionMode": in.SessionMode, "riskLevel": in.RiskLevel,
		},
		"snapshot": map[string]any{
			"id": in.SnapshotID, "correlationId": in.CorrelationID, "system": in.System,
			"historyTurns": len(in.Messages), "toolRegistry": tools,
			"partnerId": in.DigitalPartner, "sessionMode": in.SessionMode,
			"employeeBinding": in.Binding, "memoryProvenance": in.MemoryProvenance,
		},
	}
}

func parseRuntimeSSE(r io.Reader, onEvent func(typ string, payload map[string]any)) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var eventName string
	var data strings.Builder
	flush := func() {
		raw := strings.TrimSpace(data.String())
		data.Reset()
		name := eventName
		eventName = ""
		if raw == "" {
			return
		}
		var payload map[string]any
		if json.Unmarshal([]byte(raw), &payload) != nil {
			payload = map[string]any{"type": name, "text": raw}
		}
		typ := coalesce(str(payload["type"]), name)
		onEvent(typ, payload)
	}
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		if line == "" {
			flush()
			continue
		}
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(line[6:])
		case strings.HasPrefix(line, "data:"):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimSpace(line[5:]))
		}
	}
	flush()
	return sc.Err()
}

func (s *Server) reactInputFromRunRequest(r *http.Request, req *runtimev1.RunRequest, emit reactEmitFunc) reactTurnInput {
	if req == nil {
		req = &runtimev1.RunRequest{}
	}
	env := req.GetEnvelope()
	if env == nil {
		env = &commonv1.Envelope{}
	}
	snap := req.GetSnapshot()
	tools := req.GetEnabledTools()
	if len(tools) == 0 && snap != nil {
		tools = snap.GetToolRegistry()
	}
	registry := make([]registeredTool, 0, len(tools))
	for _, k := range tools {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		registry = append(registry, registeredTool{Key: k, Name: k, Kind: "builtin", Enabled: true})
	}
	ws := env.GetWorkspaceId()
	if ws == "" && r != nil {
		ws = s.workspaceID(r)
	}
	corr := env.GetCorrelationId()
	if corr == "" && snap != nil {
		corr = snap.GetCorrelationId()
	}
	input := strings.TrimSpace(req.GetInput())
	system := ""
	snapID := ""
	if snap != nil {
		system = snap.GetSystem()
		snapID = snap.GetId()
		if corr == "" {
			corr = snap.GetCorrelationId()
		}
	}
	employee := env.GetPartnerId()
	if snap != nil && employee == "" {
		employee = snap.GetPartnerId()
	}
	var viewer *auth.Identity
	if r != nil {
		viewer = identityFrom(r.Context())
	}
	messages := []modelprov.ChatMessage{{Role: "user", Content: input}}
	modeHint := contract.LoopModeFromProto(req.GetLoopMode())
	return reactTurnInput{
		Request: r, WorkspaceID: ws, ModelID: req.GetModelId(), System: system,
		Messages: messages, Registry: registry, UserMessage: input,
		ConversationID: env.GetSessionId(), CorrelationID: corr,
		DigitalPartner: employee,
		Viewer:          viewer, Emit: emit, ModeHint: modeHint, SkipStream: true,
		MaxSteps: int(req.GetMaxSteps()), SnapshotID: snapID,
		SessionMode: contract.SessionModeFromProto(env.GetSessionMode()),
		RiskLevel:   contract.RiskLevelFromProto(env.GetRiskLevel()),
		Channel:     contract.ChannelKindFromProto(env.GetChannel()),
	}
}

func loopEventFromEmit(typ, stage, corr, snapID string, extra map[string]any) *runtimev1.LoopEvent {
	text := str(extra["text"])
	sid := coalesce(str(extra["snapshotId"]), snapID)
	meta := map[string]string{"runtimeMode": runtimeMode()}
	if m := str(extra["mode"]); m != "" {
		meta["mode"] = m
	}
	if m := str(extra["modelId"]); m != "" {
		meta["modelId"] = m
	}
	if w := str(extra["warning"]); w != "" {
		meta["warning"] = w
	}
	return &runtimev1.LoopEvent{
		Type:           contract.StreamEventTypeToProto(typ),
		Stage:          stage,
		Text:           text,
		CorrelationId:  corr,
		SnapshotId:     sid,
		Meta:           meta,
		RagHits:        int32(intFrom(extra["ragHits"])),
		MemoryHits:     int32(intFrom(extra["memoryHits"])),
		PolicyDecision: contract.PolicyDecisionToProto(str(extra["decision"])),
	}
}

func envelopeFromRunJSON(body map[string]any) *commonv1.Envelope {
	raw, _ := body["envelope"].(map[string]any)
	if raw == nil {
		raw = body
	}
	return &commonv1.Envelope{
		TenantId:        str(raw["tenantId"]),
		WorkspaceId:     coalesce(str(raw["workspaceId"]), str(raw["workspace_id"])),
		ActorId:         str(raw["actorId"]),
		CorrelationId:   coalesce(str(raw["correlationId"]), str(raw["correlation_id"])),
		SessionId:       coalesce(str(raw["sessionId"]), str(raw["session_id"])),
		PartnerId:      coalesce(str(raw["partnerId"]), str(raw["partner_id"])),
		ChannelThreadId: coalesce(str(raw["channelThreadId"]), str(raw["channel_thread_id"])),
		Channel:         contract.ChannelKindToProto(str(raw["channel"])),
		SessionMode:     contract.SessionModeToProto(str(raw["sessionMode"])),
		RiskLevel:       contract.RiskLevelToProto(str(raw["riskLevel"])),
	}
}

func snapshotFromRunJSON(body map[string]any) *commonv1.ContextSnapshot {
	raw, _ := body["snapshot"].(map[string]any)
	if raw == nil {
		return &commonv1.ContextSnapshot{
			Id:            coalesce(str(body["snapshotId"]), str(body["snapshot_id"])),
			CorrelationId: coalesce(str(body["correlationId"]), str(body["correlation_id"])),
		}
	}
	return mapToProtoSnapshot(raw)
}
