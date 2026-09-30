package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestCreateWorkspaceVisibleInList(t *testing.T) {
	h := server.New(store.New()).Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces",
		bytes.NewBufferString(`{"name":"预发环境","region":"cn-east-1","plan":"enterprise"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	var created struct {
		OK   bool `json:"ok"`
		Data struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil || !created.OK || created.Data.ID == "" {
		t.Fatalf("create envelope %s", rr.Body.String())
	}

	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req2.Header.Set("Authorization", "Bearer mock-admin-token")
	h.ServeHTTP(rr2, req2)
	if rr2.Code != 200 {
		t.Fatalf("list %d %s", rr2.Code, rr2.Body.String())
	}
	if !bytes.Contains(rr2.Body.Bytes(), []byte(created.Data.ID)) {
		t.Fatalf("created workspace not listed: %s", rr2.Body.String())
	}
}

func TestTenantProfilePatch(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/tenant/profile",
		bytes.NewBufferString(`{"name":"ACME Staging","region":"cn-north-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("patch %d %s", rr.Code, rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("ACME Staging")) {
		t.Fatalf("name not updated: %s", rr.Body.String())
	}
}
