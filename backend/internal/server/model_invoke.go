package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/modelprov/trace"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// resolvedTurn is the concrete provider + model used for one Copilot turn.
type resolvedTurn struct {
	ModelID      string
	ModelName    string
	ProviderID   string
	ProviderName string
	Protocol     string
	Level        string
	Source       string // provider | routing | env
	Request      modelprov.ChatRequest
}

func (s *Server) resolveModelForTurn(ctx context.Context, ws, requested string) (resolvedTurn, error) {
	turns := s.listResolvedTurns(ctx, ws, requested)
	if len(turns) == 0 {
		return resolvedTurn{}, fmt.Errorf("no usable chat model in workspace %s", ws)
	}
	return turns[0], nil
}

// listResolvedTurns returns ordered provider candidates (requested → routing → active/standby).
// Callers should try each until one streams successfully, then fall back to DE_LLM_* / embedded.
func (s *Server) listResolvedTurns(ctx context.Context, ws, requested string) []resolvedTurn {
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
			if pol := s.publishedPolicyByLevelLocked(ws, level); pol != nil {
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
		if pol := s.publishedPolicyByLevelLocked(ws, level); pol != nil {
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

	out := make([]resolvedTurn, 0, len(cands))
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
		out = append(out, resolvedTurn{
			ModelID: coalesce(str(c.model["id"]), name), ModelName: name,
			ProviderID: str(c.provider["id"]), ProviderName: str(c.provider["name"]),
			Protocol: req.Protocol, Level: c.level, Source: c.source, Request: req,
		})
	}
	return out
}

func (s *Server) publishedPolicyByLevelLocked(ws, level string) map[string]any {
	for _, pol := range s.Store.RoutingPolicies {
		if str(pol["workspaceId"]) == ws && str(pol["status"]) == "published" && str(pol["level"]) == level {
			return pol
		}
	}
	return nil
}

func aliasToRouteLevel(alias string) string {
	a := strings.ToLower(strings.TrimSpace(alias))
	switch {
	case strings.Contains(a, "opus"), strings.HasSuffix(a, "p0+"), a == "p0+":
		return "P0+"
	case strings.Contains(a, "sonnet"), a == "p0", strings.HasPrefix(a, "p0"):
		return "P0"
	case strings.Contains(a, "gpt-5"), strings.Contains(a, "deepseek"), a == "p1":
		return "P1"
	case strings.Contains(a, "haiku"), a == "p2":
		return "P2"
	default:
		return ""
	}
}

func hasCapability(caps []string, want string) bool {
	for _, c := range caps {
		if strings.EqualFold(c, want) {
			return true
		}
	}
	return false
}

// streamResolvedChat streams text deltas for a resolved turn (local provider call).
func (s *Server) streamResolvedChat(ctx context.Context, rt resolvedTurn, messages []modelprov.ChatMessage, onDelta func(string) error) (string, error) {
	req := rt.Request
	if len(messages) == 0 {
		return "", fmt.Errorf("missing messages")
	}
	req.Messages = messages
	client := modelprov.NewClient()
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

// recordTrace emits a single trace.Event to the Server's recorder. Safe to
// call with nil recorder (test stubs).
func (s *Server) recordTrace(traceID, ws, turnID string, rt resolvedTurn, started time.Time, status trace.Status, err error) {
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

func (s *Server) newTraceID() string {
	// Cheap correlation id; uniqueness is best-effort within process.
	return fmt.Sprintf("tr-%d", time.Now().UnixNano())
}

// streamLocalCandidates tries provider candidates, then DE_LLM_*, then embedded chat.
func (s *Server) streamLocalCandidates(ctx context.Context, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (string, resolvedTurn, error) {
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

// copilotStreamTimeout is the overall Copilot harness SSE budget (multi-step ReAct + tools).
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

// formatModelInvokeUserMessage turns provider/transport errors into actionable Chinese copy.
// Avoids the misleading "无可用模型：context deadline exceeded" for timeout cases.
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

func (s *Server) streamLLMForCopilot(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (reply string, resolved resolvedTurn, err error) {
	// Split topology: Collab owns sessions; Cap owns providers/credentials/invoke.
	// Prefer Cap hop so Vault / model_secrets live in one place.
	if s.Mode == ModeCollab {
		out, rt, e := s.streamLLMViaCap(ctx, r, ws, modelID, messages, system, onDelta)
		if e == nil {
			return out, rt, nil
		}
		err = e
		if !isCapUnreachable(e) {
			// Cap answered (auth/model/SSRF/etc.) — do not re-resolve locally with a
			// half-hydrated Collab store; only allow DE_LLM_* / embedded escape hatch.
			return s.streamEnvFallback(ctx, messages, system, onDelta, err)
		}
		// Cap down: continue to local resolve (mono-dev / Cap not started) then env.
	}

	return s.streamLocalCandidates(ctx, ws, modelID, messages, system, onDelta)
}

func (s *Server) streamEnvFallback(ctx context.Context, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error, prior error) (string, resolvedTurn, error) {
	userMsg := lastUserContent(messages)
	if envReq, ok := modelprov.EnvFallbackRequest(userMsg); ok {
		if system != "" {
			envReq.System = system
		}
		envReq.Messages = messages
		rt := resolvedTurn{
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
		rt := resolvedTurn{
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
	return "", resolvedTurn{}, fmt.Errorf("%s", formatModelInvokeUserMessage(prior))
}

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

func capBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("DE_CAP_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://127.0.0.1:8102"
}

func (s *Server) streamLLMViaCap(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (string, resolvedTurn, error) {
	userMsg := lastUserContent(messages)
	payload, _ := json.Marshal(map[string]any{
		"workspaceId": ws, "modelId": modelID, "content": userMsg, "messages": messages, "stream": true, "system": system,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, capBaseURL()+"/api/model-invoke/stream", bytes.NewReader(payload))
	if err != nil {
		return "", resolvedTurn{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	// Forward auth + workspace identity
	for _, h := range []string{"Authorization", "x-workspace-id", "x-tenant-id", "x-correlation-id", "x-mock-role", "x-mock-actor", "x-mock-user-id", "x-mock-permissions"} {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}
	if req.Header.Get("x-workspace-id") == "" {
		req.Header.Set("x-workspace-id", ws)
	}

	client := &http.Client{Timeout: 0}
	res, err := client.Do(req)
	if err != nil {
		return "", resolvedTurn{}, fmt.Errorf("Cap unreachable: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		return "", resolvedTurn{}, fmt.Errorf("Cap invoke %d: %s", res.StatusCode, strings.TrimSpace(string(b)))
	}

	rt := resolvedTurn{ModelID: modelID, Source: "cap"}
	var b strings.Builder
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	event := ""
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var obj map[string]any
		if json.Unmarshal([]byte(data), &obj) != nil {
			continue
		}
		if mid := str(obj["modelId"]); mid != "" {
			rt.ModelID = mid
		}
		if name := str(obj["modelName"]); name != "" {
			rt.ModelName = name
		}
		if pid := str(obj["providerId"]); pid != "" {
			rt.ProviderID = pid
		}
		if src := str(obj["source"]); src != "" {
			rt.Source = src
		}
		switch event {
		case "delta":
			text := str(obj["text"])
			if text == "" {
				continue
			}
			b.WriteString(text)
			if onDelta != nil {
				if err := onDelta(text, rt.ModelID); err != nil {
					return b.String(), rt, err
				}
			}
		case "error":
			return b.String(), rt, fmt.Errorf("%s", coalesce(str(obj["message"]), "model invoke failed"))
		case "done":
			if b.Len() == 0 {
				if full := str(obj["text"]); full != "" {
					b.WriteString(full)
				}
			}
		}
		event = ""
	}
	if err := sc.Err(); err != nil {
		return b.String(), rt, err
	}
	if b.Len() == 0 {
		return "", rt, fmt.Errorf("empty Cap stream")
	}
	return b.String(), rt, nil
}

// --- Cap HTTP handlers ---

func (s *Server) modelInvokeStream(w http.ResponseWriter, r *http.Request) {
	body, _ := decodeMap(r)
	ws := coalesce(str(body["workspaceId"]), s.workspaceID(r))
	modelID := coalesce(str(body["modelId"]), str(body["model"]))
	messages := parseChatMessages(body["messages"])
	content := strings.TrimSpace(str(body["content"]))
	if content == "" {
		content = strings.TrimSpace(str(body["input"]))
	}
	if len(messages) == 0 {
		if content == "" {
			writeErr(w, apperr.BadReq(apperr.BadRequest, "消息不能为空"))
			return
		}
		messages = []modelprov.ChatMessage{{Role: "user", Content: content}}
	}
	system := strings.TrimSpace(str(body["system"]))
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, apperr.New(apperr.Unknown, 500, "流式不支持"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	emit := func(typ string, extra map[string]any) {
		payload := map[string]any{"type": typ}
		for k, v := range extra {
			payload[k] = v
		}
		writeSSE(w, typ, payload)
		flusher.Flush()
	}

	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()

	var full strings.Builder
	text, rt, streamErr := s.streamLocalCandidates(ctx, ws, modelID, messages, system, func(t, mid string) error {
		if full.Len() == 0 {
			emit("meta", map[string]any{
				"modelId": mid, "source": "provider",
			})
		}
		full.WriteString(t)
		emit("delta", map[string]any{"text": t, "modelId": mid})
		return nil
	})
	if streamErr != nil {
		emit("error", map[string]any{"message": formatModelInvokeUserMessage(streamErr), "partial": full.String()})
		return
	}
	emit("meta", map[string]any{
		"modelId": rt.ModelID, "modelName": rt.ModelName, "providerId": rt.ProviderID,
		"providerName": rt.ProviderName, "protocol": rt.Protocol, "source": rt.Source, "level": rt.Level,
	})
	emit("done", map[string]any{
		"ok": true, "modelId": rt.ModelID, "modelName": rt.ModelName, "text": text,
		"providerId": rt.ProviderID, "source": rt.Source,
	})
}

func (s *Server) modelInvoke(r *http.Request) (any, error) {
	body, _ := decodeMap(r)
	ws := coalesce(str(body["workspaceId"]), s.workspaceID(r))
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
