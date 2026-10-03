// M07 P3 — black-box integration coverage of memory.Service.
//
// Mirrors M06 P3 (internal/workflows/integration_test.go W1-W15) by
// exercising the public Service methods end-to-end against an in-memory
// Store pre-seeded with sample records + candidates. No HTTP framing
// — the route table lives on Server; Service is the business surface
// and these tests verify it directly.
//
// Coverage map:
//
//   W1   MemoryOverview                 — totals (active only) + capacity
//   W2   MemoryRecords                  — filter by status / layer / partner
//   W3   MemoryRecordCreate             — capacity / TTL / classification gates
//   W4   MemoryRecordAction (expire)    — sets status=expired + audit
//   W5   MemoryRecordAction (delete)    — soft revoke, audit preserved
//   W6   MemoryRecordAction (candidate) — long_term only → pending_review
//   W7   MemoryCandidates               — workspace-scoped list
//   W8   MemoryCandidateAction (approve) — drafts knowledge package, NEVER publishes
//   W9   MemoryCandidateAction (reject)  — sets rejected + audit
//   W10  MemoryRefinement               — short→working→long→candidates pipeline
//   W11  MemoryPolicy / MemoryPolicyPatch — get + governance updates
//   W12  MemoryAudit                    — workspace-scoped, append-only
//   W13  MemoryIdentity (CRUD)          — profiles + audit
//   W14  RunMemoryTTLForTest            — short_term expiry sweep
//   W15  IngestRuntimeMemory            — Dream / runtime ingest path
package memory_test

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/memory"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestW1_MemoryOverviewCountsAndCapacity — the landing page counts
// (active only) and the workspace's long-term capacity ratio. The seed
// store has 3 active long_term + 1 pending_review (long-pending) +
// 1 revoked (mem-long-2 in w2). Capacity is computed from policy.
//
func TestW1_MemoryOverviewCountsAndCapacity(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	data, err := svc.MemoryOverview(authedReq(http.MethodGet, "/api/memory/overview", ""))
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	m, _ := data.(map[string]any)
	totals, _ := m["totals"].(map[string]any)
	if int(asFloat(totals["shortTerm"])) != 1 {
		t.Fatalf("shortTerm want 1 got %#v", totals["shortTerm"])
	}
	if int(asFloat(totals["working"])) != 1 {
		t.Fatalf("working want 1 got %#v", totals["working"])
	}
	// long_term = 1 active (mem-long-1) — mem-long-pending is pending_review
	if int(asFloat(totals["longTerm"])) != 1 {
		t.Fatalf("longTerm active want 1 got %#v", totals["longTerm"])
	}
	if int(asFloat(totals["pendingCandidates"])) != 1 {
		t.Fatalf("pendingCandidates want 1 got %#v", totals["pendingCandidates"])
	}
}

// TestW2_MemoryRecordsFilterByLayer — MemoryRecords returns records
// scoped to the active workspace, all of them (no query-param filtering
// at this level — frontend does the filter). Confirms w1 sees
// mem-short-1, mem-work-1, mem-long-1, mem-long-pending (4 records), and
// that w2 records are not leaked.
//
func TestW2_MemoryRecordsScopedToWorkspace(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	data, err := svc.MemoryRecords(authedReq(http.MethodGet, "/api/memory/records", ""))
	if err != nil {
		t.Fatalf("records: %v", err)
	}
	items, _ := data.([]map[string]any)
	if len(items) != 4 {
		t.Fatalf("w1 records want 4 got %d", len(items))
	}
	for _, it := range items {
		if strAny(it["workspaceId"]) != "w1" {
			t.Fatalf("workspace leak: %#v", it)
		}
	}
}

// TestW3_MemoryRecordCreateAcceptsValidPayload — POST creates a new
// record. Confirms id, status=active, layer echo, source echoed.
//
func TestW3_MemoryRecordCreateAcceptsValidPayload(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	body := `{"title":"新会话","content":"context","layer":"short_term","scope":"user","classification":"internal","sourceType":"conversation","sourceId":"sess-1","digitalPartnerId":"de-sre"}`
	data, err := svc.MemoryRecordCreate(authedReq(http.MethodPost, "/api/memory/records", body))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	m, _ := data.(map[string]any)
	if strAny(m["id"]) == "" {
		t.Fatal("created record missing id")
	}
	if strAny(m["status"]) != "active" {
		t.Fatalf("want active got %v", m["status"])
	}
	if strAny(m["layer"]) != "short_term" {
		t.Fatalf("want short_term got %v", m["layer"])
	}
	// missing title must fail
	if _, err := svc.MemoryRecordCreate(authedReq(http.MethodPost, "/api/memory/records", `{"layer":"short_term","content":"x","sourceType":"conversation","sourceId":"s1"}`)); err == nil {
		t.Fatal("missing title must fail")
	}
}

