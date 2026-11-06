package operations

import (
	"encoding/json"
	"net/http"
	"strings"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// HomeKPIs is the HTTP entry point for GET /api/home/kpis. Thin
// wrapper around homeKPIsLive; kept as its own method so the route
// table in Handler.Routes() stays declarative (server/ doesn't have
// to know which aggregate function backs each path).
func (h *Handler) HomeKPIs(r *http.Request) (any, error) {
	return h.homeKPIsLive(r)
}

// HomeExtra is the HTTP entry point for GET /api/home/extra.
func (h *Handler) HomeExtra(r *http.Request) (any, error) {
	return h.homeExtraLive(r)
}

// HomeEvents returns the recent activity stream. Pulls from the demo
// seed in Store.HomeExtra["recentActivities"] — live re-computation of
// the activity timeline lives in HomeExtra; HomeEvents is the cheap
// endpoint used by the Home page's sidebar ticker.
func (h *Handler) HomeEvents(r *http.Request) (any, error) {
	h.Store.RLock()
	defer h.Store.RUnlock()
	if acts, ok := h.Store.HomeExtra["recentActivities"]; ok {
		return acts, nil
	}
	return []any{}, nil
}

// HomeTeam returns the team-member list. Pulls from the demo seed in
// Store.HomeExtra["teamMembers"] — the live roster projection lives
// in liveTeamMembersLocked and is consumed by HomeExtra directly.
func (h *Handler) HomeTeam(r *http.Request) (any, error) {
	h.Store.RLock()
	defer h.Store.RUnlock()
	if team, ok := h.Store.HomeExtra["teamMembers"]; ok {
		return team, nil
	}
	return []any{}, nil
}

// HomeAlerts returns the attention alerts for the caller's workspace.
//
// The rows are the same ones HomeExtra.slaAlerts serves (task-derived, id
// "task-alert-<taskId>") plus the legacy seed rows, with operator
// acknowledgements stamped on. The acknowledgement itself lives in the
// durable "home_alert_acks" collection — the alert rows are derived, so
// persisting them would duplicate a projection.
func (h *Handler) HomeAlerts(r *http.Request) (any, error) {
	ws := h.workspaceOf(r)
	h.Store.RLock()
	defer h.Store.RUnlock()
	out := h.liveTaskAlerts(ws)
	for _, a := range h.Store.HomeAlerts {
		if str(a["workspaceId"]) == ws || str(a["workspaceId"]) == "" {
			out = append(out, a)
		}
	}
	return h.applyAlertAcks(out), nil
}

// AckAlert is the HTTP entry point for POST /api/home/alerts/:id/{ack,acknowledge}.
// Behavior contract (must NOT change without updating the audit /
// frontend pipeline):
//
//   - Admin-only. User / auditor → 403 "仅管理员可确认运营告警".
//   - P0 alerts require a non-empty `note` in the JSON body; missing →
//     400 "P0 告警确认必须记录处置说明".
//   - On success: records the acknowledgement in the durable ack collection
//     (acknowledged / acknowledgedAt / acknowledgedBy / acknowledgementNote)
//     and writes an audit row with action="确认运营告警" via the injected
//     AuditSink. The audit row stays byte-identical with the legacy
//     server.ackAlert text so the audit-center UI keeps working.
func (h *Handler) AckAlert(r *http.Request) (any, error) {
	id := identityFrom(r)
	if id == nil || id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "仅管理员可确认运营告警")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/home/alerts/:id/acknowledge|ack
	if len(parts) < 5 {
		return nil, apperr.NotFoundErr(apperr.HomeAlertNotFound, "告警不存在")
	}
	aid := parts[3]
	body, _ := decodeBodyMap(r)
	note := strings.TrimSpace(str(body["note"]))
	ws := h.workspaceOf(r)

	h.Store.Lock()
	ack, err := h.ackAlert(id, ws, aid, note)
	acks := h.Store.HomeAlertAcks
	h.Store.Unlock()
	if err != nil {
		return nil, err
	}
	if h.PersistCollection != nil {
		h.PersistCollection("home_alert_acks", acks)
	}
	if h.AuditSink != nil {
		h.AuditSink(ws, id.Name, "确认运营告警", aid, "success", note)
	}
	return ack, nil
}

// OpsOverview is the HTTP entry point for GET /api/operations/overview.
func (h *Handler) OpsOverview(r *http.Request) (any, error) {
	return h.opsOverviewLive(r)
}

// decodeBodyMap is a thin wrapper around json.NewDecoder so a missing
// or empty request body doesn't fail — returns an empty map instead.
// Mirrors the legacy server.decodeMap helper used by ackAlert so the
// behavior (note="" for empty bodies) is preserved.
func decodeBodyMap(r *http.Request) (map[string]any, error) {
	if r.Body == nil {
		return map[string]any{}, nil
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return map[string]any{}, nil
	}
	return body, nil
}
