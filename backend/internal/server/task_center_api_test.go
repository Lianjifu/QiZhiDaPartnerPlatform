package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestTaskCenterProductionAPI(t *testing.T) {
	h := server.New(store.New()).Handler()
	as := func(req *http.Request, token string) {
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("x-workspace-id", "w1")
		req.Header.Set("Content-Type", "application/json")
	}

	// Create with dispatch assist semantics (user as submitter)
	rr := httptest.NewRecorder()
	body := `{"title":"跨部协办测试","dispatchKind":"assist","assignee":"李婷","digitalPartnerId":"de-it","digitalPartnerName":"青禾"}`
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(body))
	as(req, "mock-user-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create status=%d body=%s", rr.Code, rr.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if data, ok := created["data"].(map[string]any); ok {
		created = data
	}
	if created["lifecycleStage"] != "human_action" {
		t.Fatalf("assist stage=%v", created["lifecycleStage"])
	}
	gov, _ := created["governance"].(map[string]any)
	if gov == nil || gov["approvalStatus"] != "pending" {
		t.Fatalf("gov=%v", created["governance"])
	}
	tid, _ := created["id"].(string)
	if tid == "" {
		t.Fatal("missing id")
	}
	code, _ := created["code"].(string)
	if !strings.HasPrefix(code, "TSK-") {
		t.Fatalf("code=%v", code)
	}

	// Audit must not be placeholder
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/tasks/"+tid+"/audit", nil)
	as(req, "mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("audit status=%d", rr.Code)
	}
	var auditPayload any
	_ = json.Unmarshal(rr.Body.Bytes(), &auditPayload)
	auditBytes, _ := json.Marshal(auditPayload)
	if strings.Contains(string(auditBytes), "查看审计") {
		t.Fatalf("placeholder audit still present: %s", auditBytes)
	}
	if !strings.Contains(string(auditBytes), "创建任务") {
		t.Fatalf("expected create audit event: %s", auditBytes)
	}

	// Conversation-derived task has links
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/conversations/sess-smoke/tasks", strings.NewReader(`{"title":"会话派生"}`))
	as(req, "mock-user-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("conv task status=%d body=%s", rr.Code, rr.Body.String())
	}
	var convTask map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &convTask)
	if data, ok := convTask["data"].(map[string]any); ok {
		convTask = data
	}
	links, _ := convTask["links"].(map[string]any)
	if links == nil || links["conversationId"] != "sess-smoke" {
		t.Fatalf("links=%v", convTask["links"])
	}

	// Admin rejects assist (SOD: not self-approve)
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/tasks/"+tid+"/approve", bytes.NewBufferString(`{"approved":false,"reason":"暂缓"}`))
	as(req, "mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("reject status=%d body=%s", rr.Code, rr.Body.String())
	}
	var rejected map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &rejected)
	if data, ok := rejected["data"].(map[string]any); ok {
		rejected = data
	}
	gov, _ = rejected["governance"].(map[string]any)
	if gov["approvalStatus"] != "rejected" {
		t.Fatalf("after reject gov=%v", gov)
	}

	// List filter by q
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/tasks?q="+code, nil)
	as(req, "mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("list status=%d", rr.Code)
	}

	// Metrics expose task counters
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	h.ServeHTTP(rr, req)
	metrics := rr.Body.String()
	for _, needle := range []string{"de_task_created_total", "de_task_approve_reject_total", "de_tasks_total"} {
		if !strings.Contains(metrics, needle) {
			t.Fatalf("metrics missing %s", needle)
		}
	}
}
