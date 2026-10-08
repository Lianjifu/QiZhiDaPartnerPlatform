// Integration tests for the M05 数字伙伴 (Digital Partner) handlers
// (P1–P14 from docs/整合方案/数字伙伴模块整合方案.md §3.3). Mirrors the
// pattern of internal/copilot/integration_test.go and internal/tasks/
// integration_test.go: each test boots a fresh server + in-memory store,
// mints a signed JWT for an admin identity, and round-trips through the
// standard {ok, data, error} envelope used by pkg/response. The test
// file is self-contained — no shared fixtures in test/.
//
// Test surface (mirrors §3.3 of the plan doc):
//
//	P1  GET   /api/partners                                 — list (workspace filter)
//	P2  GET   /api/partners/overview                        — counters (total/active/pending/anomalies/costToday)
//	P3  POST  /api/partners                                 — create draft (id + lifecycleStage=draft)
//	P4  GET   /api/partner-templates                       — template seed
//	P5  GET   /api/partner-template-adoptions              — adoptions
//	P6  GET   /api/partner-capability-catalog              — capability catalog
//	P7  POST  /api/partner-templates/:id/adopt             — adopt seed → new employee
//	P8  PATCH /api/partners/:id                             — shallow merge
//	P9  POST  /api/partners/:id/submit → /approve           — submission + approval chain (FSM)
//	P10 POST  /api/partners/:id/lifecycle                   — state transition (draft → paused)
//	P11 POST  /api/partners/:id/configuration-versions/:vid/approve — config version approve
//	P12 GET   /api/agents                                   — legacy proxy
//	P13 GET   /api/partners (no Authorization)              — 401
//	P14 Cross-module: M02 conversation with digitalPartnerId="de-1" → M05 /api/partners/de-1 → 200
//
// Package note: `package partners_test` (external) to mirror the
// copilot_test / tasks_test / operations_test precedent — internal/
// partners is imported by internal/server, so an internal test would
// close an import cycle. The partners package is reached through the
// fully-bootstrapped server.New(workspace, which routes all 11 paths
// through s.partnerSvc.<Method>(r) per server.go.
package partners_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// envelope mirrors {ok, data, error} used by pkg/response. Kept in sync
// with internal/copilot/integration_test.go and internal/tasks/
// integration_test.go.
type envelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error *envErr         `json:"error,omitempty"`
}

type envErr struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// signToken mints a signed JWT for the given identity.
func signToken(t *testing.T, id auth.Identity) string {
	t.Helper()
	tok, err := auth.Sign(id, time.Hour)
	if err != nil {
		t.Fatalf("auth.Sign: %v", err)
	}
	return tok
}

// newServer boots a fresh server + store for each sub-test.
func newServer(t *testing.T) (*server.Server, *store.Store) {
	t.Helper()
	st := store.New()
	return server.New(st), st
}

// doRequest sends a single HTTP request through the server's Handler and
// returns the recorder. Authorization is set when tok is non-empty;
// Content-Type is set when body is non-nil.
func doRequest(t *testing.T, srv *server.Server, method, path, tok string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	return rr
}

func decodeEnvelope(t *testing.T, rr *httptest.ResponseRecorder) envelope {
	t.Helper()
	var e envelope
	if err := json.Unmarshal(rr.Body.Bytes(), &e); err != nil {
		t.Fatalf("envelope parse: %v body=%s", err, rr.Body.String())
	}
	return e
}

func decodeData(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("data parse: %v raw=%s", err, string(raw))
	}
	return m
}

// adminTok returns a signed admin JWT for workspace "w1". Admin holds
// every permission in the platform model (see auth.RolePermissions) so
// the partner handlers' create/adopt/approve/configuration gates all
// open. The seeded Employees / Templates / ConfigVersions all live in
// w1 so the workspace filter matches.
func adminTok(t *testing.T) string {
	t.Helper()
	return signToken(t, auth.Identity{
		ID: "u1", Name: "平台管理员", Email: "admin@acme.com",
		Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1",
	})
}

