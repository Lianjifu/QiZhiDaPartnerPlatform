package memory_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/memory"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// stubDeps returns a fully-wired memory.Deps pointing at the package's
// own helpers — the tests then exercise the memory.Service surface
// directly (no HTTP framing needed). This mirrors how M06's workflows
// service would be tested in isolation: the service owns the business
// logic, the route table + auth middleware live outside, and tests
// don't need to roundtrip through the HTTP layer to verify behavior.
//
// workspaceID / identityFrom / decodeMap are bound to thin test
// adapters that read the same headers the production server's auth
// middleware sets (X-Workspace-Id + a fixed admin identity). The
// evaluateZeroTrust stub always approves; the knowledge cross-module
// callbacks are appended to the store directly so candidate→package
// promotion is observable without dragging the full knowledge
// package into the test build.
func stubDeps(t *testing.T, st *store.Store) memory.Deps {
	t.Helper()
	identity := &auth.Identity{ID: "test-admin", Name: "test-admin", Role: "admin", WorkspaceID: "w1"}
	return memory.Deps{
		WorkspaceID: func(r *http.Request) string {
			if v := r.Header.Get("X-Workspace-Id"); v != "" {
				return v
			}
			return identity.WorkspaceID
		},
		IdentityFrom: func(ctx context.Context) *auth.Identity { return identity },
		DecodeMap: func(r *http.Request) (map[string]any, error) {
			var body map[string]any
			if r.Body != nil {
				_ = json.NewDecoder(r.Body).Decode(&body)
			}
			if body == nil {
				body = map[string]any{}
			}
			return body, nil
		},
		EvaluateZeroTrust: func(id *auth.Identity, resource, action, classification string, external bool, corr string) (map[string]any, error) {
			return map[string]any{"decision": "allow"}, nil
		},
		AppendKnowledgeAuditLocked: func(ws, actor, action, target, result, reason string) {
			// No Lock here — caller (memoryCandidateActionAligned) holds it.
			ke := st.KnowledgeExtra
			if ke == nil {
				ke = map[string]any{}
				st.KnowledgeExtra = ke
			}
			rows, _ := ke["audit"].([]map[string]any)
			rows = append([]map[string]any{{
				"id": st.ID("ka"), "workspaceId": ws, "actor": actor,
				"action": action, "target": target, "result": result, "reason": reason,
			}}, rows...)
			ke["audit"] = rows
		},
		PersistKnowledgeExtra: func() {},
		KnowledgeSliceMaps:    func(v any) []map[string]any { return knowledgeSliceMapsLocal(v) },
	}
}

// knowledgeSliceMapsLocal mirrors server.knowledgeSliceMaps — kept
// local to avoid an import cycle (server already imports memory).
func knowledgeSliceMapsLocal(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, x := range t {
			if m, ok := x.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

// memSvc builds a memory.Service wired with stub deps + the canonical
// memid.Store. Returns the service + a parallel copy of the Store so
// tests can take RLock to inspect mutations without going through the
// service.
func memSvc(t *testing.T, st *store.Store) *memory.Service {
	t.Helper()
	return memory.NewService(st, stubDeps(t, st), memid.NewStore())
}

// authedReq is the test request shape — mirrors what the production
// auth middleware produces post-resolve (admin identity on w1).
func authedReq(method, path string, payload string) *http.Request {
	var body *strings.Reader
	if payload != "" {
		body = strings.NewReader(payload)
	}
	if body == nil {
		body = strings.NewReader("")
	}
	r := httptest.NewRequest(method, path, body)
	if payload != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("X-Workspace-Id", "w1")
	return r
}

func TestMemoryOverviewCountsActiveOnly(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	data, err := svc.MemoryOverview(authedReq(http.MethodGet, "/api/memory/overview", ""))
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	m, _ := data.(map[string]any)
	totals, _ := m["totals"].(map[string]any)
	if int(asFloat(totals["pendingCandidates"])) != 1 {
		t.Fatalf("pendingCandidates want 1 got %#v", totals["pendingCandidates"])
	}
	if int(asFloat(totals["longTerm"])) != 1 {
		t.Fatalf("longTerm active want 1 (pending_review excluded) got %#v", totals["longTerm"])
	}
}

func TestMemoryApproveCreatesDraftKnowledgePackage(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	data, err := svc.MemoryCandidateAction(authedReq(http.MethodPost, "/api/memory/candidates/mc-1/approve", ""))
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	m, _ := data.(map[string]any)
	if strAny(m["status"]) != "approved" {
		t.Fatalf("status want approved got %v", m["status"])
	}
	pkgID := strAny(m["knowledgePackageId"])
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
	svc := memSvc(t, st)
	_, err := svc.MemoryRecordAction(authedReq(http.MethodPost, "/api/memory/records/mem-short-1/candidate", ""))
	if err == nil {
		t.Fatal("short_term must not create candidate")
	}
}

func TestMemoryDeleteSoftRevokes(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	_, err := svc.MemoryRecordAction(authedReq(http.MethodDelete, "/api/memory/records/mem-work-1", ""))
	if err != nil {
		t.Fatalf("delete: %v", err)
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
	svc := memSvc(t, st)
	// lower confidence gate so seed working/long can promote
	body := `{"minimumConfidence":0.8,"shortToWorkingEnabled":true,"workingToLongEnabled":true,"longToKnowledgeEnabled":true}`
	if _, err := svc.MemoryPolicyPatch(authedReq(http.MethodPatch, "/api/memory/policy", body)); err != nil {
		t.Fatalf("policy: %v", err)
	}

	data, err := svc.MemoryRefinement(authedReq(http.MethodPost, "/api/memory/refinement/run", "{}"))
	if err != nil {
		t.Fatalf("refinement: %v", err)
	}
	m, _ := data.(map[string]any)
	if int(asFloat(m["workingCreated"])) < 1 {
		t.Fatalf("expected workingCreated >= 1 got %#v", data)
	}
}

func TestMemoryPromoteNotDirectPublish(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	st.Lock()
	st.MemoryCands = append(st.MemoryCands, map[string]any{
		"id": "mc-test", "workspaceId": "w1", "memoryId": "mem-long-1",
		"title": "晋升候选-测试", "summary": "摘要", "classification": "internal",
		"sourceCorrelationId": "corr_test", "status": "pending_review",
		"submittedAt": "2026-07-21T09:00:00.000Z",
	})
	st.Unlock()

	if _, err := svc.MemoryCandidateAction(authedReq(http.MethodPost, "/api/memory/candidates/mc-test/promote", "")); err != nil {
		t.Fatalf("promote: %v", err)
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
	svc := memSvc(t, st)
	st.Lock()
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == "mem-short-1" {
			m["expiresAt"] = "2020-01-01T00:00:00Z"
		}
	}
	st.Unlock()
	svc.RunMemoryTTLForTest()
	st.RLock()
	defer st.RUnlock()
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == "mem-short-1" && strAny(m["status"]) != "expired" {
			t.Fatalf("want expired got %v", m["status"])
		}
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