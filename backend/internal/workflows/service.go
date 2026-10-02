// Package workflows is the M06 工作流程 (Workflow) module — the HTTP
// façade that owns workflow CRUD + trial-run dispatch + template management
// plus the workflow-as-skill publishing path. The Temporal-shaped execution
// engine itself lives in internal/qzdaworkflow/ and stays self-contained
// (per M06 plan D3 / G2): qzdaworkflow = engine, internal/workflows =
// HTTP handler + business glue. The Service struct binds to
// qzdaworkflow.Engine.StartTrial through the Deps.StartTrial function
// field so the dependency direction stays one-way (workflows → qzdaworkflow,
// never qzdaworkflow → workflows).
//
// History: prior to M06 P2 all M06 handlers lived in internal/server/ as
// (s *Server) receiver methods across handlers_d.go (list/create/run/...),
// workflow_skill.go (publish-as-skill + catalog sync),
// builtin_workflows.go (template CRUD + builtin loader),
// handlers_p1.go (workflowByID + listWorkflowGenerations + generateWorkflow),
// handlers_skills.go (listWorkflowSkillsAligned + publishWorkflowSkill)
// and handlers_skills_detail.go (bindWorkflowCapability). Phase 2 of
// the M06 工作流程整合方案
// (docs/整合方案/工作流程模块整合方案.md) extracts that M06 code into
// internal/workflows/ using the standard partners/copilot/tasks pattern:
// function-value Deps struct + NewService(deps) constructor + Service
// façade methods.
//
// Service is constructed once at server boot via NewService(deps). The
// route table in server.go dispatches the 13 M06 routes through
// s.workflowSvc.<Method>(r). The package boundary is one-way:
// internal/workflows never imports internal/server/.
//
// Required helpers stay on Server and are bound as method values on Deps:
// workspaceID, decodeMap (any of: free or s.Server), policy gating
// (evaluateWriteLocked), skill-skill helpers (requireSkillRead,
// requireSkillWrite), governance (requireDualApproval,
// maybeHoldForCountersign), bootstrap (EnsureBuiltinWorkflowsReady —
// promoted to a Service method but the DomainWorkflow boot path still
// goes through Server.workflowSvc.EnsureBuiltinWorkflowsReady()), and
// applyWorkflowSkillCatalog (kept on Server because it depends on
// peerPOST + capBaseURL runtime gating).
package workflows