// ----------------------------------------------------------------------
// P1 — GET /api/partners: 200 + JSON array
// ----------------------------------------------------------------------

// TestP1_ListEmployees verifies the M05 list endpoint round-trips through
// the standard envelope and returns a JSON array of the workspace's
// digital employees. The store is seeded with de-1 / de-hr / de-2 in
// workspace "w1"; the admin identity owns that workspace so the filter
// lets all three rows through.
func TestP1_ListEmployees(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/partners", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data is not an array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded employees in list, got 0 entries")
	}
}

// ----------------------------------------------------------------------
// P2 — GET /api/partners/overview: 200 + counters
// ----------------------------------------------------------------------

// TestP2_EmployeeOverview verifies the Operations dashboard counters
// round-trip. employeeOverviewAligned returns {total, active, pending,
// anomalies, handoffAttention, costToday} by aggregating the seeded
// employees' lifecycle/runtime. We assert the field set + non-empty
// total + sane active count (seed has at least de-1 and de-hr active).
func TestP2_EmployeeOverview(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/partners/overview", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	total, ok := d["total"].(float64)
	if !ok || total <= 0 {
		t.Fatalf("total=%v, want >0; data=%v", d["total"], d)
	}
	// Active count from seed: de-1 + de-hr are both lifecycle="active" → ≥ 2.
	active, _ := d["active"].(float64)
	if active < 2 {
		t.Fatalf("active=%v, want ≥2 (de-1, de-hr seeded active); data=%v", active, d)
	}
	if _, ok := d["pending"]; !ok {
		t.Fatalf("missing pending counter; data=%v", d)
	}
	if _, ok := d["costToday"]; !ok {
		t.Fatalf("missing costToday; data=%v", d)
	}
}

// ----------------------------------------------------------------------
// P3 — POST /api/partners: 200 + id + lifecycle=draft
// ----------------------------------------------------------------------

