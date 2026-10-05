package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// oidcStates maps an OIDC state nonce to its expiry (unix seconds). Shared
// between OIDCLogin (issue) and OIDCCallback (consume). 10-minute window
// matches Authentik/Dex defaults. State is deleted on use (one-shot).
var oidcStates sync.Map

func newOIDCState() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	state := hex.EncodeToString(b)
	oidcStates.Store(state, time.Now().Add(10*time.Minute).Unix())
	return state
}

func consumeOIDCState(state string) bool {
	if state == "" {
		return false
	}
	v, ok := oidcStates.LoadAndDelete(state)
	if !ok {
		return false
	}
	exp, _ := v.(int64)
	return time.Now().Unix() <= exp
}

// AuditWriter writes an audit row. server/ wires this to Store.AppendAudit
// (with appropriate Lock/Unlock around the call). The auth package owns
// only the call signature; concurrency control stays at the storage layer.
type AuditWriter interface {
	AppendAudit(workspaceID, actor, action, target, result, reason string)
}

// Handler holds the HTTP handlers for /api/auth/*. It is wired into the
// server's main route switch; the auth package itself stays free of any
// server/ or store/ imports so the same handler can be lifted into a
// standalone auth service later.
//
// Dependencies are injected (Sign / Parse / OIDC / AuditWriter) instead of
// reached for, so Handler tests can use stub writers without booting the
// in-memory Store.
type Handler struct {
	Sign  func(id Identity, ttl time.Duration) (string, error)
	Parse func(token string) (*Identity, error)

	// OIDC holds Authentik/Dex-compatible config (issuer, dev-code allow).
	// When nil, OIDC login + callback are disabled.
	OIDC *OIDCConfig

	// AuditWriter writes login/oidc audit rows. May be nil in tests.
	AuditWriter AuditWriter
}

// Route describes one HTTP route owned by Handler.
type Route struct {
	Method string
	Path   string
	Handle func(r *http.Request) (any, error)
}

// Routes returns the public auth routes in registration order. server/
// calls these from its main route switch — Handler does not own an http.ServeMux.
func (h *Handler) Routes() []Route {
	return []Route{
		{Method: http.MethodPost, Path: "/api/auth/login", Handle: h.Login},
		{Method: http.MethodGet, Path: "/api/auth/oidc/login", Handle: h.OIDCLogin},
		{Method: http.MethodGet, Path: "/api/auth/oidc/callback", Handle: h.OIDCCallback},
	}
}

// loginBody is the JSON body accepted by POST /api/auth/login.
type loginBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Login is the password / OIDC-gated login handler.
//
// Behavior (preserved byte-for-byte from the previous server.login):
//   - QZDA_FORCE_OIDC=1 → 403 with "请使用 OIDC".
//   - Missing email/password → 400 with "缺少凭据".
//   - Returns a stable mock token for FE smoke; production (QZDA_BAN_MOCK_TOKEN)
//     issues JWT instead via auth.Sign (unless caller already prefers JWT via
//     x-prefer-jwt: 1 header).
//   - Writes a "登录" audit row on success.
func (h *Handler) Login(r *http.Request) (any, error) {
	if ForceOIDCLogin() {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "生产环境已禁用密码登录，请使用 OIDC（/api/auth/oidc/login）")
	}
	var body loginBody
	if err := decodeJSONBody(r, &body); err != nil || body.Email == "" || body.Password == "" {
		return nil, apperr.BadReq(apperr.CredentialsRequired, "缺少凭据")
	}
	role, name, userID := RoleFromEmail(body.Email)
	ws := []string{"w1", "w2"}
	scopes := []string{"sandbox", "staging"}
	if role == "admin" {
		ws = []string{"w1", "w2", "w3", "w4"}
		scopes = []string{"sandbox", "staging", "production"}
	}
	if role == "auditor" {
		ws = []string{"w1", "w2", "w3"}
		scopes = []string{"sandbox", "staging", "production"}
	}
	id := Identity{
		ID: userID, Name: name, Email: body.Email, Role: role,
		TenantID: "tenant-acme", WorkspaceID: ws[0], WorkspaceIDs: ws,
		EnvironmentScopes: scopes, Permissions: RolePermissions(role), MFAEnabled: true,
	}
	// Prefer stable mock tokens for FE smoke; production (QZDA_BAN_MOCK_TOKEN) issues JWT only.
	token := "mock-user-token"
	switch role {
	case "admin":
		token = "mock-admin-token"
	case "auditor":
		token = "mock-auditor-token"
	}
	preferJWT := strings.EqualFold(r.Header.Get("x-prefer-jwt"), "1") || BanMockToken()
	if h.Sign != nil {
		if jwt, err := h.Sign(id, 24*time.Hour); err == nil && preferJWT {
			token = jwt
		}
	}
	if h.AuditWriter != nil {
		h.AuditWriter.AppendAudit(id.WorkspaceID, id.Name, "登录", "auth", "success", "")
	}
	return map[string]any{"token": token, "user": id}, nil
}

