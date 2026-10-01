package operations_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/operations"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// These tests previously lived in internal/server/home_extra_live_test.go
// and exercised the M01 endpoints through the full server middleware
// stack. After Phase 2 consolidation the aggregate + handler live in
// internal/operations; we now invoke the Handler methods directly with a
// hand-built authenticated context, which keeps the test surface focused
// on the operations package and avoids booting the entire server.

// newTestHandler builds an operations.Handler wired against `st` with a
// workspace resolver that reads the Identity off the request context
// (mirrors what server.workspaceID does in production). AuditSink /
// Health / ReplicaRole / InstanceID are left nil — the Handler treats
// them as optional and falls back to safe defaults.
func newTestHandler(st *store.Store) *operations.Handler {
	return &operations.Handler{
		Store: st,
		WorkspaceID: func(r *http.Request) string {
			if id := auth.IdentityFrom(r.Context()); id != nil && id.WorkspaceID != "" {
				return id.WorkspaceID
			}
			return "w1"
		},
	}
}

// adminRequest builds a GET request for `path` with an admin Identity on
// the context. Pass ws="" to leave the identity's WorkspaceID empty —
// the resolver will then fall back to "w1".
func adminRequest(path, ws string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	id := &auth.Identity{
		ID: "u1", Name: "平台管理员", Email: "admin@acme.com",
		Role: "admin", WorkspaceID: ws,
	}
	return req.WithContext(auth.WithIdentity(req.Context(), id))
}

// mustJSON unmarshals the handler's return value into a map[string]any.
// Tests pass the raw payload (not the response envelope), so this is
// much simpler than the legacy httptest round-trip.
func mustJSON(t *testing.T, v any) map[string]any {
	t.Helper()
	m, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("expected map[string]any, got %T: %+v", v, v)
	}
	return m
}

// toNum coerces an `any` numeric into a float64 — mirrors the legacy
// test helper so the assertions read the same.
func toNum(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return 0
	}
}

// TestHomeExtraLive_EmptyWorkspaceHonestZeros asserts that an empty
// store yields honest zeros / empty lists in HomeExtra — never demo
// seed values that would mislead the dashboard. The Billing seed is
// preserved (test setup) but ignored because no UsageMeters exist.
func TestHomeExtraLive_EmptyWorkspaceHonestZeros(t *testing.T) {
	st := store.New()
	st.Lock()
	st.Employees = nil
	st.Tasks = nil
	st.Sessions = nil
	st.Conversations = nil
	st.HomeAlerts = nil
	st.Billing = map[string]any{"workspaceId": "w1", "usage": map[string]any{"usd": 0}, "quota": map[string]any{"usd": 0}}
	st.Unlock()

	h := newTestHandler(st)
	req := adminRequest("/api/home/extra", "w1")
	v, err := h.HomeExtra(req)
	if err != nil {
		t.Fatalf("HomeExtra: %v", err)
	}
	data := mustJSON(t, v)
	if data["source"] != "live-aggregate" {
		t.Fatalf("source=%v", data["source"])
	}
	tc, _ := data["taskCompletion"].(map[string]any)
	if toNum(tc["done"]) != 0 || toNum(tc["doing"]) != 0 {
		t.Fatalf("taskCompletion=%v", tc)
	}
	agents, _ := data["agentCallSummary"].(map[string]any)
	if toNum(agents["healthy"]) != 0 {
		t.Fatalf("healthy=%v", agents)
	}
	metrics, _ := data["operationalMetrics"].(map[string]any)
	if metrics["taskSuccessRate"] != nil {
		t.Fatalf("expected nil success rate, got %v", metrics["taskSuccessRate"])
	}
	if toNum(metrics["activeAgents"]) != 0 || toNum(metrics["healthScore"]) != 0 {
		t.Fatalf("metrics=%v", metrics)
	}
	trend, _ := metrics["trend24h"].([]any)
	if len(trend) != 0 {
		t.Fatalf("expected empty trend, got %d", len(trend))
	}
	acts, _ := data["recentActivities"].([]any)
	if len(acts) != 0 {
		t.Fatalf("expected no seed activities, got %v", acts)
	}
	alerts, _ := data["slaAlerts"].([]any)
	if len(alerts) != 0 {
		t.Fatalf("expected no orphan alerts, got %v", alerts)
	}
	cost, _ := data["costMonth"].(map[string]any)
	if toNum(cost["used"]) != 0 {
		t.Fatalf("cost used=%v", cost["used"])
	}
}

