package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestChannelControlOverviewAligned(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/channel-control/overview", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("overview %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if int(asFloat(env.Data["activeDeployments"])) != 1 {
		t.Fatalf("activeDeployments want 1 got %#v", env.Data["activeDeployments"])
	}
	if int(asFloat(env.Data["publishedPolicies"])) != 0 {
		t.Fatalf("publishedPolicies want 0 (draft seed) got %#v", env.Data["publishedPolicies"])
	}
	if int(asFloat(env.Data["deadLetters"])) != 1 {
		t.Fatalf("deadLetters want 1 got %#v", env.Data["deadLetters"])
	}
}

func TestChannelDeploymentFieldsAndVerify(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	h := srv.Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/channel-control/deployments", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("deployments %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if len(env.Data) < 1 {
		t.Fatalf("expected seeded deployments: %s", rr.Body.String())
	}
	first := env.Data[0]
	for _, key := range []string{"credentialMasked", "environment", "credentialRef", "owner"} {
		if first[key] == nil || strAny(first[key]) == "" {
			t.Fatalf("missing field %s in %#v", key, first)
		}
	}

	rr = httptest.NewRecorder()
	mux := http.NewServeMux()
	mux.HandleFunc("/cgi-bin/gettoken", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"errcode":0,"access_token":"tok","expires_in":7200}`))
	})
	fs := httptest.NewServer(mux)
	t.Cleanup(fs.Close)
	srv.WecomHTTP = fs.Client()
	h = srv.Handler()
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments",
		strings.NewReader(`{"name":"企微沙箱","kind":"wecom","corpId":"ww_demo","corpSecret":"secret-token-1234","agentId":"1000002","callbackToken":"tok","callbackAesKey":"abcdefghijklmnopqrstuvwxyz0123456789ABCDE","apiBaseUrl":"`+fs.URL+`","environment":"sandbox"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	var createdEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &createdEnv)
	if strings.Contains(strAny(createdEnv.Data["credentialMasked"]), "secret-token") {
		t.Fatal("credential must not echo plaintext")
	}
	if strAny(createdEnv.Data["status"]) != "draft" {
		t.Fatalf("new deploy status want draft got %v", createdEnv.Data["status"])
	}
	if !strings.Contains(strAny(createdEnv.Data["webhookPath"]), "/api/channel/wecom/events/") {
		t.Fatalf("webhookPath=%v", createdEnv.Data["webhookPath"])
	}

	id := strAny(createdEnv.Data["id"])
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/deployments/"+id+"/verify", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("verify %d %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &createdEnv)
	if strAny(createdEnv.Data["status"]) != "active" || strAny(createdEnv.Data["lastVerifiedAt"]) == "" {
		t.Fatalf("verify should activate with lastVerifiedAt: %#v", createdEnv.Data)
	}
}

func TestChannelPolicyValidatePublishSimulate(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/channel-control/policies/delivery-policy-p0/validate", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("validate %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if strAny(env.Data["status"]) != "ready" {
		t.Fatalf("validate should set ready, got %#v", env.Data)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/policies/delivery-policy-p0/simulate",
		strings.NewReader(`{"scope":"sandbox"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if strAny(env.Data["status"]) != "passed" {
		t.Fatalf("simulate status want passed got %#v", env.Data)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/policies/delivery-policy-p0/publish", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("publish %d %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if env.Data["snapshot"] == nil || strAny(env.Data["publishedBy"]) == "" {
		t.Fatalf("publish version incomplete: %#v", env.Data)
	}

	// delete protected
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodDelete, "/api/channel-control/deployments/delivery-feishu", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code == 200 {
		t.Fatal("published policy should block deployment delete")
	}
}

func TestChannelDeadLettersShape(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/channel-control/dead-letters", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("dead-letters %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if len(env.Data) < 1 {
		t.Fatal("expected demo dead letter")
	}
	item := env.Data[0]
	for _, key := range []string{"targetMasked", "payloadSummary", "deploymentId", "correlationId", "createdAt"} {
		if strAny(item[key]) == "" {
			t.Fatalf("missing %s in %#v", key, item)
		}
	}
}

func TestChannelDeadLetterReplay(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/channel-control/dead-letters/da-demo-1/replay", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("replay %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/channel-control/dead-letters", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	var env struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	for _, item := range env.Data {
		if strAny(item["id"]) == "da-demo-1" {
			t.Fatal("replayed dead letter should leave queue")
		}
	}
}

func TestChannelHealthAndTemplates(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/channel-control/health", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("health %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if len(env.Data) < 1 {
		t.Fatalf("expected health rows: %s", rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/channel-templates", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if len(env.Data) < 1 || strAny(env.Data[0]["preview"]) == "" {
		t.Fatalf("templates need preview: %s", rr.Body.String())
	}
}
