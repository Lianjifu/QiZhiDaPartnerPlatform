package operations

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

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

// HomeAlerts returns the alert list filtered to the caller's
// workspace (or workspace-agnostic alerts with empty workspaceId).
// Note: this is the *seed* alert list; the live attention alerts are
// embedded in HomeExtra.slaAlerts (task-derived). AckAlert mutates
// this collection, so the operations package needs write access here
// even though the rest of the package is read-mostly.
func (h *Handler) HomeAlerts(r *http.Request) (any, error) {
	ws := h.workspaceOf(r)
	h.Store.RLock()
	defer h.Store.RUnlock()
	var out []map[string]any
	for _, a := range h.Store.HomeAlerts {
		if str(a["workspaceId"]) == ws || str(a["workspaceId"]) == "" {
			out = append(out, a)
		}
	}
	return out, nil
}

// AckAlert is the HTTP entry point for POST /api/home/alerts/:id/{ack,acknowledge}.
// Behavior contract (must NOT change without updating the audit /
// frontend pipeline):
//
//   - Admin-only. User / auditor → 403 "仅管理员可确认运营告警".
//   - P0 alerts require a non-empty `note` in the JSON body; missing →
//     400 "P0 告警确认必须记录处置说明".
//   - On success: stamps acknowledged / acknowledgedAt / acknowledgedBy /
//     acknowledgementNote on the alert row and writes an audit row with
//     action="确认运营告警" via the injected AuditSink. The audit row
//     stays byte-identical with the legacy server.ackAlert text so the
//     audit-center UI keeps working without changes.
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
	h.Store.Lock()
	defer h.Store.Unlock()
	for _, a := range h.Store.HomeAlerts {
		if str(a["id"]) != aid {
			continue
		}
		if str(a["level"]) == "P0" && note == "" {
			return nil, apperr.BadReq(apperr.AckNoteRequired, "P0 告警确认必须记录处置说明")
		}
		a["acknowledged"] = true
		a["acknowledgedAt"] = time.Now().UTC().Format(time.RFC3339)
		a["acknowledgedBy"] = id.Name
		a["acknowledgementNote"] = note
		if h.AuditSink != nil {
			h.AuditSink(h.workspaceOf(r), id.Name, "确认运营告警", aid, "success", note)
		}
		return a, nil
	}
	return nil, apperr.NotFoundErr(apperr.HomeAlertNotFound, "告警不存在或不属于当前工作区")
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
