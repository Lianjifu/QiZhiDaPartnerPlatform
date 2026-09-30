package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/metrics"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// inboxPost POSTs a JSON body to the inbox handler. body can be nil for {}.
func inboxPost(t *testing.T, h http.Handler, path, token, ws string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *strings.Reader
	if body == nil {
		rdr = strings.NewReader("{}")
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		rdr = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(http.MethodPost, path, rdr)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Workspace-Id", ws)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func inboxGet(t *testing.T, h http.Handler, path, token, ws string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Workspace-Id", ws)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

// inboxData unwraps the {ok, data, error} response envelope and returns
// the data map. Test fails loudly if envelope shape is wrong.
func inboxData(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var env struct {
		OK    bool           `json:"ok"`
		Data  map[string]any `json:"data"`
		Error map[string]any `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("envelope unmarshal: %v body=%s", err, rr.Body.String())
	}
	if !env.OK {
		t.Fatalf("envelope.ok=false body=%s", rr.Body.String())
	}
	return env.Data
}

// strOf mirrors the package-private helper in the server package.
func strOf(v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case []byte:
		return string(x)
	case fmt.Stringer:
		return x.String()
	}
	return ""
}

// num coerces a JSON number (float64) to int for cleaner assertions.
func num(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	}
	return 0
}

func TestExpertInboxListEmpty(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()
	rr := inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w1")
	if rr.Code != 200 {
		t.Fatalf("status: %d body=%s", rr.Code, rr.Body.String())
	}
	out := inboxData(t, rr)
	if num(out["total"]) != 0 || num(out["pending"]) != 0 {
		t.Fatalf("expected empty inbox, got total=%v pending=%v", out["total"], out["pending"])
	}
}

// seedExpertInbox inserts n items directly into the store under wsID.
func seedExpertInbox(t *testing.T, st *store.Store, wsID string, n int, statuses ...string) []string {
	t.Helper()
	st.Lock()
	defer st.Unlock()
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		status := "pending"
		if i < len(statuses) {
			status = statuses[i]
		}
		id := st.ID("inbox")
		ids = append(ids, id)
		st.ExpertInbox = append(st.ExpertInbox, map[string]any{
			"id":          id,
			"workspaceId": wsID,
			"title":       "seeded " + id,
			"source":      "manual",
			"severity":    "info",
			"status":      status,
			"createdAt":   "2026-09-08T00:00:00Z",
			"createdBy":   "seeder",
		})
	}
	return ids
}

func TestExpertInboxListFiltersAndCountsPending(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	seedExpertInbox(t, st, "w1", 5) // all pending
	h := server.New(st).Handler()

	rr := inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w1")
	if rr.Code != 200 {
		t.Fatalf("status: %d body=%s", rr.Code, rr.Body.String())
	}
	out := inboxData(t, rr)
	if num(out["total"]) != 5 {
		t.Fatalf("total: want 5, got %v", out["total"])
	}
	if num(out["pending"]) != 5 {
		t.Fatalf("pending: want 5, got %v", out["pending"])
	}

	rr = inboxGet(t, h, "/api/expert-inbox?status=pending", "mock-admin-token", "w1")
	filtered := inboxData(t, rr)
	if num(filtered["total"]) != 5 {
		t.Fatalf("filtered total: want 5, got %v", filtered["total"])
	}

	rr = inboxGet(t, h, "/api/expert-inbox?status=approved", "mock-admin-token", "w1")
	none := inboxData(t, rr)
	if num(none["total"]) != 0 {
		t.Fatalf("filtered approved: want 0, got %v", none["total"])
	}
}

func TestExpertInboxListIsolatesByWorkspace(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	seedExpertInbox(t, st, "w1", 3)
	seedExpertInbox(t, st, "w2", 7)
	h := server.New(st).Handler()

	rr := inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w1")
	out := inboxData(t, rr)
	if num(out["total"]) != 3 {
		t.Fatalf("w1 total: want 3, got %v", out["total"])
	}

	rr = inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w2")
	out = inboxData(t, rr)
	if num(out["total"]) != 7 {
		t.Fatalf("w2 total: want 7, got %v", out["total"])
	}
}

func TestExpertInboxListRejectsNonWriter(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()
	rr := inboxGet(t, h, "/api/expert-inbox", "mock-user-token", "w1")
	if rr.Code != 403 {
		t.Fatalf("user without access.write should be 403, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestExpertInboxCreateAndApproveFlow(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	h := server.New(st).Handler()

	// Baseline: list w1 → pending=0.
	rr := inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w1")
	out := inboxData(t, rr)
	baseline := num(out["pending"])

	rr = inboxPost(t, h, "/api/expert-inbox", "mock-admin-token", "w1", map[string]any{
		"title":    "待审核：客服回复模板",
		"source":   "manual",
		"severity": "warn",
		"payload":  map[string]any{"draft": "你好"},
	})
	if rr.Code != 200 {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	item := inboxData(t, rr)
	itemID, _ := item["id"].(string)
	if itemID == "" {
		t.Fatalf("create: missing id, body=%s", rr.Body.String())
	}
	if item["status"] != "pending" {
		t.Fatalf("create: status want pending, got %v", item["status"])
	}

	rr = inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w1")
	out = inboxData(t, rr)
	if num(out["pending"]) != baseline+1 {
		t.Fatalf("pending after create: want %d, got %v", baseline+1, out["pending"])
	}
	if metrics.Global.ExpertInbox.Get() != uint64(baseline+1) {
		t.Fatalf("metric after create: want %d, got %d", baseline+1, metrics.Global.ExpertInbox.Get())
	}

	rr = inboxPost(t, h, "/api/expert-inbox/"+itemID+"/review", "mock-admin-token", "w1", map[string]any{
		"decision": "approve",
		"note":     "OK to send",
	})
	if rr.Code != 200 {
		t.Fatalf("approve: %d %s", rr.Code, rr.Body.String())
	}
	approved := inboxData(t, rr)
	if approved["status"] != "approved" {
		t.Fatalf("approve: status want approved, got %v", approved["status"])
	}
	if approved["reviewer"] != "平台管理员" {
		t.Fatalf("approve: reviewer want 平台管理员, got %v", approved["reviewer"])
	}

	rr = inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w1")
	out = inboxData(t, rr)
	if num(out["pending"]) != baseline {
		t.Fatalf("pending after approve: want %d, got %v", baseline, out["pending"])
	}
	if metrics.Global.ExpertInbox.Get() != uint64(baseline) {
		t.Fatalf("metric after approve: want %d, got %d", baseline, metrics.Global.ExpertInbox.Get())
	}
}

func TestExpertInboxReviewAllThreeDecisions(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	ids := seedExpertInbox(t, st, "w1", 3)
	h := server.New(st).Handler()

	cases := []struct {
		id       string
		decision string
		want     string
	}{
		{ids[0], "approve", "approved"},
		{ids[1], "reject", "rejected"},
		{ids[2], "dismiss", "dismissed"},
	}
	for _, c := range cases {
		rr := inboxPost(t, h, "/api/expert-inbox/"+c.id+"/review", "mock-admin-token", "w1", map[string]any{
			"decision": c.decision,
			"note":     "test",
		})
		if rr.Code != 200 {
			t.Fatalf("%s: %d %s", c.decision, rr.Code, rr.Body.String())
		}
		out := inboxData(t, rr)
		if out["status"] != c.want {
			t.Fatalf("%s: status want %s, got %v", c.decision, c.want, out["status"])
		}
	}
}

func TestExpertInboxReviewRejectsDoubleDecision(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	ids := seedExpertInbox(t, st, "w1", 1)
	h := server.New(st).Handler()

	rr := inboxPost(t, h, "/api/expert-inbox/"+ids[0]+"/review", "mock-admin-token", "w1", map[string]any{
		"decision": "approve",
	})
	if rr.Code != 200 {
		t.Fatalf("first review: %d %s", rr.Code, rr.Body.String())
	}
	rr = inboxPost(t, h, "/api/expert-inbox/"+ids[0]+"/review", "mock-admin-token", "w1", map[string]any{
		"decision": "reject",
	})
	if rr.Code != 400 {
		t.Fatalf("second review should 400, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestExpertInboxReviewRejectsBadDecision(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	ids := seedExpertInbox(t, st, "w1", 1)
	h := server.New(st).Handler()

	rr := inboxPost(t, h, "/api/expert-inbox/"+ids[0]+"/review", "mock-admin-token", "w1", map[string]any{
		"decision": "rubber-stamp",
	})
	if rr.Code != 400 {
		t.Fatalf("bad decision should 400, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestExpertInboxReviewRejectsCrossWorkspace(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	ids := seedExpertInbox(t, st, "w1", 1)
	h := server.New(st).Handler()

	rr := inboxPost(t, h, "/api/expert-inbox/"+ids[0]+"/review", "mock-admin-token", "w2", map[string]any{
		"decision": "approve",
	})
	if rr.Code != 404 {
		t.Fatalf("cross-workspace review should 404, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestExpertInboxRejectsEmptyTitle(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()
	rr := inboxPost(t, h, "/api/expert-inbox", "mock-admin-token", "w1", map[string]any{
		"title": "",
	})
	if rr.Code != 400 {
		t.Fatalf("empty title should 400, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestExpertInboxRejectsBadSeverity(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()
	rr := inboxPost(t, h, "/api/expert-inbox", "mock-admin-token", "w1", map[string]any{
		"title":    "x",
		"severity": "panik",
	})
	if rr.Code != 400 {
		t.Fatalf("bad severity should 400, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestExpertInboxRejectsTraversalInPath(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()
	rr := inboxPost(t, h, "/api/expert-inbox/..%2Fetc%2Fpasswd/review", "mock-admin-token", "w1", map[string]any{
		"decision": "approve",
	})
	if rr.Code != 400 {
		t.Fatalf("traversal in id should 400, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestExpertInboxRejectsNoteTooLong(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	ids := seedExpertInbox(t, st, "w1", 1)
	h := server.New(st).Handler()

	huge := strings.Repeat("a", 1025)
	rr := inboxPost(t, h, "/api/expert-inbox/"+ids[0]+"/review", "mock-admin-token", "w1", map[string]any{
		"decision": "approve",
		"note":     huge,
	})
	if rr.Code != 400 {
		t.Fatalf("oversize note should 400, got %d %s", rr.Code, rr.Body.String())
	}
}

// TestExpertInboxEmitsAuditOnReview verifies that the audit row is
// recorded with action "审核 ExpertInbox 项" and the reviewer name.
func TestExpertInboxEmitsAuditOnReview(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	ids := seedExpertInbox(t, st, "w1", 1)
	h := server.New(st).Handler()

	rr := inboxPost(t, h, "/api/expert-inbox/"+ids[0]+"/review", "mock-admin-token", "w1", map[string]any{
		"decision": "approve",
		"note":     "ok",
	})
	if rr.Code != 200 {
		t.Fatalf("review: %d %s", rr.Code, rr.Body.String())
	}

	st.RLock()
	defer st.RUnlock()
	found := false
	for _, ev := range st.Audits {
		if ev == nil {
			continue
		}
		if strOf(ev["action"]) == "审核 ExpertInbox 项" && strOf(ev["target"]) == ids[0] {
			found = true
			if strOf(ev["actor"]) != "平台管理员" {
				t.Fatalf("audit actor: want 平台管理员, got %v", ev["actor"])
			}
			break
		}
	}
	if !found {
		t.Fatalf("audit row not found; have %d rows", len(st.Audits))
	}
}

// TestExpertInboxMetricGaugeAfterList confirms the gauge publishes the
// pending count after a list call. Per-workspace.
func TestExpertInboxMetricGaugeAfterList(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	seedExpertInbox(t, st, "w1", 4)
	seedExpertInbox(t, st, "w2", 2)
	h := server.New(st).Handler()

	rr := inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w1")
	if rr.Code != 200 {
		t.Fatalf("list w1: %d %s", rr.Code, rr.Body.String())
	}
	if got := metrics.Global.ExpertInbox.Get(); got != 4 {
		t.Fatalf("gauge after w1 list: want 4, got %d", got)
	}

	rr = inboxGet(t, h, "/api/expert-inbox", "mock-admin-token", "w2")
	if rr.Code != 200 {
		t.Fatalf("list w2: %d %s", rr.Code, rr.Body.String())
	}
	if got := metrics.Global.ExpertInbox.Get(); got != 2 {
		t.Fatalf("gauge after w2 list: want 2, got %d", got)
	}
}

// TestExpertInboxConcurrentDecisions: two concurrent reviews on the
// same item must not both succeed (only one wins).
func TestExpertInboxConcurrentDecisions(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	ensureExpertInboxSeeded(st)
	ids := seedExpertInbox(t, st, "w1", 1)
	h := server.New(st).Handler()

	var wins atomic.Int32
	done := make(chan struct{}, 2)
	go func() {
		rr := inboxPost(t, h, "/api/expert-inbox/"+ids[0]+"/review", "mock-admin-token", "w1", map[string]any{
			"decision": "approve",
		})
		if rr.Code == 200 {
			wins.Add(1)
		}
		done <- struct{}{}
	}()
	go func() {
		rr := inboxPost(t, h, "/api/expert-inbox/"+ids[0]+"/review", "mock-admin-token", "w1", map[string]any{
			"decision": "reject",
		})
		if rr.Code == 200 {
			wins.Add(1)
		}
		done <- struct{}{}
	}()
	<-done
	<-done
	if wins.Load() != 1 {
		t.Fatalf("exactly one of two concurrent reviews should win, got %d", wins.Load())
	}
}

func ensureExpertInboxSeeded(s *store.Store) {
	s.Lock()
	defer s.Unlock()
	if s.ExpertInbox == nil {
		s.ExpertInbox = []map[string]any{}
	}
}
