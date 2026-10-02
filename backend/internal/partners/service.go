// Package partners is the M05 数字伙伴 (Digital Partner) module — the
// HTTP-route façade that owns employee lifecycle, template adoption,
// capability catalog, configuration-version approval, and the partner
// Connect-RPC binding.
//
// History: prior to M05 P2, all M05 handlers lived in internal/server/
// as `(s *Server)` receiver methods across handlers_contract.go,
// handlers_b.go, handlers_capability_catalog.go, and connect_services.go.
// The package boundary was implicit. Phase 2 of the M05 数字伙伴整合方案
// (docs/整合方案/数字伙伴模块整合方案.md) extracts the M05 code into
// internal/partners/ with the same function-value façade pattern that
// M02 copilot and M03 tasks use.
//
// Service is constructed once at server boot via NewService(store, deps).
// It carries the M05 dependencies directly: Store, plus a Deps struct
// of cross-package function fields for the server-only helpers the M05
// handlers need (workspace resolution, identity, validation, dual-approval,
// employee runtime projection, capability catalog fetch, etc.).
//
// Using function fields instead of an interface:
//   - Keeps Service free of any internal/server/ import (no cycle risk)
//   - Lets tests inject stubs selectively — set only the deps you exercise
//   - Avoids the breadth of an interface with ~30 methods when callers
//     want one field each
//
// The route table in server.go dispatches the 11 M05 paths through
// s.partnerSvc.<Method>(r). The M02 copilot module's Deps in turn
// holds function values for ListEmployees / ListEmployeeTemplates /
// AdoptTemplate so the cross-module wiring stays single-source.
package partners

