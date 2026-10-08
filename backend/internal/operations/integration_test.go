// Integration tests for the M01 Operations Overview handlers (H1–H8
// from docs/整合方案/运营总览模块整合方案.md §6.3). These tests boot the
// full HTTP server (server.New(store.New()).Handler()), mint signed
// auth tokens for admin / user / auditor roles, and round-trip through
// the standard {ok, data, error} envelope used by pkg/response. They
// are the integration counterpart to operations/aggregate_test.go
// (which invokes Handler methods directly): the E2E path here catches
// route wiring regressions, middleware compatibility, and audit
// pipeline plumbing that direct-call unit tests miss.
//
// Test surface (mirrors §6.3 of the plan doc):
//
//	H1 GET  /api/home/kpis                       — 6 KPI tile load
//	H2 GET  /api/home/extra                      — full payload
//	H3 GET  /api/operations/overview             — source=live-aggregate
//	H4 GET  /api/home/extra                      — costMonth lock (no meters)
//	H5 GET  /api/home/alerts                     — alerts list
//	H6 POST /api/home/alerts/:id/acknowledge      — admin → 200 + audit
//	H7 POST /api/home/alerts/:id/acknowledge      — non-admin → 403
//	H8 GET  /api/home/extra (no Authorization)   — 401
package operations_test

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

// env envelope mirrors {ok, data, error} used by pkg/response. Keep in
// sync with internal/server/auth_integration_test.go.
type env struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error *envErr         `json:"error,omitempty"`
}

type envErr struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// signToken mints a signed JWT for the given identity. server.New wires
// auth.Parse as the bearer-token validator, so this token round-trips
// through the middleware cleanly.
func signToken(t *testing.T, id auth.Identity) string {
	t.Helper()
	tok, err := auth.Sign(id, time.Hour)
	if err != nil {
		t.Fatalf("auth.Sign: %v", err)
	}
	return tok
}

// newServer boots a fresh server + store for each sub-test so state
// mutation in one test cannot leak into another (AckAlert mutates
// HomeAlerts; AppendAudit mutates Audits).
func newServer(t *testing.T) (*server.Server, *store.Store) {
	t.Helper()
	st := store.New()
	srv := server.New(st)
	return srv, st
}

// doRequest sends a single HTTP request through the server's Handler
// and returns the recorder. The Authorization header is set when tok
// is non-empty; callers can override other headers via mut before the
// call.
func doRequest(t *testing.T, srv *server.Server, method, path, tok string, mut func(r *http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	var body *bytes.Reader
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch {
		body = bytes.NewReader(nil)
	} else {
		body = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, body)
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	if mut != nil {
		mut(req)
	}
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	return rr
}

// decodeEnvelope parses the {ok, data, error} body and returns it.
// Fails the test on malformed JSON.
func decodeEnvelope(t *testing.T, rr *httptest.ResponseRecorder) env {
	t.Helper()
	var e env
	if err := json.Unmarshal(rr.Body.Bytes(), &e); err != nil {
		t.Fatalf("envelope parse: %v body=%s", err, rr.Body.String())
	}
	return e
}

// decodeData unmarshals env.Data into a fresh map[string]any. Mirrors
// the auth_integration_test.go pattern.
func decodeData(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("data parse: %v raw=%s", err, string(raw))
	}
	return m
}

// keysOf returns the keys of a map[string]any. Used for diagnostic
// messages when an expected field is missing.
func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// ----------------------------------------------------------------------
// H1 — GET /api/home/kpis: 6 KPI tile load
// ----------------------------------------------------------------------

