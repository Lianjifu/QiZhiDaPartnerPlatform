package operations_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/operations"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestAckLiveTaskAlertPersists covers the dashboard's "确认" button: the
// frontend acknowledges the live alert whose id is "task-alert-<taskId>".
// The acknowledgement has to resolve against the task-derived alert, land in
// the durable ack collection, and be visible afterwards on both
// /api/home/alerts and HomeExtra.slaAlerts.
func TestAckLiveTaskAlertPersists(t *testing.T) {
	st := store.New()
	st.Lock()
	st.Tasks = []map[string]any{{
		"id": "task-9", "workspaceId": "w1", "code": "T-9", "title": "缓存延迟",
		"status": "review", "priority": "P1", "updatedAt": "2026-11-05T10:00:00Z",
	}}
	st.Unlock()

	persisted := make(chan string, 8)
	st.SetPersistHook(func(_ context.Context, collection string, _ []map[string]any) error {
		persisted <- collection
		return nil
	})

	h := newTestHandler(st)
	h.PersistCollection = func(collection string, items []map[string]any) {
		st.PersistCollection(collection, items)
	}

	// The live alert must be listed with its stable id.
	list := mustAlerts(t, h)
	if len(list) != 1 {
		t.Fatalf("want 1 live alert, got %d", len(list))
	}
	alertID, _ := list[0]["id"].(string)
	if alertID != "task-alert-task-9" {
		t.Fatalf("alert id=%q want task-alert-task-9", alertID)
	}

	// Acknowledge it the way the dashboard does.
	body := bytes.NewBufferString(`{"note":"已通知值班"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/home/alerts/"+alertID+"/acknowledge", body)
	admin := &auth.Identity{ID: "u1", Name: "平台管理员", Role: "admin", WorkspaceID: "w1"}
	req = req.WithContext(auth.WithIdentity(req.Context(), admin))
	ack, err := h.AckAlert(req)
	if err != nil {
		t.Fatalf("AckAlert: %v", err)
	}
	if acknowledged, _ := ack.(map[string]any)["acknowledged"].(bool); !acknowledged {
		t.Fatalf("ack row not acknowledged: %#v", ack)
	}

	// The acknowledgement must reach the durable collection.
	deadline := time.After(3 * time.Second)
	sawAcks := false
	for !sawAcks {
		select {
		case c := <-persisted:
			if c == "home_alert_acks" {
				sawAcks = true
			}
		case <-deadline:
			t.Fatal("acknowledgement was not persisted")
		}
	}

	// Both read surfaces must report the alert as acknowledged.
	after := mustAlerts(t, h)
	if len(after) != 1 {
		t.Fatalf("want 1 alert after ack, got %d", len(after))
	}
	if acknowledged, _ := after[0]["acknowledged"].(bool); !acknowledged {
		t.Fatalf("alert not acknowledged in /api/home/alerts: %#v", after[0])
	}

	extra := mustExtra(t, h)
	sla, _ := extra["slaAlerts"].([]any)
	if len(sla) != 1 {
		t.Fatalf("want 1 slaAlert, got %d", len(sla))
	}
	if acknowledged, _ := sla[0].(map[string]any)["acknowledged"].(bool); !acknowledged {
		t.Fatalf("alert not acknowledged in HomeExtra.slaAlerts: %#v", sla[0])
	}
}

func mustAlerts(t *testing.T, h *operations.Handler) []map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/home/alerts", nil)
	id := &auth.Identity{ID: "u1", Name: "平台管理员", Role: "admin", WorkspaceID: "w1"}
	req = req.WithContext(auth.WithIdentity(req.Context(), id))
	out, err := h.HomeAlerts(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(out)
	var rows []map[string]any
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("alerts payload: %v (%s)", err, raw)
	}
	return rows
}

func mustExtra(t *testing.T, h *operations.Handler) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/home/extra", nil)
	id := &auth.Identity{ID: "u1", Name: "平台管理员", Role: "admin", WorkspaceID: "w1"}
	req = req.WithContext(auth.WithIdentity(req.Context(), id))
	out, err := h.HomeExtra(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(out)
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("extra payload: %v (%s)", err, raw)
	}
	return m
}
