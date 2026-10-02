package models

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/modelprov/trace"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// PublishedPolicyByLevelLocked returns the published policy for (ws, level)
// or nil. Caller MUST hold no lock (acquires RLock briefly). Exported as
// the cross-module bridge consumed by the M02 copilot module via
// Deps.PublishedPolicyByLevelFn.
func (s *Service) PublishedPolicyByLevelLocked(ws, level string) map[string]any {
	for _, pol := range s.Store.RoutingPolicies {
		if str(pol["workspaceId"]) == ws && str(pol["status"]) == "published" && str(pol["level"]) == level {
			return pol
		}
	}
	return nil
}

// resolveModelForTurn returns the first usable resolved turn for the
// workspace + model-id. Callers can pick any candidate from listResolvedTurns
// if they want failover ordering.
func (s *Service) resolveModelForTurn(ctx context.Context, ws, requested string) (ResolvedTurn, error) {
	turns := s.listResolvedTurns(ctx, ws, requested)
	if len(turns) == 0 {
		return ResolvedTurn{}, fmt.Errorf("no usable chat model in workspace %s", ws)
	}
	return turns[0], nil
}

// ResolveModelForTurn is the exported bridge for the legacy
// `s.resolveModelForTurn` Server wrapper.
func (s *Service) ResolveModelForTurn(ctx context.Context, ws, requested string) (ResolvedTurn, error) {
	return s.resolveModelForTurn(ctx, ws, requested)
}

// ListResolvedTurns is the exported bridge for non-M08 call sites
// (model_invoke_test.go) that used to call `s.listResolvedTurns(ctx, ws, req)`
// on *Server.
func (s *Service) ListResolvedTurns(ctx context.Context, ws, requested string) []ResolvedTurn {
	return s.listResolvedTurns(ctx, ws, requested)
}