// TestH1_HomeKPIs_Loads asserts that /api/home/kpis returns 200 with
// the 6 KPI tile fields (activeDigitalPartners / openTasks / riskTasks
// / pendingApprovals / deadLetters / generatedAt + the M5 source
// sentinel). The field names must stay aligned with opsOverviewLive
// because homeKPIsLive is a strict projection of it (TestHomeKPIsLive_
// MatchesOpsOverview enforces the same invariant).
func TestH1_HomeKPIs_Loads(t *testing.T) {
	srv, _ := newServer(t)
	tok := signToken(t, auth.Identity{ID: "u1", Name: "平台管理员", Email: "admin@acme.com", Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1"})

	rr := doRequest(t, srv, http.MethodGet, "/api/home/kpis", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	data := decodeData(t, e.Data)

	wantKeys := []string{
		"activeDigitalPartners", "openTasks", "riskTasks",
		"pendingApprovals", "deadLetters", "generatedAt",
	}
	have := keysOf(data)
	for _, k := range wantKeys {
		if _, ok := data[k]; !ok {
			t.Fatalf("missing %q in /api/home/kpis response; have=%v", k, have)
		}
	}
	if data["source"] != "live-aggregate" {
		t.Fatalf("source=%v, want live-aggregate", data["source"])
	}
}

// ----------------------------------------------------------------------
// H2 — GET /api/home/extra: full payload
// ----------------------------------------------------------------------

// TestH2_HomeExtra_Loads asserts that /api/home/extra returns 200 with
// every field documented in home_extra.go: taskCompletion /
// agentCallSummary / operationalMetrics (with trend24h) / costMonth /
// slaAlerts / notifications / recentActivities / suggestion /
// quickLinks / teamMembers. Field names are read from the implementation
// (home_extra.go) — the test must stay in sync if the schema changes.
func TestH2_HomeExtra_Loads(t *testing.T) {
	srv, _ := newServer(t)
	tok := signToken(t, auth.Identity{ID: "u1", Name: "平台管理员", Email: "admin@acme.com", Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1"})

	rr := doRequest(t, srv, http.MethodGet, "/api/home/extra", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	data := decodeData(t, e.Data)

	wantKeys := []string{
		"taskCompletion", "agentCallSummary", "operationalMetrics",
		"costMonth", "slaAlerts", "notifications",
		"recentActivities", "suggestion", "quickLinks", "teamMembers",
	}
	have := keysOf(data)
	for _, k := range wantKeys {
		if _, ok := data[k]; !ok {
			t.Fatalf("missing %q in /api/home/extra response; have=%v", k, have)
		}
	}
	if data["source"] != "live-aggregate" {
		t.Fatalf("source=%v, want live-aggregate", data["source"])
	}

	om, _ := data["operationalMetrics"].(map[string]any)
	if _, ok := om["trend24h"]; !ok {
		t.Fatalf("operationalMetrics.trend24h missing; have=%v", keysOf(om))
	}
}

// ----------------------------------------------------------------------
// H3 — GET /api/operations/overview: source=live-aggregate
// ----------------------------------------------------------------------

// TestH3_OpsOverview_LiveAggregate asserts that /api/operations/
// overview returns 200 with source="live-aggregate" (M5 compliance
// sentinel — see internal/operations/aggregate.go). Also asserts
// H1↔H3 cross-endpoint consistency: the KPI fields exposed at
// /api/home/kpis must equal the corresponding fields on /api/operations/
// overview (the same invariant that TestHomeKPIsLive_MatchesOpsOverview
// enforces at the unit level — here it's end-to-end through HTTP).
func TestH3_OpsOverview_LiveAggregate(t *testing.T) {
	srv, _ := newServer(t)
	tok := signToken(t, auth.Identity{ID: "u1", Name: "平台管理员", Email: "admin@acme.com", Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1"})

	rr := doRequest(t, srv, http.MethodGet, "/api/operations/overview", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	ov := decodeData(t, e.Data)
	if ov["source"] != "live-aggregate" {
		t.Fatalf("source=%v, want live-aggregate (M5 compliance)", ov["source"])
	}

	// Cross-endpoint consistency with H1: activeDigitalPartners +
	// openTasks on /api/home/kpis must equal digitalPartners.active +
	// tasks.open on /api/operations/overview.
	kpisRR := doRequest(t, srv, http.MethodGet, "/api/home/kpis", tok, nil)
	if kpisRR.Code != http.StatusOK {
		t.Fatalf("kpis: want 200, got %d", kpisRR.Code)
	}
	kpisE := decodeEnvelope(t, kpisRR)
	kpis := decodeData(t, kpisE.Data)

	de, _ := ov["digitalPartners"].(map[string]any)
	tasks, _ := ov["tasks"].(map[string]any)
	if numEqual(kpis["activeDigitalPartners"], de["active"]) != true {
		t.Fatalf("active mismatch kpis=%v overview=%v", kpis["activeDigitalPartners"], de["active"])
	}
	if numEqual(kpis["openTasks"], tasks["open"]) != true {
		t.Fatalf("openTasks mismatch kpis=%v overview=%v", kpis["openTasks"], tasks["open"])
	}
}

// ----------------------------------------------------------------------
// H4 — costMonth lock when no usage-meters
// ----------------------------------------------------------------------

// TestH4_CostMonth_LockedWhenNoMeters asserts that with the default
// store.New() (which seeds no UsageMeters rows), costMonth reports
// locked / source="none" / used=0 / budget=0. billingCostLocked
// explicitly refuses to read the demo Billing.usage seed — see
// home_extra.go:282 for the contract.
func TestH4_CostMonth_LockedWhenNoMeters(t *testing.T) {
	srv, st := newServer(t)
	st.RLock()
	meterCount := len(st.UsageMeters)
	st.RUnlock()
	if meterCount != 0 {
		t.Skipf("default store should have 0 usage meters, got %d", meterCount)
	}

	tok := signToken(t, auth.Identity{ID: "u1", Name: "平台管理员", Email: "admin@acme.com", Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1"})
	rr := doRequest(t, srv, http.MethodGet, "/api/home/extra", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	data := decodeData(t, decodeEnvelope(t, rr).Data)
	cost, _ := data["costMonth"].(map[string]any)
	if cost == nil {
		t.Fatalf("costMonth missing; have=%v", keysOf(data))
	}
	if src, _ := cost["source"].(string); src != "none" {
		t.Fatalf("costMonth.source=%q, want \"none\" (no usage meters seeded)", src)
	}
	if used, _ := cost["used"].(float64); used != 0 {
		t.Fatalf("costMonth.used=%v, want 0", cost["used"])
	}
	if budget, _ := budgetAsFloat(cost["budget"]); budget != 0 {
		t.Fatalf("costMonth.budget=%v, want 0", cost["budget"])
	}
}

// budgetAsFloat coerces costMonth.budget which the JSON decoder may
// surface as float64 or int depending on the value shape. The seeded
// Billing quota is {tokens: 5_000_000, usd: 0} so usd ends up 0 — we
// want to read it numerically.
func budgetAsFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}

// ----------------------------------------------------------------------
// H5 — GET /api/home/alerts: alerts list
// ----------------------------------------------------------------------

// TestH5_HomeAlerts_List asserts that /api/home/alerts returns 200
// with an array payload (possibly empty — the default seed leaves
// HomeAlerts empty; see store.go:801). The contract is just "array
// shape": the live seed deliberately drops demo alerts because the
// frontend derives its own alerts from slaAlerts in HomeExtra.
func TestH5_HomeAlerts_List(t *testing.T) {
	srv, _ := newServer(t)
	tok := signToken(t, auth.Identity{ID: "u1", Name: "平台管理员", Email: "admin@acme.com", Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1"})

	rr := doRequest(t, srv, http.MethodGet, "/api/home/alerts", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	// data may be a JSON null or [] depending on how the slice
	// round-trips; accept either as "array-shaped".
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data is not an array: %v raw=%s", err, string(e.Data))
	}
}

// ----------------------------------------------------------------------
// H6 — POST /api/home/alerts/:id/acknowledge (admin) — 200 + audit
// ----------------------------------------------------------------------

// TestH6_AckAlert_AdminSuccess verifies that an admin ack stamps the
// alert row AND writes an audit row with action="确认运营告警". The
// audit row is written via Store.AppendAudit (sourced through the
// injected AuditSink in server.buildOpsHandler). We assert it by
// reading Store.Audits directly — going through /api/audits would
// require the `audit.read` permission which admins don't have by
// default (see handlers_a.go:770).
func TestH6_AckAlert_AdminSuccess(t *testing.T) {
	srv, st := newServer(t)
	tok := signToken(t, auth.Identity{ID: "u1", Name: "平台管理员", Email: "admin@acme.com", Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1"})

	// Seed one P1 alert into HomeAlerts so AckAlert has something to
	// mutate. store.New() intentionally leaves HomeAlerts empty.
	st.Lock()
	st.HomeAlerts = []map[string]any{
		{"id": "alert-int-1", "workspaceId": "w1", "level": "P1", "title": "集成测试告警", "acknowledged": false},
	}
	st.Unlock()

	// Count audit rows before the call. store.New() seeds one
	// "初始化审计" row.
	before := auditCount(st)

	rr := doRequest(t, srv, http.MethodPost, "/api/home/alerts/alert-int-1/acknowledge", tok, func(r *http.Request) {
		r.Header.Set("Content-Type", "application/json")
		r.Body = http.NoBody
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}

	// Verify alert row was mutated.
	st.RLock()
	mutated, _ := st.HomeAlerts[0]["acknowledged"].(bool)
	st.RUnlock()
	if !mutated {
		t.Fatalf("alert must be acknowledged=true, got %v", st.HomeAlerts[0]["acknowledged"])
	}

	// Verify audit row landed with action="确认运营告警" — read
	// Store.Audits directly (HTTP /api/audits requires audit.read).
	after := auditCount(st)
	if after <= before {
		t.Fatalf("audit row not written: before=%d after=%d", before, after)
	}
	if !auditStoreHasAction(st, "确认运营告警") {
		t.Fatalf("expected audit row with action=\"确认运营告警\" in Store.Audits; have %d rows", after)
	}
}

// auditCount returns the number of rows currently in Store.Audits.
// store.New() seeds one "初始化审计" row at line 389 of store.go.
func auditCount(st *store.Store) int {
	st.RLock()
	defer st.RUnlock()
	return len(st.Audits)
}

// auditStoreHasAction reports whether Store.Audits contains a row
// with the given action string. Reads the in-memory collection
// directly because /api/audits requires the `audit.read` permission
// which admins don't hold.
func auditStoreHasAction(st *store.Store, action string) bool {
	st.RLock()
	defer st.RUnlock()
	for _, a := range st.Audits {
		if s, _ := a["action"].(string); s == action {
			return true
		}
	}
	return false
}

// ----------------------------------------------------------------------
// H7 — POST /api/home/alerts/:id/acknowledge (non-admin) — 403
// ----------------------------------------------------------------------

// TestH7_AckAlert_NonAdminForbidden asserts that user / auditor roles
// cannot acknowledge alerts. The 403 comes from operations.ackAlert
// (RoleForbidden + StatusForbidden) — see handlers.go:84. The audit
// row MUST NOT be written on the rejected path.
func TestH7_AckAlert_NonAdminForbidden(t *testing.T) {
	cases := []struct {
		name  string
		ident auth.Identity
	}{
		{"user", auth.Identity{ID: "u2", Name: "业务构建者", Email: "user@acme.com", Role: "user", TenantID: "tenant-acme", WorkspaceID: "w1"}},
		{"auditor", auth.Identity{ID: "u3", Name: "合规审计员", Email: "audit@acme.com", Role: "auditor", TenantID: "tenant-acme", WorkspaceID: "w1"}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			srv, st := newServer(t)
			st.Lock()
			st.HomeAlerts = []map[string]any{
				{"id": "alert-7", "workspaceId": "w1", "level": "P1", "title": "未确认告警", "acknowledged": false},
			}
			st.Unlock()

			tok := signToken(t, tc.ident)
			rr := doRequest(t, srv, http.MethodPost, "/api/home/alerts/alert-7/acknowledge", tok, func(r *http.Request) {
				r.Header.Set("Content-Type", "application/json")
				r.Body = http.NoBody
			})
			if rr.Code != http.StatusForbidden {
				t.Fatalf("want 403, got %d body=%s", rr.Code, rr.Body.String())
			}
			e := decodeEnvelope(t, rr)
			if e.OK {
				t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
			}
			if e.Error == nil || e.Error.Code == "" {
				t.Fatalf("want non-empty error code, got %+v", e)
			}
			// Alert row must NOT have been mutated on the rejected path.
			st.RLock()
			mutated, _ := st.HomeAlerts[0]["acknowledged"].(bool)
			st.RUnlock()
			if mutated {
				t.Fatalf("alert must remain un-acknowledged after forbidden call, got acknowledged=true")
			}
		})
	}
}

// ----------------------------------------------------------------------
// H8 — GET /api/home/extra (no Authorization) — 401
// ----------------------------------------------------------------------

// TestH8_HomeExtra_UnauthorizedWithoutToken asserts that the auth
// middleware returns 401 when no Authorization header is sent. This
// mirrors TestProtectedRouteReturns401WithoutToken (auth_integration_
// test.go) but exercises the M01 path to confirm the operations
// routes flow through the same RequireAuth gate as /api/workspaces.
func TestH8_HomeExtra_UnauthorizedWithoutToken(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/home/extra", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if e.OK {
		t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
	}
	if e.Error == nil || e.Error.Code == "" {
		t.Fatalf("want non-empty error code, got %+v", e)
	}
}

// ----------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------

// numEqual reports whether two JSON-decoded numeric values represent
// the same number (float64 / int / int64 may all surface depending on
// the encoder). Returns false on type mismatch.
func numEqual(a, b any) bool {
	af, aok := toFloat(a)
	bf, bok := toFloat(b)
	if !aok || !bok {
		return false
	}
	return af == bf
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}