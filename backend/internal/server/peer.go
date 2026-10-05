package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
)

func collabBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_COLLAB_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://127.0.0.1:8101"
}

func (s *Server) peerClient() *http.Client {
	if s != nil && s.PeerHTTP != nil {
		return s.PeerHTTP
	}
	return &http.Client{Timeout: 8 * time.Second}
}

func (s *Server) peerPOST(r *http.Request, base, path string, body any) (any, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	url := strings.TrimRight(base, "/") + path
	ctx := r.Context()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	s.copyPeerHeaders(r, req)
	res, err := s.peerClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("peer %s %d: %s", path, res.StatusCode, strings.TrimSpace(string(b)))
	}
	var envelope struct {
		OK   bool `json:"ok"`
		Data any  `json:"data"`
	}
	if err := json.Unmarshal(b, &envelope); err == nil && envelope.Data != nil {
		return envelope.Data, nil
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Server) peerPOSTStream(r *http.Request, base, path string, body any) (string, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	url := strings.TrimRight(base, "/") + path
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	s.copyPeerHeaders(r, req)
	client := s.peerClient()
	if client.Timeout != 0 && client.Timeout < copilotStreamTimeout() {
		client = &http.Client{Timeout: copilotStreamTimeout(), Transport: client.Transport}
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode >= 400 {
		return "", fmt.Errorf("peer stream %s %d: %s", path, res.StatusCode, strings.TrimSpace(string(b)))
	}
	return lastSSEAssistantText(string(b)), nil
}

func (s *Server) copyPeerHeaders(from, to *http.Request) {
	if from == nil || to == nil {
		return
	}
	for _, h := range []string{"Authorization", "x-workspace-id", "x-tenant-id", "x-correlation-id", "x-mock-role", "x-mock-actor", "x-mock-user-id", "x-mock-permissions"} {
		if v := from.Header.Get(h); v != "" {
			to.Header.Set(h, v)
		}
	}
}

func (s *Server) requestWithActor(parent *http.Request, actor *auth.Identity, ws string) *http.Request {
	if parent == nil {
		parent, _ = http.NewRequest(http.MethodPost, "/", nil)
	}
	req := parent.Clone(parent.Context())
	if actor != nil {
		if tok, err := auth.Sign(*actor, 15*time.Minute); err == nil {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		req = req.WithContext(auth.WithIdentity(req.Context(), actor))
	}
	if ws != "" {
		req.Header.Set("x-workspace-id", ws)
	}
	return req
}

func lastSSEAssistantText(body string) string {
	var full strings.Builder
	done := ""
	for _, block := range strings.Split(body, "\n\n") {
		var data strings.Builder
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "data:") {
				if data.Len() > 0 {
					data.WriteByte('\n')
				}
				data.WriteString(strings.TrimSpace(line[5:]))
			}
		}
		raw := strings.TrimSpace(data.String())
		if raw == "" {
			continue
		}
		var payload map[string]any
		if json.Unmarshal([]byte(raw), &payload) != nil {
			continue
		}
		switch str(payload["type"]) {
		case "delta":
			full.WriteString(str(payload["text"]))
		case "done":
			if t := str(payload["text"]); t != "" {
				done = t
			}
		}
	}
	if done != "" {
		return strings.TrimSpace(done)
	}
	return strings.TrimSpace(full.String())
}

func (s *Server) ownsCollabRuntime() bool { return true }

func (s *Server) ownsCapRuntime() bool { return true }
