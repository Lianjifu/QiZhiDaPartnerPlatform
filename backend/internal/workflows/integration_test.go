// Integration tests for the M06 工作流程 (Workflow) handlers (W1–W15
// from docs/整合方案/工作流程模块整合方案.md §3.3). Mirrors the pattern
// of internal/partners/integration_test.go (P1–P14), internal/copilot/
// integration_test.go (C1–C9), and internal/tasks/integration_test.go
// (T1–T9): each test boots a fresh server + in-memory store, mints a
// signed JWT for an admin identity, and round-trips through the standard
// {ok, data, error} envelope used by pkg/response.
//
// Test surface (mirrors §3.3 of the plan doc):
//
//	W1  GET   /api/workflows                             — list (workspace filter)
//	W2  POST  /api/workflows                             — create draft workflow
//	W3  GET   /api/workflows/{id}                        — workflowByID catch-all (GET branch)
//	W4  GET   /api/workflow-templates                    — list incl. builtin packs
//	W5  POST  /api/workflow-templates                    — create personal template
//	W6  DELETE /api/workflow-templates/{id}              — delete personal template
//	W7  GET   /api/workflows/generations                 — generation history
//	W8  POST  /api/workflows/generate                    — submit a generation prompt
//	W9  GET   /api/workflow-skills                       — workflow-skills aligned list
//	W10 POST  /api/workflow-skills/{id}/publish          — promote to published/enabled
//	W11 GET   /api/workflow-runs                         — run history
//	W12 POST  /api/workflows/run                         — engine trial run + persist
//	W13 POST  /api/workflows/{id}/capabilities           — bind capability (skill → workflow)
//	W14 GET   /api/workflows (no Authorization)          — 401
//	W15 Cross-module: M06 run → qzdaworkflow.Engine.Get(runID) returns status
//
// Package note: `package workflows_test` (external) to mirror the
// partners_test / copilot_test / tasks_test / operations_test
// precedent — internal/workflows is imported by internal/server, so an
// internal test would close an import cycle. The workflows package is
// reached through the fully-bootstrapped server.New(workspace, which
// routes all 13 M06 paths through s.workflowSvc.<Method>(r) per server.go.
package workflows_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/qzdaworkflow"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// envelope mirrors {ok, data, error} used by pkg/response. Kept in
// sync with internal/partners/integration_test.go and internal/tasks/
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
func newServer(t *testing.T) (*server.Server, *store.Store, *qzdaworkflow.Engine) {
	t.Helper()
	st := store.New()
	srv := server.New(st)
	return srv, st, srv.Workflows
}

// doRequest sends a single HTTP request through the server's Handler
// and returns the recorder. Authorization is set when tok is non-empty;
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
// the workflow handlers' workflow.write / workflow.execute / skill.write
// gates all open. The seeded Workflows / WorkflowSkills / WorkflowRuns
// all live in w1 so the workspace filter matches.
//
// Permissions are populated explicitly because auth.Sign (the JWT
// helper used by the test) does NOT auto-fill them — only the mock
// login endpoints do. Without Permissions the workflow.execute /
// skill.write / workflow.write gates reject the request with 403.
func adminTok(t *testing.T) string {
	t.Helper()
	return signToken(t, auth.Identity{
		ID: "u1", Name: "平台管理员", Email: "admin@acme.com",
		Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1",
		Permissions: auth.RolePermissions("admin"),
	})
}

// ----------------------------------------------------------------------
// W1 — GET /api/workflows: 200 + JSON array
// ----------------------------------------------------------------------

// TestW1_ListWorkflows verifies the M06 list endpoint round-trips
// through the standard envelope and returns a JSON array of the
// workspace's workflows. The store seeds one workflow (wf1) in
// workspace "w1"; the admin identity owns that workspace so the filter
// lets it through.
func TestW1_ListWorkflows(t *testing.T) {
	srv, _, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/workflows", adminTok(t), nil)
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
		t.Fatalf("expected seeded workflows in list, got 0 entries")
	}
}

// ----------------------------------------------------------------------
// W2 — POST /api/workflows: 200 + id
// ----------------------------------------------------------------------

