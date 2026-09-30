package server_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestPasswordLoginBlockedWhenForceOIDC(t *testing.T) {
	t.Setenv("DE_FORCE_OIDC", "1")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestPasswordLoginBlockedWhenBanMockWithoutAllow(t *testing.T) {
	t.Setenv("DE_BAN_MOCK_TOKEN", "1")
	_ = os.Unsetenv("DE_ALLOW_PASSWORD_LOGIN")
	t.Setenv("DE_FORCE_OIDC", "")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestPasswordLoginAllowedWithEscapeHatch(t *testing.T) {
	t.Setenv("DE_BAN_MOCK_TOKEN", "1")
	t.Setenv("DE_ALLOW_PASSWORD_LOGIN", "1")
	t.Setenv("DE_FORCE_OIDC", "")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d %s", rr.Code, rr.Body.String())
	}
}
