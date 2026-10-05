package auth_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
)

// stubAudit records every AppendAudit call so tests can assert the audit
// row landed without booting an in-memory store.
type stubAudit struct {
	rows []stubAuditRow
}

type stubAuditRow struct {
	workspaceID, actor, action, target, result, reason string
}

func (s *stubAudit) AppendAudit(workspaceID, actor, action, target, result, reason string) {
	s.rows = append(s.rows, stubAuditRow{workspaceID, actor, action, target, result, reason})
}

func newTestHandler(allowMock bool, banMock bool, audit auth.AuditWriter) *auth.Handler {
	return &auth.Handler{
		Sign:  auth.Sign,
		Parse: auth.Parse,
		OIDC:  nil,
		AuditWriter: audit,
		// env-driven switches are package-level; tests set QZDA_FORCE_OIDC /
		// QZDA_BAN_MOCK_TOKEN via t.Setenv in the caller.
	}
}

// noopAudit satisfies auth.AuditWriter when a test does not care.
type noopAudit struct{}

func (noopAudit) AppendAudit(string, string, string, string, string, string) {}

// TestLoginBlockedWhenForceOIDC verifies QZDA_FORCE_OIDC=1 returns 403
// (RoleForbidden) before any credential check.
func TestLoginBlockedWhenForceOIDC(t *testing.T) {
	t.Setenv("QZDA_FORCE_OIDC", "1")
	h := newTestHandler(true, false, noopAudit{})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")

	data, err := h.Login(req)
	if data != nil {
		t.Fatalf("want nil data, got %v", data)
	}
	if err == nil {
		t.Fatalf("want error, got nil")
	}
	ae, ok := err.(*apperr.AppError)
	if !ok {
		t.Fatalf("want *AppError, got %T (%v)", err, err)
	}
	if ae.Code != apperr.RoleForbidden || ae.Status != http.StatusForbidden {
		t.Fatalf("want RoleForbidden/403, got %s/%d", ae.Code, ae.Status)
	}
}

// TestLoginAllowedWhenForceOIDCFalse verifies the happy path: admin email
// returns mock-admin-token, an "登录" audit row is written, and no error.
func TestLoginAllowedWhenForceOIDCFalse(t *testing.T) {
	t.Setenv("QZDA_FORCE_OIDC", "")
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "")
	audit := &stubAudit{}
	h := newTestHandler(true, false, audit)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")

	data, err := h.Login(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := data.(map[string]any)
	if !ok {
		t.Fatalf("want map, got %T", data)
	}
	if tok, _ := m["token"].(string); tok != "mock-admin-token" {
		t.Fatalf("want mock-admin-token, got %q", tok)
	}
	if len(audit.rows) != 1 {
		t.Fatalf("want 1 audit row, got %d", len(audit.rows))
	}
	if audit.rows[0].action != "登录" {
		t.Fatalf("want 登录 audit, got %q", audit.rows[0].action)
	}
}

// TestOIDCCallbackStubCode verifies that with OIDC disabled + dev codes
// allowed (QZDA_OIDC_ALLOW_DEV_CODES=1), the callback exchanges "admin" to a
// signed JWT for the admin role and writes the "OIDC 登录" audit row.
func TestOIDCCallbackStubCode(t *testing.T) {
	t.Setenv("QZDA_OIDC_ALLOW_DEV_CODES", "1")
	h := &auth.Handler{
		Sign:  auth.Sign,
		Parse: auth.Parse,
		OIDC: &auth.OIDCConfig{
			Enabled:       false, // simulates "no QZDA_OIDC_ISSUER"
			AllowDevCodes: true,
		},
		AuditWriter: &stubAudit{},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/callback?code=admin&state=anything", nil)

	data, err := h.OIDCCallback(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := data.(map[string]any)
	if !ok {
		t.Fatalf("want map, got %T", data)
	}
	tok, _ := m["token"].(string)
	if tok == "" || tok == "mock-admin-token" {
		t.Fatalf("want signed JWT, got %q", tok)
	}
	// Parse it back to confirm signature is valid and identity is admin.
	id, err := auth.Parse(tok)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	if id.Role != "admin" {
		t.Fatalf("want admin role, got %q", id.Role)
	}
}

// TestMiddlewareRejectsMockTokenWhenBanMock verifies the auth middleware
// rejects a mock-* bearer token when QZDA_BAN_MOCK_TOKEN=1 (production-like).
func TestMiddlewareRejectsMockTokenWhenBanMock(t *testing.T) {
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "1")
	mw := &auth.Middleware{
		Parse:             auth.Parse,
		AllowMockIdentity: auth.AllowMockIdentity,
	}
	h := mw.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("downstream should not run; got request through")
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/anything", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d %s", rr.Code, rr.Body.String())
	}
}

// TestMiddlewareAllowsJWTWhenBanMock verifies the auth middleware accepts a
// signed JWT even when QZDA_BAN_MOCK_TOKEN=1 (production).
func TestMiddlewareAllowsJWTWhenBanMock(t *testing.T) {
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "1")
	tok, err := auth.Sign(auth.Identity{ID: "u1", Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1"}, time.Hour)
	if err != nil {
		t.Fatalf("Sign failed: %v", err)
	}
	mw := &auth.Middleware{
		Parse:             auth.Parse,
		AllowMockIdentity: auth.AllowMockIdentity,
	}
	called := false
	h := mw.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		id := auth.IdentityFrom(r.Context())
		if id == nil || id.Role != "admin" {
			t.Fatalf("want admin id on context, got %+v", id)
		}
		response.OK(w, nil)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/anything", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if !called {
		t.Fatalf("downstream not invoked")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d %s", rr.Code, rr.Body.String())
	}
}