// TestP3_CreateEmployee verifies create returns a new employee id and
// initial lifecycle stage is "draft". The plan doc says lifecycleStage
// "pending" — the implementation sets lifecycle="draft" for new entries
// (see handlers_contract.go L97: \"lifecycle\": \"draft\"). We assert
// "draft" instead and document the deviation.
func TestP3_CreateEmployee(t *testing.T) {
	srv, st := newServer(t)
	body := []byte(`{"name":"P3 创建测试","role":"QA","department":"测试部"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/partners", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if id, _ := d["id"].(string); id == "" {
		t.Fatalf("missing id in response; data=%v", d)
	}
	if d["lifecycle"] != "draft" {
		t.Fatalf("lifecycle=%v, want draft (deviation: plan said 'pending'); data=%v", d["lifecycle"], d)
	}
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	// Confirm the new employee landed in the store so subsequent tests
	// that depend on store mutations can rely on the write.
	if got := len(st.Employees); got < 4 {
		t.Fatalf("store.Employees count=%d, want ≥4 (3 seed + 1 create)", got)
	}
}

// ----------------------------------------------------------------------
// P4 — GET /api/partner-templates: 200 + list
// ----------------------------------------------------------------------

// TestP4_ListEmployeeTemplates verifies the partner template seed
// round-trips. store.go seeds one template (tpl-sre) at boot so the
// list endpoint should return ≥1 entry.
func TestP4_ListEmployeeTemplates(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/partner-templates", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data is not an array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded template in list, got 0 entries")
	}
}

// ----------------------------------------------------------------------
// P5 — GET /api/partner-template-adoptions: 200
// ----------------------------------------------------------------------

// TestP5_ListTemplateAdoptions verifies the template adoptions list
// round-trips. store.go seeds adopt-1 (tpl-sre → de-1) at boot.
func TestP5_ListTemplateAdoptions(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/partner-template-adoptions", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data is not an array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded adoption in list, got 0 entries")
	}
}

// ----------------------------------------------------------------------
// P6 — GET /api/partner-capability-catalog: 200
// ----------------------------------------------------------------------

// TestP6_CapabilityCatalog verifies the capability catalog builder
// round-trips. The endpoint aggregates models / knowledge / skills /
// tools / workflows / channels from the seed. We assert the envelope +
// a non-empty data object.
func TestP6_CapabilityCatalog(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/partner-capability-catalog", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if _, ok := d["models"]; !ok {
		t.Fatalf("missing models in catalog; data=%v", d)
	}
	if _, ok := d["knowledge"]; !ok {
		t.Fatalf("missing knowledge in catalog; data=%v", d)
	}
}

// ----------------------------------------------------------------------
// P7 — POST /api/partner-templates/:id/adopt: 200 + adoption persisted
// ----------------------------------------------------------------------

// TestP7_AdoptTemplate verifies adopting a template creates a new
// employee and an adoption row. Before: store.Employees has 3, store.
// TemplateAdoptions has 1. After: +1 employee, +1 adoption.
func TestP7_AdoptTemplate(t *testing.T) {
	srv, st := newServer(t)
	before := len(st.Employees)
	body := []byte(`{"name":"采纳草稿","department":"信息技术部"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/partner-templates/tpl-sre/adopt", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["templateId"] != "tpl-sre" {
		t.Fatalf("templateId=%v, want tpl-sre", d["templateId"])
	}
	if got := len(st.Employees); got != before+1 {
		t.Fatalf("store.Employees count=%d, want %d", got, before+1)
	}
	if got := len(st.TemplateAdoptions); got < 2 {
		t.Fatalf("store.TemplateAdoptions count=%d, want ≥2 (1 seed + 1 adopt)", got)
	}
}

// ----------------------------------------------------------------------
// P8 — PATCH /api/partners/:id: 200 (shallow merge)
// ----------------------------------------------------------------------

// TestP8_PatchEmployee verifies the shallow-merge PATCH endpoint
// persists caller-supplied fields. digitalEmployeeRoute's default branch
// (handlers.go L94 PATCH) merges {name, role, department, description,
// owner, escalationOwner, serviceObject, risk, environment} only — so
// we use "description" as the mutation target.
func TestP8_PatchEmployee(t *testing.T) {
	srv, st := newServer(t)
	body := []byte(`{"description":"P8 描述覆盖测试"}`)
	rr := doRequest(t, srv, http.MethodPatch, "/api/partners/de-1", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["description"] != "P8 描述覆盖测试" {
		t.Fatalf("description=%v, want P8 描述覆盖测试", d["description"])
	}
	// Confirm the in-memory store also reflects the merge (not just
	// the response payload) — readers like listEmployees would see it.
	st.RLock()
	for _, e := range st.Employees {
		if s, _ := e["id"].(string); s == "de-1" {
			if e["description"] != "P8 描述覆盖测试" {
				t.Fatalf("store description=%v, want P8 描述覆盖测试", e["description"])
			}
		}
	}
	st.RUnlock()
}

// ----------------------------------------------------------------------
// P9 — submit → approve approval chain
// ----------------------------------------------------------------------

// TestP9_SubmitApprove walks an employee through submit + approve.
// de-1 (seed) is lifecycle="active" already; we still POST submit + approve
// and assert both return 200. In non-pro mode (QZDA_MODE=dev →
// runtimeenv.Mode Mock → DualApproval=false) submit immediately flips
// lifecycle to "active" and sets release.status="released" — that's the
// path exercised. approve then finds release already set, but the
// requireProductionDualApproval short-circuits when not in production
// so both endpoints return 200 without error.
//
// Deviation note: the plan suggested the chain ends with lifecycle
// changing through states; in non-prod env submit immediately
// activates. Both endpoints return 200 either way — that's the
// documented contract being verified.
func TestP9_SubmitApprove(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// submit
	rr := doRequest(t, srv, http.MethodPost, "/api/partners/de-1/submit", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("submit: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("submit ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["lifecycle"] != "active" {
		t.Fatalf("after submit: lifecycle=%v, want active", d["lifecycle"])
	}
	if r, _ := d["release"].(map[string]any); r == nil || r["status"] != "released" {
		t.Fatalf("after submit: release.status=%v, want released; data=%v", r, d)
	}

	// approve
	rr = doRequest(t, srv, http.MethodPost, "/api/partners/de-1/approve", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("approve: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("approve ok=false: %+v body=%s", e, rr.Body.String())
	}
	d = decodeData(t, e.Data)
	if d["lifecycle"] != "active" {
		t.Fatalf("after approve: lifecycle=%v, want active", d["lifecycle"])
	}
}

// ----------------------------------------------------------------------
// P10 — POST /api/partners/:id/lifecycle: state transition
// ----------------------------------------------------------------------

// TestP10_LifecycleTransition exercises the lifecycle action: pause an
// active employee (admin + reason), then re-activate. Pause requires
// admin role and a non-empty "reason" in the body (handlers.go
// L92-L97); activate requires the employee to be in a releaseable state
// (handlers.go L75-L90) — de-1 is already released, so activate is a
// no-op state assignment.
func TestP10_LifecycleTransition(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// pause: target=paused requires admin + reason
	body := []byte(`{"lifecycle":"paused","reason":"P10 测试暂停"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/partners/de-1/lifecycle", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("pause: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("pause ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["lifecycle"] != "paused" {
		t.Fatalf("after pause: lifecycle=%v, want paused", d["lifecycle"])
	}

	// re-activate
	body = []byte(`{"lifecycle":"active"}`)
	rr = doRequest(t, srv, http.MethodPost, "/api/partners/de-1/lifecycle", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("activate: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("activate ok=false: %+v body=%s", e, rr.Body.String())
	}
	d = decodeData(t, e.Data)
	if d["lifecycle"] != "active" {
		t.Fatalf("after activate: lifecycle=%v, want active", d["lifecycle"])
	}
}

// ----------------------------------------------------------------------
// P11 — POST /api/partners/:id/configuration-versions/:vid/approve
// ----------------------------------------------------------------------

// TestP11_ConfigVersionApprove approves the seeded cfg-1 (partnerId=de-1,
// updatedById=u1 → SOD check skipped because actor is admin). Handler
// returns the version row with status flipped to "current" (already
// "current" in seed; updatedAt is refreshed).
//
// Deviation note: the plan listed "configuration-versions/:id/approve"
// without the partner segment — the real route is
// /api/partners/:id/configuration-versions/:vid/approve (handlers.go
// L74-L100).
func TestP11_ConfigVersionApprove(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)
	rr := doRequest(t, srv, http.MethodPost,
		"/api/partners/de-1/configuration-versions/cfg-1/approve", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["status"] != "current" {
		t.Fatalf("status=%v, want current", d["status"])
	}
	if d["partnerId"] != "de-1" {
		t.Fatalf("partnerId=%v, want de-1", d["partnerId"])
	}
}

// ----------------------------------------------------------------------
// P12 — GET /api/agents (legacyAgentsProxy): 200 + compatibility
// ----------------------------------------------------------------------

// TestP12_LegacyAgentsProxy verifies the deprecated /api/agents route
// still works for back-compat. legacyAgentsProxy rewrites each item's
// "status" from lifecycle (active/released/published → installed) and
// stamps "legacy": true. We assert the array shape + the rewrite.
func TestP12_LegacyAgentsProxy(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/agents", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []map[string]any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array of objects: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded agents in legacy list, got 0")
	}
	// At least one entry should carry legacy=true (legacyAgentsProxy stamps it).
	sawLegacy := false
	for _, a := range arr {
		if a["legacy"] == true {
			sawLegacy = true
			break
		}
	}
	if !sawLegacy {
		t.Fatalf("no entry with legacy=true; arr=%v", arr)
	}
}

// ----------------------------------------------------------------------
// P13 — GET /api/partners (no Authorization): 401
// ----------------------------------------------------------------------

// TestP13_Unauthorized confirms the auth middleware rejects unauthenticated
// requests with 401. Mirrors TestC9_Unauthorized in M02 copilot and
// TestT9_Unauthorized in M03 tasks integration tests.
func TestP13_Unauthorized(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/partners", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if e.OK {
		t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
	}
}

// ----------------------------------------------------------------------
// P14 — Cross-module: M02 copilot + M05 partner via digitalPartnerId
// ----------------------------------------------------------------------

// TestP14_CrossModuleCopilotToPartner verifies the M02→M05 indirection
// via Session.digitalPartnerId: M02 stores the partner id on the
// conversation/session row, and the partner endpoint serves the same id.
//
// Deviation note: the plan described the cross-module entry as
// "M02 copilot 通过 s.partnerSvc.ListEmployees 选员工" (function-value
// dep). The current wiring in internal/copilot/ does NOT carry a
// ListEmployees function value in Deps — M02 reads partner data via the
// HTTP route only. The indirection that DOES exist is via
// Session.digitalPartnerId: M02 stores the id at conversation creation
// time (handlers_c.go L311) and M05's partner endpoint serves that
// employee.
//
// We exercise that indirection: create an M02 conversation with
// digitalPartnerId="de-1", then GET /api/partners/de-1 and assert 200.
// That proves the same employee id is recognizable end-to-end across
// the two module boundaries.
func TestP14_CrossModuleCopilotToPartner(t *testing.T) {
	srv, st := newServer(t)
	tok := adminTok(t)

	// M02: create conversation with digitalPartnerId pointing at a known
	// M05 employee.
	body := []byte(`{"title":"P14 跨模块","digitalPartnerId":"de-1","mode":"react"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/copilot/conversations", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("M02 create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("M02 create ok=false: %+v body=%s", e, rr.Body.String())
	}
	conv := decodeData(t, e.Data)
	if conv["digitalPartnerId"] != "de-1" {
		t.Fatalf("M02 stored digitalPartnerId=%v, want de-1", conv["digitalPartnerId"])
	}

	// Confirm the Session row in M02 also carries the same id — proves
	// the indirection is real, not just a request-body echo.
	st.RLock()
	var sawSession bool
	for _, sess := range st.Sessions {
		if s, _ := sess["digitalPartnerId"].(string); s == "de-1" {
			sawSession = true
			break
		}
	}
	st.RUnlock()
	if !sawSession {
		t.Fatalf("no Session row carries digitalPartnerId=de-1 (M02 indirection broken)")
	}

	// M05: GET the partner that M02 referenced.
	rr = doRequest(t, srv, http.MethodGet, "/api/partners/de-1", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("M05 GET partner: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("M05 GET partner ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["id"] != "de-1" {
		t.Fatalf("M05 partner id=%v, want de-1", d["id"])
	}
}

func TestDeleteUnreleasedPartner(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	rr := doRequest(t, srv, http.MethodPost, "/api/partners", tok, []byte(`{"name":"待删","role":"QA","department":"测试部"}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	created := decodeData(t, decodeEnvelope(t, rr).Data)
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("missing id: %v", created)
	}

	rr = doRequest(t, srv, http.MethodDelete, "/api/partners/"+id, tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	deleted := decodeEnvelope(t, rr)
	if !deleted.OK {
		t.Fatalf("delete ok=false: %+v body=%s", deleted, rr.Body.String())
	}

	rr = doRequest(t, srv, http.MethodGet, "/api/partners/"+id, tok, nil)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("get after delete: want 404, got %d body=%s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, srv, http.MethodDelete, "/api/partners/de-1", tok, nil)
	if rr.Code != http.StatusConflict {
		t.Fatalf("delete released: want 409, got %d body=%s", rr.Code, rr.Body.String())
	}
}