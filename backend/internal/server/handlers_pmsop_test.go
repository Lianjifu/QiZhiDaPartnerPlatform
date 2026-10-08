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

func pmsopHarness(t *testing.T) http.Handler {
	t.Helper()
	t.Setenv("QZDA_MODE", "dev")
	return server.New(store.New()).Handler()
}

func postJSON(t *testing.T, h http.Handler, path string, body map[string]any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(body)
	req := httptest.NewRequest("POST", path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code >= 400 {
		t.Fatalf("POST %s → %d body=%s", path, rr.Code, rr.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	return rr, out
}

func getJSON(t *testing.T, h http.Handler, path string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code >= 400 {
		t.Fatalf("GET %s → %d body=%s", path, rr.Code, rr.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	return rr, out
}

func TestPMsopTemplates(t *testing.T) {
	h := pmsopHarness(t)
	_, out := getJSON(t, h, "/api/pmsop/templates")
	data, _ := out["data"].(map[string]any)
	templates, _ := data["templates"].([]any)
	if len(templates) < 2 {
		t.Fatalf("want ≥2 templates, got %d", len(templates))
	}
}

func TestPMsopCreatePlan(t *testing.T) {
	h := pmsopHarness(t)
	_, out := postJSON(t, h, "/api/pmsop/plans", map[string]any{"templateId": "agile-sprint"})
	data, _ := out["data"].(map[string]any)
	if data["templateId"] != "agile-sprint" {
		t.Fatalf("templateId: %v", data["templateId"])
	}
	if data["workspaceId"] != "w1" {
		t.Fatalf("workspaceId: %v", data["workspaceId"])
	}
	if data["status"] != "draft" {
		t.Fatalf("status: %v", data["status"])
	}
	if stages, _ := data["stages"].([]any); len(stages) != 3 {
		t.Fatalf("want 3 stages, got %d", len(stages))
	}
}

func TestPMsopCreatePlanUnknownTemplate(t *testing.T) {
	h := pmsopHarness(t)
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]any{"templateId": "nope"})
	req := httptest.NewRequest("POST", "/api/pmsop/plans", &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestPMsopPlanLifecycle(t *testing.T) {
	h := pmsopHarness(t)
	_, out := postJSON(t, h, "/api/pmsop/plans", map[string]any{"templateId": "launch-checklist"})
	data, _ := out["data"].(map[string]any)
	planID, _ := data["id"].(string)
	if planID == "" {
		t.Fatal("missing plan id")
	}

	// Start + complete every task in "pre" stage.
	for _, taskID := range []string{"pr-1", "pr-2", "pr-3"} {
		_, o := postJSON(t, h, "/api/pmsop/plans/"+planID+"/events", map[string]any{
			"type": "task.start", "taskId": taskID,
		})
		_ = o
		_, o = postJSON(t, h, "/api/pmsop/plans/"+planID+"/events", map[string]any{
			"type": "task.complete", "taskId": taskID,
		})
		_ = o
	}

	// Verify pre stage is completed.
	_, detail := getJSON(t, h, "/api/pmsop/plans/"+planID)
	dd, _ := detail["data"].(map[string]any)
	stages, _ := dd["stages"].([]any)
	found := false
	for _, raw := range stages {
		st, _ := raw.(map[string]any)
		if st["id"] == "pre" {
			found = true
			if st["status"] != "completed" {
				t.Fatalf("pre stage status: %v", st["status"])
			}
		}
	}
	if !found {
		t.Fatalf("pre stage missing in %+v", stages)
	}
}

func TestPMsopPlanEventValidation(t *testing.T) {
	h := pmsopHarness(t)
	_, out := postJSON(t, h, "/api/pmsop/plans", map[string]any{"templateId": "agile-sprint"})
	planID, _ := out["data"].(map[string]any)["id"].(string)

	doPost := func(body map[string]any) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(body)
		req := httptest.NewRequest("POST", "/api/pmsop/plans/"+planID+"/events", &buf)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("X-Workspace-Id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr
	}

	if rr := doPost(map[string]any{"type": "task.start", "taskId": "ds-1"}); rr.Code >= 400 {
		t.Fatalf("start failed: %d body=%s", rr.Code, rr.Body.String())
	}
	if rr := doPost(map[string]any{"type": "task.block", "taskId": "ds-1"}); rr.Code >= 400 {
		t.Fatalf("block failed: %d body=%s", rr.Code, rr.Body.String())
	}
	if rr := doPost(map[string]any{"type": "task.start", "taskId": "ds-1"}); rr.Code < 400 {
		t.Fatalf("expected error starting blocked task, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestPMsopPlanNotFound(t *testing.T) {
	h := pmsopHarness(t)
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]any{"type": "task.start", "taskId": "x"})
	req := httptest.NewRequest("POST", "/api/pmsop/plans/missing/events", &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 404 {
		t.Fatalf("want 404, got %d", rr.Code)
	}
}

func TestPMsopNoAuth(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	h := server.New(store.New()).Handler()
	req := httptest.NewRequest("GET", "/api/pmsop/templates", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}