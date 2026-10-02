package models

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// ModelInvokeStream is the SSE handler for POST /api/model-invoke/stream.
// Writes {type, text, resolvedModelId, providerId, providerName, source,
// error} JSON chunks as `data: ...` SSE frames. Signature takes (w, r)
// because the route owns the ResponseWriter (writes SSE frames directly).
func (s *Service) ModelInvokeStream(w http.ResponseWriter, r *http.Request) {
	body, _ := s.DecodeMap(r)
	ws := coalesce(str(body["workspaceId"]), s.WorkspaceID(r))
	modelID := coalesce(str(body["modelId"]), str(body["model"]))
	messages := parseChatMessages(body["messages"])
	content := strings.TrimSpace(coalesce(str(body["content"]), str(body["input"])))
	if len(messages) == 0 {
		if content == "" {
			writeErrSSE(w, apperr.BadReq(apperr.BadRequest, "消息不能为空"))
			return
		}
		messages = []modelprov.ChatMessage{{Role: "user", Content: content}}
	}
	system := strings.TrimSpace(str(body["system"]))

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErrSSE(w, apperr.New(apperr.Unknown, 500, "流式不支持"))
		return
	}
	headerSSE(w)
	flusher.Flush()

	emit := func(typ string, extra map[string]any) {
		payload := map[string]any{"type": typ}
		for k, v := range extra {
			payload[k] = v
		}
		writeSSE(w, payload)
		flusher.Flush()
	}

	ctx, cancel := context.WithTimeout(r.Context(), copilotStreamTimeout())
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
	if streamErr == nil {
		emit("meta", map[string]any{
			"modelId": rt.ModelID, "modelName": rt.ModelName, "providerId": rt.ProviderID,
			"providerName": rt.ProviderName, "protocol": rt.Protocol, "source": rt.Source, "level": rt.Level,
		})
		emit("done", map[string]any{
			"ok": true, "modelId": rt.ModelID, "modelName": rt.ModelName, "text": text,
			"providerId": rt.ProviderID, "source": rt.Source,
		})
		return
	}
	emit("error", map[string]any{
		"message": formatModelInvokeUserMessage(streamErr), "partial": full.String(),
	})
}

