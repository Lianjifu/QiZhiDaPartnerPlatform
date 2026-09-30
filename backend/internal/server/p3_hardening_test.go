package server_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestEvaluateFailsIncompleteEmployee(t *testing.T) {
	st := store.New()
	// Strip capabilities to force failed evaluation.
	for _, e := range st.Employees {
		if strID(e["id"]) == "de-2" {
			e["capabilities"] = map[string]any{"model": "", "skills": []any{}, "tools": []any{}, "workflows": []any{}}
			e["responsibilities"] = []any{"待配置岗位职责"}
		}
	}
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-2/evaluate", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("evaluate %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"status":"failed"`) {
		t.Fatalf("expected failed evaluation: %s", rr.Body.String())
	}
}

func TestReleaseGatesProfileIncomplete(t *testing.T) {
	st := store.New()
	for _, e := range st.Employees {
		if strID(e["id"]) == "de-2" {
			e["lifecycle"] = "testing"
			e["release"] = map[string]any{"status": "not_released"}
			e["owner"] = ""
			e["escalationOwner"] = "待指定"
		}
	}
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-2/release", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("expected 400 got %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_DIGITAL_PARTNER_PROFILE_INCOMPLETE") {
		t.Fatalf("body %s", rr.Body.String())
	}
}

func TestMetricsExposeCopilotAndAuditCounters(t *testing.T) {
	h := server.New(store.New()).Handler()
	server.IncCopilotStream(false)
	server.IncAuditWriteFailure()
	server.IncPolicyDeny()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	h.ServeHTTP(rr, req)
	body := rr.Body.String()
	for _, needle := range []string{
		"qzda_copilot_stream_total",
		"qzda_copilot_stream_errors_total",
		"qzda_copilot_authorizations_pending",
		"qzda_audit_write_failures_total",
		"qzda_policy_denies_total",
	} {
		if !strings.Contains(body, needle) {
			t.Fatalf("missing metric %s in %s", needle, body)
		}
	}
}

func strID(v any) string {
	s, _ := v.(string)
	return s
}
