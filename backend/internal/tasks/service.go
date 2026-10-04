// Package tasks is the M03 任务中心 (Task Center) module — pure domain
// helpers + the HTTP-route façade that owns the 4 M03 routes (list /
// create / catch-all / conversation-derived cross-module entry).
//
// History: the legacy `task_*.go` files lived in internal/server/ as
// unexported helpers + (s *Server) receiver methods. Phase 2 of the M03
// 任务中心整合方案 (docs/整合方案/任务中心模块整合方案.md) split the 546L
// task_domain.go into two domain files (≤400L each, per the W4-A-收 file
// size gate) and exposed a typed façade (Service) so the parent server
// can dispatch the 4 M03 routes through a single struct field.
//
// Phase 3 (this commit) finishes the move: the 4 HTTP handlers + their
// helpers now live on *Service in handlers_*.go. server.go retains the
// route table + Deps wiring only; nothing in internal/tasks imports
// internal/server.
//
// Service is wired by server.New() with the parent Server's *store.Store
// and Deps function fields (workspaceID, identityFrom,
// requireWorkspaceAccess, decodeMap, evaluateWriteLocked,
// IngestRuntimeMemoryLocked, persistMemory, and the IncTask* metrics).
// The package boundary stays one-way: internal/tasks never imports
// internal/server/, so future qzda-tasks microservice extraction has a
// single seam (the Deps function fields become RPC calls).
//
// Lifecycle: 6 stages — pending / running / human_action / risk /
// completed / archived — with FSM edges in LifecycleEdges. Audit +
// version + visibility semantics are preserved byte-for-byte from the
// pre-move server/task_domain.go.
package tasks

import (
	"context"
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// Deps groups the cross-package *Server methods the M03 任务中心
// module depends on. server.New() constructs the Service once and
// passes method values bound to its own *Server methods (the standard
// partners/copilot pattern). The package boundary stays one-way:
// internal/tasks/ never imports internal/server/.
//
// Required fields for production (Server.New wires all of them):
//   - IdentityFrom, WorkspaceID, RequireWorkspaceAccess — every handler
//   - DecodeMap — CreateTask / TaskRoute / ConversationCreateTask
//   - EvaluateWriteLocked — TaskRoute (approve branch)
//   - IngestRuntimeMemoryLocked, PersistMemory — TaskRoute (working-
//     memory side effect on completed/review)
//
// Metrics fields (IncTask*) are nil-tolerant so partial-Service tests
// don't have to wire them.
type Deps struct {
	// Workspace / identity / access gating — every handler.
	IdentityFrom           func(ctx context.Context) *auth.Identity
	WorkspaceID            func(r *http.Request) string
	RequireWorkspaceAccess func(id *auth.Identity, ws string) error

	// Body parsing — CreateTask / TaskRoute / ConversationCreateTask.
	DecodeMap func(r *http.Request) (map[string]any, error)

	// Policy evaluation — TaskRoute "approve" sub-action.
	EvaluateWriteLocked func(r *http.Request, kind, action string, in policy.Input) error

	// Metrics — called after successful mutations. Nil-safe.
	IncTaskCreated    func()
	IncTaskTransition func()
	IncTaskApprove    func(approved bool)
	IncTaskTakeover   func()
	IncTaskRetry      func()

	// Working-memory side effect — TaskRoute "transition" completed/review
	// + the legacy start/review/complete catch-all. IngestRuntimeMemoryLocked
	// MUST be called under Store.Lock (the server-side adapter preserves
	// that contract). PersistMemory runs in a goroutine after the lock is
	// released.
	IngestRuntimeMemoryLocked func(in RuntimeMemoryInput) (map[string]any, error)
	PersistMemory             func()
}

// Service is the M03 任务中心 (Task Center) HTTP handler + domain helper
// owner. All 4 REST routes bind to methods on this struct. Constructed
// once via NewService(store, deps); the route table in server.go
// dispatches M03 paths through s.taskSvc.<Method>.
type Service struct {
	Deps

	// Store is the in-memory store backing every read/write the task
	// handlers perform. Required.
	Store *store.Store
}

// NewService builds a Service. store is required for the M03 module to
// do real work; deps may be partial for tests that exercise only the
// pure-domain helpers (BuildControlledTask / ApplyLifecycleTransition
// etc.).
func NewService(store *store.Store, deps Deps) *Service {
	return &Service{
		Store: store,
		Deps:  deps,
	}
}

// --- 4 REST route entry points ---
// Field naming mirrors the legacy *Server method names exactly so the
// route switch reads "s.taskSvc.ListTasks(r)" the same way the legacy
// "s.listTasks(r)" (via listTasksAligned wrapper) read.

// ListTasks → GET /api/tasks
func (s *Service) ListTasks(r *http.Request) (any, error) {
	return s.listTasks(r)
}

// CreateTask → POST /api/tasks
func (s *Service) CreateTask(r *http.Request) (any, error) {
	return s.createTask(r)
}

// TaskRoute → GET/PATCH/POST /api/tasks/:id[/...]
func (s *Service) TaskRoute(r *http.Request) (any, error) {
	return s.taskRoute(r)
}

// ConversationCreateTask → POST /api/conversations/:id/tasks
// (M02 → M03 cross-module entry point)
func (s *Service) ConversationCreateTask(r *http.Request) (any, error) {
	return s.conversationCreateTask(r)
}

func (s *Service) ListScheduledTasks(r *http.Request) (any, error) {
	return s.listScheduledTasks(r)
}

func (s *Service) CreateScheduledTask(r *http.Request) (any, error) {
	return s.createScheduledTask(r)
}

func (s *Service) ScheduledTaskRoute(r *http.Request) (any, error) {
	return s.scheduledTaskRoute(r)
}
