package auth

import (
	"context"
	"net/http"
	"strings"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
)

// ctxKey is unexported so external packages cannot collide with our
// context values. IdentityFrom is the public accessor.
type ctxKey string

const identityKey ctxKey = "identity"

// IdentityFrom returns the Identity stored on the request context by
// Middleware.RequireAuth, or nil if the request was not authenticated.
func IdentityFrom(ctx context.Context) *Identity {
	v, _ := ctx.Value(identityKey).(*Identity)
	return v
}

// WithIdentity stores an Identity on the context. Exported for callers
// (peer-to-peer request builders, internal pipelines) that need to inject
// an already-authenticated subject without going through the HTTP layer.
func WithIdentity(ctx context.Context, id *Identity) context.Context {
	return context.WithValue(ctx, identityKey, id)
}

// Middleware is the auth gate. server/ composes its requireAuth wrapper
// around Middleware.RequireAuth to add workspace merge + resolution.
type Middleware struct {
	// Parse validates a bearer token and returns the corresponding Identity.
	// Required. server/ wires this to auth.Parse.
	Parse func(token string) (*Identity, error)

	// AllowMockIdentity reports whether x-mock-* headers and mock-* tokens
	// are accepted in the current env. Required.
	AllowMockIdentity func() bool

	// HasMockIdentityHeaders is an injected probe; defaults to
	// HasMockIdentityHeaders (the package helper) when nil.
	HasMockIdentityHeaders func(r *http.Request) bool

	// AuditorWriteGate is invoked for auditor-role callers attempting a
	// non-GET method. Return nil to allow; return a non-nil apperr to 403.
	AuditorWriteGate func(r *http.Request, id *Identity) error

	// UserWriteGate is invoked for user-role callers. Same contract.
	UserWriteGate func(r *http.Request, id *Identity) error

	// BypassPaths overrides the default bypass list. Optional.
	BypassPaths func(r *http.Request) bool
}

// RequireAuth enforces bearer-token auth and role gates. Routes that need
// unauthenticated access (health checks, login endpoints, share links,
// channel webhooks) are recognized via the default bypass list and pass
// through with no Identity on the context.
func (m *Middleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.bypassPaths()(r) {
			next.ServeHTTP(w, r)
			return
		}

		// /api/skill-artifacts/*: try to parse Authorization so the gateway
		// gate sees an identity and can audit who downloaded what. Absence
		// of the header is NOT a 401 here — the gateway's RequireAuth
		// policy (DE_ARTIFACT_REQUIRE_AUTH) decides.
		if (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(r.URL.Path, "/api/skill-artifacts/") {
			if h := r.Header.Get("Authorization"); h != "" {
				token := trimBearer(h)
				if m.hasMockHeaders()(r) && !m.allowMockIdentity() {
					writeErr(w, apperr.New(apperr.IdentityMockForbidden, 401, "生产环境禁止使用 mock 身份头"))
					return
				}
				if strings.HasPrefix(token, "mock-") && !m.allowMockIdentity() {
					writeErr(w, apperr.New(apperr.IdentityMockForbidden, 401, "生产环境禁止使用 mock token"))
					return
				}
				if m.Parse != nil {
					if id, err := m.Parse(token); err == nil && id != nil {
						r = r.WithContext(WithIdentity(r.Context(), id))
					}
				}
			}
			next.ServeHTTP(w, r)
			return
		}

		h := r.Header.Get("Authorization")
		if h == "" {
			writeErr(w, apperr.UnauthorizedErr("缺少认证凭证"))
			return
		}
		token := trimBearer(h)

		if m.hasMockHeaders()(r) && !m.allowMockIdentity() {
			writeErr(w, apperr.New(apperr.IdentityMockForbidden, 401, "生产环境禁止使用 mock 身份头"))
			return
		}
		if strings.HasPrefix(token, "mock-") && !m.allowMockIdentity() {
			writeErr(w, apperr.New(apperr.IdentityMockForbidden, 401, "生产环境禁止使用 mock token"))
			return
		}

		id, err := m.Parse(token)
		if err != nil {
			writeErr(w, apperr.UnauthorizedErr("无效令牌"))
			return
		}

		// Auditor / user role gates — server/ defines the actual policy
		// (which paths each role can touch); this middleware only enforces.
		if id.Role == "auditor" && r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			if m.AuditorWriteGate != nil {
				if err := m.AuditorWriteGate(r, id); err != nil {
					writeErr(w, err)
					return
				}
			}
		}
		if id.Role == "user" && m.UserWriteGate != nil {
			if err := m.UserWriteGate(r, id); err != nil {
				writeErr(w, err)
				return
			}
		}

		next.ServeHTTP(w, r.WithContext(WithIdentity(r.Context(), id)))
	})
}

func (m *Middleware) bypassPaths() func(r *http.Request) bool {
	if m.BypassPaths != nil {
		return m.BypassPaths
	}
	return defaultBypassPath
}

func (m *Middleware) hasMockHeaders() func(r *http.Request) bool {
	if m.HasMockIdentityHeaders != nil {
		return m.HasMockIdentityHeaders
	}
	return HasMockIdentityHeaders
}

func (m *Middleware) allowMockIdentity() bool {
	if m.AllowMockIdentity != nil {
		return m.AllowMockIdentity()
	}
	return AllowMockIdentity()
}

func defaultBypassPath(r *http.Request) bool {
	switch {
	case r.URL.Path == "/healthz" || r.URL.Path == "/readyz" || r.URL.Path == "/metrics":
		return true
	case r.URL.Path == "/v1/evaluate":
		return true
	case r.URL.Path == "/api/auth/login":
		return true
	case r.URL.Path == "/api/auth/oidc/login" || r.URL.Path == "/api/auth/oidc/callback":
		return true
	case strings.HasPrefix(r.URL.Path, "/api/share/"):
		return true
	case strings.HasPrefix(r.URL.Path, "/api/channel/feishu/events/"):
		return true
	case strings.HasPrefix(r.URL.Path, "/api/channel/wecom/events/"):
		return true
	case strings.HasPrefix(r.URL.Path, "/api/channel/dingtalk/events/"):
		return true
	}
	return false
}

func trimBearer(h string) string {
	token := strings.TrimSpace(strings.TrimPrefix(h, "Bearer"))
	token = strings.TrimSpace(strings.TrimPrefix(token, "bearer"))
	return token
}

// writeErr writes the standard apperr envelope (matches server.writeErr).
// Replicated here so auth/ stays free of any server/ import.
func writeErr(w http.ResponseWriter, err error) {
	response.Fail(w, err)
}
