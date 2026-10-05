// Integration tests for the M03 任务中心 (Task Center) handlers (T1–T9
// from docs/整合方案/任务中心模块整合方案.md §3.3). Mirrors the pattern
// of internal/copilot/integration_test.go + internal/operations/
// integration_test.go: each test boots a fresh server + in-memory store,
// mints a signed JWT for an admin identity (with full Permission set
// populated — the create/takeover handlers gate on `task.write`, which
// only land on the Identity via RolePermissions at login time), and
// round-trips through the standard {ok, data, error} envelope used by
// pkg/response.
//
// Test surface (§3.3):
//
//	T1 GET   /api/tasks                                  — list (workspace filter)
//	T2 POST  /api/tasks                                  — create returns id+stage=pending
//	T3 PATCH /api/tasks/{id}/transition                  — advance pending→running→completed
//	T4 PATCH /api/tasks/{id}/transition  stage=running   — Kanban move (FSM-edge valid)
//	T5 POST  /api/tasks/{id}/takeover                    — lifecycle → human_action
//	T6 — audit count climbs +1 per stage change (read Store.Tasks)
//	T7 POST  /api/conversations/{id}/tasks               — M02 → M03 cross-module entry
//	T8 PATCH /api/tasks/{id}/transition  running→archived — invalid FSM edge → 400
//	T9 GET   /api/tasks  (no Authorization)              — 401
//
// Package note: `package tasks_test` (external) to mirror the
// copilot_test / operations_test precedent — internal/tasks is imported
// by internal/server, so an internal test would close an import cycle.
package tasks_test

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
// with internal/operations/integration_test.go and internal/copilot/
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

// newServer boots a fresh server + store for each sub-test so state
// mutation in one test cannot leak into another (Tasks / Audits are
// mutated by every handler in this file).
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

// adminTok returns a signed admin JWT for workspace "w1". Permissions
// must be populated explicitly — the create/takeover handlers gate on
// `task.write` / `task.approve`, and a JWT signed with empty
// Permissions carries that empty list through Parse (only the
// `mock-*-token` dev tokens auto-populate from RolePermissions). This
// mirrors the live-login code path in auth.http.go L121.
func adminTok(t *testing.T) string {
	t.Helper()
	return signToken(t, auth.Identity{
		ID: "u1", Name: "平台管理员", Email: "admin@acme.com",
		Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1",
		Permissions: auth.RolePermissions("admin"),
	})
}

// taskAuditCount returns the number of audit events on a task by
// reading Store.Tasks directly. Used by T6 (audit writes per stage
// change). RLock covers the snapshot read.
func taskAuditCount(st *store.Store, id string) int {
	st.RLock()
	defer st.RUnlock()
	for _, t := range st.Tasks {
		if s, _ := t["id"].(string); s != id {
			continue
		}
		evs, _ := t["auditEvents"].([]map[string]any)
		return len(evs)
	}
	return 0
}

// ----------------------------------------------------------------------
// T1 — GET /api/tasks: 200 + JSON array
// ----------------------------------------------------------------------

// TestT1_ListTasks verifies the M03 list endpoint round-trips through
// the standard envelope and returns a JSON array. Seeds one task into
// the store before the call so the workspace filter has something to
// pass through (the seeded `task-write` permissions + w1 workspace
// match the admin identity).
func TestT1_ListTasks(t *testing.T) {
	srv, st := newServer(t)
	now := time.Now().UTC().Format(time.RFC3339)
	st.Lock()
	st.Tasks = []map[string]any{
		{
			"id": "t-list-1", "workspaceId": "w1", "code": "TSK-LIST-1",
			"title": "列表测试", "priority": "P2",
			"lifecycleStage": "pending", "status": "pending",
			"ownerId": "u1", "ownerName": "平台管理员",
			"createdBy": "u1", "assignee": "平台管理员",
			"auditEvents": []map[string]any{},
			"version":     0,
			"sla":         map[string]any{"remainingMin": 120, "risk": "none"},
			"execution":   map[string]any{"retryCount": 0, "paused": false},
			"governance":  map[string]any{"approvalRequired": false, "approvalStatus": "not_required"},
			"progress":    map[string]any{"done": 0, "total": 1},
			"createdAt":   now, "updatedAt": now,
		},
	}
	st.Unlock()

	// Drop the limit query param so the handler returns the flat array
	// path (handlers_b.go listTasks returns []map[string]any directly
	// when paged=false; with limit>0 it wraps in {items,total,...}).
	rr := doRequest(t, srv, http.MethodGet, "/api/tasks", adminTok(t), nil)
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
		t.Fatalf("expected seeded task in list, got 0 entries")
	}
}

