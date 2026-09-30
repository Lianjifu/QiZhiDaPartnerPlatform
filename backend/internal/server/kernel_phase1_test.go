package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	collabv1 "github.com/qizhida-partner-platform/backend/gen/qzda/collab/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/collab/v1/collabv1connect"
	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/feishu"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
)

func TestMockTokenForbiddenWhenBanMock(t *testing.T) {
	t.Setenv("DE_BAN_MOCK_TOKEN", "1")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_IDENTITY_MOCK_FORBIDDEN") {
		t.Fatalf("want E_IDENTITY_MOCK_FORBIDDEN: %s", rr.Body.String())
	}
}

func TestMockHeadersForbiddenWhenAllowMockIdentityFalse(t *testing.T) {
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "0")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer "+mustAdminJWT(t))
	req.Header.Set("x-mock-role", "admin")
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_IDENTITY_MOCK_FORBIDDEN") {
		t.Fatalf("want E_IDENTITY_MOCK_FORBIDDEN: %s", rr.Body.String())
	}
}

func TestMockTokenAllowedWithEscapeHatch(t *testing.T) {
	t.Setenv("DE_BAN_MOCK_TOKEN", "1")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("want 200 got %d %s", rr.Code, rr.Body.String())
	}
}

func TestProductionEnvRejectsMockToken(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d %s", rr.Code, rr.Body.String())
	}
}

func TestCopilotStreamZeroTrustDenyIsHardReject(t *testing.T) {
	st := store.New()
	st.Lock()
	st.ZTPolicies = append(st.ZTPolicies, map[string]any{
		"id": "zt-session-write-deny", "name": "会话写入拒绝",
		"resource": "session", "action": "write", "decision": "deny",
		"enabled": true, "condition": "测试拒绝会话写入",
	})
	before := len(st.Messages["conv-1"])
	st.Unlock()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"should-deny","correlationId":"corr-zt-deny-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("want 403 got %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_ZERO_TRUST_DENY") {
		t.Fatalf("want E_ZERO_TRUST_DENY: %s", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "event:") {
		t.Fatalf("deny must not open SSE: %s", rr.Body.String())
	}
	st.RLock()
	after := len(st.Messages["conv-1"])
	st.RUnlock()
	if after != before {
		t.Fatalf("deny must not persist turn messages: before=%d after=%d", before, after)
	}
}

