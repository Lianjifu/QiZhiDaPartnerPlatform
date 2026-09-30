package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func decodeHomeData(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var wrap map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &wrap); err != nil {
		t.Fatalf("json: %v body=%s", err, rr.Body.String())
	}
	data, _ := wrap["data"].(map[string]any)
	if data == nil {
		t.Fatalf("missing data: %s", rr.Body.String())
	}
	return data
}

func getHomeExtra(t *testing.T, h http.Handler, ws string) map[string]any {
	t.Helper()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/home/extra", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("x-workspace-id", ws)
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	return decodeHomeData(t, rr)
}

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

	h := server.New(st).Handler()
	data := getHomeExtra(t, h, "w1")

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

func TestHomeExtraLive_UsesEmployeesAndTasks(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	data := getHomeExtra(t, h, "w1")

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

func TestOpsOverviewLive_PendingFromTasks(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/operations/overview", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("x-workspace-id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d", rr.Code)
	}
	data := decodeHomeData(t, rr)
	pending, _ := data["pending"].([]any)
	if len(pending) < 1 {
		t.Fatalf("expected pending items from review/open tasks, got %v", pending)
	}
	de, _ := data["digitalPartners"].(map[string]any)
	health, _ := data["health"].(map[string]any)
	if toNum(health["activeAgents"]) != toNum(de["active"]) {
		t.Fatalf("health.activeAgents must match digitalEmployees.active")
	}
}

func TestHomeKPIsLive_MatchesOpsOverview(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/home/kpis", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("x-workspace-id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d", rr.Code)
	}
	kpis := decodeHomeData(t, rr)
	if kpis["source"] != "live-aggregate" {
		t.Fatalf("source=%v", kpis["source"])
	}
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/api/operations/overview", nil)
	req2.Header.Set("Authorization", "Bearer mock-admin-token")
	req2.Header.Set("x-workspace-id", "w1")
	h.ServeHTTP(rr2, req2)
	ov := decodeHomeData(t, rr2)
	de, _ := ov["digitalPartners"].(map[string]any)
	tasks, _ := ov["tasks"].(map[string]any)
	if toNum(kpis["activeDigitalPartners"]) != toNum(de["active"]) {
		t.Fatalf("active mismatch kpis=%v ov=%v", kpis["activeDigitalPartners"], de["active"])
	}
	if toNum(kpis["openTasks"]) != toNum(tasks["open"]) {
		t.Fatalf("openTasks mismatch")
	}
}

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
