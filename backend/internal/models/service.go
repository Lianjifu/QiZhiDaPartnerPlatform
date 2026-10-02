// Package models is the M08 模型中心 (Model Center) module — the HTTP-route
// façade that owns provider CRUD, governance/overview, routing policy validation
// and failover drills, the audit log, model invocation (sync + SSE), and the
// Copilot LLM streaming bridge consumed by the M02 expert-collaboration module.
//
// Prior to M08 P2 all M08 handlers lived in internal/server/ as `(s *Server)`
// receiver methods across handlers_models.go (provider CRUD + governance +
// audit), model_invoke.go (resolve → stream → trace → Copilot bridge +
// split-hop Cap path), model_helpers.go (vault/credential/budget/probe helpers),
// and the M08 segment of handlers_c.go L75-139 (listModelRoutes,
// createModelRoute, listModelBudgets, listUsage legacy/FE path aliases).
//
// Phase 2 of the M08 模型中心整合方案
// (docs/整合方案/模型中心模块整合方案.md §3.2 + §四 D2-D7) extracts that M08
// code into internal/models/ with the same function-value façade pattern that
// M02 copilot, M03 tasks, M05 partners, and M06 workflows use:
//
//   - Service struct holds Store + Vault + Cache + ModelProbe + TraceRecorder.
//   - Deps holds ~15 cross-package server-only helpers (workspace, identity,
//     decodeMap, evaluateWrite, governance gates, audit sink, rate limit,
//     metrics, mode detection, cap-base copy).
//   - NewService(store, deps) constructs the façade.
//   - Route dispatch goes through `s.modelSvc.<Method>(r)` in server.go.
//
// The cross-module wiring of StreamLLMForCopilotFn (the bridge consumed by the
// M02 copilot module) is signature-compatible with the historical
// `*Server.streamLLMForCopilot`: the type is declared in internal/copilot/
// (consumer-owned) and the implementation lives in this package as
// (s *Service).StreamLLMForCopilot. Server.go binds the method value into
// copilot.Deps.StreamLLMForCopilotFn at boot. Result: internal/models →
// internal/copilot (one-way) — no cycle.
//
// The package boundary stays one-way: internal/models never imports
// internal/server/ (it MAY import internal/copilot for ResolvedTurn).
package models

import (
	"context"
	"net/http"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/infra"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/modelprov/trace"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
)

// Deps groups the cross-package *Server methods the M08 模型中心 module
// depends on. server.New() constructs the Service once and passes function
// values bound to its own *Server methods. The package boundary stays
// one-way: internal/models/ never imports internal/server/.
//
// All fields are required for production callers (Server.New wires them
// all). Tests can leave any subset nil and nil-check at the call site (each
// M08 handler does `s.<Field>` lookups before calling).
type Deps struct {
	// Workspace / identity / access gating — every M08 handler.
	WorkspaceID  func(r *http.Request) string
	IdentityFrom func(ctx context.Context) *auth.Identity

	// Body parsing — used by every create / patch / publish / invoke handler.
	DecodeMap func(r *http.Request) (map[string]any, error)

	// Policy evaluation — create / disable / delete / publish / failover-test.
	EvaluateWrite func(r *http.Request, resource, action string, extra policy.Input) error

	// Governance / dual approval — publish / unpublish / rollback.
	RequiresPeerApprovalGate   func(actor *auth.Identity) bool
	RequireProductionDualApproval func(submitterID, submitterName string, actor *auth.Identity, verb string) error
	MaybeHoldForCountersign    func(entity map[string]any, actor *auth.Identity, risk, verb string) (bool, error)
	ProductionLikeEnv          func() bool

	// Audit sink — used by every mutation (provider / model / route / invoke).
	AppendAudit func(workspaceID, actor, action, target, result, reason string)

	// Rate limit (cache backend) — discover / test-connection / failover-test.
	// When nil, Service.allowModelRate falls back to an in-process sliding
	// window map (kept inside the package; safe for tests + dev).
	AllowRate func(ctx context.Context, key string, limit int64, window time.Duration) (bool, error)

	// Metrics — model vault errors / probe outcomes / policy publish / budget denies.
	IncModelVaultError   func()
	IncModelProbe        func(ok bool, latencyMS int64)
	IncModelPolicyPublish func()
	IncModelBudgetDeny   func()

	// Mode detection for streamLLMForCopilot split topology — Cap hop on
	// Collab mode, local on All/unified.
	IsCollabMode func() bool
	CapBaseURL   func() string

	// VaultFn returns the current credential vault. Late-bound callback
	// (rather than a captured *vault.Client field on Service) so tests
	// that swap srv.Vault after New() still see their override. nil →
	// "no vault available, fall back to local model_secrets" (dev /
	// LaunchAgent path).
	VaultFn func() *vault.Client
}

// Service is the M08 模型中心 (Model Center) HTTP-route façade. All 17 REST
// routes + the SSE stream + the Copilot bridge bind to methods on this
// struct. Constructed once via NewService; the route table in server.go
// dispatches M08 paths through s.modelSvc.<Method>.
type Service struct {
	Deps

	// Store is the in-memory store backing every read/write the M08
	// handlers perform. Required.
	Store *store.Store

	// Vault is the credential storage for provider secrets. Optional; nil
	// means "local model_secrets only" (dev / LaunchAgent).
	Vault *vault.Client

	// Cache is the optional rate-limit cache. Optional; nil means "use the
	// in-process sliding window only". Tests can leave nil.
	Cache *infra.Cache

	// ModelProbe is the singleton HTTP probe client (provider connectivity
	// + discover). Lazily created on first call; nil is safe (modelProbe()
	// initializes on demand).
	ModelProbe *modelprov.Client

	// TraceRecorder captures per-invocation trace events for the M7
	// observability tail. Nil-safe (recordTrace no-ops when nil).
	TraceRecorder *trace.Recorder

	// UsageSink is the optional M7 usage-meters sink for /api/usage.
	// Nil falls back to the in-store UsageMeters slice (legacy behaviour).
	UsageSink *infra.UsageSink
}

// NewService builds a Service. store is required for the M08 module to do
// real work; deps may be partial for tests that exercise only one isolated
// handler (e.g. validateRoutingPolicyLocked). vault/cache/probe/recorder are
// optional and nil-checked at the call site.
func NewService(store *store.Store, deps Deps) *Service {
	return &Service{
		Store:         store,
		Deps:          deps,
	}
}

// currentVault returns the late-bound credential vault, preferring the
// Deps.VaultFn callback (so tests / runtime can swap srv.Vault after
// construction) and falling back to the static Vault field set by tests
// that don't use Deps.VaultFn. Returns nil when no vault is wired.
func (s *Service) currentVault() *vault.Client {
	if s == nil {
		return nil
	}
	if s.VaultFn != nil {
		return s.VaultFn()
	}
	return s.Vault
}

// StreamLLMForCopilotFn is a re-export of the copilot-side type so callers
// inside this package (e.g. the buildCopSvc adapter in server.go) can refer
// to it without an extra `import` line.
type StreamLLMForCopilotFn = copilot.StreamLLMForCopilotFn

// ResolvedTurn is a re-export of the copilot-side type so the rest of this
// package can use the canonical name without bouncing through `copilot.X` at
// every call site.
type ResolvedTurn = copilot.ResolvedTurn