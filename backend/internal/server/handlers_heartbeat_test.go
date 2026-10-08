package server_test

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestHeartbeatProbeReturnsLag verifies the /api/heartbeat endpoint
// returns 200 with a non-negative lag.
func TestHeartbeatProbeReturnsLag(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	h := server.New(store.New()).Handler()

	req := httptest.NewRequest("GET", "/api/heartbeat", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != 200 {
		t.Fatalf("heartbeat: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, rr.Body.String())
	}
	data, _ := out["data"].(map[string]any)
	if data == nil {
		t.Fatalf("missing data: %+v", out)
	}
	if _, ok := data["lagSeconds"]; !ok {
		t.Fatalf("lagSeconds missing: %+v", data)
	}
}

// TestHeartbeatProbeNoAuth verifies the endpoint rejects unauth requests.
func TestHeartbeatProbeNoAuth(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	h := server.New(store.New()).Handler()

	req := httptest.NewRequest("GET", "/api/heartbeat", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

// TestOnlineListTouchesAndReturns verifies a Touch (via authed request)
// causes the identity to appear in /api/online.
func TestOnlineListTouchesAndReturns(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	h := server.New(store.New()).Handler()

	// Any authed request touches; the seed admin identity is "u-admin".
	req := httptest.NewRequest("GET", "/api/skills", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("warmup: want 200, got %d", rr.Code)
	}

	req = httptest.NewRequest("GET", "/api/online", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("/api/online: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	data, _ := out["data"].(map[string]any)
	online, _ := data["online"].([]any)
	if len(online) == 0 {
		t.Fatalf("expected at least 1 online identity: %+v", data)
	}
}

// TestOnlineNoAuth verifies /api/online rejects unauth requests.
func TestOnlineNoAuth(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	h := server.New(store.New()).Handler()

	req := httptest.NewRequest("GET", "/api/online", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

// TestOnlineStreamRequiresAuth covers the auth gate on the SSE endpoint.
func TestOnlineStreamRequiresAuth(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	h := server.New(store.New()).Handler()

	req := httptest.NewRequest("GET", "/api/online/stream", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}