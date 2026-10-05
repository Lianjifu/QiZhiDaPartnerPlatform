package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
)

func TestOIDCStubCallback(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/login", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("login %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/auth/oidc/callback?code=admin&state=t1", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("callback %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if env.Data.Token == "" {
		t.Fatalf("missing token: %s", rr.Body.String())
	}
}

func TestModelProviderTestResolvesVault(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/models", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-live" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":[]}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()
	srv.ModelProbe.HTTP = ts.Client()
	ref := "vault://model-providers/mp-vault/credential"
	if err := srv.Vault.Put(context.Background(), ref, "sk-live"); err != nil {
		t.Fatal(err)
	}
	st.Lock()
	st.ModelProviders = append([]map[string]any{{
		"id": "mp-vault", "workspaceId": "w1", "name": "v", "status": "draft",
		"protocol": "openai_compatible", "baseUrl": ts.URL, "credentialRef": ref,
	}}, st.ModelProviders...)
	st.Unlock()

	h := srv.Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/model-providers/mp-vault/test", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-workspace-id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("test %d %s", rr.Code, rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"credentialResolved":true`)) {
		t.Fatalf("expected credentialResolved: %s", rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"status":"healthy"`)) {
		t.Fatalf("expected healthy: %s", rr.Body.String())
	}
}
