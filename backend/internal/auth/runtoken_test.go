package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"
)

func TestMintVerifyRunToken(t *testing.T) {
	t.Setenv("QZDA_SANDBOX_RUN_SECRET", "test-secret")
	tok := MintRunToken("sk1", "w1", "u1", []string{"wttr.in", " API.weather.gov "}, time.Minute)
	claims, err := VerifyRunToken(tok)
	if err != nil {
		t.Fatal(err)
	}
	if claims.SkillID != "sk1" || claims.WorkspaceID != "w1" || claims.ActorID != "u1" {
		t.Fatalf("%+v", claims)
	}
	// allowedEgress 应该被规范化(trim + lower-case,空字符串丢弃)
	if len(claims.AllowedEgress) != 2 ||
		claims.AllowedEgress[0] != "wttr.in" ||
		claims.AllowedEgress[1] != "api.weather.gov" {
		t.Fatalf("egress 字段未正确规范化: %+v", claims.AllowedEgress)
	}
	if _, err := VerifyRunToken(tok + "x"); err == nil {
		t.Fatal("expected bad sig")
	}
}

func TestMintVerifyRunTokenEmptyEgress(t *testing.T) {
	t.Setenv("QZDA_SANDBOX_RUN_SECRET", "test-secret")
	// 显式空 allowlist (deny-all) 也要正确序列化与回放
	tok := MintRunToken("sk1", "w1", "u1", nil, time.Minute)
	claims, err := VerifyRunToken(tok)
	if err != nil {
		t.Fatal(err)
	}
	if len(claims.AllowedEgress) != 0 {
		t.Fatalf("expected empty egress, got %+v", claims.AllowedEgress)
	}
}

func TestVerifyRunTokenExpired(t *testing.T) {
	t.Setenv("QZDA_SANDBOX_RUN_SECRET", "test-secret")
	// Craft expired claims (MintRunToken coerces non-positive TTL to 5m).
	claims := RunTokenClaims{SkillID: "sk1", WorkspaceID: "w1", ActorID: "u1", Exp: time.Now().UTC().Add(-time.Minute).Unix()}
	raw, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte("test-secret"))
	mac.Write([]byte(payload))
	tok := "v1." + payload + "." + hex.EncodeToString(mac.Sum(nil))
	if _, err := VerifyRunToken(tok); err == nil {
		t.Fatal("expected expired")
	}
}

func TestRunTokenClaimsBackwardCompat(t *testing.T) {
	// 阶段 2 之前签发的 token (没有 allowedEgress 字段) 仍要能验证通过,
	// 只是 AllowedEgress 解析为空切片。防止阶段 1 之前部署的存量 token 失效。
	t.Setenv("QZDA_SANDBOX_RUN_SECRET", "test-secret")
	claims := RunTokenClaims{SkillID: "sk1", WorkspaceID: "w1", ActorID: "u1", Exp: time.Now().UTC().Add(time.Minute).Unix()}
	raw, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte("test-secret"))
	mac.Write([]byte(payload))
	tok := "v1." + payload + "." + hex.EncodeToString(mac.Sum(nil))
	got, err := VerifyRunToken(tok)
	if err != nil {
		t.Fatalf("旧 token 应该仍然可验证: %v", err)
	}
	if got.AllowedEgress != nil && len(got.AllowedEgress) != 0 {
		t.Fatalf("旧 token 的 AllowedEgress 应为空,got %+v", got.AllowedEgress)
	}
}
