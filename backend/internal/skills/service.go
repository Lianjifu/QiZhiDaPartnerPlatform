package skills

import (
	"context"
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/skills/artifacts"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// Deps groups the cross-package *Server methods the M09 技能中心
// module depends on. server.New() constructs the Service once and
// passes function values bound to its own *Server methods. The package
// boundary stays one-way: internal/skills/ never imports internal/server/.
//
// All fields are required for production callers (Server.New wires
// them all). Tests can leave any subset nil and nil-check at the call
// site.
type Deps struct {
	// Workspace / identity / access gating — every M09 handler.
	WorkspaceID  func(r *http.Request) string
	IdentityFrom func(ctx context.Context) *auth.Identity
	DecodeMap    func(r *http.Request) (map[string]any, error)
	EvaluateWrite func(r *http.Request, resource, action string, extra policy.Input) error

	// EvaluateZeroTrust is the cross-package zero-trust gate used by
	// executeSkill + createMCPConnection + createTool.
	EvaluateZeroTrust func(id *auth.Identity, kind, action, target string, isExternal bool, reason string) (map[string]any, error)

	// Mode / actor helpers used by execute + publish handlers.
	ActorIsAdmin      func(id *auth.Identity) bool
	ProductionLikeEnv func() bool

	// Audit sink — used by every mutation.
	AppendAudit func(workspaceID, actor, action, target, result, reason string)

	// Persistence + durable-delete hooks.
	PersistSkillsLocked func()
	PersistSkillExtra   func()
	PersistCollection   func(collection string)
	PersistDelete       func(collection string, ids ...string)
	DurableDeleteSync   func(collection string, ids ...string)

	// KV hydration hook for skill governance rehydrate (skill_health +
	// skill_extra on startup).
	KV func() any // *infra.KVStore — declared as any to avoid infra coupling

	// ResolvePublisherKey is the W2-D1 trust gate used by
	// skillSupplyChainGate + verifyImportSignature.
	ResolvePublisherKey func(workspaceID, keyID string) (any, string, error)

	// SkillTrustStore is the loaded trust store (lazy fallback when the
	// boot path did not bind one). Returns the concrete *signing.TrustStore
	// (or nil). Tests inject a stub.
	SkillTrustStore func() any
	// SkillDevKey is the optional dev keypair (for tests / local dev).
	SkillDevKey func() any

	// Peer fetch for cross-process skill catalog sync (cap-runtime delegate).
	PeerPOST   func(r *http.Request, base, path string, body any) (any, error)
	CapBaseURL func() string

	// DelegateSkillInvocation is the cap-runtime delegate hook used by
	// recordSkillInvocation when this instance does not own the runtime.
	DelegateSkillInvocation func(r *http.Request, ws string, skill map[string]any, durationMs int, ok bool, actor, source string)

	// KnowledgeSliceMaps is the cross-package helper used by M09 trend
	// bucket projection (the legacy Store round-trip can yield either
	// []map[string]any or []any).
	KnowledgeSliceMaps func(v any) []map[string]any

	// LoadTrustStore is invoked once at boot to hydrate the trust store
	// from trusted-publishers.json. The boot path is fail-closed.
	LoadTrustStore func() error

	// AuthorizeActorCapability returns whether the named capability is
	// available for the actor in the workspace (used by skill execute).
	AuthorizeActorCapability func(id *auth.Identity, capability string) bool

	// GetSkillTrustStore + GetSkillDevKey are the resolved references
	// (after boot). Used by trustStoreForSkillVerify fallback.
	// Signer is the resolved signing.SignerResolver (Deps injection from
	// server.go's bootstrapSkillSigning + bootstrapVaultSkillSigning).
	Signer any

	// ToFloat converts a generic value to float64 (mirrors server.toFloat).
	ToFloat func(v any) float64

	// CoalesceNum is the cross-package coercion helper (used in
	// catalog publish + sync).
	CoalesceNum func(v any, def float64) float64
}

// Service is the M09 技能中心 HTTP-route façade. All 20 REST routes +
// catch-all detail + governance batch + skill execute + skill-artifacts
// media endpoints bind to methods on this struct. Constructed once via
// NewService; the route table in server.go dispatches M09 paths through
// s.skillsSvc.<Method>.
type Service struct {
	Deps

	// Store is the in-memory store backing every read/write the M09
	// handlers perform. Required.
	Store *store.Store

	// CopSvc is the M02 专家协作 backend service. Required by the skill
	// harness (runSkillTool + dispatchAuthorizedTool) for tool
	// authorization, registry lookup, and tool execution delegation.
	CopSvc *copilot.Service

	// ArtifactsSvc is the M09 /api/skill-artifacts/* sub-router
	// (DOCX/PPTX/PDF/XLSX inline-preview + download). Owned by the
	// skills package; constructed by NewService so the gateway-policy
	// and audit-sink deps are wired in one place.
	ArtifactsSvc *artifacts.Service
}

// NewService builds a Service. store is required for the M09 module to
// do real work; deps may be partial for tests.
func NewService(store *store.Store, deps Deps) *Service {
	s := &Service{
		Store: store,
		Deps:  deps,
	}
	if store != nil {
		s.ArtifactsSvc = &artifacts.Service{
			AppendAuditSink: func(ws, actor, action, target, result, reason string) {
				if deps.AppendAudit != nil {
					deps.AppendAudit(ws, actor, action, target, result, reason)
				}
			},
			WorkspaceResolver: deps.WorkspaceID,
			IdentityFrom: func(r *http.Request) *auth.Identity {
				if deps.IdentityFrom == nil {
					return nil
				}
				return deps.IdentityFrom(r.Context())
			},
		}
	}
	return s
}

// --- 20 REST route entry points + catch-all + media ---
//
// Field naming mirrors the legacy *Server method names exactly so the
// route switch reads `s.skillsSvc.ListSkills(r)` the same way the
// legacy `s.listSkillsAligned(r)` read. Where the handler signature
// uses extra parameters (e.g. skillByID takes `(r, id, ws, skillID)`),
// the wrapper accepts *http.Request only and parses the path internally
// to keep the server.go switch case shape identical.

// 1. ListSkillsAligned → GET /api/skills
func (s *Service) ListSkillsAligned(r *http.Request) (any, error) {
	return s.listSkillsAligned(r)
}

// 2. CreateSkill → POST /api/skills
func (s *Service) CreateSkill(r *http.Request) (any, error) {
	return s.createSkill(r)
}

// 3. ImportSkills → POST /api/skills/import
func (s *Service) ImportSkills(r *http.Request) (any, error) {
	return s.importSkills(r)
}

// 4. ImportSkillPackage → POST /api/skills/import-package
func (s *Service) ImportSkillPackage(r *http.Request) (any, error) {
	return s.importSkillPackage(r)
}

// 5. ListSkillCatalog → GET /api/skills/catalog
func (s *Service) ListSkillCatalog(r *http.Request) (any, error) {
	return s.listSkillCatalog(r)
}

// 6. PublishSkillToCatalog → POST /api/skills/catalog/publish
func (s *Service) PublishSkillToCatalog(r *http.Request) (any, error) {
	return s.publishSkillToCatalog(r)
}

// 7. SyncSkillCatalog → POST /api/skills/catalog/sync
func (s *Service) SyncSkillCatalog(r *http.Request) (any, error) {
	return s.syncSkillCatalog(r)
}

// 8. ApplyGeneralPack → POST /api/skills/apply-general-pack
func (s *Service) ApplyGeneralPack(r *http.Request) (any, error) {
	return s.applyGeneralPack(r)
}

// 9. ListSkillPacks → GET /api/skills/packs
func (s *Service) ListSkillPacks(r *http.Request) (any, error) {
	return s.listSkillPacks(r)
}

// 10. SkillDependencyMatrix → GET /api/skills/dependency-matrix
func (s *Service) SkillDependencyMatrix(r *http.Request) (any, error) {
	return s.skillDependencyMatrix(r)
}

// 11. ApplySkillPack → POST /api/skills/apply-pack/{id}
func (s *Service) ApplySkillPack(r *http.Request) (any, error) {
	return s.applySkillPack(r)
}

// 12–17. Governance overview / health / incidents / events / trends / batch
func (s *Service) SkillsGovernanceOverview(r *http.Request) (any, error) {
	return s.skillsGovernanceOverview(r)
}
func (s *Service) SkillsGovernanceHealth(r *http.Request) (any, error) {
	return s.skillsGovernanceHealth(r)
}
func (s *Service) SkillsGovernanceIncidents(r *http.Request) (any, error) {
	return s.skillsGovernanceIncidents(r)
}
func (s *Service) SkillsGovernanceEvents(r *http.Request) (any, error) {
	return s.skillsGovernanceEvents(r)
}
func (s *Service) SkillsGovernanceTrends(r *http.Request) (any, error) {
	return s.skillsGovernanceTrends(r)
}
func (s *Service) SkillsGovernanceBatch(r *http.Request) (any, error) {
	return s.skillsGovernanceBatch(r)
}

// 18. ListSkillAudit → GET /api/skills/audit
func (s *Service) ListSkillAudit(r *http.Request) (any, error) {
	return s.listSkillAudit(r)
}

// 19. ExecuteSkill → POST /api/skills/execute
func (s *Service) ExecuteSkill(r *http.Request) (any, error) {
	return s.executeSkill(r)
}

// 20. SkillByID catch-all → /api/skills/{id}/{action}
func (s *Service) SkillByID(r *http.Request) (any, error) {
	return s.skillByID(r)
}

// SkillArtifact, SkillArtifactPreview, SkillArtifactSlidePNG — media handlers
// (s serveSkillArtifact*) — body-less response writers.
func (s *Service) ServeSkillArtifact(w http.ResponseWriter, r *http.Request) {
	if s.ArtifactsSvc != nil {
		s.ArtifactsSvc.ServeSkillArtifact(w, r)
		return
	}
	writeArtifactNotConfigured(w)
}
func (s *Service) ServeSkillArtifactPreview(w http.ResponseWriter, r *http.Request) {
	if s.ArtifactsSvc != nil {
		s.ArtifactsSvc.ServeSkillArtifactPreview(w, r)
		return
	}
	writeArtifactNotConfigured(w)
}
func (s *Service) ServeSkillArtifactSlidePNG(w http.ResponseWriter, r *http.Request) {
	if s.ArtifactsSvc != nil {
		s.ArtifactsSvc.ServeSkillArtifactSlidePNG(w, r)
		return
	}
	writeArtifactNotConfigured(w)
}

func writeArtifactNotConfigured(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write([]byte(`{"error":"artifacts service not configured"}`))
}

// ListSkillIntegrations → GET /api/skill-integrations
func (s *Service) ListSkillIntegrations(r *http.Request) (any, error) {
	return s.listSkillIntegrations(r)
}

// SkillIntegrationAction → /api/skill-integrations/{id}/{action}
func (s *Service) SkillIntegrationAction(r *http.Request) (any, error) {
	return s.skillIntegrationAction(r)
}

// CreateMCPConnection → POST /api/mcp-connections
func (s *Service) CreateMCPConnection(r *http.Request) (any, error) {
	return s.createMCPConnection(r)
}

// CreateTool → POST /api/tools
func (s *Service) CreateTool(r *http.Request) (any, error) {
	return s.createTool(r)
}

// BindSkillToAgent is the cross-module entry consumed by M05 partners
// for /api/agents/{id}/skills. Bound to the (s *Service).bindAgentSkill
// implementation.
func (s *Service) BindSkillToAgent(r *http.Request) (any, error) {
	return s.bindAgentSkill(r)
}

// SkillInvocationAPI is the cap-runtime delegate entry: POST
// /api/internal/skill/invocation. Exposed so server.go can dispatch the
// internal route through the skills façade without leaking the
// implementation into server.go.
func (s *Service) SkillInvocationAPI(r *http.Request) (any, error) {
	return s.skillInvocationAPI(r)
}

// UpsertSkillCatalogAPI is the cap-runtime delegate entry: POST
// /api/internal/skill-catalog.
func (s *Service) UpsertSkillCatalogAPI(r *http.Request) (any, error) {
	return s.upsertSkillCatalogAPI(r)
}

// BuiltinSkillsRoot returns the on-disk directory containing the
// bundled builtin skills. Injected into copilot.Deps so the copilot
// module can locate per-skill digest.md without importing skills/
// directly. Falls back to the QZDA_BUILTIN_SKILLS_DIR env override,
// then probes three common layouts (matches the legacy server-side
// builtinSkillsRoot helper).
func (s *Service) BuiltinSkillsRoot() string {
	return builtinSkillsRoot()
}
