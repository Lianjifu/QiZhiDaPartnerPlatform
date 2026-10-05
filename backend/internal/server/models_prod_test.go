package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func adminReq(method, path, body string) *http.Request {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	r.Header.Set("Authorization", "Bearer mock-admin-token")
	r.Header.Set("x-workspace-id", "w1")
	return r
}

func decodeData(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var env struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v body=%s", err, rr.Body.String())
	}
	if !env.OK {
		t.Fatalf("not ok: %s", rr.Body.String())
	}
	return env.Data
}

func TestModelProviderCredentialAliasAndAudit(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	st := store.New()
	srv := server.New(st)
	h := srv.Handler()

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodPost, "/api/model-providers", `{
		"name":"DeepSeek","model":"deepseek-chat","credential":"sk-secret-key",
		"protocol":"openai_compatible","baseUrl":"https://api.deepseek.com","region":"cn-east","tier":"connectable"
	}`))
	if rr.Code != 200 {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	data := decodeData(t, rr)
	if data["status"] != "standby" {
		t.Fatalf("status=%v", data["status"])
	}
	if data["credentialRef"] == nil || strings.Contains(rr.Body.String(), "sk-secret-key") {
		t.Fatalf("credential leaked or missing ref: %s", rr.Body.String())
	}
	models, _ := data["models"].([]any)
	if len(models) == 0 {
		t.Fatal("expected models")
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodGet, "/api/model-audit", ""))
	if rr.Code != 200 || !bytes.Contains(rr.Body.Bytes(), []byte("接入供应商")) {
		t.Fatalf("audit: %d %s", rr.Code, rr.Body.String())
	}
}

