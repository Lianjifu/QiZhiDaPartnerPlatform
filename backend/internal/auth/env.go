package auth

import (
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
)

// BanMockToken reports whether mock tokens (mock-admin-token etc.) are rejected
// and login issues JWT instead (pro only).
func BanMockToken() bool {
	return runtimeenv.FromEnv().BanMockToken()
}

// AllowMockIdentity reports whether x-mock-* identity forging is accepted (dev only).
func AllowMockIdentity() bool {
	return runtimeenv.FromEnv().AllowsMockIdentity()
}

// HasMockIdentityHeaders reports whether the request carries any x-mock-*
// header. Presence without AllowMockIdentity is a 401 in pro — see
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
