package server_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/feishu"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
)

func TestFeishuWebhookURLVerificationAndInbound(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()
	h := srv.Handler()

	cred := feishu.Credentials{
		AppID: "cli_x", AppSecret: "sec_x",
		EncryptKey: "", VerificationToken: "vt-demo",
		Domain: "https://open.feishu.cn",
	}
	payload, _ := cred.Marshal()
	if err := srv.Vault.Put(context.Background(), "vault://channel-deployments/dep-feishu-wh/credential", payload); err != nil {
		t.Fatal(err)
	}
	st.Lock()
	st.ChannelDeploys = append([]map[string]any{{
		"id": "dep-feishu-wh", "workspaceId": "w1", "name": "飞书入站", "kind": "feishu",
		"status": "active", "credentialRef": "vault://channel-deployments/dep-feishu-wh/credential",
		"connectionMode": "webhook", "webhookPath": "/api/channel/feishu/events/dep-feishu-wh",
	}}, st.ChannelDeploys...)
	st.Unlock()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/channel/feishu/events/dep-feishu-wh",
		strings.NewReader(`{"challenge":"chal-abc","token":"vt-demo","type":"url_verification"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("challenge %d %s", rr.Code, rr.Body.String())
	}
	var chal map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &chal)
	if chal["challenge"] != "chal-abc" {
		t.Fatalf("%v", chal)
	}

	msgBody := `{
	  "schema":"2.0",
	  "header":{"event_id":"ev-in-1","event_type":"im.message.receive_v1","token":"vt-demo"},
	  "event":{
	    "sender":{"sender_type":"user","sender_id":{"open_id":"ou_u1"}},
	    "message":{"chat_id":"oc_1","chat_type":"p2p","message_id":"om_in","message_type":"text","content":"{\"text\":\"hello inbound\"}"}
	  }
	}`
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel/feishu/events/dep-feishu-wh", strings.NewReader(msgBody))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("inbound %d %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/channel-control/inbound", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("list inbound %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if len(env.Data) < 1 || strAny(env.Data[0]["text"]) != "hello inbound" {
		t.Fatalf("%s", rr.Body.String())
	}
}

func TestFeishuWebhookRejectsBadSignature(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()
	h := srv.Handler()
	cred := feishu.Credentials{AppID: "a", AppSecret: "b", EncryptKey: "ek-1"}
	payload, _ := cred.Marshal()
	if err := srv.Vault.Put(context.Background(), "vault://channel-deployments/dep-sig/credential", payload); err != nil {
		t.Fatal(err)
	}
	st.Lock()
	st.ChannelDeploys = append([]map[string]any{{
		"id": "dep-sig", "workspaceId": "w1", "kind": "feishu", "name": "sig",
		"credentialRef": "vault://channel-deployments/dep-sig/credential",
	}}, st.ChannelDeploys...)
	st.Unlock()

	body := []byte(`{"hello":true}`)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/channel/feishu/events/dep-sig", bytes.NewReader(body))
	req.Header.Set("X-Lark-Request-Timestamp", "1")
	req.Header.Set("X-Lark-Request-Nonce", "n")
	req.Header.Set("X-Lark-Signature", "deadbeef")
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}

	h2 := sha256.New()
	_, _ = h2.Write([]byte("1" + "n" + "ek-1"))
	_, _ = h2.Write(body)
	sig := hex.EncodeToString(h2.Sum(nil))
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel/feishu/events/dep-sig", bytes.NewReader(body))
	req.Header.Set("X-Lark-Request-Timestamp", "1")
	req.Header.Set("X-Lark-Request-Nonce", "n")
	req.Header.Set("X-Lark-Signature", sig)
	h.ServeHTTP(rr, req)
	if rr.Code == 401 {
		t.Fatalf("signature should be accepted: %s", rr.Body.String())
	}
}
