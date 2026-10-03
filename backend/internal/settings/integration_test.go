// M09 P3 integration tests — black-box W1-W12 coverage of the M09
// 平台设置 (Platform Settings) route surface end-to-end. Drives the
// same routes the frontend calls through s.Handler() so the full
// auth / audit / persist / withRecover chain is exercised, mirroring
// the M06 P3 W1-W15 + M07 P3 W1-W15 + M08 P3 W1-W15 patterns.
package settings_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// harness builds a Server with the production wiring (settingsSvc
// bound, full auth/audit/persist chain) and exposes the http.Handler
// plus the backing store for assertions.
type harness struct {
	srv *server.Server
	h   http.Handler
	st  *store.Store
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	st := store.New()
	srv := server.New(st)
	return &harness{srv: srv, h: srv.Handler(), st: st}
}

// doJSON runs a request through the harness with the given token and
// workspace. token "" leaves Authorization empty (forces unauth path).
func (hs *harness) doJSON(t *testing.T, method, path, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	var bodyR io.Reader
	if body != "" {
		bodyR = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyR)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("X-Workspace-Id", "w1")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	hs.h.ServeHTTP(rr, req)
	return rr
}

// parseData unmarshals the {"data": <T>} envelope into T.
func parseData(t *testing.T, body []byte, into any) {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v body=%s", err, string(body))
	}
	if err := json.Unmarshal(env.Data, into); err != nil {
		t.Fatalf("unmarshal data: %v body=%s", err, string(env.Data))
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	}
	return 0
}

func strAny(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return ""
	}
}

// --- W1-W12 black-box coverage ---

// W1: GET /api/billing requires billing.read (admin token carries it).
// Returns the seeded billing snapshot unchanged.
func TestW1GetBilling(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodGet, "/api/billing", "", "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	parseData(t, rr.Body.Bytes(), &got)
	if strAny(got["plan"]) == "" {
		t.Fatalf("missing plan in %#v", got)
	}
	if strAny(got["workspaceId"]) != "w1" {
		t.Fatalf("workspaceId=%v want w1", got["workspaceId"])
	}
}

// W2: GET /api/billing/quota returns usage / quota / progress shape
// with tokens and usd ratios pre-computed.
func TestW2GetBillingQuota(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodGet, "/api/billing/quota", "", "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	parseData(t, rr.Body.Bytes(), &got)
	if got["usage"] == nil || got["quota"] == nil || got["progress"] == nil {
		t.Fatalf("missing usage/quota/progress in %#v", got)
	}
	progress, _ := got["progress"].(map[string]any)
	if progress["tokens"] == nil || progress["usd"] == nil {
		t.Fatalf("missing tokens/usd in progress=%#v", progress)
	}
}

// W3: GET /api/tenant/profile — when the store has no TenantProfile
// seeded, returns the default ACME Corp snapshot.
func TestW3GetTenantProfileDefault(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodGet, "/api/tenant/profile", "", "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	parseData(t, rr.Body.Bytes(), &got)
	if strAny(got["name"]) != "ACME Corp" {
		t.Fatalf("name=%v want ACME Corp", got["name"])
	}
}