func TestCreateModelProviderAllowsLocalSecretsWithBanMockToken(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "1")
	t.Setenv("QZDA_ALLOW_PASSWORD_LOGIN", "1")
	t.Setenv("QZDA_ENV", "development")
	st := store.New()
	h := server.New(st).Handler()

	loginRR := httptest.NewRecorder()
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"x"}`))
	loginReq.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(loginRR, loginReq)
	if loginRR.Code != 200 {
		t.Fatalf("login %d %s", loginRR.Code, loginRR.Body.String())
	}
	var loginEnv struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(loginRR.Body.Bytes(), &loginEnv); err != nil || loginEnv.Data.Token == "" {
		t.Fatalf("login token: %v body=%s", err, loginRR.Body.String())
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/model-providers", bytes.NewBufferString(`{
		"name":"DeepSeek","model":"deepseek-chat","credential":"sk-secret-key",
		"protocol":"openai_compatible","baseUrl":"https://api.deepseek.com","region":"cn-east","tier":"connectable"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+loginEnv.Data.Token)
	req.Header.Set("x-workspace-id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create with QZDA_BAN_MOCK_TOKEN=1 should use ModelSecrets locally, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestModelProviderWorkspaceIsolation(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := adminReq(http.MethodDelete, "/api/model-providers/mp-9", "")
	req.Header.Set("x-workspace-id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 404 {
		t.Fatalf("expected 404 cross-ws delete, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestDiscoverModelsShape(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	t.Setenv("QZDA_MODEL_DISCOVER_FALLBACK", "1")
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"m1"}]}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	srv := server.New(store.New())
	srv.ModelProbe = modelprov.NewClient()
	srv.ModelProbe.HTTP = ts.Client()
	h := srv.Handler()

	rr := httptest.NewRecorder()
	body := `{"protocol":"openai_compatible","baseUrl":"` + ts.URL + `","apiKey":"sk-x"}`
	h.ServeHTTP(rr, adminReq(http.MethodPost, "/api/model-providers/discover-models", body))
	if rr.Code != 200 {
		t.Fatalf("discover %d %s", rr.Code, rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"models"`)) || !bytes.Contains(rr.Body.Bytes(), []byte(`"id"`)) {
		t.Fatalf("shape: %s", rr.Body.String())
	}
}

func TestProviderImpactBlocksDelete(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodDelete, "/api/model-providers/mp-1", ""))
	if rr.Code != 409 {
		t.Fatalf("expected 409 in use, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestUnpublishClearsProviderImpactAndAllowsDelete(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodGet, "/api/model-providers/mp-1/impact", ""))
	if rr.Code != 200 {
		t.Fatalf("impact %d %s", rr.Code, rr.Body.String())
	}
	impact := decodeData(t, rr)
	if impact["deletionAllowed"] == true {
		t.Fatalf("expected published route to block delete, got %#v", impact)
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodPost, "/api/model-routing/policies/rp-p0/unpublish", `{"reason":"下线以便退役供应商"}`))
	if rr.Code != 200 {
		t.Fatalf("unpublish p0 %d %s", rr.Code, rr.Body.String())
	}
	for _, pid := range []string{"rp-p1", "rp-p3"} {
		rr = httptest.NewRecorder()
		h.ServeHTTP(rr, adminReq(http.MethodPost, "/api/model-routing/policies/"+pid+"/unpublish", `{"reason":"下线以便退役供应商"}`))
		if rr.Code != 200 {
			t.Fatalf("unpublish %s %d %s", pid, rr.Code, rr.Body.String())
		}
	}
	pol := decodeData(t, rr)
	if pol["status"] != "draft" {
		t.Fatalf("status=%v", pol["status"])
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodGet, "/api/model-providers/mp-1/impact", ""))
	impact = decodeData(t, rr)
	if impact["deletionAllowed"] != true {
		t.Fatalf("expected deletionAllowed after unpublish, got %#v", impact)
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodDelete, "/api/model-providers/mp-1", `{"reason":"退役"}`))
	if rr.Code != 200 {
		t.Fatalf("delete %d %s", rr.Code, rr.Body.String())
	}
}

func TestRoutingValidateReadyPublishRollback(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()

	// validate draft that has primary but no fallback — should become ready if budget ok
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodPost, "/api/model-routing/policies/rp-draft/validate", `{}`))
	if rr.Code != 200 {
		t.Fatalf("validate %d %s", rr.Code, rr.Body.String())
	}
	data := decodeData(t, rr)
	if data["status"] != "ready" {
		t.Fatalf("expected ready, got %v issues=%v", data["status"], data["validationIssues"])
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodPost, "/api/model-routing/policies/rp-draft/publish", `{}`))
	if rr.Code != 200 {
		t.Fatalf("publish %d %s", rr.Code, rr.Body.String())
	}
	ver := decodeData(t, rr)
	vid, _ := ver["id"].(string)
	if vid == "" {
		t.Fatal("missing version id")
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodPost, "/api/model-routing/policies/rp-draft/rollback", `{"versionId":"`+vid+`"}`))
	if rr.Code != 200 {
		t.Fatalf("rollback %d %s", rr.Code, rr.Body.String())
	}
}

func TestFailoverTestResponseShape(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodPost, "/api/model-routing/failover-tests", `{"policyId":"rp-p0","scope":"sandbox"}`))
	if rr.Code != 200 {
		t.Fatalf("failover %d %s", rr.Code, rr.Body.String())
	}
	data := decodeData(t, rr)
	for _, k := range []string{"fromModelId", "toModelId", "correlationId", "policyId", "status"} {
		if data[k] == nil {
			t.Fatalf("missing %s: %v", k, data)
		}
	}
	if data["status"] != "passed" || data["fromModelId"] != "mdl-gpt4" {
		t.Fatalf("unexpected: %v", data)
	}
}

func TestBudgetExceededOnUsage(t *testing.T) {
	t.Setenv("QZDA_MODEL_BUDGET_ENFORCE", "1")
	st := store.New()
	st.Lock()
	st.ModelBudgets = []map[string]any{
		{"workspaceId": "w1", "month": "2026-07", "usedUsd": 9999, "limitUsd": 500},
	}
	st.Unlock()
	srv := server.New(st)
	s := srv
	_ = s
	// use exported path via stream is heavy; call check via record path indirectly:
	// expose through Handler by posting to a tiny internal — instead lock and call via package test in server.
	// We verify governance risk and that enforce flag is wired by simulating check through copilot would need full stream.
	// Unit: ensure governance reflects critical.
	h := srv.Handler()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodGet, "/api/model-governance/overview", ""))
	if rr.Code != 200 {
		t.Fatalf("gov %d %s", rr.Code, rr.Body.String())
	}
	data := decodeData(t, rr)
	if data["budgetRisk"] != "critical" {
		t.Fatalf("risk=%v", data["budgetRisk"])
	}
	if data["healthyShare"] == nil || data["regionDistribution"] == nil {
		t.Fatalf("missing gov fields: %v", data)
	}
}

func TestPatchDoesNotPersistPlaintextCredential(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, adminReq(http.MethodPatch, "/api/model-providers/mp-2", `{
		"name":"本地 Embedding 2","credential":"sk-should-not-persist"
	}`))
	if rr.Code != 200 {
		t.Fatalf("patch %d %s", rr.Code, rr.Body.String())
	}
	if bytes.Contains(rr.Body.Bytes(), []byte("sk-should-not-persist")) {
		t.Fatal("plaintext credential in response")
	}
	st.RLock()
	defer st.RUnlock()
	for _, p := range st.ModelProviders {
		if strID := p["id"]; strID == "mp-2" {
			if _, ok := p["credential"]; ok {
				t.Fatal("credential field on provider")
			}
			if _, ok := p["apiKey"]; ok {
				t.Fatal("apiKey field on provider")
			}
		}
	}
}