// TestHomeExtraLive_UsesEmployeesAndTasks asserts that the seeded
// w1 workspace yields non-zero task + employee counts, and that
// `activeAgents` matches `healthy` exactly.
func TestHomeExtraLive_UsesEmployeesAndTasks(t *testing.T) {
	st := store.New()
	h := newTestHandler(st)

	req := adminRequest("/api/home/extra", "w1")
	v, err := h.HomeExtra(req)
	if err != nil {
		t.Fatalf("HomeExtra: %v", err)
	}
	data := mustJSON(t, v)
	agents, _ := data["agentCallSummary"].(map[string]any)
	if toNum(agents["healthy"]) < 1 {
		t.Fatalf("expected active employees on seed w1, got %v", agents)
	}
	tc, _ := data["taskCompletion"].(map[string]any)
	if toNum(tc["doing"])+toNum(tc["review"])+toNum(tc["todo"])+toNum(tc["done"]) < 1 {
		t.Fatalf("expected tasks on seed w1, got %v", tc)
	}
	metrics, _ := data["operationalMetrics"].(map[string]any)
	if toNum(metrics["activeAgents"]) != toNum(agents["healthy"]) {
		t.Fatalf("activeAgents must match healthy count: %v vs %v", metrics["activeAgents"], agents["healthy"])
	}
	if metrics["taskSuccessRate"] == nil {
		t.Fatal("expected computed success rate when tasks exist")
	}
}

// TestOpsOverviewLive_PendingFromTasks asserts that the live overview
// surfaces pending review / risk tasks and that health.activeAgents
// tracks digitalPartners.active exactly.
func TestOpsOverviewLive_PendingFromTasks(t *testing.T) {
	st := store.New()
	h := newTestHandler(st)

	req := adminRequest("/api/operations/overview", "w1")
	v, err := h.OpsOverview(req)
	if err != nil {
		t.Fatalf("OpsOverview: %v", err)
	}
	data := mustJSON(t, v)
	// aggregate.go declares pending as []map[string]any, so the assertion
	// must match exactly. Using []any here would always fail (the value
	// is a typed slice, not a []any).
	pending, _ := data["pending"].([]map[string]any)
	if len(pending) < 1 {
		t.Fatalf("expected pending items from review/open tasks, got %v", pending)
	}
	de, _ := data["digitalPartners"].(map[string]any)
	health, _ := data["health"].(map[string]any)
	if toNum(health["activeAgents"]) != toNum(de["active"]) {
		t.Fatalf("health.activeAgents must match digitalEmployees.active")
	}
}

// TestHomeKPIsLive_MatchesOpsOverview asserts the projection relationship
// between the KPI tile endpoint and the cross-asset overview: every
// number on /api/home/kpis must match the corresponding field on
// /api/operations/overview.
func TestHomeKPIsLive_MatchesOpsOverview(t *testing.T) {
	st := store.New()
	h := newTestHandler(st)

	kpisReq := adminRequest("/api/home/kpis", "w1")
	v, err := h.HomeKPIs(kpisReq)
	if err != nil {
		t.Fatalf("HomeKPIs: %v", err)
	}
	kpis := mustJSON(t, v)
	if kpis["source"] != "live-aggregate" {
		t.Fatalf("source=%v", kpis["source"])
	}

	ovReq := adminRequest("/api/operations/overview", "w1")
	ovV, err := h.OpsOverview(ovReq)
	if err != nil {
		t.Fatalf("OpsOverview: %v", err)
	}
	ov := mustJSON(t, ovV)
	de, _ := ov["digitalPartners"].(map[string]any)
	tasks, _ := ov["tasks"].(map[string]any)
	if toNum(kpis["activeDigitalPartners"]) != toNum(de["active"]) {
		t.Fatalf("active mismatch kpis=%v ov=%v", kpis["activeDigitalPartners"], de["active"])
	}
	if toNum(kpis["openTasks"]) != toNum(tasks["open"]) {
		t.Fatalf("openTasks mismatch")
	}
}