// W3b: GET /api/tenant/profile after PATCH reflects the update.
func TestW3GetTenantProfileAfterPatch(t *testing.T) {
	hs := newHarness(t)
	patch := hs.doJSON(t, http.MethodPatch, "/api/tenant/profile", `{"name":"ACME Staging","region":"cn-north-1"}`, "mock-admin-token")
	if patch.Code != 200 {
		t.Fatalf("patch %d body=%s", patch.Code, patch.Body.String())
	}
	rr := hs.doJSON(t, http.MethodGet, "/api/tenant/profile", "", "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("get %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	parseData(t, rr.Body.Bytes(), &got)
	if strAny(got["name"]) != "ACME Staging" {
		t.Fatalf("name=%v want ACME Staging", got["name"])
	}
	if strAny(got["region"]) != "cn-north-1" {
		t.Fatalf("region=%v want cn-north-1", got["region"])
	}
	if strAny(got["updatedBy"]) == "" {
		t.Fatalf("updatedBy not stamped: %#v", got)
	}
}

// W4: PATCH /api/tenant/profile is admin-gated. Non-admin gets 403.
func TestW4PatchTenantProfileAdminOnly(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodPatch, "/api/tenant/profile", `{"name":"hacked"}`, "mock-user-token")
	if rr.Code/100 != 4 {
		t.Fatalf("expected 4xx, got %d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_ADMIN_REQUIRED") {
		t.Fatalf("expected E_ADMIN_REQUIRED, got %s", rr.Body.String())
	}
}

// W5: GET /api/notification-channels returns the seeded channels.
func TestW5ListNotificationChannels(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodGet, "/api/notification-channels", "", "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var rows []map[string]any
	parseData(t, rr.Body.Bytes(), &rows)
	if len(rows) != 1 || strAny(rows[0]["id"]) != "nc-1" {
		t.Fatalf("expected seed [nc-1], got %#v", rows)
	}
}

// W6: PATCH /api/notification-channels/nc-1 flips enabled + renames.
func TestW6PatchNotificationChannel(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodPatch, "/api/notification-channels/nc-1",
		`{"enabled":false,"name":"飞书值守(夜间)"}`, "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	parseData(t, rr.Body.Bytes(), &got)
	if got["enabled"] != false {
		t.Fatalf("enabled=%v want false", got["enabled"])
	}
	if strAny(got["name"]) != "飞书值守(夜间)" {
		t.Fatalf("name=%v want 飞书值守(夜间)", got["name"])
	}
	// Confirm persistence: re-list and see the change reflected.
	list := hs.doJSON(t, http.MethodGet, "/api/notification-channels", "", "mock-admin-token")
	var rows []map[string]any
	parseData(t, list.Body.Bytes(), &rows)
	if rows[0]["enabled"] != false {
		t.Fatalf("persisted enabled=%v want false", rows[0]["enabled"])
	}
}

// W7: PATCH on a non-existent channel returns 404.
func TestW7PatchNotificationChannelNotFound(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodPatch, "/api/notification-channels/nc-missing",
		`{"enabled":true}`, "mock-admin-token")
	if rr.Code != 404 {
		t.Fatalf("expected 404, got %d body=%s", rr.Code, rr.Body.String())
	}
}

// W8: GET /api/api-keys and /api/webhooks-config return their seeds.
func TestW8ListAPIKeysAndWebhooks(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodGet, "/api/api-keys", "", "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("api-keys %d body=%s", rr.Code, rr.Body.String())
	}
	var keys []map[string]any
	parseData(t, rr.Body.Bytes(), &keys)
	if len(keys) != 1 || strAny(keys[0]["id"]) != "key-1" {
		t.Fatalf("expected seed [key-1], got %#v", keys)
	}

	rr = hs.doJSON(t, http.MethodGet, "/api/webhooks-config", "", "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("webhooks-config %d body=%s", rr.Code, rr.Body.String())
	}
	var hooks []map[string]any
	parseData(t, rr.Body.Bytes(), &hooks)
	if len(hooks) != 1 || strAny(hooks[0]["id"]) != "wh-1" {
		t.Fatalf("expected seed [wh-1], got %#v", hooks)
	}
}

// W9: GET /api/backups is admin/auditor gated. Plain user gets 403,
// admin sees the seeded bk-1.
func TestW9ListBackupsAuthorization(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodGet, "/api/backups", "", "mock-user-token")
	if rr.Code/100 != 4 {
		t.Fatalf("expected 4xx for plain user, got %d body=%s", rr.Code, rr.Body.String())
	}
	rr = hs.doJSON(t, http.MethodGet, "/api/backups", "", "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("admin %d body=%s", rr.Code, rr.Body.String())
	}
	var rows []map[string]any
	parseData(t, rr.Body.Bytes(), &rows)
	if len(rows) != 1 || strAny(rows[0]["id"]) != "bk-1" {
		t.Fatalf("expected seed [bk-1], got %#v", rows)
	}
}

