package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
)

// OIDCConfig is Authentik/Dex-compatible OIDC settings.
type OIDCConfig struct {
	Issuer        string
	ClientID      string
	ClientSecret  string
	RedirectURL   string
	Enabled       bool
	AllowDevCodes bool // dev only: code=admin|user|audit for local demos
	HTTPClient    *http.Client
	// Optional overrides (tests / non-standard IdPs).
	TokenURL   string
	UserInfoURL string
	AuthPath   string // default /authorize; Authentik often /application/o/.../authorize via issuer
}

func LoadOIDC() OIDCConfig {
	issuer := strings.TrimSpace(os.Getenv("QZDA_OIDC_ISSUER"))
	return OIDCConfig{
		Issuer:        issuer,
		ClientID:      os.Getenv("QZDA_OIDC_CLIENT_ID"),
		ClientSecret:  os.Getenv("QZDA_OIDC_CLIENT_SECRET"),
		RedirectURL:   envOr("QZDA_OIDC_REDIRECT_URL", "http://127.0.0.1:5173/login/oidc/callback"),
		Enabled:       issuer != "",
		AllowDevCodes: runtimeenv.FromEnv().IsDev(),
		HTTPClient:    &http.Client{Timeout: 15 * time.Second},
		TokenURL:      strings.TrimSpace(os.Getenv("QZDA_OIDC_TOKEN_URL")),
		UserInfoURL:   strings.TrimSpace(os.Getenv("QZDA_OIDC_USERINFO_URL")),
		AuthPath:      envOr("QZDA_OIDC_AUTH_PATH", "/authorize"),
	}
}

func envOr(k, d string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return d
}

func (c OIDCConfig) client() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// AuthURL returns the authorize endpoint for browser redirect.
// Prefers OpenID discovery (Authentik/Dex); falls back to issuer+AuthPath.
func (c OIDCConfig) AuthURL(state string) (string, error) {
	if !c.Enabled {
		return "", errors.New("OIDC 未配置：设置 QZDA_OIDC_ISSUER 指向 Authentik/Dex")
	}
	if state == "" {
		return "", errors.New("缺少 OIDC state")
	}
	authEP, _, _, err := c.resolveEndpoints(context.Background())
	if err != nil || authEP == "" {
		base := strings.TrimRight(c.Issuer, "/")
		path := c.AuthPath
		if path == "" {
			path = "/authorize"
		}
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
		authEP = base + path
	}
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", c.ClientID)
	q.Set("redirect_uri", c.RedirectURL)
	q.Set("scope", "openid profile email")
	q.Set("state", state)
	return authEP + "?" + q.Encode(), nil
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	IDToken     string `json:"id_token"`
	TokenType   string `json:"token_type"`
	Error       string `json:"error"`
	ErrorDesc   string `json:"error_description"`
}

type userInfo struct {
	Sub               string `json:"sub"`
	Email             string `json:"email"`
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
	Groups            []string `json:"groups"`
}

// ExchangeCode exchanges an authorization code for an Identity.
// When AllowDevCodes is set, code admin|user|audit maps to demo identities (local only).
func (c OIDCConfig) ExchangeCode(ctx context.Context, code string) (*Identity, error) {
	if code == "" {
		return nil, errors.New("缺少 authorization code")
	}
	if c.AllowDevCodes {
		if id := identityFromDevCode(code); id != nil {
			return id, nil
		}
	}
	if !c.Enabled {
		return nil, errors.New("OIDC 未配置")
	}
	return c.exchangeRemote(ctx, code)
}

func identityFromDevCode(code string) *Identity {
	role, name, uid := "", "", ""
	switch code {
	case "admin":
		role, name, uid = "admin", "OIDC 管理员", "oidc-admin"
	case "audit":
		role, name, uid = "auditor", "OIDC 审计", "oidc-audit"
	case "user":
		role, name, uid = "user", "OIDC 用户", "oidc-user"
	default:
		return nil
	}
	ws := []string{"w1", "w2"}
	if role == "admin" {
		ws = []string{"w1", "w2", "w3", "w4"}
	}
	return &Identity{
		ID: uid, Name: name, Email: uid + "@oidc.local", Role: role,
		TenantID: "tenant-acme", WorkspaceID: "w1", WorkspaceIDs: ws,
		EnvironmentScopes: []string{"sandbox", "staging", "production"},
		Permissions:       RolePermissions(role), MFAEnabled: true,
	}
}

func (c OIDCConfig) exchangeRemote(ctx context.Context, code string) (*Identity, error) {
	_, tokenURL, userInfoURL, err := c.resolveEndpoints(ctx)
	if err != nil {
		return nil, err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", c.RedirectURL)
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	res, err := c.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("OIDC token 请求失败: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var tr tokenResponse
	_ = json.Unmarshal(body, &tr)
	if res.StatusCode >= 300 || tr.Error != "" {
		msg := tr.ErrorDesc
		if msg == "" {
			msg = tr.Error
		}
		if msg == "" {
			msg = string(body)
		}
		return nil, fmt.Errorf("OIDC token 交换失败 (%d): %s", res.StatusCode, msg)
	}
	if tr.AccessToken == "" && tr.IDToken == "" {
		return nil, errors.New("OIDC token 响应缺少 access_token/id_token")
	}

	info, err := c.fetchUserInfo(ctx, tr.AccessToken, userInfoURL)
	if err != nil {
		return nil, fmt.Errorf("OIDC userinfo 获取失败: %w", err)
	}
	return identityFromUserInfo(info), nil
}

func (c OIDCConfig) fetchUserInfo(ctx context.Context, accessToken, userInfoURL string) (*userInfo, error) {
	if accessToken == "" {
		return nil, errors.New("缺少 access_token")
	}
	u := userInfoURL
	if u == "" {
		u = c.UserInfoURL
	}
	if u == "" {
		u = strings.TrimRight(c.Issuer, "/") + "/userinfo"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	res, err := c.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("userinfo %d: %s", res.StatusCode, string(body))
	}
	var info userInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func identityFromUserInfo(info *userInfo) *Identity {
	email := info.Email
	if email == "" && info.PreferredUsername != "" {
		email = info.PreferredUsername + "@oidc.local"
	}
	role, name, uid := RoleFromEmail(email)
	if info.Name != "" {
		name = info.Name
	}
	if info.Sub != "" {
		uid = info.Sub
	}
	for _, g := range info.Groups {
		gl := strings.ToLower(g)
		if strings.Contains(gl, "admin") {
			role = "admin"
			break
		}
		if strings.Contains(gl, "audit") {
			role = "auditor"
		}
	}
	ws := []string{"w1", "w2"}
	if role == "admin" {
		ws = []string{"w1", "w2", "w3", "w4"}
	}
	return &Identity{
		ID: uid, Name: name, Email: email, Role: role,
		TenantID: "tenant-acme", WorkspaceID: "w1", WorkspaceIDs: ws,
		EnvironmentScopes: []string{"sandbox", "staging", "production"},
		Permissions:       RolePermissions(role), MFAEnabled: true,
	}
}
