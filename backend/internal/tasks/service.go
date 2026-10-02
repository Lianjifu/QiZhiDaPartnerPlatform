// Package tasks is the M03 任务中心 (Task Center) module — pure domain
// helpers + the HTTP-route façade that binds the parent *server.Server's
// task handlers.
//
// History: the legacy `task_*.go` files lived in internal/server/ as
// unexported helpers + (s *Server) receiver methods. Phase 2 of the M03
// 任务中心整合方案 (docs/整合方案/任务中心模块整合方案.md) splits the 546L
// task_domain.go into two domain files (≤400L each, per the W4-A-收 file
// size gate) and exposes a typed façade (Service) so the parent server
// can dispatch the 4 M03 routes through a single struct field.
//
// Service is wired by server.New() with method values bound to *Server
// methods. The package boundary stays one-way: internal/tasks never
// imports internal/server/, so future qzda-tasks microservice extraction
// has a single seam (the Deps function fields become RPC calls).
//
// Lifecycle: 6 stages — pending / running / human_action / risk /
// completed / archived — with FSM edges in lifecycleEdges. Audit +
// version + visibility semantics are preserved byte-for-byte from the
// pre-move server/task_domain.go.
package tasks

import "net/http"

// Service holds the 4 M03 HTTP-route entry points as function-value
// fields. server.New() populates them with method values bound to
// *Server methods; the route switch then dispatches the 4 M03 paths
// through this struct so the package boundary stays real (internal/tasks
// never imports internal/server/).
//
// Field naming matches the *Server method names exactly so dispatch
// sites read "s.taskSvc.ListTasksAligned(r)" the same way the legacy
// "s.listTasksAligned(r)" read.
type Service struct {
	// 4 JSON routes — return (any, error) for the response envelope.
	ListTasksAligned       func(r *http.Request) (any, error)
	CreateTaskAligned      func(r *http.Request) (any, error)
	TaskRoute              func(r *http.Request) (any, error)
	ConversationCreateTask func(r *http.Request) (any, error)
}

// Deps groups the cross-package *Server methods the M03 tasks module
// exposes via the Service façade. server.New() builds a *Service and
// passes method values bound to its own *Server methods.
//
// All fields are required for production callers (Server.New wires
// them all). Defensive code at the route table falls back to the
// legacy receiver methods when s.taskSvc is nil (matches the
// copH / opsH precedent — never happens in production, only matters
// for early-boot tests).
type Deps struct {
	ListTasksAligned       func(r *http.Request) (any, error)
	CreateTaskAligned      func(r *http.Request) (any, error)
	TaskRoute              func(r *http.Request) (any, error)
	ConversationCreateTask func(r *http.Request) (any, error)
}

// NewService builds a Service from the supplied Deps. The 4 function
// fields are copied verbatim so the caller can mutate Deps after
// construction without affecting the live Service.
func NewService(d Deps) *Service {
	return &Service{
		ListTasksAligned:       d.ListTasksAligned,
		CreateTaskAligned:      d.CreateTaskAligned,
		TaskRoute:              d.TaskRoute,
		ConversationCreateTask: d.ConversationCreateTask,
	}
}