// TestW2_CreateWorkflow verifies create returns a new workflow id and
// initial status is "draft". Admin has workflow.write so the gate opens.
func TestW2_CreateWorkflow(t *testing.T) {
	srv, st, _ := newServer(t)
	before := len(st.Workflows)
	body := []byte(`{"name":"W2 创建测试","graph":{"nodes":[{"id":"n1","type":"start"}]}}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/workflows", adminTok(t), body)
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
	if d["status"] != "draft" {
		t.Fatalf("status=%v, want draft; data=%v", d["status"], d)
	}
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	if got := len(st.Workflows); got != before+1 {
		t.Fatalf("store.Workflows count=%d, want %d", got, before+1)
	}
}

// ----------------------------------------------------------------------
// W3 — GET /api/workflows/{id}: 200 (workflowByID catch-all)
// ----------------------------------------------------------------------

// TestW3_WorkflowByID exercises the workflowByID catch-all. The route
// table dispatches GET /api/workflows/{id} (no action suffix) into
// handlers.go workflowByID → returns the seed workflow wf1 as-is. We
// also issue a POST /api/workflows/wf1/versions to confirm the action
// switch works (creates a new version row and returns it).
//
// Deviation note: the plan listed GET / POST / PATCH for the same path;
// the real route table only matches PATCH via the prefix in server.go
// L932. The catch-all is shared by all three verbs; this test exercises
// the GET + POST (versions action) branches.
func TestW3_WorkflowByID(t *testing.T) {
	srv, _, _ := newServer(t)
	tok := adminTok(t)

	// GET /api/workflows/wf1 → returns the seeded workflow
	rr := doRequest(t, srv, http.MethodGet, "/api/workflows/wf1", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET wf1: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("GET wf1 ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["id"] != "wf1" {
		t.Fatalf("id=%v, want wf1", d["id"])
	}

	// POST /api/workflows/wf1/versions → returns a new version row
	verBody := []byte(`{"label":"v1.3.0","version":"1.3.0","nodes":[{"id":"n1"}]}`)
	rr = doRequest(t, srv, http.MethodPost, "/api/workflows/wf1/versions", tok, verBody)
	if rr.Code != http.StatusOK {
		t.Fatalf("POST versions: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("POST versions ok=false: %+v body=%s", e, rr.Body.String())
	}
	d = decodeData(t, e.Data)
	if d["workflowId"] != "wf1" {
		t.Fatalf("version workflowId=%v, want wf1", d["workflowId"])
	}
	if d["label"] != "v1.3.0" {
		t.Fatalf("version label=%v, want v1.3.0", d["label"])
	}
}

// ----------------------------------------------------------------------
// W4 — GET /api/workflow-templates: 200 + list incl. builtin packs
// ----------------------------------------------------------------------

// TestW4_ListTemplates verifies the template list endpoint round-trips
// and includes the builtin packs loaded by EnsureBuiltinWorkflowsReady.
// The store seeds WorkflowTpls=[] and the list handler populates it
// from backend/builtin/workflows/manifest.json on each call. We assert
// at least 9 packs (matches TestLoadBuiltinWorkflowPacks expectation).
func TestW4_ListTemplates(t *testing.T) {
	srv, _, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/workflow-templates", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) < 9 {
		t.Fatalf("expected ≥9 builtin packs (TestLoadBuiltinWorkflowPacks baseline), got %d", len(arr))
	}
}

// ----------------------------------------------------------------------
// W5 — POST /api/workflow-templates: 200 + personal template persisted
// ----------------------------------------------------------------------

// TestW5_CreateTemplate verifies create returns a new personal template
// id and persists it in the store. Admin has workflow.write so the
// gate opens. The handler refuses empty canvases so we send a
// non-empty sequence.
func TestW5_CreateTemplate(t *testing.T) {
	srv, st, _ := newServer(t)
	before := len(st.WorkflowTpls)
	body := []byte(`{"name":"W5 个人模板","sequence":["start","action"],"department":"it"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/workflow-templates", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if id, _ := d["id"].(string); id == "" {
		t.Fatalf("missing id; data=%v", d)
	}
	if d["source"] != "personal" {
		t.Fatalf("source=%v, want personal", d["source"])
	}
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	if got := len(st.WorkflowTpls); got != before+1 {
		t.Fatalf("store.WorkflowTpls count=%d, want %d (builtin packs + 1 personal)", got, before+1)
	}
}

// ----------------------------------------------------------------------
// W6 — DELETE /api/workflow-templates/{id}: 200
// ----------------------------------------------------------------------

// TestW6_DeleteTemplate creates a personal template then deletes it via
// the DELETE route. The handler refuses platform templates — we use
// the freshly-created personal template from W5's flow.
//
// Deviation note: the plan's contract said DELETE returns the deleted
// row; the implementation returns {"ok":true,"id":id} (handlers_
func TestW6_DeleteTemplate(t *testing.T) {
	srv, st, _ := newServer(t)
	tok := adminTok(t)

	// Create a personal template first (cannot delete platform packs).
	before := len(st.WorkflowTpls)
	body := []byte(`{"name":"W6 待删模板","sequence":["trigger"]}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/workflow-templates", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("create ok=false: %+v body=%s", e, rr.Body.String())
	}
	created := decodeData(t, e.Data)
	tplID, _ := created["id"].(string)
	if tplID == "" {
		t.Fatalf("missing id in create response; data=%v", created)
	}
	if len(st.WorkflowTpls) != before+1 {
		t.Fatalf("after create: count=%d, want %d", len(st.WorkflowTpls), before+1)
	}

	// Delete it.
	rr = doRequest(t, srv, http.MethodDelete, "/api/workflow-templates/"+tplID, tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("delete ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["ok"] != true {
		t.Fatalf("delete ok=%v, want true; data=%v", d["ok"], d)
	}
	if d["id"] != tplID {
		t.Fatalf("delete id=%v, want %s", d["id"], tplID)
	}
	if len(st.WorkflowTpls) != before {
		t.Fatalf("after delete: count=%d, want %d (back to baseline)", len(st.WorkflowTpls), before)
	}
}

// ----------------------------------------------------------------------
// W7 — GET /api/workflows/generations: 200 + array
// ----------------------------------------------------------------------

// TestW7_ListGenerations verifies the generation history endpoint
// round-trips. The store seeds WorkflowGens=[]; the list returns the
// empty array (envelope.data is [] not null).
func TestW7_ListGenerations(t *testing.T) {
	srv, _, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/workflows/generations", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array: %v raw=%s", err, string(e.Data))
	}
	// arr is empty by seed; just confirm shape.
	_ = arr
}

// ----------------------------------------------------------------------
// W8 — POST /api/workflows/generate: 200 + id
// ----------------------------------------------------------------------

// TestW8_GenerateWorkflow verifies a generation request persists as a
// "ready" record. The handler always returns status="ready" (the
// actual LLM graph build is client-side in the Workflows page).
func TestW8_GenerateWorkflow(t *testing.T) {
	srv, st, _ := newServer(t)
	before := len(st.WorkflowGens)
	body := []byte(`{"prompt":"每天早上汇总销售数据"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/workflows/generate", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if id, _ := d["id"].(string); id == "" {
		t.Fatalf("missing id; data=%v", d)
	}
	if d["status"] != "ready" {
		t.Fatalf("status=%v, want ready", d["status"])
	}
	if d["prompt"] != "每天早上汇总销售数据" {
		t.Fatalf("prompt=%v, want '每天早上汇总销售数据'", d["prompt"])
	}
	if len(st.WorkflowGens) != before+1 {
		t.Fatalf("store.WorkflowGens count=%d, want %d", len(st.WorkflowGens), before+1)
	}
}

// ----------------------------------------------------------------------
// W9 — GET /api/workflow-skills: 200 + aligned list
// ----------------------------------------------------------------------

// TestW9_ListWorkflowSkills verifies the workflow-skills list endpoint
// round-trips and the aligned wrapper back-fills description/
// riskLevel/sourceWorkflowId for the seeded wfs-1.
func TestW9_ListWorkflowSkills(t *testing.T) {
	srv, _, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/workflow-skills", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []map[string]any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array of objects: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded wfs-1 in list, got 0")
	}
	// The aligned wrapper must back-fill description (seed has empty
	// description for wfs-1 in some seed variants; assert it is non-empty).
	if desc, _ := arr[0]["description"].(string); desc == "" {
		t.Fatalf("aligned wrapper did not back-fill description; item=%v", arr[0])
	}
}

