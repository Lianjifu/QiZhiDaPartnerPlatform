package auth

import (
	"net/http"
	"os"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
)

// ForceOIDCLogin reports whether password login must be rejected.
// True when QZDA_FORCE_OIDC=1, or when QZDA_BAN_MOCK_TOKEN=1 unless
// QZDA_ALLOW_PASSWORD_LOGIN=1 (local escape hatch). The default (no env)
// keeps password login enabled for demo / development.
func ForceOIDCLogin() bool {
	if v := strings.TrimSpace(os.Getenv("QZDA_FORCE_OIDC")); v == "1" || strings.EqualFold(v, "true") {
		return true
	}
	if !BanMockToken() {
		return false
	}
	allow := strings.TrimSpace(os.Getenv("QZDA_ALLOW_PASSWORD_LOGIN"))
	return !(allow == "1" || strings.EqualFold(allow, "true"))
}

// BanMockToken reports whether mock tokens (mock-admin-token etc.) must be
// rejected by the auth middleware and replaced with JWT in login responses.
// Thin re-export of runtimeenv.BanDemoToken so callers do not need to know
// the env flag name.
func BanMockToken() bool {
	return runtimeenv.BanDemoToken()
}

// AllowMockIdentity reports whether the current env allows x-mock-*
// identity forging. Thin re-export of runtimeenv.AllowsDemoIdentityHeaders.
func AllowMockIdentity() bool {
	return runtimeenv.FromEnv().AllowsDemoIdentityHeaders()
}

// HasMockIdentityHeaders reports whether the request carries any x-mock-*
// header. Presence without AllowMockIdentity is a 401 in production — see
// Middleware.RequireAuth for the policy.
func HasMockIdentityHeaders(r *http.Request) bool {
	if r == nil {
		return false
	}
	for _, h := range []string{"x-mock-role", "x-mock-user-id", "x-mock-actor", "x-mock-permissions"} {
		if strings.TrimSpace(r.Header.Get(h)) != "" {
			return true
		}
	}
	return false
}