// W10: POST /api/backups creates a pending_approval backup + audit row.
func TestW10RequestBackup(t *testing.T) {
	hs := newHarness(t)
	auditBefore := len(hs.st.Audits)
	rr := hs.doJSON(t, http.MethodPost, "/api/backups", `{"scope":"incremental"}`, "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	parseData(t, rr.Body.Bytes(), &got)
	if strAny(got["status"]) != "pending_approval" {
		t.Fatalf("status=%v want pending_approval", got["status"])
	}
	if strAny(got["scope"]) != "incremental" {
		t.Fatalf("scope=%v want incremental", got["scope"])
	}
	if strAny(got["id"]) == "" {
		t.Fatalf("missing id in %#v", got)
	}
	if len(hs.st.Audits) <= auditBefore {
		t.Fatalf("expected new audit row, before=%d after=%d", auditBefore, len(hs.st.Audits))
	}
	if strAny(hs.st.Audits[0]["action"]) != "申请备份" {
		t.Fatalf("audit action=%v want 申请备份", hs.st.Audits[0]["action"])
	}
}

// W11: POST /api/backups/{id}/approve flips status to approved + stamps
// approvedBy. To exercise the success path past SoD we seed a backup
// whose requestedBy is *not* the current admin.
func TestW11ApproveBackup(t *testing.T) {
	hs := newHarness(t)
	// Seed: a backup request from a different admin so the SoD gate
	// (approver must not equal requester) passes.
	hs.st.Lock()
	hs.st.Backups = append(hs.st.Backups, map[string]any{
		"id": "bk-2", "workspaceId": "w1",
		"status": "pending_approval", "requestedBy": "其他管理员",
		"requestedAt": "2026-07-22T07:00:00Z", "scope": "full",
	})
	hs.st.Unlock()

	rr := hs.doJSON(t, http.MethodPost, "/api/backups/bk-2/approve", `{}`, "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	parseData(t, rr.Body.Bytes(), &got)
	if strAny(got["status"]) != "approved" {
		t.Fatalf("status=%v want approved", got["status"])
	}
	if strAny(got["approvedBy"]) == "" {
		t.Fatalf("approvedBy not stamped: %#v", got)
	}
}

// W11b: Approve a non-existent backup → 404.
func TestW11ApproveBackupNotFound(t *testing.T) {
	hs := newHarness(t)
	rr := hs.doJSON(t, http.MethodPost, "/api/backups/bk-missing/approve", `{}`, "mock-admin-token")
	if rr.Code != 404 {
		t.Fatalf("expected 404, got %d body=%s", rr.Code, rr.Body.String())
	}
}

// W12: POST /api/backups/{id}/restore-drill requires status=approved.
// (a) unapproved backup → 4xx
// (b) approved backup → 200 status=drill_passed + lastDrillAt stamp
func TestW12RestoreDrillRequiresApproved(t *testing.T) {
	hs := newHarness(t)
	// Seed an unapproved backup.
	hs.st.Lock()
	hs.st.Backups = append(hs.st.Backups, map[string]any{
		"id": "bk-pending", "workspaceId": "w1",
		"status": "pending_approval", "requestedBy": "其他管理员",
		"requestedAt": "2026-07-22T07:00:00Z", "scope": "full",
	})
	// Seed an approved backup (owned by other admin so SoD passes).
	hs.st.Backups = append(hs.st.Backups, map[string]any{
		"id": "bk-ready", "workspaceId": "w1",
		"status": "approved", "requestedBy": "其他管理员",
		"approvedBy": "其他管理员", "approvedAt": "2026-07-22T08:00:00Z",
		"scope": "full",
	})
	hs.st.Unlock()

	// (a) pending → rejected
	rr := hs.doJSON(t, http.MethodPost, "/api/backups/bk-pending/restore-drill", `{}`, "mock-admin-token")
	if rr.Code/100 != 4 {
		t.Fatalf("expected 4xx for pending, got %d body=%s", rr.Code, rr.Body.String())
	}
	// (b) approved → drill_passed
	rr = hs.doJSON(t, http.MethodPost, "/api/backups/bk-ready/restore-drill", `{}`, "mock-admin-token")
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	parseData(t, rr.Body.Bytes(), &got)
	if strAny(got["status"]) != "drill_passed" {
		t.Fatalf("status=%v want drill_passed", got["status"])
	}
	if strAny(got["lastDrillBy"]) == "" {
		t.Fatalf("lastDrillBy not stamped: %#v", got)
	}
}