// ----------------------------------------------------------------------
// W10 — POST /api/workflow-skills/{id}/publish: 200
// ----------------------------------------------------------------------

// TestW10_PublishWorkflowSkill verifies the publish-as-skill endpoint
// round-trips. The seed wfs-1 has status="published" already, so the
// handler short-circuits at the early-return (handlers_skills.go L84)
// and returns the item unchanged.
//
// Deviation note: the plan listed the contract as
// "promote pending → published + governance gates"; in non-production
// env (QZDA_MODE=dev) the published seed is a no-op return. We
// assert 200 + status="published" either way.
func TestW10_PublishWorkflowSkill(t *testing.T) {
	srv, _, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodPost, "/api/workflow-skills/wfs-1/publish", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["id"] != "wfs-1" {
		t.Fatalf("id=%v, want wfs-1", d["id"])
	}
	// Already-published seed short-circuits with status="published".
	if st, _ := d["status"].(string); st != "published" {
		t.Fatalf("status=%v, want published", d["status"])
	}
}

// ----------------------------------------------------------------------
// W11 — GET /api/workflow-runs: 200 + array
// ----------------------------------------------------------------------

// TestW11_ListWorkflowRuns verifies the run history endpoint
// round-trips. The store seeds one run (run-1) so the list returns ≥1.
func TestW11_ListWorkflowRuns(t *testing.T) {
	srv, _, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/workflow-runs", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded run-1, got 0 entries")
	}
}

