package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/modelprov/trace"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func setupSelfImprovingHarness(t *testing.T) http.Handler {
	t.Helper()
	t.Setenv("QZDA_MODE", "dev")
	t.Setenv("QZDA_KNOWLEDGE_BLOB_DIR", t.TempDir())
	return server.New(store.New()).Handler()
}

func seedRecurringErrors(s *server.Server, ws, provider, class string, n int) {
	now := time.Now().UTC()
	for i := 0; i < n; i++ {
		s.TraceRecorder.Append(trace.Event{
			TraceID: "err", WorkspaceID: ws, TurnID: "t1",
			ModelID: "m1", ProviderID: provider, Level: "P1", Source: "provider",
			Status: trace.StatusError, ErrorClass: class,
			StartedAt: now, EndedAt: now, LatencyMs: 1200,
		})
	}
}

func seedOK(s *server.Server, ws string, n int) {
	now := time.Now().UTC()
	for i := 0; i < n; i++ {
		s.TraceRecorder.Append(trace.Event{
			TraceID: "ok", WorkspaceID: ws, TurnID: "t1",
			ModelID: "m1", ProviderID: "p1", Level: "P1", Source: "provider",
			Status: trace.StatusOK, StartedAt: now, EndedAt: now, LatencyMs: 800,
		})
	}
}

func postSOP(t *testing.T, h http.Handler, body map[string]any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(body)
	req := httptest.NewRequest("POST", "/api/selfimproving/sop", &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v body=%s", err, rr.Body.String())
	}
	data, _ := out["data"].(map[string]any)
	if data == nil {
		t.Fatalf("missing data envelope: %+v", out)
	}
	return rr, data
}

func TestSelfImprovingCreate(t *testing.T) {
	h := setupSelfImprovingHarness(t)
	// Inject traces by reaching into the running server.
	srv := server.New(store.New())
	seedOK(srv, "w1", 4)
	seedRecurringErrors(srv, "w1", "p-err", "timeout", 3)
	h = srv.Handler()

	_, data := postSOP(t, h, map[string]any{"window": "all"})
	if data["verdict"] != "created" {
		t.Fatalf("want created, got %v reason=%v", data["verdict"], data["reason"])
	}
	if data["reason"] != "recurring_errors" {
		t.Fatalf("reason: %v", data["reason"])
	}
	if title, _ := data["title"].(string); !strings.Contains(title, "w1") {
		t.Fatalf("title missing workspace: %q", title)
	}
	if md, _ := data["markdown"].(string); !strings.Contains(md, "p-err") {
		t.Fatalf("markdown missing provider: %q", md)
	}
}

func TestSelfImprovingRejectedNoAnomaly(t *testing.T) {
	srv := server.New(store.New())
	seedOK(srv, "w1", 5)
	h := srv.Handler()
	_, data := postSOP(t, h, map[string]any{"window": "all"})
	if data["verdict"] != "rejected" {
		t.Fatalf("want rejected, got %v reason=%v", data["verdict"], data["reason"])
	}
	if data["reason"] != "no_anomaly_detected" {
		t.Fatalf("reason: %v", data["reason"])
	}
}

func TestSelfImprovingSampleTooSmall(t *testing.T) {
	h := setupSelfImprovingHarness(t)
	_, data := postSOP(t, h, map[string]any{"window": "all"})
	if data["verdict"] != "rejected" {
		t.Fatalf("want rejected, got %v reason=%v", data["verdict"], data["reason"])
	}
	if data["reason"] != "sample_too_small" {
		t.Fatalf("reason: %v", data["reason"])
	}
	if _, hasMarkdown := data["markdown"]; hasMarkdown {
		t.Fatalf("no markdown expected when sample too small: %+v", data)
	}
}

func TestSelfImprovingWorkspaceMismatch(t *testing.T) {
	h := setupSelfImprovingHarness(t)
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]any{
		"workspaceId": "ws-other", "window": "all",
	})
	req := httptest.NewRequest("POST", "/api/selfimproving/sop", &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("want 403, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestSelfImprovingWriteCreatesKnowledgeDoc(t *testing.T) {
	srv := server.New(store.New())
	seedOK(srv, "w1", 4)
	seedRecurringErrors(srv, "w1", "p-err", "timeout", 3)
	h := srv.Handler()
	_, data := postSOP(t, h, map[string]any{"window": "all", "write": true})
	if data["verdict"] != "created" {
		t.Fatalf("want created, got %v", data["verdict"])
	}
	if data["write"] != "ok" {
		t.Fatalf("write: %v (err=%v)", data["write"], data["writeError"])
	}
	docID, _ := data["docId"].(string)
	if docID == "" {
		t.Fatalf("missing docId: %+v", data)
	}
	pkgID, _ := data["packageId"].(string)
	if pkgID == "" {
		t.Fatalf("missing packageId: %+v", data)
	}
}

func TestSelfImprovingWriteRejectedNotPersisted(t *testing.T) {
	srv := server.New(store.New())
	seedOK(srv, "w1", 5)
	h := srv.Handler()
	_, data := postSOP(t, h, map[string]any{"window": "all", "write": true})
	if data["verdict"] != "rejected" {
		t.Fatalf("want rejected, got %v", data["verdict"])
	}
	if _, hasWrite := data["write"]; hasWrite {
		t.Fatalf("rejected SOP should not be written: %+v", data)
	}
}

func TestSelfImprovingNoAuth(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	h := server.New(store.New()).Handler()
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]any{})
	req := httptest.NewRequest("POST", "/api/selfimproving/sop", &buf)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}