// listResolvedTurns returns ordered provider candidates (requested → routing
// → active/standby). Callers should try each until one streams successfully,
// then fall back to DE_LLM_* / embedded via streamEnvFallback.
func (s *Service) listResolvedTurns(ctx context.Context, ws, requested string) []ResolvedTurn {
	requested = strings.TrimSpace(requested)

	type cand struct {
		model, provider map[string]any
		level, source   string
	}
	var cands []cand
	seen := map[string]struct{}{}

	s.Store.RLock()
	collect := func(model, provider map[string]any, level, source string) {
		if model == nil || provider == nil {
			return
		}
		if str(provider["workspaceId"]) != "" && str(provider["workspaceId"]) != ws {
			return
		}
		status := str(provider["status"])
		// Explicit model picks may use standby/offline (credential configured, probe pending).
		if status == "disabled" {
			return
		}
		if source != "provider" && status != "" && status != "active" && status != "standby" {
			return
		}
		if caps := stringSlice(model["capabilities"]); len(caps) > 0 && !hasCapability(caps, "chat") && !hasCapability(caps, "reasoning") {
			return
		}
		key := str(provider["id"]) + "|" + coalesce(str(model["id"]), str(model["name"]))
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		mc, pc := map[string]any{}, map[string]any{}
		for k, v := range model {
			mc[k] = v
		}
		for k, v := range provider {
			pc[k] = v
		}
		cands = append(cands, cand{model: mc, provider: pc, level: level, source: source})
	}

	if requested != "" {
		if m, p := s.modelByIDInWorkspaceLocked(requested, ws); m != nil {
			collect(m, p, "", "provider")
		}
		for _, p := range s.Store.ModelProviders {
			if str(p["workspaceId"]) != ws {
				continue
			}
			for _, m := range providerModels(p) {
				if strings.EqualFold(str(m["name"]), requested) || strings.EqualFold(str(m["id"]), requested) {
					collect(m, p, "", "provider")
				}
			}
		}
		// 数字伙伴装配的「企业通用路由 v2」等：按路由名/ID 解析到主模型（显式选择，允许 offline 探测）
		for _, route := range s.Store.ModelRoutes {
			if str(route["workspaceId"]) != "" && str(route["workspaceId"]) != ws {
				continue
			}
			if str(route["status"]) != "" && str(route["status"]) != "published" {
				continue
			}
			if !strings.EqualFold(str(route["name"]), requested) && !strings.EqualFold(str(route["id"]), requested) {
				continue
			}
			level := str(route["level"])
			if m, p := s.modelByIDInWorkspaceLocked(str(route["primaryModelId"]), ws); m != nil {
				collect(m, p, level, "provider")
			}
			for _, fb := range stringSlice(route["fallbackModelIds"]) {
				if m, p := s.modelByIDInWorkspaceLocked(fb, ws); m != nil {
					collect(m, p, level, "provider")
				}
			}
		}
		for _, pol := range s.Store.RoutingPolicies {
			if str(pol["workspaceId"]) != "" && str(pol["workspaceId"]) != ws {
				continue
			}
			if str(pol["status"]) != "published" {
				continue
			}
			if !strings.EqualFold(str(pol["name"]), requested) && !strings.EqualFold(str(pol["id"]), requested) &&
				!strings.EqualFold(coalesce(str(pol["name"]), str(pol["level"])+" 路由"), requested) {
				continue
			}
			level := str(pol["level"])
			if m, p := s.modelByIDInWorkspaceLocked(str(pol["primaryModelId"]), ws); m != nil {
				collect(m, p, level, "provider")
			}
			for _, fb := range stringSlice(pol["fallbackModelIds"]) {
				if m, p := s.modelByIDInWorkspaceLocked(fb, ws); m != nil {
					collect(m, p, level, "provider")
				}
			}
		}
		if level := aliasToRouteLevel(requested); level != "" {
			if pol := s.PublishedPolicyByLevelLocked(ws, level); pol != nil {
				if m, p := s.modelByIDInWorkspaceLocked(str(pol["primaryModelId"]), ws); m != nil {
					collect(m, p, level, "routing")
				}
				for _, fb := range stringSlice(pol["fallbackModelIds"]) {
					if m, p := s.modelByIDInWorkspaceLocked(fb, ws); m != nil {
						collect(m, p, level, "routing")
					}
				}
			}
		}
	}
	for _, level := range []string{"P0", "P0+", "P1", "P2", "P3"} {
		if pol := s.PublishedPolicyByLevelLocked(ws, level); pol != nil {
			if m, p := s.modelByIDInWorkspaceLocked(str(pol["primaryModelId"]), ws); m != nil {
				collect(m, p, level, "routing")
			}
		}
	}
	for _, pol := range s.Store.RoutingPolicies {
		if str(pol["workspaceId"]) != ws || str(pol["status"]) != "published" {
			continue
		}
		if m, p := s.modelByIDInWorkspaceLocked(str(pol["primaryModelId"]), ws); m != nil {
			collect(m, p, str(pol["level"]), "routing")
		}
	}
	for _, p := range s.Store.ModelProviders {
		if str(p["workspaceId"]) != ws {
			continue
		}
		st := str(p["status"])
		// 运行配置可选：active / standby / offline（已配待探测）；disabled 排除
		if st == "disabled" {
			continue
		}
		if st != "" && st != "active" && st != "standby" && st != "offline" {
			continue
		}
		for _, m := range providerModels(p) {
			if str(m["status"]) != "" && str(m["status"]) != "available" {
				continue
			}
			collect(m, p, "", "provider")
		}
	}
	s.Store.RUnlock()

	out := make([]ResolvedTurn, 0, len(cands))
	for _, c := range cands {
		apiKey := ""
		if ref := str(c.provider["credentialRef"]); ref != "" {
			apiKey = s.resolveProviderCredential(ctx, ref)
		}
		name := coalesce(str(c.model["name"]), str(c.model["id"]))
		base := str(c.provider["baseUrl"])
		if base == "" {
			continue
		}
		protocol := coalesce(str(c.provider["protocol"]), "openai_compatible")
		// Keep turns even without API key so route-name → model-id resolution still works;
		// streamLocalCandidates skips empty-key non-local protocols before dialing.
		// DeepSeek Anthropic 兼容路径常被误配；会话统一走 OpenAI 兼容 /v1
		if strings.Contains(strings.ToLower(base), "deepseek.com") {
			protocol = "openai_compatible"
			base = strings.TrimSuffix(strings.TrimSuffix(base, "/"), "/anthropic")
			if !strings.HasSuffix(base, "/v1") {
				base = strings.TrimSuffix(base, "/") + "/v1"
			}
		}
		req := modelprov.ChatRequest{
			Protocol:   protocol,
			BaseURL:    base,
			APIKey:     apiKey,
			APIVersion: str(c.provider["apiVersion"]),
			Deployment: coalesce(str(c.provider["deploymentName"]), name),
			Model:      name,
			System:     "You are an enterprise digital-employee expert assistant. Answer in the user's language. Be precise and actionable.",
		}
		out = append(out, ResolvedTurn{
			ModelID: coalesce(str(c.model["id"]), name), ModelName: name,
			ProviderID: str(c.provider["id"]), ProviderName: str(c.provider["name"]),
			Protocol: req.Protocol, Level: c.level, Source: c.source, Request: req,
		})
	}
	return out
}

