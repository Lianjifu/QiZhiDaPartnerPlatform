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

func TestMemoryOverviewCountsActiveOnly(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/memory/overview", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("overview %d %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	data, _ := body["data"].(map[string]any)
	if data == nil {
		data = body
	}
	totals, _ := data["totals"].(map[string]any)
	if int(asFloat(totals["pendingCandidates"])) != 1 {
		t.Fatalf("pendingCandidates want 1 got %#v", totals["pendingCandidates"])
	}
	if int(asFloat(totals["longTerm"])) != 1 {
		t.Fatalf("longTerm active want 1 (pending_review excluded) got %#v", totals["longTerm"])
	}
}

func TestMemoryApproveCreatesDraftKnowledgePackage(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/memory/candidates/mc-1/approve", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("approve %d %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	data, _ := body["data"].(map[string]any)
	if data == nil {
		data = body
	}
	if strAny(data["status"]) != "approved" {
		t.Fatalf("status want approved got %v", data["status"])
	}
	pkgID := strAny(data["knowledgePackageId"])
	if pkgID == "" {
		t.Fatal("knowledgePackageId missing")
	}
	st.RLock()
	defer st.RUnlock()
	found := false
	pkgs, _ := st.KnowledgeExtra["packages"].([]map[string]any)
	for _, p := range pkgs {
		if strAny(p["id"]) == pkgID {
			found = true
			if strAny(p["status"]) != "draft" {
				t.Fatalf("package must be draft, got %v", p["status"])
			}
		}
		if strAny(p["status"]) == "published" && strAny(p["memoryCandidateId"]) == "mc-1" {
			t.Fatal("approve must not publish knowledge package")
		}
	}
	if !found {
		t.Fatal("draft knowledge package not created")
	}
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == "mem-long-pending" && strAny(m["status"]) != "promoted" {
			t.Fatalf("memory status want promoted got %v", m["status"])
		}
	}
}

func TestMemoryCandidateRequiresLongTerm(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/memory/records/mem-short-1/candidate", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code == 200 {
		t.Fatal("short_term must not create candidate")
	}
}

func TestMemoryDeleteSoftRevokes(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/memory/records/mem-work-1", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("delete %d %s", rr.Code, rr.Body.String())
	}
	st.RLock()
	defer st.RUnlock()
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == "mem-work-1" {
			if strAny(m["status"]) != "revoked" {
				t.Fatalf("want revoked got %v", m["status"])
			}
			return
		}
	}
	t.Fatal("record should remain (soft delete)")
}

func TestMemoryRefinementCreatesWorkingAndCandidates(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	// lower confidence gate so seed working/long can promote
	body := `{"minimumConfidence":0.8,"shortToWorkingEnabled":true,"workingToLongEnabled":true,"longToKnowledgeEnabled":true}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/memory/policy", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("policy %d %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/memory/refinement/run", strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("refinement %d %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	data, _ := resp["data"].(map[string]any)
	if data == nil {
		data = resp
	}
	if int(asFloat(data["workingCreated"])) < 1 {
		t.Fatalf("expected workingCreated >= 1 got %#v", data)
	}
}

func TestMemoryPromoteNotDirectPublish(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	st.Lock()
	st.MemoryCands = append(st.MemoryCands, map[string]any{
		"id": "mc-test", "workspaceId": "w1", "memoryId": "mem-long-1",
		"title": "晋升候选-测试", "summary": "摘要", "classification": "internal",
		"sourceCorrelationId": "corr_test", "status": "pending_review",
		"submittedAt": "2026-07-21T09:00:00.000Z",
	})
	st.Unlock()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/memory/candidates/mc-test/promote", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("promote %d %s", rr.Code, rr.Body.String())
	}
	st.RLock()
	defer st.RUnlock()
	for _, d := range st.KnowledgeDocs {
		if strAny(d["title"]) == "晋升候选-测试" && strAny(d["status"]) == "published" {
			t.Fatalf("memory promote must not publish knowledge directly")
		}
	}
	pkgs, _ := st.KnowledgeExtra["packages"].([]map[string]any)
	for _, p := range pkgs {
		if strAny(p["name"]) == "晋升候选-测试" && strAny(p["status"]) == "published" {
			t.Fatal("promote must create draft package only")
		}
	}
}

func TestMemoryTTLExpiresShortTerm(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	st.Lock()
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == "mem-short-1" {
			m["expiresAt"] = "2020-01-01T00:00:00Z"
		}
	}
	st.Unlock()
	srv.RunMemoryTTLForTest()
	st.RLock()
	defer st.RUnlock()
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == "mem-short-1" && strAny(m["status"]) != "expired" {
			t.Fatalf("want expired got %v", m["status"])
		}
	}
}

func TestCopilotStreamWritesShortTermMemory(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	before := len(st.MemoryRecords)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		strings.NewReader(`{"content":"请总结 Redis 风险","digitalPartnerId":"de-1","correlationId":"corr_stream_mem"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	st.RLock()
	defer st.RUnlock()
	if len(st.MemoryRecords) <= before {
		t.Fatal("expected short_term memory from copilot stream")
	}
	found := false
	for _, m := range st.MemoryRecords {
		if strAny(m["correlationId"]) == "corr_stream_mem" && strAny(m["layer"]) == "short_term" && strAny(m["sourceType"]) == "conversation" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("short_term conversation memory not found")
	}
}

func TestTaskTransitionWritesWorkingMemory(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	before := len(st.MemoryRecords)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/tasks/task-1/transition", strings.NewReader(`{"stage":"completed"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("transition %d %s", rr.Code, rr.Body.String())
	}
	st.RLock()
	defer st.RUnlock()
	if len(st.MemoryRecords) <= before {
		t.Fatal("expected working memory from task transition")
	}
	found := false
	for _, m := range st.MemoryRecords {
		if strAny(m["sourceId"]) == "task-1" && strAny(m["layer"]) == "working" && strAny(m["sourceType"]) == "task" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("working task memory not found")
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		return 0
	}
}

func strAny(v any) string {
	s, _ := v.(string)
	return s
}