// ----------------------------------------------------------------------
// T2 — POST /api/tasks: 200 + id + stage=pending
// ----------------------------------------------------------------------

// TestT2_CreateTask verifies create returns the new task id and the
// initial lifecycleStage is "pending". Body carries only the required
// fields (title + owner + step) — extra dispatchKind/assignee/etc. stay
// empty to avoid the cross-department协办 (assist) code path that
// forces stage=human_action up front.
func TestT2_CreateTask(t *testing.T) {
	srv, _ := newServer(t)
	body := []byte(`{"title":"新建任务","owner":"平台管理员","step":"待开始"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/tasks", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	data := decodeData(t, e.Data)
	if id, _ := data["id"].(string); id == "" {
		t.Fatalf("missing id in response; data=%v", data)
	}
	if data["lifecycleStage"] != "pending" {
		t.Fatalf("lifecycleStage=%v, want pending", data["lifecycleStage"])
	}
}

// ----------------------------------------------------------------------
// T3 — Lifecycle FSM: pending → running → completed
// ----------------------------------------------------------------------

// TestT3_LifecycleFSM creates a task, then walks it through the
// canonical 3-stage happy path (pending → running → completed) and
// asserts each transition's response shape. Every transition is a
// PATCH /api/tasks/{id}/transition with body.stage. The handler's
// switch dispatches "transition" to ApplyLifecycleTransition, which
// validates the FSM edge + appends an audit event on success.
func TestT3_LifecycleFSM(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// Create
	body := []byte(`{"title":"FSM流转","owner":"平台管理员","step":"待开始"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/tasks", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	created := decodeData(t, decodeEnvelope(t, rr).Data)
	tid, _ := created["id"].(string)
	if tid == "" {
		t.Fatalf("missing id from create; data=%v", created)
	}

	// pending → running
	rr = doRequest(t, srv, http.MethodPatch, "/api/tasks/"+tid+"/transition", tok,
		[]byte(`{"stage":"running"}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("pending→running: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	d := decodeData(t, decodeEnvelope(t, rr).Data)
	if d["lifecycleStage"] != "running" {
		t.Fatalf("after running: stage=%v", d["lifecycleStage"])
	}
	if d["status"] != "in_progress" {
		t.Fatalf("after running: status=%v, want in_progress", d["status"])
	}

	// running → completed
	rr = doRequest(t, srv, http.MethodPatch, "/api/tasks/"+tid+"/transition", tok,
		[]byte(`{"stage":"completed"}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("running→completed: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	d = decodeData(t, decodeEnvelope(t, rr).Data)
	if d["lifecycleStage"] != "completed" {
		t.Fatalf("after completed: stage=%v", d["lifecycleStage"])
	}
	if d["status"] != "completed" {
		t.Fatalf("after completed: status=%v", d["status"])
	}
}

// ----------------------------------------------------------------------
// T4 — Kanban move (POST /api/tasks/{id}/transition stage=running)
// ----------------------------------------------------------------------

// TestT4_KanbanMove exercises the same transition endpoint the frontend
// Kanban board uses for drag-to-stage moves (see features/tasks/components/
// TasksPage.tsx moveTask → /api/tasks/{id}/transition with stage). The
// plan doc labelled the action "move" with `to_stage=running`; the
// handler actually accepts `stage` in body and dispatches via the
// "transition" action path. We assert the FSM edge is honoured (no 4xx)
// and the row's lifecycleStage flips to running.
//
// Deviation note: the plan says POST /api/tasks/{id}/move with
// to_stage=running; the implementation accepts /transition + stage.
// Tested against the real route — see handler taskRoute L121-136 in
// internal/server/handlers_contract.go.
func TestT4_KanbanMove(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	body := []byte(`{"title":"看板移动","owner":"平台管理员","step":"待开始"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/tasks", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	created := decodeData(t, decodeEnvelope(t, rr).Data)
	tid, _ := created["id"].(string)

	// Kanban move pending → running.
	rr = doRequest(t, srv, http.MethodPatch, "/api/tasks/"+tid+"/transition", tok,
		[]byte(`{"stage":"running"}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("move: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	d := decodeData(t, decodeEnvelope(t, rr).Data)
	if d["lifecycleStage"] != "running" {
		t.Fatalf("after move: stage=%v, want running", d["lifecycleStage"])
	}
}

// ----------------------------------------------------------------------
// T5 — Takeover (POST /api/tasks/{id}/takeover)
// ----------------------------------------------------------------------

// TestT5_Takeover verifies that the takeover action moves the task
// into StageHumanAction (per tasks.ApplyTaskTakeover) and the response
// reflects the new lifecycle stage. Takeover is admin-gated in the
// handler — the admin token is the right actor.
func TestT5_Takeover(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	body := []byte(`{"title":"人工接管测试","owner":"平台管理员","step":"待开始"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/tasks", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	created := decodeData(t, decodeEnvelope(t, rr).Data)
	tid, _ := created["id"].(string)

	rr = doRequest(t, srv, http.MethodPost, "/api/tasks/"+tid+"/takeover", tok,
		[]byte(`{"reason":"测试接管"}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("takeover: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	d := decodeData(t, decodeEnvelope(t, rr).Data)
	if d["lifecycleStage"] != "human_action" {
		t.Fatalf("after takeover: stage=%v, want human_action", d["lifecycleStage"])
	}
	if d["status"] != "review" {
		t.Fatalf("after takeover: status=%v, want review", d["status"])
	}
}

// ----------------------------------------------------------------------
// T6 — Audit: +1 audit log per stage change
// ----------------------------------------------------------------------

// TestT6_AuditPerStageChange counts the audit events on the task after
// every stage transition. CreateTaskAligned writes 1 event ("创建任务");
// each /transition call writes 1 more (ApplyLifecycleTransition →
// AppendTaskAuditLocked). We assert the count climbs by exactly 1 per
// transition (3 events total after create + 2 transitions).
//
// Deviation note: the plan asked for "any stage change writes +1 audit
// log"; we count audit events via Store.Tasks (in-process) because the
// GET /api/tasks/{id}/audit endpoint returns the same list and
// requires a second round-trip. Reading the task directly avoids the
// double-roundtrip and matches the operations integration test pattern
// for H6 (which reads Store.Audits for the same reason).
func TestT6_AuditPerStageChange(t *testing.T) {
	srv, st := newServer(t)
	tok := adminTok(t)

	body := []byte(`{"title":"审计计数测试","owner":"平台管理员","step":"待开始"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/tasks", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	created := decodeData(t, decodeEnvelope(t, rr).Data)
	tid, _ := created["id"].(string)

	// After create: 1 audit event ("创建任务").
	if n := taskAuditCount(st, tid); n != 1 {
		t.Fatalf("after create: audit count=%d, want 1", n)
	}

	// pending → running: +1 audit event.
	if rr := doRequest(t, srv, http.MethodPatch, "/api/tasks/"+tid+"/transition", tok,
		[]byte(`{"stage":"running"}`)); rr.Code != http.StatusOK {
		t.Fatalf("transition running: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	if n := taskAuditCount(st, tid); n != 2 {
		t.Fatalf("after running: audit count=%d, want 2", n)
	}

	// running → completed: +1 audit event.
	if rr := doRequest(t, srv, http.MethodPatch, "/api/tasks/"+tid+"/transition", tok,
		[]byte(`{"stage":"completed"}`)); rr.Code != http.StatusOK {
		t.Fatalf("transition completed: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	if n := taskAuditCount(st, tid); n != 3 {
		t.Fatalf("after completed: audit count=%d, want 3", n)
	}
}

// ----------------------------------------------------------------------
// T7 — Cross-module: POST /api/conversations/{id}/tasks
// ----------------------------------------------------------------------

// TestT7_ConversationCreateTask verifies the M02 → M03 entry point.
// The handler stamps `source=conversation` on the body before delegating
// to BuildControlledTask, so the resulting task's source field carries
// that tag — and the conversationId lands in links.conversationId for
// the front-end to walk back. We don't require the conversation row
// itself to exist; the handler just stamps the id onto the new task.
func TestT7_ConversationCreateTask(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)
	const cid = "conv-cross-1"
	body := []byte(`{"title":"协作派生任务","step":"待专家确认"}`)

	rr := doRequest(t, srv, http.MethodPost, "/api/conversations/"+cid+"/tasks", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	tid, _ := d["id"].(string)
	if tid == "" {
		t.Fatalf("missing task id in response; data=%v", d)
	}
	if d["source"] != "conversation" {
		t.Fatalf("source=%v, want conversation", d["source"])
	}
}

// ----------------------------------------------------------------------
// T8 — Invalid FSM transition (running → archived)
// ----------------------------------------------------------------------

// TestT8_InvalidTransition drives the task to StageRunning, then tries
// to transition straight to StageArchived. The LifecycleEdges table
// does NOT include that edge (running → {human_action, completed,
// pending, risk} only), so AssertLifecycleTransition returns
// apperr.BadReq which the handler surfaces as HTTP 400.
//
// Deviation note: the plan suggested "409 or 400"; the actual handler
// uses BadReq (StatusBadRequest → 400), so we assert 400. The error
// envelope's code is E_BAD_REQUEST.
func TestT8_InvalidTransition(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	body := []byte(`{"title":"非法流转测试","owner":"平台管理员","step":"待开始"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/tasks", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	tid, _ := decodeData(t, decodeEnvelope(t, rr).Data)["id"].(string)

	// Move to running first.
	if rr := doRequest(t, srv, http.MethodPatch, "/api/tasks/"+tid+"/transition", tok,
		[]byte(`{"stage":"running"}`)); rr.Code != http.StatusOK {
		t.Fatalf("transition running: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}

	// running → archived is not a legal FSM edge; expect 400.
	rr = doRequest(t, srv, http.MethodPatch, "/api/tasks/"+tid+"/transition", tok,
		[]byte(`{"stage":"archived"}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("running→archived: want 400, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if e.OK {
		t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
	}
	if e.Error == nil || e.Error.Code == "" {
		t.Fatalf("want error.code set, got %+v body=%s", e, rr.Body.String())
	}
}

// ----------------------------------------------------------------------
// T9 — GET /api/tasks without Authorization: 401
// ----------------------------------------------------------------------

// TestT9_Unauthorized confirms the auth middleware rejects unauthenticated
// requests with 401. Mirrors TestC9_Unauthorized in the M02 copilot
// integration test.
func TestT9_Unauthorized(t *testing.T) {
	srv, _ := newServer(t)
	// Make sure no dev-mock token bypass is active.
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "")
	rr := doRequest(t, srv, http.MethodGet, "/api/tasks", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if e.OK {
		t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
	}
}

func TestScheduledTasks_CreatePauseRunComment(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	rr := doRequest(t, srv, http.MethodGet, "/api/scheduled-tasks", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list schedules: %d %s", rr.Code, rr.Body.String())
	}

	body := []byte(`{"title":"夜间巡检","cadence":"daily","hour":2,"minute":30}`)
	rr = doRequest(t, srv, http.MethodPost, "/api/scheduled-tasks", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create schedule: %d %s", rr.Code, rr.Body.String())
	}
	created := decodeData(t, decodeEnvelope(t, rr).Data)
	sid, _ := created["id"].(string)
	if sid == "" {
		t.Fatalf("missing schedule id: %s", rr.Body.String())
	}
	if created["cadence"] != "daily" {
		t.Fatalf("cadence=%v", created["cadence"])
	}

	rr = doRequest(t, srv, http.MethodPost, "/api/scheduled-tasks/"+sid+"/pause", tok, []byte(`{}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("pause: %d %s", rr.Code, rr.Body.String())
	}
	paused := decodeData(t, decodeEnvelope(t, rr).Data)
	if paused["status"] != "paused" {
		t.Fatalf("status=%v", paused["status"])
	}

	rr = doRequest(t, srv, http.MethodPost, "/api/scheduled-tasks/"+sid+"/resume", tok, []byte(`{}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("resume: %d %s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, srv, http.MethodPost, "/api/scheduled-tasks/"+sid+"/run", tok, []byte(`{}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("run: %d %s", rr.Code, rr.Body.String())
	}
	run := decodeData(t, decodeEnvelope(t, rr).Data)
	taskID, _ := run["taskId"].(string)
	if taskID == "" {
		t.Fatalf("run did not spawn task: %s", rr.Body.String())
	}

	rr = doRequest(t, srv, http.MethodPost, "/api/tasks/"+taskID+"/comments", tok, []byte(`{"body":"已接手夜间巡检"}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("comment: %d %s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, srv, http.MethodGet, "/api/tasks/"+taskID+"/comments", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list comments: %d %s", rr.Code, rr.Body.String())
	}
	var comments []map[string]any
	if err := json.Unmarshal(decodeEnvelope(t, rr).Data, &comments); err != nil {
		t.Fatalf("comments json: %v %s", err, rr.Body.String())
	}
	if len(comments) != 1 {
		t.Fatalf("comments=%d", len(comments))
	}
}
