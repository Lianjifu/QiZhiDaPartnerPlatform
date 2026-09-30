package server_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/feishu"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
)

func TestCollabCopilotPostTurnDelegatesToCap(t *testing.T) {
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "1")
	capStore := store.New()
	capStore.SetWriteDomain(store.DomainCap)
	capStore.DropUnowned(store.DomainCap)
	capSrv := server.New(capStore)
	capSrv.Mode = server.ModeCap
	capTS := httptest.NewServer(capSrv.Handler())
	t.Cleanup(capTS.Close)

	collabStore := store.New()
	collabStore.SetWriteDomain(store.DomainCollab)
	collabStore.DropUnowned(store.DomainCollab)
	collab := server.New(collabStore)
	collab.Mode = server.ModeCollab
	collab.PeerHTTP = capTS.Client()
	t.Setenv("DE_CAP_URL", capTS.URL)

	rr := httptest.NewRecorder()
	req := adminReq(http.MethodPost, "/api/internal/copilot/post-turn", `{
		"workspaceId":"w1","ownerId":"u1","ownerName":"Admin",
		"conversationId":"conv-1","correlationId":"corr-1","messageId":"msg-1",
		"userMessage":"我喜欢简洁回答","assistantText":"好的","mode":"react",
		"memoryIngest":{"workspaceId":"w1","ownerId":"u1","ownerName":"Admin","title":"t","content":"c","sourceType":"conversation","sourceId":"conv-1","correlationId":"corr-1","layer":"short_term","scope":"user","confidence":0.85}
	}`)
	capSrv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("cap post-turn %d %s", rr.Code, rr.Body.String())
	}
	if len(capStore.MemoryRecords) == 0 {
		t.Fatal("expected cap to persist memory ingest")
	}
}

func TestCapInboundSessionLandsOnCollab(t *testing.T) {
	collabStore := store.New()
	collabStore.SetWriteDomain(store.DomainCollab)
	collabStore.DropUnowned(store.DomainCollab)
	collab := server.New(collabStore)
	collab.Mode = server.ModeCollab
	collabTS := httptest.NewServer(collab.Handler())
	t.Cleanup(collabTS.Close)

	capStore := store.New()
	capStore.SetWriteDomain(store.DomainCap)
	capStore.DropUnowned(store.DomainCap)
	cap := server.New(capStore)
	cap.Mode = server.ModeCap
	cap.Vault = vault.NewFromEnv()
	cap.PeerHTTP = collabTS.Client()
	t.Setenv("DE_COLLAB_URL", collabTS.URL)

	cred := feishu.Credentials{
		AppID: "cli_x", AppSecret: "sec_x",
		VerificationToken: "vt-split", Domain: "https://open.feishu.cn",
	}
	payload, _ := cred.Marshal()
	if err := cap.Vault.Put(context.Background(), "vault://channel-deployments/dep-split/credential", payload); err != nil {
		t.Fatal(err)
	}
	capStore.Lock()
	capStore.ChannelDeploys = append([]map[string]any{{
		"id": "dep-split", "workspaceId": "w1", "name": "飞书拆分", "kind": "feishu",
		"status": "active", "credentialRef": "vault://channel-deployments/dep-split/credential",
		"connectionMode": "webhook", "digitalPartnerId": "de-1",
		"webhookPath": "/api/channel/feishu/events/dep-split",
	}}, capStore.ChannelDeploys...)
	capStore.Unlock()

	body := `{
	  "schema":"2.0",
	  "header":{"event_id":"ev-split-1","event_type":"im.message.receive_v1","token":"vt-split"},
	  "event":{
	    "sender":{"sender_type":"user","sender_id":{"open_id":"ou_split"}},
	    "message":{"chat_id":"oc_split_1","chat_type":"p2p","message_id":"om_split_1","message_type":"text","content":"{\"text\":\"split inbound\"}"}
	  }
	}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/channel/feishu/events/dep-split", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	cap.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("webhook %d %s", rr.Code, rr.Body.String())
	}
	if n := countChannelSessions(capStore, "feishu", "oc_split_1"); n != 0 {
		t.Fatalf("cap must not own sessions, got %d", n)
	}
	if n := countChannelSessions(collabStore, "feishu", "oc_split_1"); n != 1 {
		t.Fatalf("collab should have the inbound session, got %d", n)
	}
}