// ----------------------------------------------------------------------
// W12 — POST /api/workflows/run: 200, run persisted via engine
// ----------------------------------------------------------------------

// TestW12_RunWorkflow exercises the runWorkflow handler. It calls
// qzdaworkflow.Engine.StartTrial via Deps.StartTrial (bound in
// buildWorkflowSvc to s.Workflows.StartTrial) and persists the run in
// store.WorkflowRuns. Admin has workflow.execute so the gate opens.
// The engine's StartTrialLocal simulates a 5ms trial that finishes
// with status="succeeded" (engine.go L98).
func TestW12_RunWorkflow(t *testing.T) {
	srv, st, _ := newServer(t)
	tok := adminTok(t)
	before := len(st.WorkflowRuns)
	body := []byte(`{"workflowId":"wf1"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/workflows/run", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["workflowId"] != "wf1" {
		t.Fatalf("workflowId=%v, want wf1", d["workflowId"])
	}
	if d["status"] != "succeeded" {
		t.Fatalf("status=%v, want succeeded", d["status"])
	}
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	if d["engine"] != "qzda-workflow" {
		t.Fatalf("engine=%v, want qzda-workflow", d["engine"])
	}
	if got := len(st.WorkflowRuns); got != before+1 {
		t.Fatalf("store.WorkflowRuns count=%d, want %d", got, before+1)
	}
}

// ----------------------------------------------------------------------
// W13 — POST /api/workflows/{id}/capabilities: 200
// ----------------------------------------------------------------------

// TestW13_BindWorkflowCapability binds the seeded skill sk-docx to
// the seeded workflow wf1. The store seeds cap-wf1-docx as an active
// binding for the same pair; bindWorkflowCapability dedupes and
// returns the existing binding (handlers_skills.go L177-L181).
func TestW13_BindWorkflowCapability(t *testing.T) {
	srv, st, _ := newServer(t)
	body := []byte(`{"capabilityId":"sk-docx","capabilityKind":"skill"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/workflows/wf1/capabilities", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["targetType"] != "workflow" {
		t.Fatalf("targetType=%v, want workflow", d["targetType"])
	}
	if d["targetId"] != "wf1" {
		t.Fatalf("targetId=%v, want wf1", d["targetId"])
	}
	if d["capabilityId"] != "sk-docx" {
		t.Fatalf("capabilityId=%v, want sk-docx", d["capabilityId"])
	}
	if d["status"] != "active" {
		t.Fatalf("status=%v, want active", d["status"])
	}
	// Confirm the store still has the binding (dedupe path returns
	// existing row — count stays the same).
	st.RLock()
	bindingCount := 0
	if arr, ok := st.SkillExtra["bindings"].([]map[string]any); ok {
		for _, b := range arr {
			if b["targetId"] == "wf1" && b["capabilityId"] == "sk-docx" {
				bindingCount++
			}
		}
	}
	st.RUnlock()
	if bindingCount == 0 {
		t.Fatalf("no active binding for wf1+sk-docx; binding dedupe path broken")
	}
}

// ----------------------------------------------------------------------
// W14 — GET /api/workflows (no Authorization): 401
// ----------------------------------------------------------------------

// TestW14_Unauthorized confirms the auth middleware rejects
// unauthenticated requests with 401. Mirrors TestP13_Unauthorized in
// M05 partners, TestC9_Unauthorized in M02 copilot, and TestT9_Unauthorized
// in M03 tasks integration tests.
func TestW14_Unauthorized(t *testing.T) {
	srv, _, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/workflows", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if e.OK {
		t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
	}
}

