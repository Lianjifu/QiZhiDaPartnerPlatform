package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"
)

// Identity is the authenticated subject (Dev JWT stub; OIDC reserved for Phase E).
type Identity struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Email             string   `json:"email"`
	Role              string   `json:"role"` // user | admin | auditor
	TenantID          string   `json:"tenantId"`
	WorkspaceID       string   `json:"workspaceId"`
	WorkspaceIDs      []string `json:"workspaceIds"`
	EnvironmentScopes []string `json:"environmentScopes"`
	Permissions       []string `json:"permissions"`
	MFAEnabled        bool     `json:"mfaEnabled"`
}

type claims struct {
	Identity
	Exp int64 `json:"exp"`
	Iat int64 `json:"iat"`
}

func secret() []byte {
	if s := os.Getenv("QZDA_JWT_SECRET"); s != "" {
		return []byte(s)
	}
	return []byte("de-dev-jwt-secret-change-me")
}

func b64(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

func Sign(id Identity, ttl time.Duration) (string, error) {
	now := time.Now()
	c := claims{Identity: id, Iat: now.Unix(), Exp: now.Add(ttl).Unix()}
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	header := b64([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body := b64(payload)
	mac := hmac.New(sha256.New, secret())
	mac.Write([]byte(header + "." + body))
	sig := b64(mac.Sum(nil))
	return header + "." + body + "." + sig, nil
}

func Parse(token string) (*Identity, error) {
	// Dev compatibility: accept mock-* tokens used by frontend tests / smoke.
	if mapped := mapDevToken(token); mapped != nil {
		return mapped, nil
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token")
	}
	mac := hmac.New(sha256.New, secret())
	mac.Write([]byte(parts[0] + "." + parts[1]))
	expected := b64(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return nil, errors.New("bad signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	var c claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	if c.Exp > 0 && time.Now().Unix() > c.Exp {
		return nil, errors.New("token expired")
	}
	id := c.Identity
	return &id, nil
}

func mapDevToken(token string) *Identity {
	switch token {
	case "mock-admin-token", "mock-model-admin-token":
		return &Identity{
			ID: "u1", Name: "平台管理员", Email: "admin@acme.com", Role: "admin",
			TenantID: "tenant-acme", WorkspaceID: "w1",
			WorkspaceIDs: []string{"w1", "w2", "w3", "w4"},
			EnvironmentScopes: []string{"sandbox", "staging", "production"},
			Permissions: RolePermissions("admin"), MFAEnabled: true,
		}
	case "mock-user-token", "mock-jwt-token":
		return &Identity{
			ID: "u2", Name: "业务构建者", Email: "user@acme.com", Role: "user",
			TenantID: "tenant-acme", WorkspaceID: "w1",
			WorkspaceIDs: []string{"w1", "w2"},
			EnvironmentScopes: []string{"sandbox", "staging"},
			Permissions: RolePermissions("user"), MFAEnabled: true,
		}
	case "mock-auditor-token":
		return &Identity{
			ID: "u3", Name: "合规审计员", Email: "audit@acme.com", Role: "auditor",
			TenantID: "tenant-acme", WorkspaceID: "w1",
			WorkspaceIDs: []string{"w1", "w2", "w3"},
			EnvironmentScopes: []string{"sandbox", "staging", "production"},
			Permissions: RolePermissions("auditor"), MFAEnabled: true,
		}
	default:
		return nil
	}
}