// StreamLLMForCopilot is the cross-module bridge invoked by the Copilot
// harness. Streams text deltas back via onDelta(text, resolvedModelID).
// Split topology: Collab hops there first (Cap owns providers/credentials/
// invoke), and falls back to local candidate resolution on transport
// failure.
func (s *Service) StreamLLMForCopilot(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (string, copilot.ResolvedTurn, error) {
	if s.IsCollabMode != nil && s.IsCollabMode() {
		out, rt, err := s.streamLLMViaCap(ctx, r, ws, modelID, messages, system, onDelta)
		if err == nil {
			return out, rt, nil
		}
		// Cap unreachable / 5xx — degrade to local resolution so a flaky
		// sidecar doesn't kill the entire Copilot session.
	}
	// Honour the overall harness timeout for multi-step ReAct.
	harnessCtx, cancel := context.WithTimeout(ctx, copilotStreamTimeout())
	defer cancel()
	text, rt, err := s.streamLocalCandidates(harnessCtx, ws, modelID, messages, system, onDelta)
	if err != nil {
		return "", rt, err
	}
	return text, rt, nil
}

// capBaseURL returns the Cap sidecar base URL (CapBaseURL Deps field, with
// sensible default fallback). Reads DE_CAP_URL (the canonical var consumed
// by the Copilot Cap-hop path) via the Deps.CapBaseURL callback so tests
// can stub it. Falls back to http://127.0.0.1:8102 (matches the pre-M08
// P2 behaviour).
func (s *Service) capBaseURL() string {
	if s.CapBaseURL != nil {
		if u := s.CapBaseURL(); u != "" {
			return u
		}
	}
	return "http://127.0.0.1:8102"
}

// streamLLMViaCap forwards the request to the Cap sidecar's stream
// endpoint. The Cap sidecar owns providers/credentials/invoke (Collab
// only owns session/routing), so Collab hops there first and falls back
// to direct local resolution on transport failure.
func (s *Service) streamLLMViaCap(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (string, ResolvedTurn, error) {
	url := s.capBaseURL() + "/api/model-invoke/stream"
	body, _ := json.Marshal(map[string]any{
		"workspaceId": ws, "modelId": modelID, "messages": messages, "system": system,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	// Forward the inbound auth + workspace headers so the Cap sidecar's
	// middleware (Bearer / X-Workspace-Id gates) accepts the hop. Without
	// these, the sidecar returns 401 / 403 and the hop degrades to a
	// local-fallback that has no providers in Collab mode.
	if r != nil {
		if v := r.Header.Get("Authorization"); v != "" {
			req.Header.Set("Authorization", v)
		}
		if v := r.Header.Get("X-Workspace-Id"); v != "" {
			req.Header.Set("X-Workspace-Id", v)
		}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", ResolvedTurn{}, fmt.Errorf("cap unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", ResolvedTurn{}, fmt.Errorf("cap returned %d", resp.StatusCode)
	}
	// Cap-side ModelInvokeStream emits SSE frames via writeSSE
	// ("data: <json>\n\n"). Use a Scanner so we honour the SSE framing
	// instead of trying to feed raw JSON to the decoder (which would choke
	// on the "data:" prefix and produce no chunks).
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1*1024*1024)
	var b strings.Builder
	var resolved string
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var c sseChunk
		if err := json.Unmarshal([]byte(payload), &c); err != nil {
			continue
		}
		switch c.Type {
		case "delta":
			b.WriteString(c.Text)
			resolved = c.ResolvedModelID
			if onDelta != nil {
				if err := onDelta(c.Text, c.ResolvedModelID); err != nil {
					return b.String(), ResolvedTurn{ModelID: resolved}, err
				}
			}
		case "done":
			resolved = c.ResolvedModelID
		case "error":
			return b.String(), ResolvedTurn{ModelID: resolved}, fmt.Errorf("%s", c.Error)
		}
	}
	if err := sc.Err(); err != nil {
		// Treat scanner EOF / transient pipe close as a graceful end-of-stream;
		// we only surface transport errors here.
		if err.Error() != "EOF" {
			return b.String(), ResolvedTurn{ModelID: resolved}, fmt.Errorf("cap stream read: %w", err)
		}
	}
	return b.String(), ResolvedTurn{ModelID: resolved}, nil
}

// headerSSE sets the SSE response headers (Content-Type, no-cache, keep-alive).
func headerSSE(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
}

// writeSSE marshals payload as a JSON SSE frame.
func writeSSE(w http.ResponseWriter, payload any) {
	data, _ := json.Marshal(payload)
	_, _ = w.Write([]byte("data: "))
	_, _ = w.Write(data)
	_, _ = w.Write([]byte("\n\n"))
}

// writeErrSSE writes an error frame in SSE form (for early bad-request paths
// before any chunk has been emitted).
func writeErrSSE(w http.ResponseWriter, err error) {
	headerSSE(w)
	payload := map[string]any{"type": "error", "message": err.Error()}
	writeSSE(w, payload)
}

// sseChunk is the wire format the client consumes. Mirrors the legacy
// `modelInvokeStream` payload. `Type` ∈ {"delta","done","error","meta"}.
type sseChunk struct {
	Type           string `json:"type"`
	Text           string `json:"text,omitempty"`
	ResolvedModelID string `json:"resolvedModelId,omitempty"`
	ProviderID     string `json:"providerId,omitempty"`
	ProviderName   string `json:"providerName,omitempty"`
	Source         string `json:"source,omitempty"`
	Error          string `json:"error,omitempty"`
}
