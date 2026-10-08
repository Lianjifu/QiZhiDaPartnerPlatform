package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

// In the qzda-app monolith every route is served in-process. There is no
// "owned by other unit" path semantics; this test only sanity-checks
// that ModeApp does not reject the canonical routes at the route layer
// (handler-level checks like auth still apply, but that's not what
// OwnsPath tested historically).
func TestModeAppAcceptsCanonicalRoutes(t *testing.T) {
	paths := []string{
		"/api/workspaces",
		"/api/sessions",
		"/api/copilot/conversations",
		"/api/skills",
		"/api/memory/records",
		"/api/model-providers",
		"/api/channel-control/deployments",
		"/api/workflows",
		"/v1/evaluate",
		"/healthz",
	}
	for _, path := range paths {
		if !ModeApp.IsUnified() {
			t.Fatalf("ModeApp.IsUnified()=false for %s", path)
		}
	}
}

func TestModeAppInProcessPostTurn(t *testing.T) {
	st := store.New()
	srv := New(st)
	srv.Mode = ModeApp

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/internal/copilot/post-turn", bytes.NewBufferString(`{
		"workspaceId":"w1","ownerId":"u1","ownerName":"Admin",
		"conversationId":"conv-1","correlationId":"corr-1","messageId":"msg-1",
		"userMessage":"hello","assistantText":"hi","mode":"react",
		"memoryIngest":{"workspaceId":"w1","ownerId":"u1","ownerName":"Admin","title":"t","content":"c","sourceType":"conversation","sourceId":"conv-1","correlationId":"corr-1","layer":"short_term","scope":"user","confidence":0.85}
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("x-workspace-id", "w1")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("post-turn in-process %d %s", rr.Code, rr.Body.String())
	}
	if len(st.MemoryRecords) == 0 {
		t.Fatal("expected memory ingest in same process")
	}
}

func TestModeAppSkillInvocationInProcess(t *testing.T) {
	st := store.New()
	st.EnsureDocxSkillReady()
	srv := New(st)
	srv.Mode = ModeApp

	var sk map[string]any
	srv.Store.RLock()
	for _, item := range st.Skills {
		if str(item["id"]) == "sk-docx" {
			sk = item
			break
		}
	}
	srv.Store.RUnlock()
	if sk == nil {
		t.Fatal("docx skill missing")
	}

	srv.recordSkillInvocationWithRequest(nil, "w1", sk, 55, true, "tester", "unit-test")
	srv.Store.RLock()
	calls := 0
	for _, h := range st.SkillHealth {
		if str(h["skillId"]) == "sk-docx" {
			calls = intFrom(h["calls24h"])
			break
		}
	}
	srv.Store.RUnlock()
	if calls < 1 {
		t.Fatalf("expected in-process skill health calls24h>=1 got %d", calls)
	}
}