// OIDCLogin returns either the Authentik/Dex authorize URL (when OIDC is
// configured) or a stub callback URL the FE can use for local demos. State
// is generated if the caller did not pass one; if a state IS passed, its
// expiry is refreshed (clients reuse state across reloads).
func (h *Handler) OIDCLogin(r *http.Request) (any, error) {
	state := r.URL.Query().Get("state")
	if state == "" {
		state = newOIDCState()
	} else {
		oidcStates.Store(state, time.Now().Add(10*time.Minute).Unix())
	}
	if h.OIDC == nil || !h.OIDC.Enabled {
		return map[string]any{
			"enabled":      false,
			"hint":         "设置 QZDA_OIDC_ISSUER / QZDA_OIDC_CLIENT_ID 后启用 Authentik/Dex OIDC",
			"stubCallback": "/api/auth/oidc/callback?code=admin&state=" + state,
			"state":        state,
		}, nil
	}
	url, err := h.OIDC.AuthURL(state)
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, err.Error())
	}
	return map[string]any{"enabled": true, "authorizationUrl": url, "state": state}, nil
}

// OIDCCallback exchanges the auth code for an Identity, mints a JWT, writes
// an "OIDC 登录" audit row, and returns {token, user}. State validation is
// enforced only when OIDC is enabled AND dev-code shortcut is disabled
// (preserves the original allowlist semantics).
func (h *Handler) OIDCCallback(r *http.Request) (any, error) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if h.OIDC != nil && h.OIDC.Enabled && !h.OIDC.AllowDevCodes {
		if !consumeOIDCState(state) {
			return nil, apperr.UnauthorizedErr("无效或过期的 OIDC state")
		}
	} else if state != "" {
		consumeOIDCState(state) // best-effort clear
	}

	if h.OIDC == nil {
		return nil, apperr.UnauthorizedErr("OIDC 未配置")
	}
	id, err := h.OIDC.ExchangeCode(r.Context(), code)
	if err != nil {
		return nil, apperr.UnauthorizedErr(err.Error())
	}
	if h.Sign == nil {
		return nil, apperr.BadReq(apperr.BadRequest, "签发令牌失败")
	}
	token, err := h.Sign(*id, 24*time.Hour)
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, "签发令牌失败")
	}
	if h.AuditWriter != nil {
		h.AuditWriter.AppendAudit(id.WorkspaceID, id.Name, "OIDC 登录", "auth", "success", "")
	}
	return map[string]any{"token": token, "user": id}, nil
}

func decodeJSONBody(r *http.Request, v any) error {
	if r.Body == nil {
		return apperr.BadReq(apperr.CredentialsRequired, "缺少请求体")
	}
	return json.NewDecoder(r.Body).Decode(v)
}
