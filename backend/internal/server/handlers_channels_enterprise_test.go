package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
)

func TestDingtalkWecomWeixinCreateAndVerify(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()

	// DingTalk
	dmux := http.NewServeMux()
	dmux.HandleFunc("/v1.0/oauth2/accessToken", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"accessToken":"dtok","expireIn":7200}`))
	})
	ds := httptest.NewServer(dmux)
	t.Cleanup(ds.Close)
	srv.DingTalkHTTP = ds.Client()

	// Weixin
	wmux := http.NewServeMux()
	wmux.HandleFunc("/ilink/bot/getupdates", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ret":0,"msgs":[]}`))
	})
	ws := httptest.NewServer(wmux)
	t.Cleanup(ws.Close)
	srv.WeixinHTTP = ws.Client()

	h := srv.Handler()

	// create dingtalk
	rr := httptest.NewRecorder()
	body := `{"name":"钉钉生产","kind":"dingtalk","clientId":"ding_x","clientSecret":"sec","domain":"` + ds.URL + `","connectionMode":"stream"}`
	req := httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("dingtalk create %d %s", rr.Code, rr.Body.String())
	}
	var created struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	if strAny(created.Data["connectionMode"]) != "stream" {
		t.Fatalf("%v", created.Data["connectionMode"])
	}
	did := strAny(created.Data["id"])
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments/"+did+"/verify", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("dingtalk verify %d %s", rr.Code, rr.Body.String())
	}

	// create weixin
	rr = httptest.NewRecorder()
	body = `{"name":"个人微信","kind":"weixin","token":"ilink-tok","baseUrl":"` + ws.URL + `"}`
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("weixin create %d %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	wid := strAny(created.Data["id"])
	if strAny(created.Data["connectionMode"]) != "long_poll" {
		t.Fatalf("%v", created.Data)
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments/"+wid+"/verify", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("weixin verify %d %s", rr.Code, rr.Body.String())
	}

	// ensure vault stored
	_ = context.Background()
	ref := strAny(created.Data["credentialRef"])
	if v, err := srv.Vault.Resolve(context.Background(), ref); err != nil || !strings.Contains(v, "ilink-tok") {
		t.Fatalf("vault %v %q", err, v)
	}
}