import (
	"context"
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/qzdaworkflow"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// Deps groups the cross-package helpers the M06 module needs. Server.New()
// constructs the Service once and passes method values bound to its own
// *Server methods. The package boundary stays one-way: internal/workflows
// never imports internal/server/.
//
// All fields are required for production callers (Server.New wires them
// all). Tests can leave any subset nil and nil-check at the call site
// (each M06 handler does `s.<Field>` lookups before calling).
type Deps struct {
	// Workspace / identity / access gating — every handler.
	WorkspaceID func(r *http.Request) string

	// Body parsing — used by createWorkflow / generateWorkflow /
	// runWorkflow / bindWorkflowCapability / publishWorkflowSkill /
	// createWorkflowTemplate / workflowByID.
	DecodeMap func(r *http.Request) (map[string]any, error)

	// Policy evaluation — workflowByID publish branch uses EvaluateWriteLocked.
	EvaluateWriteLocked func(r *http.Request, kind, action string, in policy.Input) error

	// Governance / dual approval — publishWorkflowSkill + publishWorkflowAsSkillLocked
	// need the production dual-approval gate + the countersign hold.
	RequireSkillRead                 func(id *auth.Identity) error
	RequireSkillWrite                func(id *auth.Identity) error
	RequiresPeerApprovalGate         func(id *auth.Identity) bool
	RequireProductionDualApproval   func(submitterID, submitterName string, actor *auth.Identity, verb string) error
	MaybeHoldForCountersign         func(rel map[string]any, actor *auth.Identity, risk, verb string) (bool, error)
	ProductionLikeEnv               func() bool

	// Persistence — called after successful mutations (persist Skills /
	// workflows runs / templates / durable delete sync).
	AfterWriteLocked     func(collections ...string)
	AfterWrite           func(collections ...string)
	DurableDeleteSync    func(collection string, ids ...string)
	PersistSkills        func()
	PersistSkillExtra    func()
	PersistSkillHealth   func()

	// Skill catalog peer sync — stays on Server because it depends on
	// peerPOST + capBaseURL runtime gating + upsertSkillCatalogLocked.
	// Inject as a function value so workflows never imports server.
	ApplyWorkflowSkillCatalog func(actor *auth.Identity, skill map[string]any, r *http.Request)

	// Engine StartTrial — bound by buildWorkflowSvc to qzdaworkflow.Engine.StartTrial.
	// Returns the run struct (engine internal type) the workflow then flattens
	// to a map[string]any via Run.ToMap().
	StartTrial func(ctx context.Context, runID, workflowID string) (*qzdaworkflow.Run, error)
}

// Service is the M06 工作流程 (Workflow) HTTP-route façade. All 13 REST
// routes bind to methods on this struct. Constructed once via
// NewService(deps); the route table in server.go dispatches M06 paths
// through s.workflowSvc.<Method>.
type Service struct {
	Deps

	// Store is the in-memory store backing every read/write the M06
	// handlers perform. Required.
	Store *store.Store
}

// NewService builds a Service. store is required for the M06 module to
// do real work; deps may be partial for tests that exercise only one
// isolated handler.
func NewService(store *store.Store, deps Deps) *Service {
	return &Service{
		Store: store,
		Deps:  deps,
	}
}

// --- 13 REST route entry points ---
// Field naming mirrors the legacy *Server method names exactly so the
// route switch reads "s.workflowSvc.ListWorkflows(r)" the same way the
// legacy "s.listWorkflows(r)" read.

// ListWorkflows → GET /api/workflows
func (s *Service) ListWorkflows(r *http.Request) (any, error) {
	return s.listWorkflows(r)
}

// CreateWorkflow → POST /api/workflows
func (s *Service) CreateWorkflow(r *http.Request) (any, error) {
	return s.createWorkflow(r)
}

// ListWorkflowTemplates → GET /api/workflow-templates
func (s *Service) ListWorkflowTemplates(r *http.Request) (any, error) {
	return s.listWorkflowTemplates(r)
}

// CreateWorkflowTemplate → POST /api/workflow-templates
func (s *Service) CreateWorkflowTemplate(r *http.Request) (any, error) {
	return s.createWorkflowTemplate(r)
}

// DeleteWorkflowTemplate → DELETE /api/workflow-templates/{id}
func (s *Service) DeleteWorkflowTemplate(r *http.Request) (any, error) {
	return s.deleteWorkflowTemplate(r)
}

// ListWorkflowGenerations → GET /api/workflows/generations
func (s *Service) ListWorkflowGenerations(r *http.Request) (any, error) {
	return s.listWorkflowGenerations(r)
}

// GenerateWorkflow → POST /api/workflows/generate
func (s *Service) GenerateWorkflow(r *http.Request) (any, error) {
	return s.generateWorkflow(r)
}

// ListWorkflowSkillsAligned → GET /api/workflow-skills
func (s *Service) ListWorkflowSkillsAligned(r *http.Request) (any, error) {
	return s.listWorkflowSkillsAligned(r)
}

// PublishWorkflowSkill → POST /api/workflow-skills/{id}/publish
func (s *Service) PublishWorkflowSkill(r *http.Request) (any, error) {
	return s.publishWorkflowSkill(r)
}

// ListWorkflowRuns → GET /api/workflow-runs
func (s *Service) ListWorkflowRuns(r *http.Request) (any, error) {
	return s.listWorkflowRuns(r)
}

// RunWorkflow → POST /api/workflows/run
func (s *Service) RunWorkflow(r *http.Request) (any, error) {
	return s.runWorkflow(r)
}

// BindWorkflowCapability → POST /api/workflows/{id}/capabilities
func (s *Service) BindWorkflowCapability(r *http.Request) (any, error) {
	return s.bindWorkflowCapability(r)
}

// WorkflowByID → GET/POST/PATCH /api/workflows/{id}[/action]
func (s *Service) WorkflowByID(r *http.Request) (any, error) {
	return s.workflowByID(r)
}