// ----------------------------------------------------------------------
// W15 — Cross-module: M06 run → qzdaworkflow.Engine.Get(runID) status
// ----------------------------------------------------------------------

// TestW15_CrossModuleRunToEngineGet verifies the M06→qzdaworkflow
// indirection: POST /api/workflows/run calls Engine.StartTrial via
// Deps.StartTrial and persists the returned *Run. We then read the run
// back via Engine.Get(runID) (the qzdaworkflow.Engine is exported on
// Server.Workflows) and confirm the status matches what the API
// returned.
//
// This proves the same Run object round-trips through the engine + the
// HTTP handler without a copy mismatch — i.e. Engine.Get is the
// authoritative source for the run state.
func TestW15_CrossModuleRunToEngineGet(t *testing.T) {
	srv, _, eng := newServer(t)
	tok := adminTok(t)
	body := []byte(`{"workflowId":"wf1"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/workflows/run", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("run: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("run ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	runID, _ := d["id"].(string)
	if runID == "" {
		t.Fatalf("missing run id; data=%v", d)
	}

	// Read back from the engine — proves the engine itself, not the
	// HTTP response, is the source of truth.
	got, err := eng.Get(runID)
	if err != nil {
		t.Fatalf("engine.Get(%s): %v", runID, err)
	}
	if got.ID != runID {
		t.Fatalf("engine.Run.ID=%s, want %s", got.ID, runID)
	}
	if got.WorkflowID != "wf1" {
		t.Fatalf("engine.Run.WorkflowID=%s, want wf1", got.WorkflowID)
	}
	if got.Status != "succeeded" {
		t.Fatalf("engine.Run.Status=%s, want succeeded", got.Status)
	}
	if got.EngineName != "qzda-workflow" {
		t.Fatalf("engine.Run.EngineName=%s, want qzda-workflow", got.EngineName)
	}
}

func TestOrchestrationSessionGenerateAndApply(t *testing.T) {
	srv, _, _ := newServer(t)
	tok := adminTok(t)
	create := doRequest(t, srv, http.MethodPost, "/api/workflows/orchestration-sessions", tok, []byte(`{"goal":"由数字伙伴研判处置路径，经双重审批后执行受控恢复","constraints":{"riskLevel":"L2","requireApproval":true,"requireRollback":true}}`))
	if create.Code != http.StatusOK {
		t.Fatalf("create want 200, got %d body=%s", create.Code, create.Body.String())
	}
	created := decodeData(t, decodeEnvelope(t, create).Data)
	sid, _ := created["id"].(string)
	if sid == "" {
		t.Fatalf("missing session id: %v", created)
	}
	if created["status"] != "drafting" {
		t.Fatalf("status=%v want drafting", created["status"])
	}
	gen := doRequest(t, srv, http.MethodPost, "/api/workflows/orchestration-sessions/"+sid+"/generate", tok, []byte(`{"skipClarification":true}`))
	if gen.Code != http.StatusOK {
		t.Fatalf("generate want 200, got %d body=%s", gen.Code, gen.Body.String())
	}
	generated := decodeData(t, decodeEnvelope(t, gen).Data)
	session := generated["session"].(map[string]any)
	if session["status"] != "ready" {
		t.Fatalf("generate status=%v want ready", session["status"])
	}
	cand := generated["candidate"].(map[string]any)
	cid, _ := cand["id"].(string)
	apply := doRequest(t, srv, http.MethodPost, "/api/workflows/orchestration-sessions/"+sid+"/apply", tok, []byte(`{"candidateId":"`+cid+`"}`))
	if apply.Code != http.StatusOK {
		t.Fatalf("apply want 200, got %d body=%s", apply.Code, apply.Body.String())
	}
	applied := decodeData(t, decodeEnvelope(t, apply).Data)
	if applied["status"] != "applied" {
		t.Fatalf("apply status=%v want applied", applied["status"])
	}
	if _, ok := applied["revisionId"].(string); !ok || applied["revisionId"] == "" {
		t.Fatalf("missing revisionId: %v", applied)
	}
}

