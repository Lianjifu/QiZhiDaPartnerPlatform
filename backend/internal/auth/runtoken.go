package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"
)

// RunToken is an HMAC-signed capability token for skill-runtime sandbox calls.
//
// 阶段 2:增加 ``AllowedEgress`` 字段,把技能声明的"允许出口域名"
// 写进签名。Python 沙箱消费该字段,作为唯一可信源(不再读 body,
// 防 body 篡改)。
type RunTokenClaims struct {
	SkillID       string   `json:"skillId"`
	WorkspaceID   string   `json:"workspaceId"`
	ActorID       string   `json:"actorId"`
	Exp           int64    `json:"exp"`
	AllowedEgress []string `json:"allowedEgress,omitempty"`
}

func skillRunSecret() string {
	if v := strings.TrimSpace(os.Getenv("DE_SKILL_RUN_SECRET")); v != "" {
		return v
	}
	return "qzda-skill-run-dev"
}

// MintRunToken issues a short-lived token (default 5m).
//
// ``allowedEgress`` 是技能执行允许的出口域名白名单(后缀匹配),
// 由调用方(handlers_d / skill_harness)传入签名。空切片允许显式声明"无外联"。
func MintRunToken(skillID, workspaceID, actorID string, allowedEgress []string, ttl time.Duration) string {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	// lower-case + 去空,避免空字符串进入 JSON 让 Python 端误判
	cleanEgress := make([]string, 0, len(allowedEgress))
	for _, h := range allowedEgress {
		h = strings.ToLower(strings.TrimSpace(h))
		if h != "" {
			cleanEgress = append(cleanEgress, h)
		}
	}
	claims := RunTokenClaims{
		SkillID: skillID, WorkspaceID: workspaceID, ActorID: actorID,
		Exp: time.Now().UTC().Add(ttl).Unix(),
		AllowedEgress: cleanEgress,
	}
	raw, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(skillRunSecret()))
	mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))
	return "v1." + payload + "." + sig
}

// VerifyRunToken validates signature and expiry. Returns claims or error.
func VerifyRunToken(token string) (*RunTokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return nil, errors.New("invalid runToken format")
	}
	mac := hmac.New(sha256.New, []byte(skillRunSecret()))
	mac.Write([]byte(parts[1]))
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(parts[2])) {
		return nil, errors.New("invalid runToken signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid runToken payload")
	}
	var claims RunTokenClaims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return nil, err
	}
	if claims.Exp > 0 && time.Now().UTC().Unix() > claims.Exp {
		return nil, errors.New("runToken expired")
	}
	return &claims, nil
}
