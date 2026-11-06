package server_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// Pro mode has no dev shortcut: password login is accepted only for a
// verified account in platform.auth_accounts. Without a configured account
// store the lookup fails closed, so the request is rejected (not 403 — the
// credentials themselves are simply wrong).
func TestPasswordLoginRejectedInProduction(t *testing.T) {
	t.Setenv("QZDA_MODE", "pro")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d %s", rr.Code, rr.Body.String())
	}
}

// Pro mode bans the dev mock tokens, so a login response must never carry
// one — neither as the issued credential nor inside the identity payload.
func TestPasswordLoginNeverReturnsMockTokenInProduction(t *testing.T) {
	t.Setenv("QZDA_MODE", "pro")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if strings.Contains(rr.Body.String(), "mock-") {
		t.Fatalf("production must not expose a mock credential: %s", rr.Body.String())
	}
}

// Dev keeps the stable mock token for FE smoke.
func TestPasswordLoginAllowedInDev(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"token":"mock-admin-token"`) {
		t.Fatalf("want the dev mock token: %s", rr.Body.String())
	}
}

// The escape hatch: x-prefer-jwt: 1 asks for a signed JWT instead of the
// mock token, so a dev caller can exercise the real credential path.
func TestPasswordLoginEscapeHatchReturnsJWT(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-prefer-jwt", "1")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), `"token":"mock-`) {
		t.Fatalf("escape hatch must issue a signed JWT: %s", rr.Body.String())
	}
}