func TestCopilotStreamPersistsSnapshotAndReadonlyReplay(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	corr := "corr-replay-kernel-1"
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"hello snapshot","correlationId":"`+corr+`"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"snapshotId"`) {
		t.Fatalf("missing snapshotId in SSE: %s", rr.Body.String())
	}

	st.RLock()
	msgCount := len(st.Messages["conv-1"])
	if len(st.ContextSnapshots) == 0 {
		st.RUnlock()
		t.Fatal("expected context snapshot persisted")
	}
	rawSnaps, _ := json.Marshal(st.ContextSnapshots)
	st.RUnlock()

	var hydrated []map[string]any
	if err := json.Unmarshal(rawSnaps, &hydrated); err != nil {
		t.Fatal(err)
	}
	st.HydrateFrom("context_snapshots", hydrated)

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/copilot/conversations/conv-1/turns/"+corr+"/replay", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("replay %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		OK   bool `json:"ok"`
		Data struct {
			Replay        bool             `json:"replay"`
			CorrelationID string           `json:"correlationId"`
			Snapshot      map[string]any   `json:"snapshot"`
			Events        []map[string]any `json:"events"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil || !env.OK {
		t.Fatalf("envelope %s", rr.Body.String())
	}
	if !env.Data.Replay || env.Data.CorrelationID != corr {
		t.Fatalf("replay payload %#v", env.Data)
	}
	if strAny(env.Data.Snapshot["system"]) == "" || strAny(env.Data.Snapshot["id"]) == "" {
		t.Fatalf("snapshot incomplete: %s", rr.Body.String())
	}
	if len(env.Data.Events) == 0 {
		t.Fatalf("expected replay events: %s", rr.Body.String())
	}

	st.RLock()
	afterReplay := len(st.Messages["conv-1"])
	st.RUnlock()
	if afterReplay != msgCount {
		t.Fatalf("replay must not append messages: before=%d after=%d", msgCount, afterReplay)
	}

	client := collabv1connect.NewCollabServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")
	res, err := client.ReplayTurn(context.Background(), connect.NewRequest(&collabv1.ReplayTurnRequest{
		ConversationId: "conv-1", CorrelationId: corr,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.GetSnapshot().GetId() == "" || res.Msg.GetSnapshot().GetCorrelationId() != corr {
		t.Fatalf("connect snapshot %#v", res.Msg.GetSnapshot())
	}
	if len(res.Msg.GetEvents()) == 0 {
		t.Fatal("connect replay missing events")
	}
}

func TestFeishuWebhookReusesSessionForSameChatID(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()
	h := srv.Handler()

	cred := feishu.Credentials{
		AppID: "cli_x", AppSecret: "sec_x",
		VerificationToken: "vt-demo", Domain: "https://open.feishu.cn",
	}
	payload, _ := cred.Marshal()
	if err := srv.Vault.Put(context.Background(), "vault://channel-deployments/dep-feishu-route/credential", payload); err != nil {
		t.Fatal(err)
	}
	st.Lock()
	st.ChannelDeploys = append([]map[string]any{{
		"id": "dep-feishu-route", "workspaceId": "w1", "name": "飞书路由", "kind": "feishu",
		"status": "active", "credentialRef": "vault://channel-deployments/dep-feishu-route/credential",
		"connectionMode": "webhook", "digitalPartnerId": "de-1",
		"webhookPath": "/api/channel/feishu/events/dep-feishu-route",
	}}, st.ChannelDeploys...)
	st.Unlock()

	post := func(eventID, text string) {
		t.Helper()
		body := `{
		  "schema":"2.0",
		  "header":{"event_id":"` + eventID + `","event_type":"im.message.receive_v1","token":"vt-demo"},
		  "event":{
		    "sender":{"sender_type":"user","sender_id":{"open_id":"ou_u1"}},
		    "message":{"chat_id":"oc_route_1","chat_type":"p2p","message_id":"om_` + eventID + `","message_type":"text","content":"{\"text\":\"` + text + `\"}"}
		  }
		}`
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/channel/feishu/events/dep-feishu-route", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatalf("webhook %s %d %s", eventID, rr.Code, rr.Body.String())
		}
	}
	post("ev-route-1", "first inbound")
	post("ev-route-2", "second inbound")
	post("ev-route-1", "duplicate event")

	if n := countChannelSessions(st, "feishu", "oc_route_1"); n != 1 {
		t.Fatalf("want 1 session for chat, got %d", n)
	}
}

func mustAdminJWT(t *testing.T) string {
	t.Helper()
	tok, err := auth.Sign(auth.Identity{
		ID: "u1", Name: "平台管理员", Email: "admin@acme.com", Role: "admin",
		TenantID: "tenant-acme", WorkspaceID: "w1",
		WorkspaceIDs:      []string{"w1", "w2", "w3", "w4"},
		EnvironmentScopes: []string{"sandbox", "staging", "production"},
		Permissions:       auth.RolePermissions("admin"),
		MFAEnabled:        true,
	}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func countChannelSessions(st *store.Store, channel, threadID string) int {
	st.RLock()
	defer st.RUnlock()
	n := 0
	for _, sess := range st.Sessions {
		if strAny(sess["channel"]) != channel || strAny(sess["channelThreadId"]) != threadID {
			continue
		}
		if strAny(sess["status"]) == "closed" {
			continue
		}
		n++
	}
	return n
}
