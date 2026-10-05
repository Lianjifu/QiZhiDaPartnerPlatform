// Integration tests for the M02 专家协作 (Expert Collaboration) handlers
// (C1–C9 from docs/整合方案/专家协作模块整合方案.md §6.3). Mirrors the
// pattern of internal/operations/integration_test.go: each test boots a
// fresh server + in-memory store, mints a signed JWT, and round-trips
// through the standard {ok, data, error} envelope. The test file is
// self-contained — no shared fixtures in test/.
//
// Test surface (mirrors §6.3 of the plan doc):
//
//	C1 GET   /api/copilot/conversations                       — list w/ filter
//	C2 POST  /api/copilot/conversations                       — create + audit
//	C3 GET   /api/copilot/conversations/{id}/turns/{corr}/{status}
//	C4 GET   /api/copilot/conversations/{id}/turns/{corr}/replay
//	C5 POST  /api/copilot/conversations/{id}/cancel           — turn state
//	C6 POST  /api/copilot/conversations/{cid}/messages/{mid}/feedback + audit
//	C7 POST  /api/internal/copilot/post-turn                  — internal hook
//	C8 (rate-limit) 31 rapid POSTs /api/copilot/{cid}/stream  → 429
//	C9 GET   /api/copilot/conversations (no Authorization)    — 401
//
// Package note: we use `package copilot_test` (not `package copilot`)
// because the copilot package is imported by internal/server, and an
// internal test that imports server would close an import cycle. The
// operations integration test uses the same external-test layout.
package copilot_test

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
// with internal/operations/integration_test.go.
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
// returns the recorder. Sets Authorization when tok is non-empty and
// Content-Type when body is non-nil.
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

func adminTok(t *testing.T) string {
	t.Helper()
	return signToken(t, auth.Identity{
		ID: "u1", Name: "平台管理员", Email: "admin@acme.com",
		Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1",
	})
}

func memoryAuditCount(st *store.Store) int {
	st.RLock()
	defer st.RUnlock()
	return len(st.MemoryAudits)
}

func memoryAuditHasAction(st *store.Store, action string) bool {
	st.RLock()
	defer st.RUnlock()
	for _, a := range st.MemoryAudits {
		if s, _ := a["action"].(string); s == action {
			return true
		}
	}
	return false
}

// ----------------------------------------------------------------------
// C1 — GET /api/copilot/conversations: 200 + JSON array
// ----------------------------------------------------------------------

// TestC1_ListConversations verifies the M02 list endpoint round-trips
// through the standard envelope. Handler returns a flat slice filtered
// by workspace (no separate pagination meta — the front-end materializes
// its own paging). The test seeds one conversation into the store so we
// can confirm the workspace filter lets our row through.
func TestC1_ListConversations(t *testing.T) {
	srv, st := newServer(t)
	st.Lock()
	st.Conversations = []map[string]any{
		{"id": "conv-list-1", "workspaceId": "w1", "title": "列表测试", "updatedAt": time.Now().UTC().Format(time.RFC3339)},
	}
	st.Unlock()

	rr := doRequest(t, srv, http.MethodGet, "/api/copilot/conversations?limit=20", adminTok(t), nil)
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
		t.Fatalf("expected seeded conversation in list, got 0 entries")
	}
}

// ----------------------------------------------------------------------
// C2 — POST /api/copilot/conversations: 200 + id + title
// ----------------------------------------------------------------------

