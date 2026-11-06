package operations

import (
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// liveTaskAlerts derives the attention alerts from the live task list.
//
// Both HomeExtra.slaAlerts and GET /api/home/alerts serve these rows, so the
// dashboard, the alert list and the ack endpoint agree on ids and content.
// The alert id is "task-alert-<taskId>" — stable across restarts, which is
// what lets an acknowledgement outlive the process.
//
// Caller must hold the store lock (it reads Store.Tasks / Store.HomeAlertAcks).
func (h *Handler) liveTaskAlerts(ws string) []map[string]any {
	alerts := make([]map[string]any, 0)
	for _, t := range h.Store.Tasks {
		if str(t["workspaceId"]) != ws {
			continue
		}
		st := str(t["status"])
		risk := ""
		if sla, ok := t["sla"].(map[string]any); ok {
			risk = str(sla["risk"])
		}
		prio := str(t["priority"])
		needsAttention := st == "review" || risk == "critical" || risk == "overdue" || risk == "warning" ||
			(prio == "P0" && st != "completed" && st != "archived")
		if !needsAttention {
			continue
		}
		code := str(t["code"])
		title := str(t["title"])
		if title == "" {
			title = code
		}
		level := firstNonEmpty(prio, risk, "P2")
		alerts = append(alerts, map[string]any{
			"id": "task-alert-" + str(t["id"]), "taskId": str(t["id"]),
			"level": level, "text": title, "time": str(t["updatedAt"]),
			"assignee": firstNonEmpty(str(t["digitalPartnerName"]), str(t["assignee"])),
			"taskCode": code, "workspaceId": ws, "source": "task",
		})
	}
	return alerts
}

// alertAckByID indexes the durable acknowledgements by alert id.
// Caller must hold the store lock.
func (h *Handler) alertAckByID() map[string]map[string]any {
	acks := make(map[string]map[string]any, len(h.Store.HomeAlertAcks))
	for _, a := range h.Store.HomeAlertAcks {
		if id := str(a["id"]); id != "" {
			acks[id] = a
		}
	}
	return acks
}

// applyAlertAcks stamps the operator acknowledgement onto the alert rows.
// Caller must hold the store lock.
func (h *Handler) applyAlertAcks(alerts []map[string]any) []map[string]any {
	acks := h.alertAckByID()
	for _, a := range alerts {
		ack, ok := acks[str(a["id"])]
		if !ok {
			continue
		}
		a["acknowledged"] = true
		a["acknowledgedAt"] = ack["acknowledgedAt"]
		a["acknowledgedBy"] = ack["acknowledgedBy"]
		a["acknowledgementNote"] = ack["acknowledgementNote"]
	}
	return alerts
}

// ackAlert resolves an alert id against the live task alerts and the legacy
// seed rows, and records the acknowledgement in the durable ack collection.
//
// The ack — not the alert row — is what gets persisted: alert rows are
// derived from tasks on every read, so storing them would duplicate a
// derived projection.
//
// Caller must hold the store lock. Returns the stored ack row.
func (h *Handler) ackAlert(id *auth.Identity, ws, alertID, note string) (map[string]any, error) {
	level := ""
	known := false
	var legacy map[string]any
	for _, a := range h.liveTaskAlerts(ws) {
		if str(a["id"]) == alertID {
			level = str(a["level"])
			known = true
			break
		}
	}
	if !known {
		for _, a := range h.Store.HomeAlerts {
			if str(a["id"]) != alertID {
				continue
			}
			if str(a["workspaceId"]) != "" && str(a["workspaceId"]) != ws {
				break
			}
			level = firstNonEmpty(str(a["level"]), str(a["severity"]))
			legacy = a
			known = true
			break
		}
	}
	if !known {
		return nil, apperr.NotFoundErr(apperr.HomeAlertNotFound, "告警不存在或不属于当前工作区")
	}
	if level == "P0" && note == "" {
		return nil, apperr.BadReq(apperr.AckNoteRequired, "P0 告警确认必须记录处置说明")
	}
	ack := map[string]any{
		"id": alertID, "workspaceId": ws, "level": level,
		"acknowledged":        true,
		"acknowledgedAt":      time.Now().UTC().Format(time.RFC3339),
		"acknowledgedBy":      id.Name,
		"acknowledgementNote": note,
	}
	replaced := false
	for i, a := range h.Store.HomeAlertAcks {
		if str(a["id"]) == alertID {
			h.Store.HomeAlertAcks[i] = ack
			replaced = true
			break
		}
	}
	if !replaced {
		h.Store.HomeAlertAcks = append(h.Store.HomeAlertAcks, ack)
	}
	if legacy != nil {
		// Seed rows are stored in place, so stamp them too — their state is
		// the row itself rather than the ack collection.
		legacy["acknowledged"] = true
		legacy["acknowledgedAt"] = ack["acknowledgedAt"]
		legacy["acknowledgedBy"] = ack["acknowledgedBy"]
		legacy["acknowledgementNote"] = note
	}
	return ack, nil
}
