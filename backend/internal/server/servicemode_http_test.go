package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestModeRejectsForeignRoutes(t *testing.T) {
	st := store.New()
	srv := New(st)
	srv.Mode = ModeCap
	h := srv.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("cap should reject workspaces: %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "owned by other") {
		t.Fatalf("expected ownership error, got %s", rr.Body.String())
	}

	req2 := httptest.NewRequest(http.MethodGet, "/api/channel/deployments", nil)
	req2.Header.Set("Authorization", "Bearer mock-admin-token")
	rr2 := httptest.NewRecorder()
	h.ServeHTTP(rr2, req2)
	if strings.Contains(rr2.Body.String(), "owned by other") {
		t.Fatalf("cap must own /api/channel/deployments: %s", rr2.Body.String())
	}
}

func TestModeSysOwnsGovernanceAuditAliases(t *testing.T) {
	st := store.New()
	srv := New(st)
	srv.Mode = ModeSys
	h := srv.Handler()
	for _, path := range []string{"/api/governance", "/api/audit", "/healthz"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if path != "/healthz" {
			req.Header.Set("Authorization", "Bearer mock-admin-token")
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if strings.Contains(rr.Body.String(), "owned by other") {
			t.Fatalf("%s rejected by sys: %s", path, rr.Body.String())
		}
		if path == "/healthz" && rr.Code != http.StatusOK {
			t.Fatalf("healthz %d", rr.Code)
		}
	}
}

func TestOwnsPathChannelAlias(t *testing.T) {
	if !ModeCap.OwnsPath("/api/channel/deployments") {
		t.Fatal("cap should own /api/channel/deployments")
	}
	if ModeSys.OwnsPath("/api/channel/deployments") {
		t.Fatal("sys should not own channel alias")
	}
}

func TestModePolicyEvaluateAndRejectsWorkspaces(t *testing.T) {
	srv := New(store.New())
	srv.Mode = ModePolicy
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

	req2 := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req2.Header.Set("Authorization", "Bearer mock-admin-token")
	rr2 := httptest.NewRecorder()
	h.ServeHTTP(rr2, req2)
	if !strings.Contains(rr2.Body.String(), "owned by other") {
		t.Fatalf("policy must reject workspaces: %s", rr2.Body.String())
	}
}

func TestModeAuditOwnsAuditCenter(t *testing.T) {
	srv := New(store.New())
	srv.Mode = ModeAudit
	h := srv.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/audit-center", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if strings.Contains(rr.Body.String(), "owned by other") {
		t.Fatalf("audit must own audit-center: %s", rr.Body.String())
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("audit-center %d %s", rr.Code, rr.Body.String())
	}
}