// TestAckAlertRequiresAdmin asserts that the AckAlert handler returns
// 403 for non-admin callers (identity-based gate). The audit row is
// only written on the admin-success path.
func TestAckAlertRequiresAdmin(t *testing.T) {
	st := store.New()
	st.Lock()
	st.HomeAlerts = []map[string]any{
		{"id": "alert-1", "workspaceId": "w1", "level": "P1", "title": "缓存延迟", "acknowledged": false},
	}
	st.Unlock()

	h := newTestHandler(st)

	// user role → 403
	req := httptest.NewRequest(http.MethodPost, "/api/home/alerts/alert-1/acknowledge", nil)
	id := &auth.Identity{ID: "u2", Name: "业务构建者", Email: "user@acme.com", Role: "user", WorkspaceID: "w1"}
	req = req.WithContext(auth.WithIdentity(req.Context(), id))
	if _, err := h.AckAlert(req); err == nil {
		t.Fatalf("expected forbidden for user role")
	}
	// alert must NOT have been mutated: seed has acknowledged=false,
	// the rejected call must not flip it to true.
	st.RLock()
	mutated := st.HomeAlerts[0]["acknowledged"]
	st.RUnlock()
	if mutated == true {
		t.Fatalf("alert must remain un-acknowledged after non-admin call, got %v", mutated)
	}
}

// TestAckAlertAdminSuccess writes the audit row and stamps the alert.
// Verifies the audit text "确认运营告警" survives the package split.
func TestAckAlertAdminSuccess(t *testing.T) {
	st := store.New()
	st.Lock()
	st.HomeAlerts = []map[string]any{
		{"id": "alert-1", "workspaceId": "w1", "level": "P1", "title": "缓存延迟", "acknowledged": false},
	}
	st.Unlock()

	var captured []string
	h := newTestHandler(st)
	h.AuditSink = func(ws, actor, action, target, status, detail string) {
		captured = append(captured, ws, actor, action, target, status, detail)
	}

	req := adminRequest("/api/home/alerts/alert-1/acknowledge", "w1")
	if _, err := h.AckAlert(req); err != nil {
		t.Fatalf("AckAlert: %v", err)
	}
	if len(captured) != 6 {
		t.Fatalf("expected one audit write, got %d", len(captured)/6)
	}
	if captured[2] != "确认运营告警" {
		t.Fatalf("audit action=%q, want \"确认运营告警\"", captured[2])
	}
	if captured[3] != "alert-1" {
		t.Fatalf("audit target=%q, want alert-1", captured[3])
	}
	if captured[4] != "success" {
		t.Fatalf("audit status=%q, want success", captured[4])
	}

	st.RLock()
	ack := st.HomeAlerts[0]["acknowledged"]
	st.RUnlock()
	if ack != true {
		t.Fatalf("alert must be acknowledged, got %v", ack)
	}
}

// TestAckAlertP0RequiresNote asserts the P0 note gate — without a
// `note` in the JSON body the handler must reject with a 400.
func TestAckAlertP0RequiresNote(t *testing.T) {
	st := store.New()
	st.Lock()
	st.HomeAlerts = []map[string]any{
		{"id": "alert-p0", "workspaceId": "w1", "level": "P0", "title": "P0 故障", "acknowledged": false},
	}
	st.Unlock()

	h := newTestHandler(st)
	req := adminRequest("/api/home/alerts/alert-p0/acknowledge", "w1")
	_, err := h.AckAlert(req)
	if err == nil {
		t.Fatal("expected BadReq for P0 without note")
	}
}

// (kept for parity with the legacy test file's `decodeHomeData` shape —
// tests that need to assert against raw JSON envelopes can use this.)
func decodeJSONBody(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("json: %v body=%s", err, string(body))
	}
	return v
}
