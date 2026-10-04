package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

// The qzda-app monolith does not enforce per-unit route ownership —
// every route is reachable from the single process. These tests assert
// the post-collapse behavior: ModeApp / ModeAll accept every route,
// no "owned by other" rejection path is reachable.
func TestModeAppAcceptsAllRoutes(t *testing.T) {
	srv := New(store.New())
	srv.Mode = ModeApp
	h := srv.Handler()
	for _, path := range []string{
		"/api/workspaces",
		"/api/sessions",
		"/api/skills",
		"/api/channel-control/deployments",
		"/api/audit-center",
		"/api/access/governance",
		"/api/tasks",
		"/api/workflows",
		"/api/partners",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if strings.Contains(rr.Body.String(), "owned by other") {
			t.Fatalf("monolith should not reject %s with ownership error: %s", path, rr.Body.String())
		}
	}
}

func TestModeAppEvaluateInProcess(t *testing.T) {
	srv := New(store.New())
	srv.Mode = ModeApp
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(`{"action":"read","actorRole":"admin"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("evaluate %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"allow"`) {
		t.Fatalf("want allow field: %s", rr.Body.String())
	}
}

func TestModeAppHealthz(t *testing.T) {
	srv := New(store.New())
	srv.Mode = ModeApp
	h := srv.Handler()

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("healthz %d %s", rr.Code, rr.Body.String())
	}
}