// streamResolvedChat streams text deltas for a resolved turn via the
// modelprov client. Calls back on every non-empty delta.
func (s *Service) streamResolvedChat(ctx context.Context, rt ResolvedTurn, messages []modelprov.ChatMessage, onDelta func(string) error) (string, error) {
	req := rt.Request
	if len(messages) == 0 {
		return "", fmt.Errorf("missing messages")
	}
	req.Messages = messages
	client := s.modelProbe()
	started := time.Now()
	traceID := s.newTraceID()
	ch, err := client.StreamChat(ctx, req)
	if err != nil {
		s.recordTrace(traceID, "", "", rt, started, trace.StatusError, err)
		return "", err
	}
	var b strings.Builder
	for chunk := range ch {
		if chunk.Err != nil {
			status := trace.StatusError
			if isCapUnreachable(chunk.Err) {
				status = trace.StatusError
			}
			if strings.Contains(strings.ToLower(chunk.Err.Error()), "timeout") || strings.Contains(strings.ToLower(chunk.Err.Error()), "deadline") {
				status = trace.StatusTimeout
			}
			if strings.Contains(chunk.Err.Error(), "429") {
				status = trace.Status429
			}
			s.recordTrace(traceID, "", "", rt, started, status, chunk.Err)
			if b.Len() > 0 {
				return b.String(), chunk.Err
			}
			return "", chunk.Err
		}
		if chunk.Text == "" {
			continue
		}
		b.WriteString(chunk.Text)
		if onDelta != nil {
			if err := onDelta(chunk.Text); err != nil {
				s.recordTrace(traceID, "", "", rt, started, trace.StatusError, err)
				return b.String(), err
			}
		}
	}
	if b.Len() == 0 {
		err := fmt.Errorf("empty model response")
		s.recordTrace(traceID, "", "", rt, started, trace.StatusError, err)
		return "", err
	}
	s.recordTrace(traceID, "", "", rt, started, trace.StatusOK, nil)
	return b.String(), nil
}

// recordTrace emits a single trace.Event to the recorder. Nil-safe.
func (s *Service) recordTrace(traceID, ws, turnID string, rt ResolvedTurn, started time.Time, status trace.Status, err error) {
	if s == nil || s.TraceRecorder == nil {
		return
	}
	ev := trace.Event{
		TraceID:     traceID,
		WorkspaceID: ws,
		TurnID:      turnID,
		ModelID:     rt.ModelID,
		ProviderID:  rt.ProviderID,
		Level:       rt.Level,
		Source:      rt.Source,
		Status:      status,
		StartedAt:   started,
		EndedAt:     time.Now().UTC(),
	}
	if err != nil {
		ev.ErrorClass = trace.ClassifyError(err.Error())
		ev.ErrorMessage = err.Error()
	}
	s.TraceRecorder.Append(ev)
}

// newTraceID generates a cheap correlation id for the per-invocation trace.
func (s *Service) newTraceID() string {
	// Cheap correlation id; uniqueness is best-effort within process.
	return fmt.Sprintf("tr-%d", time.Now().UnixNano())
}

