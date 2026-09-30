package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
)

func TestFeishuChannelCreateAndVerify(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/tenant_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "tenant_access_token": "t-test", "expire": 7200})
	})
	mux.HandleFunc("/open-apis/bot/v3/info", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0, "bot": map[string]any{"open_id": "ou_feishu_bot", "app_name": "数字伙伴机器人"},
		})
	})
	fs := httptest.NewServer(mux)
	t.Cleanup(fs.Close)

	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()
	srv.FeishuHTTP = fs.Client()
	h := srv.Handler()

	rr := httptest.NewRecorder()
	body := `{"name":"飞书生产","kind":"feishu","appId":"cli_demo","appSecret":"sec_demo","domain":"` + fs.URL + `","environment":"sandbox","connectionMode":"webhook"}`
	req := httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	var created struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	if created.Data["status"] != "draft" {
		t.Fatalf("status=%v", created.Data["status"])
	}
	if !strings.Contains(strAny(created.Data["credentialMasked"]), "demo") && !strings.HasPrefix(strAny(created.Data["credentialMasked"]), "••••") {
		t.Fatalf("masked=%v", created.Data["credentialMasked"])
	}
	if strAny(created.Data["domain"]) != fs.URL {
		t.Fatalf("domain=%v", created.Data["domain"])
	}
	if strAny(created.Data["connectionMode"]) != "webhook" {
		t.Fatalf("connectionMode=%v", created.Data["connectionMode"])
	}
	if !strings.Contains(strAny(created.Data["webhookPath"]), "/api/channel/feishu/events/") {
		t.Fatalf("webhookPath=%v", created.Data["webhookPath"])
	}
	id := strAny(created.Data["id"])

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments/"+id+"/verify", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("verify %d %s", rr.Code, rr.Body.String())
	}
	var verified struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &verified)
	if verified.Data["status"] != "active" {
		t.Fatalf("want active got %#v", verified.Data)
	}
	if strAny(verified.Data["botOpenId"]) != "ou_feishu_bot" {
		t.Fatalf("botOpenId=%v", verified.Data["botOpenId"])
	}
	if strAny(verified.Data["botName"]) != "数字伙伴机器人" {
		t.Fatalf("botName=%v", verified.Data["botName"])
	}
}

func TestFeishuChannelPatchDeployment(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()
	h := srv.Handler()

	rr := httptest.NewRecorder()
	body := `{"name":"飞书可编辑","kind":"feishu","appId":"cli_edit","appSecret":"sec_edit","connectionMode":"webhook"}`
	req := httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	var created struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	id := strAny(created.Data["id"])

	rr = httptest.NewRecorder()
	patch := `{"name":"飞书已改名","environment":"production","connectionMode":"websocket"}`
	req = httptest.NewRequest(http.MethodPatch, "/api/channel-control/deployments/"+id, strings.NewReader(patch))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("patch %d %s", rr.Code, rr.Body.String())
	}
	var updated struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &updated)
	if strAny(updated.Data["name"]) != "飞书已改名" {
		t.Fatalf("name=%v", updated.Data["name"])
	}
	if strAny(updated.Data["environment"]) != "production" {
		t.Fatalf("environment=%v", updated.Data["environment"])
	}
	if strAny(updated.Data["connectionMode"]) != "websocket" {
		t.Fatalf("connectionMode=%v", updated.Data["connectionMode"])
	}
	if _, ok := updated.Data["webhookPath"]; ok {
		t.Fatalf("websocket mode should clear webhookPath, got %v", updated.Data["webhookPath"])
	}
}

func TestFeishuChannelCreateWebSocketMode(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()
	h := srv.Handler()

	rr := httptest.NewRecorder()
	body := `{"name":"飞书WS","kind":"feishu","appId":"cli_ws","appSecret":"sec_ws","connectionMode":"websocket","encryptKey":"should-clear","verificationToken":"tok"}`
	req := httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	var created struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	if strAny(created.Data["connectionMode"]) != "websocket" {
		t.Fatalf("connectionMode=%v", created.Data["connectionMode"])
	}
	if _, ok := created.Data["webhookPath"]; ok {
		t.Fatalf("websocket mode must not set webhookPath: %v", created.Data["webhookPath"])
	}
	if created.Data["hasEncryptKey"] == true || created.Data["hasVerificationToken"] == true {
		t.Fatalf("websocket mode must not keep webhook secrets flags: %#v", created.Data)
	}
}