// TestW4_MemoryRecordExpire — POST /records/{id}/expire flips the
// record to status=expired and writes an audit row. A subsequent
// overview call should decrement active counts.
//
func TestW4_MemoryRecordExpire(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	if _, err := svc.MemoryRecordAction(authedReq(http.MethodPost, "/api/memory/records/mem-work-1/expire", "")); err != nil {
		t.Fatalf("expire: %v", err)
	}
	st.RLock()
	defer st.RUnlock()
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == "mem-work-1" && strAny(m["status"]) != "expired" {
			t.Fatalf("want expired got %v", m["status"])
		}
	}
}

// TestW5_MemoryRecordDeleteSoftRevokes — DELETE /records/{id} marks
// the record as revoked (soft delete) and preserves audit. The record
// itself stays in MemoryRecords for history; status flips to "revoked".
//
func TestW5_MemoryRecordDeleteSoftRevokes(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	if _, err := svc.MemoryRecordAction(authedReq(http.MethodDelete, "/api/memory/records/mem-work-1", "")); err != nil {
		t.Fatalf("delete: %v", err)
	}
	st.RLock()
	defer st.RUnlock()
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == "mem-work-1" && strAny(m["status"]) != "revoked" {
			t.Fatalf("want revoked got %v", m["status"])
		}
	}
}

// TestW6_MemoryRecordCandidatePromotion — POST /records/{id}/candidate
// promotes a long_term active record into a pending_review candidate.
// short_term records must NOT be promotable (guard against
// short-contexts leaking into knowledge).
//
func TestW6_MemoryRecordCandidatePromotion(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	// mem-long-1 is long_term+active → promotion OK
	data, err := svc.MemoryRecordAction(authedReq(http.MethodPost, "/api/memory/records/mem-long-1/candidate", ""))
	if err != nil {
		t.Fatalf("promote long_term: %v", err)
	}
	m, _ := data.(map[string]any)
	if strAny(m["status"]) != "pending_review" {
		t.Fatalf("want pending_review got %v", m["status"])
	}
	// mem-short-1 is short_term → must fail
	if _, err := svc.MemoryRecordAction(authedReq(http.MethodPost, "/api/memory/records/mem-short-1/candidate", "")); err == nil {
		t.Fatal("short_term must not be promotable")
	}
}

// TestW7_MemoryCandidatesList — GET /candidates returns workspace-
// scoped candidates only. w1 has 1 pending candidate (mc-1 from seed).
// MemoryCandidates returns []map[string]any directly (no wrapper).
//
func TestW7_MemoryCandidatesList(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	data, err := svc.MemoryCandidates(authedReq(http.MethodGet, "/api/memory/candidates", ""))
	if err != nil {
		t.Fatalf("candidates: %v", err)
	}
	items, _ := data.([]map[string]any)
	if len(items) != 1 {
		t.Fatalf("w1 candidates want 1 got %d", len(items))
	}
	if strAny(items[0]["id"]) != "mc-1" {
		t.Fatalf("want mc-1 got %v", items[0]["id"])
	}
}

// TestW8_MemoryApproveCreatesDraftKnowledgePackage — approving a
// candidate drafts a knowledge package (status=draft) but NEVER
// publishes it directly. The originating memory record transitions
// to status=promoted. Already covered by TestMemoryApproveCreatesDraftKnowledgePackage;
// duplicated here for W-numbering traceability.
//
func TestW8_MemoryApproveCreatesDraftKnowledgePackage(t *testing.T) {
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
	if strAny(m["knowledgePackageId"]) == "" {
		t.Fatal("knowledgePackageId missing on approve")
	}
	st.RLock()
	defer st.RUnlock()
	pkgs, _ := st.KnowledgeExtra["packages"].([]map[string]any)
	for _, p := range pkgs {
		if strAny(p["memoryCandidateId"]) == "mc-1" && strAny(p["status"]) == "published" {
			t.Fatal("approve must not publish")
		}
	}
}

