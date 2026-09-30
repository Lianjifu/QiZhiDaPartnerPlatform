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

func TestOpsOverviewLiveAggregate(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/operations/overview", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("x-workspace-id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("ops %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data struct {
			Source string `json:"source"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env.Data.Source != "live-aggregate" {
		t.Fatalf("expected live-aggregate, got %q body=%s", env.Data.Source, rr.Body.String())
	}
}

func TestBackupDualSignAndRestoreDrill(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()

	// Admin may approve own backup request (no second admin required).
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/backups/bk-1/approve", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("admin self-approve allowed %d %s", rr.Code, rr.Body.String())
	}

	// Non-admin requester → admin may approve then restore-drill.
	st.Lock()
	st.Backups = append([]map[string]any{{
		"id": "bk-drill", "workspaceId": "w1", "status": "pending_approval",
		"requestedBy": "值班经理", "requestedAt": "2026-07-22T06:00:00Z", "scope": "full",
	}}, st.Backups...)
	st.Unlock()

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/backups/bk-drill/approve", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("approve %d %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/backups/bk-drill/restore-drill",
		bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("restore-drill %d %s", rr.Code, rr.Body.String())
	}
	var okEnv struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &okEnv)
	if okEnv.Data.Status != "drill_passed" {
		t.Fatalf("status %s body=%s", okEnv.Data.Status, rr.Body.String())
	}
}

func TestMetricsEndpoint(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("metrics %d %s", rr.Code, rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("qzda_core_up")) {
		t.Fatalf("missing qzda_core_up: %s", rr.Body.String())
	}
}