// streamLocalCandidates tries provider candidates, then DE_LLM_*, then
// embedded chat. Honors per-attempt timeouts (full for primary, shorter for
// standbys).
func (s *Service) streamLocalCandidates(ctx context.Context, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (string, ResolvedTurn, error) {
	var lastErr error
	candidates := s.listResolvedTurns(ctx, ws, modelID)
	for i, rt := range candidates {
		if system != "" {
			rt.Request.System = system
		}
		proto := strings.ToLower(strings.TrimSpace(rt.Request.Protocol))
		if proto != "ollama" && proto != "embedded" && strings.TrimSpace(rt.Request.APIKey) == "" {
			lastErr = fmt.Errorf("missing provider credential")
			continue
		}
		// Cap multi-candidate: per-endpoint budget so dead providers fail over;
		// primary (i==0) uses full candidate timeout, standbys may use a shorter budget.
		budget := candidateAttemptTimeout()
		if i > 0 {
			budget = candidateStandbyTimeout()
		}
		budget = clampAttemptToParent(ctx, budget)
		if budget < 2*time.Second {
			lastErr = fmt.Errorf("context deadline exceeded")
			break
		}
		attemptCtx, cancel := context.WithTimeout(ctx, budget)
		rt.Request.Timeout = budget
		text, streamErr := s.streamResolvedChat(attemptCtx, rt, messages, func(t string) error {
			return onDelta(t, rt.ModelID)
		})
		cancel()
		if streamErr == nil {
			return text, rt, nil
		}
		lastErr = streamErr
	}
	return s.streamEnvFallback(ctx, messages, system, onDelta, lastErr)
}

// candidateAttemptTimeout returns the per-attempt timeout for the primary
// candidate. Defaults to 45s; tunable via DE_MODEL_CANDIDATE_TIMEOUT.
func candidateAttemptTimeout() time.Duration {
	// Default 45s: DeepSeek / Azure cold path often exceeds the old 8s fail-fast budget
	// during tool-heavy Copilot turns (pptx skill, multi-step ReAct).
	sec := 45
	if v := strings.TrimSpace(os.Getenv("DE_MODEL_CANDIDATE_TIMEOUT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			sec = n
		}
	}
	if sec < 5 {
		sec = 5
	}
	if sec > 180 {
		sec = 180
	}
	return time.Duration(sec) * time.Second
}

// candidateStandbyTimeout returns the per-attempt timeout for standby
// candidates (shorter than the primary). Tunable via DE_MODEL_STANDBY_TIMEOUT.
func candidateStandbyTimeout() time.Duration {
	sec := 20
	if v := strings.TrimSpace(os.Getenv("DE_MODEL_STANDBY_TIMEOUT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			sec = n
		}
	}
	primary := candidateAttemptTimeout()
	d := time.Duration(sec) * time.Second
	if d > primary {
		return primary
	}
	if d < 5*time.Second {
		return 5 * time.Second
	}
	return d
}

// clampAttemptToParent shortens the per-attempt budget so the overall parent
// ctx deadline is respected (leaves a 500ms cushion for SSE flush / fallback).
func clampAttemptToParent(ctx context.Context, budget time.Duration) time.Duration {
	if dl, ok := ctx.Deadline(); ok {
		remain := time.Until(dl)
		if remain <= 0 {
			return 0
		}
		// Leave a small cushion for fallback / SSE flush.
		remain -= 500 * time.Millisecond
		if remain < budget {
			return remain
		}
	}
	return budget
}

// copilotStreamTimeout returns the overall Copilot harness SSE budget
// (multi-step ReAct + tools).
func copilotStreamTimeout() time.Duration {
	sec := 300
	if v := strings.TrimSpace(os.Getenv("DE_COPILOT_STREAM_TIMEOUT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			sec = n
		}
	}
	if sec < 60 {
		sec = 60
	}
	if sec > 900 {
		sec = 900
	}
	return time.Duration(sec) * time.Second
}

// formatModelInvokeUserMessage turns provider/transport errors into actionable
// Chinese copy. Avoids the misleading "无可用模型：context deadline exceeded"
// for timeout cases.
func formatModelInvokeUserMessage(err error) string {
	if err == nil {
		return "模型调用失败"
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "模型调用失败"
	}
	if strings.HasPrefix(msg, "模型调用超时") || strings.HasPrefix(msg, "模型调用失败") || strings.HasPrefix(msg, "无可用模型端点") {
		return msg
	}
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "deadline exceeded"),
		strings.Contains(low, "context canceled"),
		strings.Contains(low, "client.timeout exceeded"),
		strings.Contains(low, "i/o timeout"),
		(strings.Contains(low, "timeout") && !strings.Contains(low, "timed out waiting for lock")):
		return "模型调用超时：供应商在限定时间内未返回。请到「模型中心」探测连通性与密钥，或将 DE_MODEL_CANDIDATE_TIMEOUT 调至 45–60 后重启 qzda-app/qzda-cap。"
	case strings.Contains(low, "no model endpoint"),
		strings.Contains(low, "empty model"),
		strings.Contains(low, "model not found"),
		strings.Contains(msg, "未配置"):
		return "无可用模型端点：" + msg
	case strings.Contains(low, "401"), strings.Contains(low, "unauthorized"), strings.Contains(low, "invalid api key"):
		return "模型鉴权失败：" + msg + "。请检查模型中心凭证。"
	default:
		return "模型调用失败：" + msg
	}
}