import (
	"context"
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// Deps groups the cross-package *Server methods the M05 数字伙伴
// module depends on. server.New() constructs the Service once and passes
// method values bound to its own *Server methods. The package boundary
// stays one-way: internal/partners/ never imports internal/server/.
//
// All fields are required for production callers (Server.New wires
// them all). Tests can leave any subset nil and nil-check at the call
// site (the M05 handlers do `s.<Field>` lookups before each call).
type Deps struct {
	// Workspace / identity / access gating
	WorkspaceID                     func(r *http.Request) string
	IdentityFrom                    func(ctx context.Context) *auth.Identity
	RequireWorkspaceAccess          func(id *auth.Identity, ws string) error
	EvaluateWriteLocked             func(r *http.Request, kind, action string, in policy.Input) error
	ActorIsAdmin                    func(id *auth.Identity) bool
	RequiresPeerApprovalGate        func(id *auth.Identity) bool
	RequireProductionDualApprovalFn func(submitterID, submitterName string, actor *auth.Identity, verb string) error
	MaybeHoldForCountersign         func(rel map[string]any, actor *auth.Identity, risk, verb string) (bool, error)
	ProductionLikeEnv               func() bool

	// Employee validation
	ValidateEmployeeConfigurationBody func(body map[string]any) error
	ValidateEmployeeReleaseGates      func(emp map[string]any) error
	EmployeeEvaluateIncomplete        func(emp map[string]any) bool
	ValidatePublishedCapabilities     func(emp map[string]any) error

	// Employee runtime projections (compute / evidence / with-runtime)
	EmployeeWithRuntimeLocked    func(emp map[string]any) map[string]any
	RealEmployeeEvidenceLocked   func(emp map[string]any, limit int) []map[string]any
	ComputeEmployeeRuntimeLocked func(emp map[string]any) map[string]any
	ResolveActiveEmployee        func(r *http.Request, deID string) (any, error)

	// Persistence / audit
	PersistEmployeesLocked func()
	AfterWriteLocked       func(collections ...string)
	PersistCollection      func(collection string, rows []map[string]any)

	// Capability catalog peer fetch
	ModelByIDLocked           func(id string) (map[string]any, bool)
	CapBaseURL                func() string
	PeerGET                   func(r *http.Request, base, path string) (any, error)
	FetchCapCatalogParts      func(r *http.Request, ws string) (skills, tools, knowledge, channels, models []map[string]any, err error)
	FetchWorkflowCatalogParts func(r *http.Request, ws string) ([]map[string]any, error)
	CatalogPlatformTools      func() []map[string]any
	CatalogRuntimeTools       func(filter any) []map[string]any
	ProviderModels            func(p map[string]any) []map[string]any
	KnowledgeSliceMaps        func(v any) []map[string]any
	HasCapability             func(caps []string, want string) bool
}

// Service is the M05 数字伙伴 (Digital Partner) HTTP handler + Connect-RPC
// binding. All 11 REST routes + the partnerConnect ResolveActive method
// bind to methods on this struct. Constructed once via NewService; the
// route table in server.go dispatches M05 paths through s.partnerSvc.
type Service struct {
	Deps

	// Store is the in-memory store backing every read/write the partner
	// handlers perform. Required.
	Store *store.Store
}

// NewService builds a Service. store is required for the M05 module to
// do real work; deps may be partial for tests that exercise only the
// catalogue projection or one isolated handler.
func NewService(store *store.Store, deps Deps) *Service {
	return &Service{
		Store: store,
		Deps:  deps,
	}
}

// --- 11 REST route entry points ---
// Each method is the canonical façade for the matching route in
// server.go L667-L705. They are thin wrappers over the actual handler
// implementations in handlers.go / handlers_actions.go /
// handlers_contract.go / capability_catalog.go so the route table reads
// `s.partnerSvc.ListEmployees(r)` without ever touching the underlying
// *Service receiver or the free helpers that package owns.
//
// Field naming mirrors the *Server method names exactly so the route
// switch reads identically to the pre-move `s.listEmployees(r)` style.

// ListEmployees → GET /api/partners
func (s *Service) ListEmployees(r *http.Request) (any, error) {
	return s.listEmployees(r)
}

// CreateEmployee → POST /api/partners
func (s *Service) CreateEmployee(r *http.Request) (any, error) {
	return s.createEmployee(r)
}

// EmployeeOverview → GET /api/partners/overview
func (s *Service) EmployeeOverview(r *http.Request) (any, error) {
	return s.employeeOverview(r)
}

// ListEmployeeTemplates → GET/POST/PATCH /api/partner-templates and /api/partner-templates/:id
func (s *Service) ListEmployeeTemplates(r *http.Request) (any, error) {
	return s.listEmployeeTemplates(r)
}

// ListTemplateAdoptions → GET /api/partner-template-adoptions
func (s *Service) ListTemplateAdoptions(r *http.Request) (any, error) {
	return s.listTemplateAdoptions(r)
}

// CapabilityCatalog → GET /api/partner-capability-catalog
func (s *Service) CapabilityCatalog(r *http.Request) (any, error) {
	return s.capabilityCatalog(r)
}

// AdoptTemplate → POST /api/partner-templates/:id/adopt
func (s *Service) AdoptTemplate(r *http.Request) (any, error) {
	return s.adoptTemplate(r)
}

// GetEmployee → GET /api/partners/:id (used by digitalEmployeeRoute fallback)
func (s *Service) GetEmployee(r *http.Request) (any, error) {
	return s.getEmployee(r)
}

// PatchEmployee → PATCH /api/partners/:id (used by digitalEmployeeRoute)
func (s *Service) PatchEmployee(r *http.Request) (any, error) {
	return s.patchEmployee(r)
}

// EmployeeAction → POST /api/partners/:id/:action (submit/approve/reject/pause)
func (s *Service) EmployeeAction(r *http.Request) (any, error) {
	return s.employeeAction(r)
}

// DigitalEmployeeRoute → /api/partners/:id/* catch-all
func (s *Service) DigitalEmployeeRoute(r *http.Request) (any, error) {
	return s.digitalEmployeeRoute(r)
}

// LegacyAgentsProxy → GET /api/agents
func (s *Service) LegacyAgentsProxy(r *http.Request) (any, error) {
	return s.legacyAgentsProxy(r)
}

// EmployeeOverviewAligned → backwards-compat wrapper preserved for the
// CopSvc cross-module call that M02 used pre-P2.
func (s *Service) EmployeeOverviewAligned(r *http.Request) (any, error) {
	return s.employeeOverviewAligned(r)
}

// CapabilityCatalogAligned → same — exposed for parity with the legacy
// server package's capabilityCatalogAligned name.
func (s *Service) CapabilityCatalogAligned(r *http.Request) (any, error) {
	return s.capabilityCatalogAligned(r)
}