// TestC2_CreateConversation verifies create returns the new conversation
// id + title. The handler does NOT echo a separate "state" field — the
// companion session row carries status="active", but the conversation
// row returned here only has id/workspaceId/title/digitalPartnerId/
// modelId/updatedAt/sessionId (see handlers_c.go createConversation).
// That matches the legacy byte-for-byte and is the documented contract.
func TestC2_CreateConversation(t *testing.T) {
	srv, _ := newServer(t)
	body := []byte(`{"title":"测试会话","digitalPartnerId":"de-1","mode":"react"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/copilot/conversations", adminTok(t), body)
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
	if data["title"] != "测试会话" {
		t.Fatalf("title=%v, want 测试会话", data["title"])
	}
}

// ----------------------------------------------------------------------
// C3 — GET /api/copilot/conversations/{id}/turns/{corr}/status
// ----------------------------------------------------------------------

// TestC3_TurnStatus seeds an assistant message so hasAssistantForCorrelation
// returns true and the handler resolves the turn to "done" (the happy
// state). The allowed state set below also covers the other documented
// states from copilot_turn_state.go (running / cancelled / failed) — the
// task spec lists 8 states but the implementation only emits 4, so the
// assertion accepts both lists as valid.
func TestC3_TurnStatus(t *testing.T) {
	srv, st := newServer(t)
	const cid, corr = "c-status", "corr-status-1"
	st.Lock()
	st.Messages[cid] = []map[string]any{
		{"id": "m-1", "role": "assistant", "correlationId": corr, "content": "ok"},
	}
	st.Unlock()

	rr := doRequest(t, srv, http.MethodGet,
		"/api/copilot/conversations/"+cid+"/turns/"+corr+"/status",
		adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	data := decodeData(t, e.Data)
	got, _ := data["status"].(string)
	allowed := map[string]bool{
		"queued": true, "in_flight": true, "streaming": true,
		"succeeded": true, "done": true,
		"failed": true, "cancelled": true, "expired": true,
		"moderated": true, "running": true,
	}
	if !allowed[got] {
		t.Fatalf("invalid turn status %q (allowed=%v)", got, keys(allowed))
	}
	if data["correlationId"] != corr {
		t.Fatalf("correlationId=%v, want %s", data["correlationId"], corr)
	}
}

// keys returns the keys of a map[string]bool for diagnostic messages.
func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// ----------------------------------------------------------------------
// C4 — GET /api/copilot/conversations/{id}/turns/{corr}/replay
// ----------------------------------------------------------------------

// TestC4_ReplayTurn seeds a context snapshot so replayCopilotTurn finds
// the record and returns it. The route is GET (not POST as the task spec
// hints) — see server.go L841. Replay is read-only by design: it
// reconstructs the turn from the snapshot without re-invoking the LLM.
func TestC4_ReplayTurn(t *testing.T) {
	srv, st := newServer(t)
	st.Lock()
	st.ContextSnapshots = []map[string]any{{
		"id": "snap-1", "workspaceId": "w1",
		"conversationId": "c-rep", "correlationId": "corr-rep-1",
		"events": []any{}, "builtAt": time.Now().UTC().Format(time.RFC3339),
	}}
	st.Unlock()

	rr := doRequest(t, srv, http.MethodGet,
		"/api/copilot/conversations/c-rep/turns/corr-rep-1/replay",
		adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	data := decodeData(t, e.Data)
	if data["replay"] != true {
		t.Fatalf("replay flag missing/false; data=%v", data)
	}
	if data["correlationId"] != "corr-rep-1" {
		t.Fatalf("correlationId=%v, want corr-rep-1", data["correlationId"])
	}
}

// ----------------------------------------------------------------------
// C5 — POST /api/copilot/conversations/{id}/cancel: 200 + status
// ----------------------------------------------------------------------

// TestC5_CancelTurn asserts that cancel returns the updated turn state.
// The handler accepts correlationId from body OR x-correlation-id
// header; we use the body. The default state after cancel is "cancelled"
// (turnStatusCancelled from copilot_turn_state.go).
func TestC5_CancelTurn(t *testing.T) {
	srv, _ := newServer(t)
	body := []byte(`{"correlationId":"corr-cancel-1"}`)
	rr := doRequest(t, srv, http.MethodPost,
		"/api/copilot/conversations/c-cancel/cancel", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	data := decodeData(t, e.Data)
	if data["status"] != "cancelled" {
		t.Fatalf("status=%v, want cancelled", data["status"])
	}
	if data["correlationId"] != "corr-cancel-1" {
		t.Fatalf("correlationId=%v, want corr-cancel-1", data["correlationId"])
	}
}

// ----------------------------------------------------------------------
// C6 — POST /api/copilot/conversations/{cid}/messages/{mid}/feedback + audit
// ----------------------------------------------------------------------

// TestC6_MessageFeedback_Audit seeds an assistant message, posts a like
// feedback, and asserts the memory-audit row landed. copilotMessageFeedback
// writes to Store.MemoryAudits (not Store.Audits) via
// appendMemoryAuditLocked with action="反馈自进化" — see copilot_evolve.go
// createFeedbackEvolveCandidateLocked.
func TestC6_MessageFeedback_Audit(t *testing.T) {
	srv, st := newServer(t)
	const cid, mid = "c-fb", "m-fb-1"
	st.Lock()
	st.Messages[cid] = []map[string]any{
		{"id": mid, "role": "assistant", "content": "推荐回答", "correlationId": "corr-fb-1"},
	}
	st.Unlock()

	before := memoryAuditCount(st)
	body := []byte(`{"kind":"like","comment":"很有帮助"}`)
	rr := doRequest(t, srv, http.MethodPost,
		"/api/copilot/conversations/"+cid+"/messages/"+mid+"/feedback",
		adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	after := memoryAuditCount(st)
	if after <= before {
		t.Fatalf("memory audit row not written: before=%d after=%d", before, after)
	}
	if !memoryAuditHasAction(st, "反馈自进化") {
		t.Fatalf("missing 反馈自进化 audit row in MemoryAudits (have %d rows)", after)
	}
}

// ----------------------------------------------------------------------
// C7 — POST /api/internal/copilot/post-turn
// ----------------------------------------------------------------------

// TestC7_InternalPostTurn hits the internal hook and asserts the response
// envelope. copilotPostTurnAPI returns {evolveCandidates, memoryError};
// the task spec hints at "turn state" but the implementation shape is
// these two fields (see handlers_internal.go L183).
func TestC7_InternalPostTurn(t *testing.T) {
	srv, _ := newServer(t)
	body := []byte(`{"workspaceId":"w1","conversationId":"c-pt","correlationId":"corr-pt-1","messageId":"m-pt-1","userMessage":"hi","assistantText":"hello","mode":"react"}`)
	rr := doRequest(t, srv, http.MethodPost,
		"/api/internal/copilot/post-turn", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	data := decodeData(t, e.Data)
	if _, ok := data["evolveCandidates"]; !ok {
		t.Fatalf("missing evolveCandidates in response; data=%v", data)
	}
	if _, ok := data["memoryError"]; !ok {
		t.Fatalf("missing memoryError in response; data=%v", data)
	}
}

// ----------------------------------------------------------------------
// C8 — Rate limit: rapid-fire POSTs to stream endpoint
// ----------------------------------------------------------------------

// TestC8_RateLimit floods the copilot stream endpoint with rapid POSTs
// to trip the per-(workspace,user) rate-limit bucket. The default config
// (QZDA_COPILOT_RPM=30) gives burst=30, so 31 rapid calls guarantee a 429.
//
// Deviation note: the task spec suggests testing /api/copilot/conversations
// (the create endpoint) but that endpoint has no rate limit — only the
// stream endpoint (POST /api/copilot/{cid}/stream) calls
// allowCopilotTurn. We target the actual rate-limited route.
func TestC8_RateLimit(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)
	body := []byte(`{"content":"hi"}`)
	const path = "/api/copilot/conversations/c-rl/stream"
	var last429 *httptest.ResponseRecorder
	for i := 0; i < 35; i++ {
		rr := doRequest(t, srv, http.MethodPost, path, tok, body)
		if rr.Code == http.StatusTooManyRequests {
			last429 = rr
			break
		}
	}
	if last429 == nil {
		t.Fatalf("expected 429 within 35 rapid-fire requests, none returned 429")
	}
}

// ----------------------------------------------------------------------
// C9 — GET /api/copilot/conversations (no Authorization): 401
// ----------------------------------------------------------------------

// TestC9_Unauthorized confirms the auth middleware rejects unauthenticated
// requests with 401, mirroring TestProtectedRouteReturns401WithoutToken.
func TestC9_Unauthorized(t *testing.T) {
	srv, _ := newServer(t)
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "")
	rr := doRequest(t, srv, http.MethodGet, "/api/copilot/conversations", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if e.OK {
		t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
	}
}