// streamEnvFallback tries the DE_LLM_* env fallback, then embedded chat,
// before bubbling up a "no model endpoint available" error.
func (s *Service) streamEnvFallback(ctx context.Context, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error, prior error) (string, ResolvedTurn, error) {
	userMsg := copilot.LastUserContent(messages)
	if envReq, ok := modelprov.EnvFallbackRequest(userMsg); ok {
		if system != "" {
			envReq.System = system
		}
		envReq.Messages = messages
		rt := ResolvedTurn{
			ModelID: coalesce(envReq.Model, "env-llm"), ModelName: envReq.Model,
			ProviderID: "env", ProviderName: "DE_LLM", Protocol: envReq.Protocol, Source: "env", Request: envReq,
		}
		text, streamErr := s.streamResolvedChat(ctx, rt, messages, func(t string) error {
			return onDelta(t, rt.ModelID)
		})
		if streamErr == nil {
			return text, rt, nil
		}
		prior = streamErr
	}
	if modelprov.EmbeddedChatEnabled() {
		req := modelprov.EmbeddedChatRequest(userMsg, system)
		req.Messages = messages
		rt := ResolvedTurn{
			ModelID: req.Model, ModelName: req.Model, ProviderID: "embedded",
			ProviderName: "平台内置对话", Protocol: "embedded", Source: "embedded", Request: req,
		}
		text, streamErr := s.streamResolvedChat(ctx, rt, messages, func(t string) error {
			return onDelta(t, rt.ModelID)
		})
		if streamErr == nil {
			return text, rt, nil
		}
		prior = streamErr
	}
	if prior == nil {
		prior = fmt.Errorf("no model endpoint available")
	}
	return "", ResolvedTurn{}, fmt.Errorf("%s", formatModelInvokeUserMessage(prior))
}

// isCapUnreachable reports whether the error is one we'd see when the Cap
// sidecar is down (vs. a model/repo-side issue).
func isCapUnreachable(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "Cap unreachable") ||
		strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "timeout")
}

// ModelInvoke → POST /api/model-invoke
func (s *Service) ModelInvoke(r *http.Request) (any, error) {
	body, _ := s.DecodeMap(r)
	ws := coalesce(str(body["workspaceId"]), s.WorkspaceID(r))
	modelID := coalesce(str(body["modelId"]), str(body["model"]))
	messages := parseChatMessages(body["messages"])
	content := strings.TrimSpace(coalesce(str(body["content"]), str(body["input"])))
	if len(messages) == 0 {
		if content == "" {
			return nil, apperr.BadReq(apperr.BadRequest, "消息不能为空")
		}
		messages = []modelprov.ChatMessage{{Role: "user", Content: content}}
	}
	system := strings.TrimSpace(str(body["system"]))
	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	text, rt, err := s.streamLocalCandidates(ctx, ws, modelID, messages, system, func(string, string) error { return nil })
	if err != nil {
		return nil, apperr.BadReq(apperr.ModelUnavailable, formatModelInvokeUserMessage(err))
	}
	return map[string]any{
		"output": text, "modelId": rt.ModelID, "modelName": rt.ModelName,
		"providerId": rt.ProviderID, "providerName": rt.ProviderName, "source": rt.Source,
	}, nil
}

// parseChatMessages normalises a generic message slice onto
// modelprov.ChatMessage. Unknown roles are dropped; empty content is dropped.
func parseChatMessages(raw any) []modelprov.ChatMessage {
	arr, ok := raw.([]any)
	if !ok || len(arr) == 0 {
		return nil
	}
	out := make([]modelprov.ChatMessage, 0, len(arr))
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(str(m["role"])))
		content := strings.TrimSpace(str(m["content"]))
		if content == "" {
			continue
		}
		switch role {
		case "user", "assistant", "system", "tool":
			out = append(out, modelprov.ChatMessage{Role: role, Content: content})
		}
	}
	return out
}