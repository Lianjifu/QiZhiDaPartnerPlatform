// Package operations holds the M01 Operations Overview handlers and
// aggregation logic. It mirrors the layout of internal/auth/ — Handler
// is wired with injected dependencies (Store + AuditSink + workspace
// resolver) so the package stays free of server/ imports, ready to
// lift into a standalone service later.
//
// 7 HTTP entry points (see Handler.Routes()):
//
//	GET  /api/home/kpis          → Handler.HomeKPIs      (KPI tile projection)
//	GET  /api/home/extra         → Handler.HomeExtra     (full payload)
//	GET  /api/home/events        → Handler.HomeEvents    (recent activity stream)
//	GET  /api/home/team          → Handler.HomeTeam      (team member list)
//	GET  /api/home/alerts        → Handler.HomeAlerts    (SLA alerts)
//	POST /api/home/alerts/:id/...→ Handler.AckAlert      (admin-only, writes audit)
//	GET  /api/operations/overview→ Handler.OpsOverview   (cross-asset compact view)
//
// KPI / aggregate math (employeeHealthScore, hour bucketing, billing
// lock) lives in aggregate.go / kpis.go / home_extra.go. Audit writes
// for AckAlert go through the injected AuditSink so the operations
// package never touches the audit-pipeline internals directly.
//
// NOTE: The package depends on internal/store (the data layer) but not
// on internal/server (the HTTP/router layer). The Store dependency is
// fine because store/ has no upstream consumer of operations — making
// the operations package a candidate for extraction into a standalone
// `de-ops` microservice later. The would-be microservice would swap
// the *store.Store dependency for a thin adapter that satisfies the
// same field shape (the package never reaches past aggregate collections
// + AppendAudit + Lock/Unlock).
package operations

import (
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// Route describes one HTTP route owned by Handler. Mirrors auth.Route
// so server/ can iterate routes uniformly.
type Route struct {
	Method string
	Path   string
	Handle func(r *http.Request) (any, error)
}

// AuditSink writes an audit row. nil skips the audit write (test / no-audit
// mode). Mirrors auth.AuditWriter — kept as a function type here because
// the operations package only ever fires one kind of audit (alert
// acknowledgement) and a func value is enough.
type AuditSink func(workspaceID, actor, action, target, status, detail string)

// HealthProbe reports optional infra availability. The aggregate's
// `health.postgres` / `health.redis` flags read from this; nil-safe
// (nil reports both false). server/ passes *Server; tests pass nil.
type HealthProbe interface {
	HasPostgres() bool
	HasRedis() bool
}

// WorkspaceIDFn resolves the active workspace for a request. server/
// wires this to (*Server).workspaceID; tests inject a closure that
// returns a constant or reads from the Identity on context.
type WorkspaceIDFn func(r *http.Request) string

// ReplicaRoleFn returns the current replica's role label ("active" or
// "standby"). Optional; nil defaults to "active".
type ReplicaRoleFn func() string

// InstanceIDFn returns the instance identifier embedded in aggregates.
// Optional; nil defaults to "local" (mirrors server.instanceID).
type InstanceIDFn func() string

// Handler holds the HTTP handlers for /api/home/* and
// /api/operations/overview. Wired into server/ at New() time with
// dependencies injected — see NewHandler below.
type Handler struct {
	Store       *store.Store
	AuditSink   AuditSink
	Health      HealthProbe  // optional, nil-safe
	WorkspaceID WorkspaceIDFn
	ReplicaRole ReplicaRoleFn // optional
	InstanceID  InstanceIDFn  // optional
}

// NewHandler builds an operations.Handler with the dependencies wired
// from the calling server. WorkspaceID and Store must be non-nil in
// production; AuditSink / Health / ReplicaRole / InstanceID are
// optional (nil-safe defaults kick in for the role/instance ID).
func NewHandler(st *store.Store, sink AuditSink, ws WorkspaceIDFn) *Handler {
	return &Handler{
		Store:       st,
		AuditSink:   sink,
		WorkspaceID: ws,
	}
}

// Routes returns the public ops routes in registration order. server/
// calls these from its main route switch — Handler does not own an
// http.ServeMux. Path matching mirrors the legacy switch in server.go
// exactly so a missing case here would surface as a 404 regression.
func (h *Handler) Routes() []Route {
	return []Route{
		{Method: http.MethodGet, Path: "/api/home/kpis", Handle: h.HomeKPIs},
		{Method: http.MethodGet, Path: "/api/home/extra", Handle: h.HomeExtra},
		{Method: http.MethodGet, Path: "/api/home/events", Handle: h.HomeEvents},
		{Method: http.MethodGet, Path: "/api/home/team", Handle: h.HomeTeam},
		{Method: http.MethodGet, Path: "/api/home/alerts", Handle: h.HomeAlerts},
		// POST /api/home/alerts/:id/{acknowledge,ack} — same handler, the
		// path suffix is parsed inside AckAlert so both legacy spellings
		// keep working without two route entries.
		{Method: http.MethodPost, Path: "/api/home/alerts/", Handle: h.AckAlert},
		{Method: http.MethodGet, Path: "/api/operations/overview", Handle: h.OpsOverview},
	}
}

// identityFrom pulls the Identity off the request context. Mirrors
// server.identityFrom but goes through auth.IdentityFrom so the
// operations package stays free of server/ imports.
func identityFrom(r *http.Request) *auth.Identity {
	return auth.IdentityFrom(r.Context())
}

// workspaceOf returns the workspace for the current request. Delegates
// to the injected resolver; falls back to "w1" if not configured (so
// unit tests can omit it).
func (h *Handler) workspaceOf(r *http.Request) string {
	if h != nil && h.WorkspaceID != nil {
		if ws := h.WorkspaceID(r); ws != "" {
			return ws
		}
	}
	return "w1"
}

// replicaRoleOf returns the replica role for aggregates. Defaults to
// "active" so test handlers don't need to wire it.
func (h *Handler) replicaRoleOf() string {
	if h != nil && h.ReplicaRole != nil {
		return h.ReplicaRole()
	}
	return "active"
}

// instanceIDOf returns the instance id for aggregates. Mirrors
// server.instanceID — defaults to "local" so test handlers don't need
// to wire it.
func (h *Handler) instanceIDOf() string {
	if h != nil && h.InstanceID != nil {
		return h.InstanceID()
	}
	return "local"
}

// hasPostgres reports whether the backing Postgres pool is wired.
// Nil-safe.
func (h *Handler) hasPostgres() bool {
	if h == nil || h.Health == nil {
		return false
	}
	return h.Health.HasPostgres()
}

// hasRedis reports whether Redis (Cache) is wired and reachable.
// Nil-safe.
func (h *Handler) hasRedis() bool {
	if h == nil || h.Health == nil {
		return false
	}
	return h.Health.HasRedis()
}