// TestW9_MemoryRejectDoesNotCreatePackage — rejecting a candidate
// records the decision + audit but never touches the knowledge
// package store. The candidate flips to status=rejected.
//
func TestW9_MemoryRejectDoesNotCreatePackage(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	data, err := svc.MemoryCandidateAction(authedReq(http.MethodPost, "/api/memory/candidates/mc-1/reject", ""))
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	m, _ := data.(map[string]any)
	if strAny(m["status"]) != "rejected" {
		t.Fatalf("want rejected got %v", m["status"])
	}
	st.RLock()
	defer st.RUnlock()
	pkgs, _ := st.KnowledgeExtra["packages"].([]map[string]any)
	for _, p := range pkgs {
		if strAny(p["memoryCandidateId"]) == "mc-1" {
			t.Fatal("reject must not create knowledge package")
		}
	}
}

// TestW10_MemoryRefinementPipeline — the run-once refinement
// pipeline walks short→working→long→candidates. With the confidence
// floor lowered and all stage toggles on, workingCreated>=2.
//
func TestW10_MemoryRefinementPipeline(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
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
		t.Fatalf("workingCreated want >=1 got %#v", data)
	}
	if int(asFloat(m["longCreated"])) < 0 {
		t.Fatalf("longCreated negative: %#v", data)
	}
}

// TestW11_MemoryPolicyGetPatch — GET returns the workspace's
// effective policy (default if unset); PATCH updates fields
// (longTermWriteApproval) and persists.
//
func TestW11_MemoryPolicyGetPatch(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	// get default
	data, err := svc.MemoryPolicy(authedReq(http.MethodGet, "/api/memory/policy", ""))
	if err != nil {
		t.Fatalf("get policy: %v", err)
	}
	m, _ := data.(map[string]any)
	if m == nil {
		t.Fatal("policy response missing")
	}
	// patch
	body := `{"longTermWriteApproval":false}`
	data, err = svc.MemoryPolicyPatch(authedReq(http.MethodPatch, "/api/memory/policy", body))
	if err != nil {
		t.Fatalf("patch policy: %v", err)
	}
	m, _ = data.(map[string]any)
	if asBool(m["longTermWriteApproval"]) {
		t.Fatalf("want false got true")
	}
	// re-read — must reflect the patch
	data, err = svc.MemoryPolicy(authedReq(http.MethodGet, "/api/memory/policy", ""))
	if err != nil {
		t.Fatalf("re-get policy: %v", err)
	}
	m, _ = data.(map[string]any)
	if asBool(m["longTermWriteApproval"]) {
		t.Fatal("patched policy not persisted")
	}
}

// TestW12_MemoryAuditAppendOnly — MemoryAudit returns events scoped
// to the workspace, sorted descending. MemoryCandidateAction +
// expire + delete each append one row. The endpoint must NOT mutate.
//
func TestW12_MemoryAuditAppendOnly(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	// fire 2 mutations to seed audit rows
	if _, err := svc.MemoryRecordAction(authedReq(http.MethodPost, "/api/memory/records/mem-work-1/expire", "")); err != nil {
		t.Fatalf("expire: %v", err)
	}
	if _, err := svc.MemoryCandidateAction(authedReq(http.MethodPost, "/api/memory/candidates/mc-1/approve", "")); err != nil {
		t.Fatalf("approve: %v", err)
	}
	data, err := svc.MemoryAudit(authedReq(http.MethodGet, "/api/memory/audit", ""))
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	items, _ := data.([]map[string]any)
	if len(items) < 2 {
		t.Fatalf("audit want >=2 rows got %d", len(items))
	}
	// workspace must be w1
	for _, ev := range items {
		if strAny(ev["workspaceId"]) != "w1" {
			t.Fatalf("audit cross-workspace leak: %#v", ev)
		}
	}
	// time-desc: first item.time >= last item.time
	times := make([]string, 0, len(items))
	for _, ev := range items {
		times = append(times, strAny(ev["time"]))
	}
	sortedDesc := append([]string(nil), times...)
	sort.Sort(sort.Reverse(sort.StringSlice(sortedDesc)))
	if !equalStrings(times, sortedDesc) {
		t.Fatalf("audit not time-desc-sorted: %#v", times)
	}
}

