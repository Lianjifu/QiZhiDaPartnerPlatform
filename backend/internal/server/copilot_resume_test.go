package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestCopilotResumeTurnExecutesApprovedAction covers the P6 endpoint: after a
// human approves a tool authorization, resuming the turn really executes the
// approved tool and reports it in the SSE stream.
func TestCopilotResumeTurnExecutesApprovedAction(t *testing.T) {
	st := store.New()
	st.Lock()
	st.Conversations = append([]map[string]any{{
		"id": "conv-1", "workspaceId": "w1", "title": "会话", "digitalPartnerId": "de-office",
	}}, st.Conversations...)
	st.Actions["act-1"] = map[string]any{
		"id": "act-1", "conversationId": "conv-1", "workspaceId": "w1",
		"status":           "approved",
		"digitalPartnerId": "de-office",
		"authorizationRequest": map[string]any{
			"toolName": "knowledge.retrieve", "toolKey": "builtin:knowledge.retrieve",
			"args":          map[string]any{"query": "制度"},
			"correlationId": "corr-1",
			"status":        "approved",
		},
	}
	st.Unlock()

	h := server.New(st).Handler()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/turns/corr-1/resume", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("resume %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "event: done") {
		t.Fatalf("no done event: %s", body)
	}
	if !strings.Contains(body, "knowledge.retrieve") {
		t.Fatalf("approved tool not executed: %s", body)
	}
}

// TestCopilotResumeTurnWithoutActionsIsNotFound keeps the endpoint honest:
// nothing to resume → 404, not an empty success.
func TestCopilotResumeTurnWithoutActionsIsNotFound(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-x/turns/corr-x/resume", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404 got %d %s", rr.Code, rr.Body.String())
	}
}
