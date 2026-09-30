package server_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestWorkspaceForgeForbidden(t *testing.T) {
	h := server.New(store.New()).Handler()
	// mock-user-token membership: w1, w2 — forge w3 must 403
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	req.Header.Set("Authorization", "Bearer mock-user-token")
	req.Header.Set("x-workspace-id", "w3")
	h.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("expected 403 for forged workspace, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestWorkspaceForgeAllowedOnListWorkspaces(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer mock-user-token")
	req.Header.Set("x-workspace-id", "w3")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("expected 200 for workspace list bootstrap, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestWorkspaceAllowedHeader(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	req.Header.Set("Authorization", "Bearer mock-user-token")
	req.Header.Set("x-workspace-id", "w2")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("expected 200 for allowed workspace, got %d %s", rr.Code, rr.Body.String())
	}
}