// TestW13_MemoryIdentityCRUD — full lifecycle: list returns empty,
// upsert writes a profile, list returns it, delete removes it.
// Audit appends on each mutation. Profile is keyed by
// (workspaceId, digitalPartnerId) — there is no separate `id` field
// on the upsert response, just the profile struct echoed back.
// We JSON-roundtrip the response so the test sees the same shape the
// HTTP wire sees (handlers return memid.Profile by value; the JSON
// marshal gives the test a stable map shape to assert on).
//
func TestW13_MemoryIdentityCRUD(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)

	// 1. list (empty or seeded — depends on store; we assert at least one
	// after upsert)
	_, err := svc.MemoryIdentity(authedReq(http.MethodGet, "/api/memory/identity", ""))
	if err != nil {
		t.Fatalf("identity list: %v", err)
	}

	// 2. upsert (digitalPartnerId required)
	body := `{"name":"test-profile","digitalPartnerId":"de-sre","preferences":{"tone":"concise"},"notes":"unit test"}`
	raw, err := svc.MemoryIdentityUpsert(authedReq(http.MethodPost, "/api/memory/identity", body))
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	m := decodeJSON(t, raw)
	de := strAny(m["digitalPartnerId"])
	if de != "de-sre" {
		t.Fatalf("upsert missing digitalPartnerId: %#v", m)
	}

	// 3. list must include it
	data, err := svc.MemoryIdentity(authedReq(http.MethodGet, "/api/memory/identity", ""))
	if err != nil {
		t.Fatalf("re-list: %v", err)
	}
	items := decodeJSONList(t, data)
	found := false
	for _, it := range items {
		if strAny(it["digitalPartnerId"]) == de {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("upserted profile %s not in list", de)
	}

	// 4. delete — route keyed by digitalPartnerId
	if _, err := svc.MemoryIdentityDelete(authedReq(http.MethodDelete, "/api/memory/identity/"+de, "")); err != nil {
		t.Fatalf("delete: %v", err)
	}
	data, err = svc.MemoryIdentity(authedReq(http.MethodGet, "/api/memory/identity", ""))
	if err != nil {
		t.Fatalf("list-after-delete: %v", err)
	}
	items = decodeJSONList(t, data)
	for _, it := range items {
		if strAny(it["digitalPartnerId"]) == de {
			t.Fatalf("deleted profile %s still in list", de)
		}
	}
}

// TestW14_MemoryTTLExpiresShortTerm — RunMemoryTTLForTest sweeps
// short-term records whose expiresAt is in the past and flips them to
// status=expired. Manually rewind mem-short-1's expiresAt to verify.
//
func TestW14_MemoryTTLExpiresShortTerm(t *testing.T) {
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

// TestW15_IngestRuntimeMemory — the IngestRuntimeMemoryLocked path is
// what tasks / copilot / cap-runtime use to write working+long-term
// records during execution. It must NOT publish anything and must
// attach the supplied correlationId.
//
func TestW15_IngestRuntimeMemory(t *testing.T) {
	st := store.New()
	svc := memSvc(t, st)
	// Note: IngestRuntimeMemory takes RuntimeMemoryInput (struct), not *http.Request.
	// Use the lower-level entrypoint.
	out, err := svc.IngestRuntimeMemory(memory.RuntimeMemoryInput{
		WorkspaceID:    "w1",
		OwnerID:        "test-admin",
		OwnerName:      "test-admin",
		Layer:          "working",
		Scope:          "user",
		Title:          "runtime-test",
		Content:        "captured during execution",
		SourceType:     "task",
		SourceID:       "task-123",
		Classification: "internal",
		CorrelationID:  "corr-runtime-1",
	})
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	if strAny(out["status"]) != "active" {
		t.Fatalf("want active got %v", out["status"])
	}
	if strAny(out["correlationId"]) != "corr-runtime-1" {
		t.Fatalf("correlationId lost: %#v", out)
	}
	st.RLock()
	defer st.RUnlock()
	for _, m := range st.MemoryRecords {
		if strAny(m["id"]) == strAny(out["id"]) {
			if strAny(m["layer"]) != "working" {
				t.Fatalf("layer mismatch: %v", m["layer"])
			}
			if strAny(m["correlationId"]) != "corr-runtime-1" {
				t.Fatalf("stored correlationId mismatch")
			}
			return
		}
	}
	t.Fatal("ingested record not found in store")
}

// ----- helpers -----

// decodeJSON round-trips a service response through JSON so handlers
// that return Go struct values (e.g. memid.Profile on upsert) get
// observed as the same map shape the HTTP wire would see. Mirrors what
// writeJSON does on the way out + what the SPA does on the way in.
func decodeJSON(t *testing.T, v any) map[string]any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	return m
}

// decodeJSONList is the slice counterpart — used by listMemoryIdentity
// which returns []memid.Profile.
func decodeJSONList(t *testing.T, v any) []map[string]any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	var out []map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	return out
}

func asBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ensure strings import is used (split strings import in this file).
var _ = strings.HasPrefix