package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/qizhida-partner-platform/backend/internal/agentos"
	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/channel"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/gateway"
	"github.com/qizhida-partner-platform/backend/internal/heartbeat"
	"github.com/qizhida-partner-platform/backend/internal/infra"
	"github.com/qizhida-partner-platform/backend/internal/knowledge"
	mem "github.com/qizhida-partner-platform/backend/internal/memory"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/metrics"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/modelprov/trace"
	"github.com/qizhida-partner-platform/backend/internal/models"
	"github.com/qizhida-partner-platform/backend/internal/multimodal"
	"github.com/qizhida-partner-platform/backend/internal/operations"
	"github.com/qizhida-partner-platform/backend/internal/partners"
	"github.com/qizhida-partner-platform/backend/internal/pmsop"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/qzdaworkflow"
	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
	"github.com/qizhida-partner-platform/backend/internal/secretbox"
	"github.com/qizhida-partner-platform/backend/internal/settings"
	"github.com/qizhida-partner-platform/backend/internal/skills"
	"github.com/qizhida-partner-platform/backend/internal/skills/registry"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/tasks"
	"github.com/qizhida-partner-platform/backend/internal/vault"
	"github.com/qizhida-partner-platform/backend/internal/workflows"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
)

// Type aliases — the original copilot-internal types moved to internal/copilot
// during the M02 backend consolidation (M02 P2 deep move). Local aliases
// keep call sites in server/ readable (no copilot.X noise) while the real
// definitions live in the copilot package. These MUST stay byte-identical
// to the originals — see internal/copilot/service.go and copilot_*.go.
type (
	memoryBudgetReport    = copilot.MemoryBudgetReport
	toolRunContext        = copilot.ToolRunContext
	registeredTool        = copilot.RegisteredTool
	toolCallRequest       = copilot.ToolCallRequest
	toolExecResult        = copilot.ToolExecResult
	reactTurnInput        = copilot.ReactTurnInput
	reactTurnResult       = copilot.ReactTurnResult
	reactEmitFunc         = copilot.ReactEmitFunc
	participantContext    = copilot.ParticipantContext
	participantTurnResult = copilot.ParticipantTurnResult
	cognitiveDecision     = copilot.CognitiveDecision
	memoryHit             = copilot.MemoryHit
)

type Server struct {
	Store      *store.Store
	Mode       ServiceMode
	RuntimeURL string
	RAGURL     string
	PG         *pgxpool.Pool
	Cache      *infra.Cache
	AuditSink  *infra.AuditSink
	UsageSink  *infra.UsageSink
	KV         *infra.KVStore
	Search     *infra.OpenSearchAudit
	Policy     *policy.Engine
	Vault      *vault.Client
	OIDC       auth.OIDCConfig
	Workflows  *qzdaworkflow.Engine
	ModelProbe *modelprov.Client
	// Optional HTTP clients override Open API transport in tests.
	FeishuHTTP   *http.Client
	DingTalkHTTP *http.Client
	WecomHTTP    *http.Client
	WeixinHTTP   *http.Client
	RuntimeHTTP  *http.Client
	PeerHTTP     *http.Client
	Kernel       *infra.KernelStore
	// ReplicaForced is set when Postgres is in recovery (pg_is_in_recovery).
	ReplicaForced    bool
	PostgresRecovery bool
	// TraceRecorder captures per-invocation model traces for M7.
	TraceRecorder *trace.Recorder
	// SkillRegistry is the v2 skill spec registry (S1/S2).
	SkillRegistry *registry.Registry
	// IdentityProfiles holds durable digital-employee identity (Mem5).
	IdentityProfiles *memid.Store
	// ChannelRegistry routes sends/probes/parse to the right vendor adapter
	// without per-vendor conditionals at call sites.
	ChannelRegistry *channel.Registry
	// lastMemoryBudgetReport is set by retrieveMemoryForTurnLocked so the
	// copilot stream can flush a `memory.budget` SSE event. Single-slot:
	// concurrent turns overwrite; that's acceptable for an observability tail
	// (the live SSE always sees the latest write for its own turn).
	lastMemoryBudgetReport *memoryBudgetReport
	// participantMemoryBudgetReports collects per-participant memory budget
	// reports during a panel dispatch so the supervisor can flush a single
	// consolidated `memory.budget` event after the panel completes — without
	// this, each participant overwrites the single-slot and the supervisor
	// stream (which flushes before participants run) would only ever see the
	// supervisor's own retrieval, never the per-specialist slicing.
	participantMemoryBudgetReports map[string]*memoryBudgetReport
	// participantMemoryBudgetMu guards participantMemoryBudgetReports.
	participantMemoryBudgetMu sync.Mutex
	// testHooks lets *_test.go files override behavior at well-defined seams
	// (runParticipantTurn, runCopilotTool, runPlanExecuteTurn) without
	// standing up the full LLM/RAG stack. Nil in production; nil fields
	// inside mean "no override at that seam".
	testHooks *serverTestHooks
	// W1-D2 · Skill 签名信任锚
	// SkillTrustStore 加载静态 trusted-publishers.json（prod 用），包含所有
	// 受信任发布者的公钥。SkillDevKey 是 dev/demo 模式下自动生成的本地 keypair，
	// 用于本地签名/校验 skills 且不污染 prod trust。
	SkillTrustStore *signing.TrustStore
	SkillDevKey     *signing.DevKeyStore
	// SkillSigner is the SignerResolver in effect (dev or vault). Server
	// never signs during runtime today, but this slot exists so cmd/sign-skill
	// and future server-side flows can pick the prod-safe path without
	// touching the dev auto-provisioning logic.
	SkillSigner signing.SignerResolver
	// Heartbeat (W4-D1) tracks active identity presence per workspace.
	// Touch() is called by the auth middleware on every authed request;
	// the SSE stream and /api/online endpoint read from it.
	Heartbeat *heartbeat.Tracker
	// HeartbeatCancel stops the sweeper goroutine on shutdown.
	HeartbeatCancel context.CancelFunc
	// MemoryTTLCancel stops the memory TTL expiry goroutine started by
	// StartMemoryMaintenance. nil until StartMemoryMaintenance runs.
	MemoryTTLCancel context.CancelFunc
	// W5-D2 · Multimodal extraction registry. nil until initMultimodal
	// has registered a provider.
	Multimodal *multimodal.Registry
	// W6-D1 · PM SOP engine + bundled templates. nil until initPMsop.
	PMSop *pmsop.Engine
	// W7-D1 · SQLite durability hooks. nil when QZDA_STORE_BACKEND != "sqlite".
	SQLite *store.SQLiteHooks
	// W2-D3 · SubAgent dispatch engine. Built in New(); concurrency cap
	// configured via QZDA_SUBAGENT_MAX_CONCURRENCY.
	SubAgent *agentos.Engine
	// CopSvc is the M02 专家协作 backend service. Built once in New();
	// server handlers dispatch into its methods (rather than the legacy
	// *Server receivers that lived in copilot_*.go before the M02 P2
	// deep move). nil only during very early boot.
	CopSvc *copilot.Service
	// P1-4 · AuditBus is the Redis stream publisher (QZDA_REDIS_URL). Injected
	// by apprun/runDurable so future code can read or replace it; its
	// underlying *redis.Client is closed via RegisterCloseFunc by runDurable
	// (registered once for Cache — same rdb).
	AuditBus *infra.AuditBus
	// P1-4 · KafkaBus is the optional Kafka audit publisher
	// (QZDA_KAFKA_BROKERS). nil when env unset; Close is registered by
	// apprun/runDurable.
	KafkaBus *infra.KafkaAuditBus

	// authH holds the HTTP handlers for /api/auth/*. Built in New() with
	// dependencies injected from Server state so the handlers in internal/auth
	// do not need to import this package. The route switch consults
	// s.authH for the three login endpoints.
	authH *auth.Handler
	// authMW is the auth middleware (Bearer parse + mock rejection +
	// role gates). server.requireAuth composes around it for workspace
	// merge / resolution.
	authMW *auth.Middleware

	// opsH holds the HTTP handlers for /api/home/* and
	// /api/operations/overview (M01 Operations Overview). Built in New()
	// with dependencies injected from Server state so the handlers in
	// internal/operations do not need to import this package. The route
	// switch consults s.opsH for the 7 M01 endpoints.
	opsH *operations.Handler

	// taskSvc holds the M03 任务中心 (Task Center) HTTP-route façade.
	// Built in New() via buildTaskSvc (which wires Deps function fields
	// to *Server methods). The tasks package owns the full M03 surface
	// (4 REST handlers + lifecycle/audit/visibility helpers) and the
	// route switch dispatches the 4 M03 endpoints through this struct.
	// Package boundary is one-way: tasks never imports internal/server/.
	taskSvc *tasks.Service

	// partnerSvc holds the M05 数字伙伴 (Digital Partner) HTTP-route
	// façade. Built in New() with method values bound to *Server methods
	// so the partners package stays free of any internal/server/ import.
	// The route switch consults s.partnerSvc for the 11 M05 endpoints
	// (employees list/create/overview, templates list/adopt, capability
	// catalog, partner-by-id catch-all, legacy /api/agents proxy). The
	// Connect-RPC PartnerServiceHandler also delegates to it via
	// partners.newPartnerConnect. Nil-tolerant: falls back to the
	// legacy receiver methods when s.partnerSvc is nil (kept around for
	// tests that don't wire the package).
	partnerSvc *partners.Service

	// workflowSvc holds the M06 工作流程 (Workflow) HTTP-route façade.
	// Built in New() with method values bound to *Server methods so the
	// workflows package stays free of any internal/server/ import. The
	// route switch consults s.workflowSvc for the 13 M06 endpoints
	// (workflows CRUD + trial-run + templates + workflow-skills +
	// capability bind). The qzdaworkflow execution engine itself stays
	// in internal/qzdaworkflow/ — s.Workflows (the *Engine) is bound
	// into the service via Deps.StartTrial in buildWorkflowSvc().
	workflowSvc *workflows.Service

	// modelSvc holds the M08 模型中心 (Model Center) HTTP-route façade.
	// Built in New() via buildModelSvc (which wires Deps function fields
	// to *Server methods). The models package owns the full M08 surface:
	// 17 REST handlers (providers CRUD + governance + audit + routing
	// policies + failover drills + model invocation) + the SSE stream
	// endpoint + the Copilot LLM streaming bridge (StreamLLMForCopilotFn).
	// Package boundary stays one-way: models never imports internal/server/.
	modelSvc *models.Service

	// knowledgeSvc holds the M07 知识中心 (Knowledge Center) HTTP-route
	// façade. Built in New() with method values bound to *Server methods
	// so the knowledge package stays free of any internal/server/ import.
	// The route switch consults s.knowledgeSvc for the 25 M07 endpoints
	// (docs CRUD + retrieve + kb-list + packages + sources + governance +
	// processing-jobs + retrieval-profiles + evaluations + graph +
	// bindings + citation-trace + eval + chunks + review + reindex +
	// rescore + evaluation-run). The Connect-RPC RagServiceHandler also
	// delegates to it via knowledge.NewConnect. Nil-tolerant: falls back
	// to the legacy receiver methods when s.knowledgeSvc is nil (kept
	// around for tests that don't wire the package).
	knowledgeSvc *knowledge.Service

	// skillsSvc holds the M09 技能中心 (Skills Center) HTTP-route
	// façade. Built in New() via buildSkillsSvc (which wires Deps
	// function fields to *Server methods). The skills package owns the
	// full M09 surface: 20 REST routes + skill-artifacts media + the
	// catch-all skillByID + governance batch + skill execute + cap-
	// runtime delegate routes. Package boundary stays one-way: skills
	// never imports internal/server/. The legacy *Server receiver
	// methods (s.listSkillsAligned, s.createSkill, …) are kept as
	// thin forwarders to s.skillsSvc.<Method> so the route table can
	// migrate incrementally.
	skillsSvc *skills.Service

	// settingsSvc is the M09 平台设置 module façade (extracted from this
	// package by M09 P2). Route cases for /api/billing, /api/billing/quota,
	// /api/backups/*, /api/notification-channels, /api/tenant/profile,
	// /api/api-keys, and /api/webhooks-config all dispatch through it.
	settingsSvc *settings.Service

	// closeMu guards closeFuncs + closed; RegisterCloseFunc and Shutdown
	// race in tests where Shutdown runs on a different goroutine than
	// the apprun boot path.
	closeMu    sync.Mutex
	closeFuncs []func() error // external resources, invoked in parallel by Shutdown
	closed     bool           // set after first Shutdown completes

	// memorySvc holds the M07 记忆中心 (Memory Center) HTTP-route
	// façade. Built in New() via buildMemorySvc (which wires Deps
	// function fields to *Server methods). The memory package owns the
	// full M07 surface: 13 REST handlers (overview + records CRUD +
	// candidates + refinement + policy + audit + identity profiles) +
	// the runtime ingest entrypoint used by tasks + copilot +
	// cap-delegate + the TTL expiry goroutine. Server wires Deps
	// (workspace / identity helpers, zero-trust evaluation, knowledge
	// cross-module bridge) so the package boundary stays one-way:
	// memory never imports internal/server/. Nil-tolerant: the
	// server.go route switch + the Server-side thin delegators below
	// both no-op when memorySvc is nil (kept around for tests that
	// don't wire the package).
	memorySvc *mem.Service
}

// serverTestHooks groups the optional test seams. Field types are kept in
// this file (rather than exported per-hook fields on Server) so production
// call sites can branch on a single nil check and tests can populate any
// subset without touching the Server public API surface.
type serverTestHooks struct {
	// participantTurnOverride, when non-nil, replaces the body of
	// runParticipantTurn. Used to inject panics for errgroup recovery tests.
	participantTurnOverride func(ctx context.Context, pc participantContext) participantTurnResult
	// runCopilotToolOverride, when non-nil, replaces runCopilotTool for
	// builtin tools (knowledge.retrieve / memory.recall). Used to fake
	// retrieval results without bringing up the sidecar.
	runCopilotToolOverride func(ctx toolRunContext, t *registeredTool, call toolCallRequest) toolExecResult
	// runPlanExecuteOverride, when non-nil, replaces runPlanExecuteTurn
	// on the no-specialists fallback path so tests can observe the emit
	// without depending on the harness.
	runPlanExecuteOverride func(in reactTurnInput) reactTurnResult
}

func New(st *store.Store) *Server {
	s := &Server{
		Store:            st,
		Mode:             ModeAll,
		RuntimeURL:       envOr("QZDA_AGENT_RUNTIME_URL", "http://127.0.0.1:8091"),
		RAGURL:           envOr("QZDA_RAG_URL", "http://127.0.0.1:8092"),
		Policy:           policy.New(),
		Vault:            vault.NewFromEnv(),
		OIDC:             auth.LoadOIDC(),
		Workflows:        qzdaworkflow.New(),
		ModelProbe:       modelprov.NewClient(),
		TraceRecorder:    trace.NewRecorder(5000),
		SkillRegistry:    defaultSkillRegistry(),
		IdentityProfiles: memid.NewStore(),
		ChannelRegistry:  channel.NewDefaultRegistry(),
		Heartbeat:        heartbeat.New(heartbeatConfigFromEnv(), nil),
	}
	var hbCtx context.Context
	hbCtx, s.HeartbeatCancel = context.WithCancel(context.Background())
	go s.Heartbeat.Run(hbCtx)
	s.hydrateVaultFromSecrets()
	st.MigrateProvenance()
	// Drain store-owned hooks (persist / delete / audit) on shutdown so
	// post-shutdown mutators skip the dangling I/O. Registered before the
	// external pg/rdb close funcs because the Store hooks reference them.
	if st != nil {
		s.RegisterCloseFunc(st.Close)
	}
	s.bootstrapSkillSigning()
	s.bootstrapVaultSkillSigning()
	// W5-D2 · Multimodal registry (OCR / ASR stubs gated by env flags).
	s.initMultimodal()
	// W6-D1 · PM SOP templates + plan state machine.
	s.initPMsop()
	// W7-D1 · SQLite durability layer (gated on QZDA_STORE_BACKEND=sqlite).
	s.initSQLiteDurability()
	// W2-D3 · SubAgent dispatch engine.
	s.SubAgent = buildSubAgentEngine()
	// W*-D* · Auth HTTP handlers + middleware (Phase 2 login module split).
	// The auth package owns Login / OIDCLogin / OIDCCallback / RequireAuth;
	// server/ wires deps (Sign, Parse, OIDC, store-backed audit writer,
	// role gates) here so the package boundary stays one-way.
	s.authH = s.buildAuthHandler()
	s.authMW = s.buildAuthMiddleware()
	// M01 Operations Overview handlers + aggregate (Phase 2 ops module split).
	// The operations package owns HomeKPIs / HomeExtra / HomeEvents /
	// HomeTeam / HomeAlerts / AckAlert / OpsOverview + the underlying live
	// aggregate math; server/ wires Store / AuditSink / workspace resolver
	// so the package boundary stays one-way (operations never imports server/).
	s.opsH = s.buildOpsHandler()
	// M08 模型中心 (Model Center) façade. The models package owns the
	// full M08 surface: 17 REST handlers (providers CRUD + governance +
	// audit + routing policies + failover drills + model invocation) +
	// the SSE stream endpoint + the Copilot LLM streaming bridge
	// (StreamLLMForCopilotFn). Server wires Deps (workspace/identity
	// helpers, governance gates, audit sink, rate limit, metrics,
	// mode detection, cap-base copy) so the package boundary stays
	// one-way: models never imports internal/server/.
	//
	// NB: must be built BEFORE CopSvc — buildCopSvc references
	// s.modelSvc.StreamLLMForCopilot / publishedPolicyByLevelLocked to
	// wire the cross-module LLM bridge into Copilot.Deps.
	s.modelSvc = s.buildModelSvc()
	// M02 专家协作 (Expert Collaboration) backend. The copilot package
	// owns the full module (HTTP routes, turn/state machine, helpers,
	// types). Server constructs the Service once, wires its Deps to the
	// methods copilot needs from this Server, and the route table
	// dispatches the 8 M02 paths through s.CopSvc.<Method>. Package
	// boundary is real: copilot never imports server/.
	//
	// NB: buildCopSvc references s.modelSvc (StreamLLMForCopilotFn +
	// PublishedPolicyByLevelFn), so the modelSvc façade MUST be built
	// first — see the buildModelSvc call above this one.
	s.CopSvc = s.buildCopSvc()
	// M03 任务中心 (Task Center) façade. The tasks package owns the pure
	// domain helpers (buildControlledTask, lifecycle FSM, audit, version,
	// visibility, filter, paginate, code generation, legacy status
	// edges). The 4 HTTP route handlers stay on *Server (they need
	// server-only helpers like evaluateWriteLocked, writeTaskWorkingMemoryLocked,
	// IncTask*, s.Store ops) and are bound to the Service as method
	// values. Package boundary stays one-way: tasks never imports
	// server/.
	s.taskSvc = s.buildTaskSvc()
	// M07 知识中心 (Knowledge Center) façade. The knowledge package owns
	// the full M07 surface: 25 REST handlers (docs CRUD + retrieve +
	// kb-list + packages + sources + governance + processing-jobs +
	// retrieval-profiles + evaluations + graph + bindings +
	// citation-trace + eval + chunks + review + reindex + rescore +
	// evaluation-run) + the ragConnect binding for Connect-RPC. Server
	// wires Deps (workspace/identity helpers, governance gates, audit
	// sink, RAG sidecar URL, citation / citationlog helpers, record
	// usage, builtin tool registry) so the package boundary stays
	// one-way: knowledge never imports internal/server/.
	s.knowledgeSvc = s.buildKnowledgeSvc()
	// M05 数字伙伴 (Digital Partner) façade. The partners package owns
	// the M05 surface: 11 REST routes + the partnerConnect binding for
	// Connect-RPC. Server wires Deps (workspace/identity helpers,
	// cross-module validation, runtime projections, peer-fetch, etc.)
	// at boot so the package boundary stays one-way: partners never
	// imports server/.
	s.partnerSvc = s.buildPartnerSvc()
	// M06 工作流程 (Workflow) façade. The workflows package owns the
	// M06 surface: 13 REST routes (workflows CRUD + trial-run +
	// templates + workflow-skills publish + capability bind). Server
	// wires Deps (workspace/identity helpers, governance gates,
	// skill-catalog sync, persistence helpers) and binds the
	// qzdaworkflow.Engine.StartTrial closure so workflows never imports
	// server/ — package boundary is one-way.
	s.workflowSvc = s.buildWorkflowSvc()
	// M09 技能中心 (Skills Center) façade. The skills package owns
	// the M09 surface: 20 REST routes + skill-artifacts media + the
	// catch-all skillByID + governance batch + skill execute +
	// internal cap-runtime delegate. Server wires Deps (workspace/
	// identity helpers, audit sink, persistence hooks, signing
	// trust-store + dev-key + signer-resolver, peer-fetch, knowledge
	// slice coercion) so the package boundary stays one-way: skills
	// never imports server/. Built AFTER CopSvc since the skill
	// harness references s.CopSvc for tool authorization + execution.
	s.skillsSvc = s.buildSkillsSvc()
	// M07 记忆中心 (Memory Center) façade. The memory package owns the
	// full M07 surface: 13 REST handlers (overview + records CRUD +
	// candidates + refinement + policy + audit + identity profiles) +
	// the runtime ingest entrypoint used by tasks + copilot +
	// cap-delegate + the TTL expiry goroutine. Server wires Deps
	// (workspace / identity helpers, zero-trust evaluation, knowledge
	// cross-module bridge) so the package boundary stays one-way:
	// memory never imports internal/server/.
	s.memorySvc = s.buildMemorySvc()
	// M09 P2 · 平台设置 Service façade — wires all cross-package helpers
	// via method values so internal/settings stays one-way
	// (never imports internal/server).
	s.settingsSvc = settings.NewService(st, settings.Deps{
		WorkspaceID:  s.workspaceID,
		IdentityFrom: identityFrom,
		DecodeMap:    decodeMap,
		// Store.AppendAudit returns map[string]any (the persisted audit row);
		// settings.Deps expects a void callback. Wrap in a closure that
		// drops the return value.
		AppendAudit: func(workspaceId, actor, action, target, result, reason string) {
			s.Store.AppendAudit(workspaceId, actor, action, target, result, reason)
		},
		// Store.PersistCollection takes []map[string]any specifically;
		// settings.Deps is the looser (name, v any) signature so the
		// package can stay generic. Cast at the boundary.
		PersistCollection: func(name string, v any) {
			if items, ok := v.([]map[string]any); ok {
				s.Store.PersistCollection(name, items)
			}
		},
		ActorIsAdmin:  actorIsAdmin,
		EvaluateWrite: s.evaluateWrite,
	})

	return s
}

// RegisterCloseFunc registers a resource closer that Shutdown will invoke
// in parallel after cancelling the internal background goroutines. Called
// by apprun/runDurable right after each external client (PG / Redis /
// KV / Kernel / UsageSink / AuditSink) is created. Nil fn is skipped.
// Safe to call after Shutdown — the func will be appended but the goroutine
// fan-out has already completed, so the new entry is effectively a no-op
// (a second Shutdown call would still execute it).
func (s *Server) RegisterCloseFunc(fn func() error) {
	if fn == nil {
		return
	}
	s.closeMu.Lock()
	s.closeFuncs = append(s.closeFuncs, fn)
	s.closeMu.Unlock()
}

// Shutdown stops background goroutines started by New() and
// StartMemoryMaintenance, then closes every external resource registered
// via RegisterCloseFunc. Mirrors http.Server.Shutdown semantics: each
// registered cancel func is invoked; the goroutines observe ctx.Done()
// and return at their next select point.
//
// The external close funcs run in parallel bounded by ctx. Returns the
// first non-nil error encountered, or ctx.Err() when the deadline
// fires before all funcs complete. Safe to call multiple times — the
// second and later calls return nil immediately without re-invoking
// close funcs (so double Shutdown can't double-close a connection).
func (s *Server) Shutdown(ctx context.Context) error {
	s.closeMu.Lock()
	if s.closed {
		s.closeMu.Unlock()
		return nil
	}
	s.closed = true
	funcs := append([]func() error(nil), s.closeFuncs...)
	s.closeFuncs = nil // drain so a 2nd Shutdown has no work even if closed check is bypassed
	s.closeMu.Unlock()

	// 1. Internal ctx-cancels (sequential, cheap, idempotent).
	for _, c := range []struct {
		label string
		fn    context.CancelFunc
	}{
		{"heartbeat", s.HeartbeatCancel},
		{"memoryTTL", s.MemoryTTLCancel},
	} {
		if c.fn != nil {
			c.fn()
		}
	}

	if len(funcs) == 0 {
		return nil
	}

	// 2. Run all close funcs in parallel, bounded by ctx deadline.
	var wg sync.WaitGroup
	var errMu sync.Mutex
	var firstErr error
	for _, fn := range funcs {
		wg.Add(1)
		go func(fn func() error) {
			defer wg.Done()
			if err := fn(); err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				errMu.Unlock()
			}
		}(fn)
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
		return firstErr
	case <-ctx.Done():
		return fmt.Errorf("shutdown timed out: %w", ctx.Err())
	}
}

// WithRecoverForTest exposes the withRecover middleware for unit tests
// that need to wrap a stand-alone handler (e.g. a panicking route) without
// pulling in the full cors/requireAuth chain. Production wiring goes
// through Handler().
func (s *Server) WithRecoverForTest(next http.Handler) http.Handler {
	return s.withRecover(next)
}

// buildSubAgentEngine configures the bounded-concurrency dispatch engine
// from env. Defaults: 4 concurrent participants, 30s per-task budget.
func buildSubAgentEngine() *agentos.Engine {
	maxConc := agentos.MaxConcurrencyDefault
	if v := strings.TrimSpace(os.Getenv("QZDA_SUBAGENT_MAX_CONCURRENCY")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxConc = n
		}
	}
	return &agentos.Engine{
		MaxConc:        maxConc,
		DefaultTimeout: agentos.DefaultTimeoutDefault,
		OnMetric: func(d time.Duration, status string) {
			metrics.Global.SubAgent.Observe(d, status)
		},
	}
}

// initSQLiteDurability wires the SQLite-backed PersistHook when env flag
// is set. Default backend remains in-memory (no durability); the PG path
// in infra.KVStore is selected by infra.OpenPostgres in main. ADR-028.
func (s *Server) initSQLiteDurability() {
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_STORE_BACKEND")))
	if backend != "sqlite" {
		return
	}
	path := strings.TrimSpace(os.Getenv("QZDA_SQLITE_PATH"))
	if path == "" {
		path = "data/store.db"
	}
	h, err := store.OpenSQLite(path)
	if err != nil {
		log.Printf("sqlite durability: open failed (%s): %v — falling back to in-memory", path, err)
		return
	}
	s.Store.SetPersistHook(h.Persist)
	s.SQLite = h
	log.Printf("sqlite durability: hooked PersistFunc path=%s", path)
}

// bootstrapSkillSigning wires the W1-D2 trust store + dev keypair onto the
// running server. Always loads the static trusted-publishers.json (may be
// empty in dev). Auto-provisions the dev keypair only when the runtime env
// permits it (demo / development).
func (s *Server) bootstrapSkillSigning() {
	mode := runtimeenv.FromEnv()
	tfPath := envOr("QZDA_TRUSTED_PUBLISHERS_PATH", "data/skill-keys/trusted-publishers.json")
	tf, err := signing.LoadTrustFile(tfPath)
	if err != nil {
		log.Printf("skill signing: trust file load failed: %v", err)
	}
	s.SkillTrustStore = signing.NewTrustStore(tf)
	if len(tf.Keys) > 0 {
		log.Printf("skill signing: loaded %d trusted publishers from %s", len(tf.Keys), tfPath)
	}
	if !mode.AutoProvisionsSkillKeys() {
		return
	}
	keyPath := envOr("QZDA_DEV_KEYPAIR_PATH", "data/skill-keys/dev-keypair.json")
	d, err := signing.NewDevKeyStore(keyPath)
	if err != nil {
		log.Printf("skill signing: dev keypair provisioning failed: %v", err)
		return
	}
	s.SkillDevKey = d
	// Register the dev public key into the trust store so locally-produced
	// signatures verify. AddedBy/AddedAt stamped here for the audit trail.
	tk, _ := d.TrustedKey("")
	if tk.KeyID == "" {
		// Defensive: TrustedKey() may have raced with auto-provision.
		// Re-derive from the signer directly.
		sign, _ := d.Signer("")
		tk.KeyID = sign.KeyID()
		if signerRec, ok := s.SkillTrustStore.Lookup(tk.KeyID); ok {
			tk.PublicKey = signerRec.PublicKey
			tk.Name = signerRec.Name
		}
	}
	tk.AddedAt = time.Now().UTC()
	tk.AddedBy = "dev-keypair-auto"
	s.SkillTrustStore.Add(tk)
	log.Printf("skill signing: dev keypair ready keyID=%s path=%s", tk.KeyID, keyPath)
	// Slot the dev store as the active SignerResolver so callers that
	// already have a keyID in hand can sign without re-loading from disk.
	s.SkillSigner = d
}

// bootstrapVaultSkillSigning wires VaultKeyStore as the active
// SignerResolver when QZDA_VAULT_ADDR + QZDA_VAULT_TOKEN are configured and
// QZDA_SANDBOX_KEYSTORE=vault is set. The dev auto-provision path is skipped
// so no dev-keypair.json ever lands on disk in production. A bootstrap
// lookup against the vault is done to fail fast on misconfiguration.
func (s *Server) bootstrapVaultSkillSigning() {
	if s.Vault == nil || !s.Vault.Enabled() {
		return
	}
	if !envFlagTrue("QZDA_SANDBOX_KEYSTORE") {
		return
	}
	ks, err := signing.NewVaultKeyStore(s.Vault)
	if err != nil {
		log.Printf("skill signing: vault keystore init failed: %v", err)
		return
	}
	probe := envOr("QZDA_VAULT_KEYSTORE_PROBE", "ed25519:probe")
	if _, err := ks.Signer(probe); err != nil {
		log.Printf("skill signing: vault keystore probe %q failed: %v", probe, err)
		return
	}
	s.SkillSigner = ks
	log.Printf("skill signing: vault keystore active probe=%s", probe)
}

// hydrateVaultFromSecrets reloads durable local secrets into the in-memory Vault stub
// so credentials survive process restart when HashiCorp Vault is not configured.
func (s *Server) hydrateVaultFromSecrets() {
	if s == nil || s.Vault == nil || s.Store == nil {
		return
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	for ref, val := range s.Store.ModelSecrets {
		if ref != "" && val != "" && !secretbox.IsSealed(val) && !runtimeenv.FromEnv().IsPro() {
			s.Vault.PutStub(ref, val)
		}
	}
}

func envOr(k, def string) string {
	if v := strings.TrimSpace(lookupEnv(k)); v != "" {
		return v
	}
	return def
}

// heartbeatConfigFromEnv reads QZDA_HEARTBEAT_INTERVAL and QZDA_HEARTBEAT_STALE.
// Both default to heartbeat.DefaultConfig().
func heartbeatConfigFromEnv() heartbeat.Config {
	def := heartbeat.DefaultConfig()
	cfg := def
	if v := strings.TrimSpace(lookupEnv("QZDA_HEARTBEAT_INTERVAL")); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			cfg.Interval = d
			cfg.SweepEvery = d
			cfg.StaleAfter = d * 3
		}
	}
	if v := strings.TrimSpace(lookupEnv("QZDA_HEARTBEAT_STALE")); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			cfg.StaleAfter = d
		}
	}
	return cfg
}

func (s *Server) Handler() http.Handler {
	mode := s.Mode
	if mode == "" {
		mode = ModeAll
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		status := map[string]any{
			"status":           "ok",
			"service":          mode.String(),
			"mode":             string(mode),
			"instance":         instanceID(),
			"replica":          s.replicaRole(),
			"postgresRecovery": s.PostgresRecovery,
		}
		response.OK(w, status)
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		status := map[string]any{
			"status":           "ready",
			"service":          mode.String(),
			"mode":             string(mode),
			"instance":         instanceID(),
			"replica":          s.replicaRole(),
			"postgresRecovery": s.PostgresRecovery,
			"postgres":         s.PG != nil,
			"redis":            s.Cache != nil && s.Cache.Available(),
		}
		if s.PG != nil {
			if err := s.PG.Ping(r.Context()); err != nil {
				status["status"] = "degraded"
				status["postgresError"] = err.Error()
			}
		}
		if s.Cache != nil && s.Cache.Available() {
			if err := s.Cache.Ping(r.Context()); err != nil {
				status["status"] = "degraded"
				status["redisError"] = err.Error()
			}
		}
		response.OK(w, status)
	})
	if mode == ModeAll || mode == ModeApp {
		s.mountConnectRPC(mux)
		mux.HandleFunc("/connect/", s.handleConnect)
		mux.HandleFunc("/v1/evaluate", s.handleLocalPolicyEvaluate)
	}
	mux.HandleFunc("/metrics", s.metricsPrometheus)
	mux.HandleFunc("/", s.route)
	return s.withRecover(cors(s.withHTTPMetrics(s.requireAuth(s.withHeartbeat(mux)))))
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	method := r.Method
	var (
		data any
		err  error
	)
	switch {
	case path == "/api/auth/login" && method == http.MethodPost:
		data, err = s.authH.Login(r)
	case path == "/api/auth/oidc/login" && method == http.MethodGet:
		data, err = s.authH.OIDCLogin(r)
	case path == "/api/auth/oidc/callback" && method == http.MethodGet:
		data, err = s.authH.OIDCCallback(r)
	case path == "/api/workspaces" && method == http.MethodGet:
		data, err = s.listWorkspaces(r)
	case path == "/api/workspaces" && method == http.MethodPost:
		data, err = s.createWorkspace(r)
	// W2-D1 · workspace publisher key CRUD. Must come BEFORE the generic
	// /api/workspaces/ prefix matches below, otherwise
	// workspaceSubresource / workspaceAction would 404 them.
	case strings.HasPrefix(path, "/api/workspaces/") && strings.HasSuffix(path, "/publisher-key/rotate") && method == http.MethodPost:
		data, err = s.rotateWorkspacePublisherKey(r)
	case strings.HasPrefix(path, "/api/workspaces/") && strings.HasSuffix(path, "/publisher-key") && method == http.MethodGet:
		data, err = s.getWorkspacePublisherKey(r)
	case strings.HasPrefix(path, "/api/workspaces/") && strings.HasSuffix(path, "/publisher-key") && method == http.MethodPost:
		data, err = s.createOrRegisterWorkspacePublisherKey(r)
	case strings.HasPrefix(path, "/api/workspaces/") && strings.HasSuffix(path, "/publisher-key") && method == http.MethodDelete:
		data, err = s.revokeWorkspacePublisherKey(r)
	case path == "/api/vault/keys" && method == http.MethodGet:
		data, err = s.listVaultKeys(r)
	case path == "/api/workspace-switch-history" && method == http.MethodGet:
		data, err = s.switchHistory(r)
	case strings.HasPrefix(path, "/api/workspaces/") && method == http.MethodGet:
		data, err = s.workspaceSubresource(r)
	case strings.HasPrefix(path, "/api/workspaces/") && method == http.MethodPost:
		data, err = s.workspaceAction(r)
	case path == "/api/access/governance" && method == http.MethodGet:
		data, err = s.accessGovernance(r)
	case path == "/api/access/grants" && method == http.MethodPost:
		data, err = s.createGrant(r)
	case strings.HasPrefix(path, "/api/access/grants/") && method == http.MethodPost:
		data, err = s.grantAction(r)
	case path == "/api/access/reviews/complete" && method == http.MethodPost:
		data, err = s.completeReview(r)
	case path == "/api/zero-trust/overview" && method == http.MethodGet:
		data, err = s.ztOverview(r)
	case path == "/api/zero-trust/policies" && method == http.MethodGet:
		data, err = s.ztPolicies(r)
	case path == "/api/zero-trust/policies" && method == http.MethodPost:
		data, err = s.createZTPolicy(r)
	case strings.HasPrefix(path, "/api/zero-trust/policies/") && method == http.MethodPatch:
		data, err = s.patchZTPolicy(r)
	case path == "/api/zero-trust/evaluate" && method == http.MethodPost:
		data, err = s.ztEvaluate(r)
	case path == "/api/zero-trust/events" && method == http.MethodGet:
		data, err = s.ztEvents(r)
	case path == "/api/zero-trust/authorizations" && method == http.MethodGet:
		data, err = s.listTempAuth(r)
	case path == "/api/zero-trust/authorizations" && method == http.MethodPost:
		data, err = s.createTempAuth(r)
	case strings.HasPrefix(path, "/api/zero-trust/authorizations/") && strings.HasSuffix(path, "/revoke") && method == http.MethodPost:
		data, err = s.revokeTempAuth(r)
	case path == "/api/release-approvals" && method == http.MethodGet:
		data, err = s.listReleases(r)
	case path == "/api/release-approvals" && method == http.MethodPost:
		data, err = s.createRelease(r)
	case strings.HasPrefix(path, "/api/release-approvals/") && method == http.MethodPost:
		data, err = s.releaseAction(r)
	case path == "/api/audit-center" && method == http.MethodGet:
		data, err = s.auditCenter(r)
	case path == "/api/audit-center/export" && method == http.MethodPost:
		data, err = s.auditExport(r)

	// Phase B — Mock-aligned digital employees / tasks (M05 数字伙伴 façade)
	case path == "/api/partners" && method == http.MethodGet:
		data, err = s.partnerSvc.ListEmployees(r)
	case path == "/api/partners" && method == http.MethodPost:
		data, err = s.partnerSvc.CreateEmployee(r)
	case path == "/api/partners/overview" && method == http.MethodGet:
		data, err = s.partnerSvc.EmployeeOverview(r)
	case path == "/api/partner-templates" && method == http.MethodGet:
		data, err = s.partnerSvc.ListEmployeeTemplates(r)
	case path == "/api/partner-templates" && method == http.MethodPost:
		data, err = s.partnerSvc.ListEmployeeTemplates(r) // create uses same list seed shape via adopt flow primarily
	case path == "/api/partner-template-adoptions" && method == http.MethodGet:
		data, err = s.partnerSvc.ListTemplateAdoptions(r)
	case path == "/api/partner-capability-catalog" && method == http.MethodGet:
		data, err = s.partnerSvc.CapabilityCatalog(r)
	case strings.HasPrefix(path, "/api/partner-templates/") && strings.HasSuffix(path, "/adopt") && method == http.MethodPost:
		data, err = s.partnerSvc.AdoptTemplate(r)
	case strings.HasPrefix(path, "/api/partner-templates/") && method == http.MethodPatch:
		data, err = s.partnerSvc.ListEmployeeTemplates(r)
	case strings.HasPrefix(path, "/api/partners/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch || method == http.MethodDelete):
		data, err = s.partnerSvc.DigitalEmployeeRoute(r)
	case path == "/api/scheduled-tasks" && method == http.MethodGet:
		data, err = s.taskSvc.ListScheduledTasks(r)
	case path == "/api/scheduled-tasks" && method == http.MethodPost:
		data, err = s.taskSvc.CreateScheduledTask(r)
	case strings.HasPrefix(path, "/api/scheduled-tasks/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch || method == http.MethodDelete):
		data, err = s.taskSvc.ScheduledTaskRoute(r)
	case path == "/api/tasks" && method == http.MethodGet:
		data, err = s.taskSvc.ListTasks(r)
	case path == "/api/tasks" && method == http.MethodPost:
		data, err = s.taskSvc.CreateTask(r)
	case strings.HasPrefix(path, "/api/tasks/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.taskSvc.TaskRoute(r)
	case path == "/api/agents" && method == http.MethodGet:
		data, err = s.partnerSvc.LegacyAgentsProxy(r)

	// Models — M08 模型中心 façade (internal/models/). The 13 REST + 1 SSE
	// routes all dispatch through s.modelSvc.<Method>. Package boundary is
	// one-way: models never imports server/.
	case path == "/api/model-providers" && method == http.MethodGet:
		data, err = s.modelSvc.ListModelProviders(r)
	case path == "/api/model-providers" && method == http.MethodPost:
		data, err = s.modelSvc.CreateModelProvider(r)
	case path == "/api/model-providers/discover-models" && method == http.MethodPost:
		data, err = s.modelSvc.DiscoverModels(r)
	case path == "/api/model-providers/test-connection" && method == http.MethodPost:
		data, err = s.modelSvc.TestModelConnection(r)
	case strings.HasPrefix(path, "/api/model-providers/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch || method == http.MethodDelete):
		data, err = s.modelSvc.ModelProviderAction(r)
	case path == "/api/model-routing/policies" && method == http.MethodGet:
		data, err = s.modelSvc.ListRoutingPolicies(r)
	case path == "/api/model-routing/policies" && method == http.MethodPost:
		data, err = s.modelSvc.CreateRoutingPolicy(r)
	case strings.HasPrefix(path, "/api/model-routing/policies/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.modelSvc.RoutingPolicyAction(r)
	case path == "/api/model-routing/failover-tests" && method == http.MethodPost:
		data, err = s.modelSvc.FailoverTest(r)
	case path == "/api/model-governance/overview" && method == http.MethodGet:
		data, err = s.modelSvc.ModelGovernanceOverview(r)
	case path == "/api/model-audit" && method == http.MethodGet:
		data, err = s.modelSvc.ListModelAudit(r)
	case path == "/api/model-invoke" && method == http.MethodPost:
		data, err = s.modelSvc.ModelInvoke(r)
	case path == "/api/model-invoke/stream" && method == http.MethodPost:
		s.modelSvc.ModelInvokeStream(w, r)
		return
	case path == "/api/models/providers" && method == http.MethodGet:
		data, err = s.modelSvc.ListModelProviders(r)
	case path == "/api/models/providers" && method == http.MethodPost:
		data, err = s.modelSvc.CreateModelProvider(r)
	case path == "/api/models/routes" && method == http.MethodGet:
		data, err = s.modelSvc.ListRoutingPolicies(r)
	case path == "/api/models/routes" && method == http.MethodPost:
		data, err = s.modelSvc.CreateModelRoute(r)
	case path == "/api/models/budgets" && method == http.MethodGet:
		data, err = s.modelSvc.ListModelBudgets(r)
	case path == "/api/models/usage" && method == http.MethodGet:
		data, err = s.modelSvc.ListUsage(r)
	case path == "/api/model/routes" && method == http.MethodGet:
		data, err = s.modelSvc.ListModelRoutes(r)
	case path == "/api/model/budgets" && method == http.MethodGet:
		data, err = s.modelSvc.ListModelBudgets(r)
	case path == "/api/usage" && method == http.MethodGet:
		data, err = s.modelSvc.ListUsage(r)

	// Knowledge
	case path == "/api/knowledge/docs" && method == http.MethodGet:
		data, err = s.knowledgeSvc.ListKnowledgeDocs(r)
	case path == "/api/knowledge/docs" && method == http.MethodPost:
		data, err = s.knowledgeSvc.CreateKnowledgeDoc(r)
	case path == "/api/knowledge/docs/delete" && method == http.MethodPost:
		data, err = s.knowledgeSvc.DeleteKnowledgeDocs(r)
	case path == "/api/knowledge/kb-list" && method == http.MethodGet:
		data, err = s.knowledgeSvc.ListKB(r)
	case path == "/api/knowledge/retrieve" && method == http.MethodPost:
		data, err = s.knowledgeSvc.KnowledgeRetrieve(r)
	case strings.HasPrefix(path, "/api/knowledge/doc/") && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeDocDetail(r)
	case strings.HasPrefix(path, "/api/knowledge/doc/") && method == http.MethodDelete:
		data, err = s.knowledgeSvc.DeleteKnowledgeDoc(r)
	case path == "/api/knowledge/packages" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "packages")
	case path == "/api/knowledge/packages" && method == http.MethodPost:
		data, err = s.knowledgeSvc.CreateKnowledgePackage(r)
	case strings.HasPrefix(path, "/api/knowledge/packages/") && method == http.MethodPost:
		data, err = s.knowledgeSvc.KnowledgePackageAction(r)
	case path == "/api/knowledge/sources" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "sources")
	case path == "/api/knowledge/sources" && method == http.MethodPost:
		data, err = s.knowledgeSvc.CreateKnowledgeSource(r)
	case strings.HasPrefix(path, "/api/knowledge/sources/") && strings.HasSuffix(path, "/sync") && method == http.MethodPost:
		data, err = s.knowledgeSvc.SyncKnowledgeSource(r)
	case path == "/api/knowledge/governance" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "governance")
	case path == "/api/knowledge/governance" && method == http.MethodPatch:
		data, err = s.knowledgeSvc.PatchKnowledgeGovernance(r)
	case path == "/api/knowledge/audit" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "audit")
	case path == "/api/knowledge/processing-jobs" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "processingJobs")
	case strings.HasPrefix(path, "/api/knowledge/processing-jobs/") && strings.HasSuffix(path, "/retry") && method == http.MethodPost:
		data, err = s.knowledgeSvc.RetryKnowledgeJob(r)
	case path == "/api/knowledge/retrieval-profiles" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "retrievalProfiles")
	case path == "/api/knowledge/evaluations" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "evaluations")
	case path == "/api/knowledge/graph/entities" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "graphEntities")
	case path == "/api/knowledge/graph/relations" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "graphRelations")
	case path == "/api/knowledge/bindings" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "bindings")
	case path == "/api/knowledge/citation-trace" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "citationTrace")
	case path == "/api/knowledge/eval" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "eval")
	case path == "/api/knowledge/chunks/top" && method == http.MethodGet:
		data, err = s.knowledgeSvc.KnowledgeListFiltered(r, "chunksTop")
	case path == "/api/knowledge/docs/review" && method == http.MethodPost:
		data, err = s.knowledgeSvc.ReviewKnowledgeDocs(r)
	case path == "/api/knowledge/reindex" && method == http.MethodPost:
		data, err = s.knowledgeSvc.ReindexKnowledge(r)
	case path == "/api/knowledge/chunks/rescore" && method == http.MethodPost:
		data, err = s.knowledgeSvc.RescoreKnowledgeChunks(r)
	case path == "/api/knowledge/evaluations/run" && method == http.MethodPost:
		data, err = s.knowledgeSvc.RunKnowledgeEvaluation(r)

	// Copilot — sessions / conversations / actions
	case path == "/api/internal/channel-sessions" && method == http.MethodPost:
		data, err = s.ensureChannelSessionAPI(r)
	case path == "/api/internal/skill-catalog" && method == http.MethodPost:
		data, err = s.upsertSkillCatalogAPI(r)
	case path == "/api/internal/copilot/post-turn" && method == http.MethodPost:
		data, err = s.copilotPostTurnAPI(r)
	case path == "/api/internal/memory/purge-conversation" && method == http.MethodPost:
		data, err = s.purgeConversationMemoryAPI(r)
	case path == "/api/internal/skill/invocation" && method == http.MethodPost:
		data, err = s.skillInvocationAPI(r)
	case path == "/api/sessions" && method == http.MethodGet:
		data, err = s.listSessions(r)
	case path == "/api/sessions" && method == http.MethodPost:
		data, err = s.createSession(r)
	case strings.HasPrefix(path, "/api/sessions/") && strings.HasSuffix(path, "/share") && method == http.MethodPost:
		data, err = s.createSessionShare(r)
	case strings.HasPrefix(path, "/api/sessions/") && strings.HasSuffix(path, "/share") && method == http.MethodDelete:
		data, err = s.revokeSessionShare(r)
	case strings.HasPrefix(path, "/api/sessions/") && method == http.MethodPatch:
		data, err = s.patchSession(r)
	case strings.HasPrefix(path, "/api/sessions/") && method == http.MethodDelete:
		data, err = s.deleteSession(r)
	case path == "/api/sessions/bulk-archive" && method == http.MethodPost:
		s.bulkArchiveSessions(w, r)
		return
	case path == "/api/sessions/bulk-export" && method == http.MethodPost:
		s.bulkExportSessions(w, r)
		return
	case path == "/api/sessions/bulk" && method == http.MethodDelete:
		s.bulkDeleteSessions(w, r)
		return
	case strings.HasPrefix(path, "/api/conversations/") && method == http.MethodDelete && !strings.Contains(path, "/stream") && !strings.Contains(path, "/messages") && !strings.Contains(path, "/tasks") && !strings.Contains(path, "/attachments"):
		data, err = s.deleteConversation(r)
	case path == "/api/slash-commands" && method == http.MethodGet:
		data, err = s.listSlashCommands(r)
	case path == "/api/conversations" && method == http.MethodGet:
		data, err = s.listConversations(r)
	case path == "/api/conversations" && method == http.MethodPost:
		data, err = s.createConversation(r)
	case strings.HasPrefix(path, "/api/conversations/") && strings.HasSuffix(path, "/stream") && method == http.MethodPost:
		s.conversationStream(w, r)
		return
	case strings.HasPrefix(path, "/api/conversations/") && strings.HasSuffix(path, "/tasks") && method == http.MethodPost:
		data, err = s.taskSvc.ConversationCreateTask(r)
	case strings.HasPrefix(path, "/api/conversations/") && strings.HasSuffix(path, "/attachments") && method == http.MethodPost:
		data, err = s.uploadConversationAttachment(r)
	case strings.HasPrefix(path, "/api/conversations/") && strings.HasSuffix(path, "/messages") && method == http.MethodGet:
		data, err = s.listMessages(r)
	case strings.HasPrefix(path, "/api/conversations/") && method == http.MethodGet:
		data, err = s.getConversation(r)
	// M02 专家协作 — copilot handlers live directly on *Server.
	case path == "/api/copilot/conversations" && method == http.MethodGet:
		data, err = s.listConversations(r)
	case path == "/api/copilot/conversations" && method == http.MethodPost:
		data, err = s.createConversation(r)
	case strings.HasPrefix(path, "/api/copilot/conversations/") && strings.Contains(path, "/turns/") && strings.HasSuffix(path, "/status") && method == http.MethodGet:
		data, err = s.getCopilotTurnStatus(r)
	case strings.HasPrefix(path, "/api/copilot/conversations/") && strings.Contains(path, "/turns/") && strings.HasSuffix(path, "/replay") && method == http.MethodGet:
		data, err = s.CopSvc.ReplayCopilotTurn(r)
	case strings.HasPrefix(path, "/api/copilot/conversations/") && strings.HasSuffix(path, "/cancel") && method == http.MethodPost:
		data, err = s.CopSvc.CancelCopilotTurn(r)
	case strings.HasPrefix(path, "/api/copilot/conversations/") && strings.HasSuffix(path, "/stream") && method == http.MethodPost:
		s.copilotStream(w, r)
		return
	case strings.HasPrefix(path, "/api/copilot/conversations/") && strings.Contains(path, "/messages/") && strings.HasSuffix(path, "/feedback") && method == http.MethodPost:
		data, err = s.CopSvc.CopilotMessageFeedback(r)
	case strings.HasPrefix(path, "/api/copilot/conversations/") && strings.Contains(path, "/messages/") && strings.HasSuffix(path, "/variants") && method == http.MethodGet:
		s.listConversationVariants(w, r)
		return
	case strings.HasPrefix(path, "/api/copilot/conversations/") && strings.Contains(path, "/messages/") && strings.HasSuffix(path, "/branch-active") && method == http.MethodPost:
		s.switchConversationVariant(w, r)
		return
	case strings.HasPrefix(path, "/api/actions/") && strings.HasSuffix(path, "/approve") && method == http.MethodPost:
		data, err = s.approveAction(r)
	case strings.HasPrefix(path, "/api/actions/") && strings.HasSuffix(path, "/reject") && method == http.MethodPost:
		data, err = s.rejectAction(r)
	case strings.HasPrefix(path, "/api/actions/") && strings.HasSuffix(path, "/execute") && method == http.MethodPost:
		data, err = s.executeAction(r)
	case strings.HasPrefix(path, "/api/share/") && method == http.MethodGet:
		data, err = s.getSharedSession(r)
	case strings.HasPrefix(path, "/api/attachments/") && method == http.MethodGet:
		s.downloadAttachment(w, r)
		return

	// Workflows
	case path == "/api/workflows" && method == http.MethodGet:
		data, err = s.workflowSvc.ListWorkflows(r)
	case path == "/api/workflows" && method == http.MethodPost:
		data, err = s.workflowSvc.CreateWorkflow(r)
	case path == "/api/workflow-templates" && method == http.MethodGet:
		data, err = s.workflowSvc.ListWorkflowTemplates(r)
	case path == "/api/workflow-templates" && method == http.MethodPost:
		data, err = s.workflowSvc.CreateWorkflowTemplate(r)
	case strings.HasPrefix(path, "/api/workflow-templates/") && method == http.MethodDelete:
		data, err = s.workflowSvc.DeleteWorkflowTemplate(r)
	case path == "/api/workflows/generations" && method == http.MethodGet:
		data, err = s.workflowSvc.ListWorkflowGenerations(r)
	case path == "/api/workflows/generate" && method == http.MethodPost:
		data, err = s.workflowSvc.GenerateWorkflow(r)
	case strings.HasPrefix(path, "/api/workflows/orchestration-sessions"):
		data, err = s.workflowSvc.OrchestrationRoute(r)
	case path == "/api/workflow-skills" && method == http.MethodGet:
		data, err = s.workflowSvc.ListWorkflowSkillsAligned(r)
	case strings.HasPrefix(path, "/api/workflow-skills/") && strings.HasSuffix(path, "/publish") && method == http.MethodPost:
		data, err = s.workflowSvc.PublishWorkflowSkill(r)
	case path == "/api/workflow-runs" && method == http.MethodGet:
		data, err = s.workflowSvc.ListWorkflowRuns(r)
	case path == "/api/workflows/run" && method == http.MethodPost:
		data, err = s.workflowSvc.RunWorkflow(r)
	case strings.HasPrefix(path, "/api/workflows/") && strings.HasSuffix(path, "/capabilities") && method == http.MethodPost:
		data, err = s.workflowSvc.BindWorkflowCapability(r)
	case strings.HasPrefix(path, "/api/workflows/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.workflowSvc.WorkflowByID(r)

	// Skills
	case path == "/api/internal/skill-catalog" && method == http.MethodPost:
		data, err = s.skillsSvc.UpsertSkillCatalogAPI(r)
	case path == "/api/internal/skill/invocation" && method == http.MethodPost:
		data, err = s.skillsSvc.SkillInvocationAPI(r)

	// W3-D1 · Expert Inbox review flow. Order matters: the /:id/review
	// suffix match must precede the generic /api/expert-inbox/:id match
	// (we don't have a single-item GET — only list + review), so this is
	// safe to keep at the top of the inbox block.
	case path == "/api/expert-inbox" && method == http.MethodGet:
		data, err = s.listExpertInbox(r)
	case path == "/api/expert-inbox" && method == http.MethodPost:
		data, err = s.createExpertInbox(r)
	case strings.HasPrefix(path, "/api/expert-inbox/") && strings.HasSuffix(path, "/review") && method == http.MethodPost:
		data, err = s.reviewExpertInbox(r)

	case path == "/api/skills" && method == http.MethodGet:
		data, err = s.skillsSvc.ListSkillsAligned(r)
	case path == "/api/skills" && method == http.MethodPost:
		data, err = s.skillsSvc.CreateSkill(r)
	case path == "/api/skills/import" && method == http.MethodPost:
		data, err = s.skillsSvc.ImportSkills(r)
	case path == "/api/skills/import-package" && method == http.MethodPost:
		data, err = s.skillsSvc.ImportSkillPackage(r)
	case path == "/api/skills/catalog" && method == http.MethodGet:
		data, err = s.skillsSvc.ListSkillCatalog(r)
	case path == "/api/skills/catalog/publish" && method == http.MethodPost:
		data, err = s.skillsSvc.PublishSkillToCatalog(r)
	case path == "/api/skills/catalog/sync" && method == http.MethodPost:
		data, err = s.skillsSvc.SyncSkillCatalog(r)
	case path == "/api/skills/apply-general-pack" && method == http.MethodPost:
		data, err = s.skillsSvc.ApplyGeneralPack(r)
	case path == "/api/skills/packs" && method == http.MethodGet:
		data, err = s.skillsSvc.ListSkillPacks(r)
	case path == "/api/skills/dependency-matrix" && method == http.MethodGet:
		data, err = s.skillsSvc.SkillDependencyMatrix(r)
	case strings.HasPrefix(path, "/api/skills/apply-pack/") && method == http.MethodPost:
		data, err = s.skillsSvc.ApplySkillPack(r)
	case path == "/api/platform-tools/registry" && method == http.MethodGet:
		data, err = s.platformToolsRegistry(r)
	case path == "/api/skills/governance/overview" && method == http.MethodGet:
		data, err = s.skillsSvc.SkillsGovernanceOverview(r)
	case path == "/api/skills/governance/health" && method == http.MethodGet:
		data, err = s.skillsSvc.SkillsGovernanceHealth(r)
	case path == "/api/skills/governance/incidents" && method == http.MethodGet:
		data, err = s.skillsSvc.SkillsGovernanceIncidents(r)
	case path == "/api/skills/governance/events" && method == http.MethodGet:
		data, err = s.skillsSvc.SkillsGovernanceEvents(r)
	case path == "/api/skills/governance/trends" && method == http.MethodGet:
		data, err = s.skillsSvc.SkillsGovernanceTrends(r)
	case path == "/api/skills/governance/batch" && method == http.MethodPost:
		data, err = s.skillsSvc.SkillsGovernanceBatch(r)
	case path == "/api/skills/audit" && method == http.MethodGet:
		data, err = s.skillsSvc.ListSkillAudit(r)
	case path == "/api/skills/execute" && method == http.MethodPost:
		data, err = s.skillsSvc.ExecuteSkill(r)
	case strings.HasPrefix(path, "/api/skill-artifacts/") && strings.Contains(path, "/slides/") && strings.HasSuffix(strings.ToLower(path), ".png") && (method == http.MethodGet || method == http.MethodHead):
		s.skillsSvc.ServeSkillArtifactSlidePNG(w, r)
		return
	case strings.HasPrefix(path, "/api/skill-artifacts/") && strings.HasSuffix(path, "/preview") && (method == http.MethodGet || method == http.MethodHead):
		s.skillsSvc.ServeSkillArtifactPreview(w, r)
		return
	case strings.HasPrefix(path, "/api/skill-artifacts/") && (method == http.MethodGet || method == http.MethodHead):
		s.skillsSvc.ServeSkillArtifact(w, r)
		return
	case strings.HasPrefix(path, "/api/skills/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.skillsSvc.SkillByID(r)
	// W4-D1 · Heartbeat + 在线探测
	case path == "/api/heartbeat" && method == http.MethodGet:
		s.heartbeatProbe(w, r)
		return
	case path == "/api/online" && method == http.MethodGet:
		s.onlineList(w, r)
		return
	case path == "/api/online/stream" && method == http.MethodGet:
		s.onlineStream(w, r)
		return
	// W5-D2 · Multimodal extraction
	case path == "/api/multimodal/extract" && method == http.MethodPost:
		s.multimodalExtractHandler(w, r)
		return
	// W5-D1 · SelfImproving SOP
	case path == "/api/selfimproving/sop" && method == http.MethodPost:
		s.selfimprovingGenerateHandler(w, r)
		return
	// W6-D1 · PM SOP templates + plans
	case path == "/api/pmsop/templates" && method == http.MethodGet:
		s.pmsopTemplatesHandler(w, r)
		return
	case path == "/api/pmsop/plans" && method == http.MethodPost:
		s.pmsopCreatePlanHandler(w, r)
		return
	case path == "/api/pmsop/plans" && method == http.MethodGet:
		s.pmsopListPlansHandler(w, r)
		return
	case strings.HasPrefix(path, "/api/pmsop/plans/") && method == http.MethodGet:
		s.pmsopPlanDetailHandler(w, r)
		return
	case strings.HasSuffix(path, "/events") && strings.HasPrefix(path, "/api/pmsop/plans/") && method == http.MethodPost:
		s.pmsopPlanEventHandler(w, r)
		return
	case path == "/api/skill-integrations" && method == http.MethodGet:
		data, err = s.skillsSvc.ListSkillIntegrations(r)
	case strings.HasPrefix(path, "/api/skill-integrations/") && (method == http.MethodPost || method == http.MethodPatch):
		data, err = s.skillsSvc.SkillIntegrationAction(r)
	case path == "/api/mcp-connections" && method == http.MethodPost:
		data, err = s.skillsSvc.CreateMCPConnection(r)
	case path == "/api/tools" && method == http.MethodPost:
		data, err = s.skillsSvc.CreateTool(r)
	case strings.HasPrefix(path, "/api/agents/") && strings.HasSuffix(path, "/skills") && method == http.MethodPost:
		data, err = s.skillsSvc.BindSkillToAgent(r)

	// Memory
	case path == "/api/memory/overview" && method == http.MethodGet:
		data, err = s.memorySvc.MemoryOverview(r)
	case path == "/api/memory/records" && method == http.MethodGet:
		data, err = s.memorySvc.MemoryRecords(r)
	case path == "/api/memory/records" && method == http.MethodPost:
		data, err = s.memorySvc.MemoryRecordCreate(r)
	case strings.HasPrefix(path, "/api/memory/records/") && (method == http.MethodPost || method == http.MethodDelete):
		data, err = s.memorySvc.MemoryRecordAction(r)
	case path == "/api/memory/candidates" && method == http.MethodGet:
		data, err = s.memorySvc.MemoryCandidates(r)
	case strings.HasPrefix(path, "/api/memory/candidates/") && method == http.MethodPost:
		data, err = s.memorySvc.MemoryCandidateAction(r)
	case path == "/api/memory/refinement/run" && method == http.MethodPost:
		data, err = s.memorySvc.MemoryRefinement(r)
	case path == "/api/memory/policy" && method == http.MethodGet:
		data, err = s.memorySvc.MemoryPolicy(r)
	case path == "/api/memory/policy" && method == http.MethodPatch:
		data, err = s.memorySvc.MemoryPolicyPatch(r)
	case path == "/api/memory/audit" && method == http.MethodGet:
		data, err = s.memorySvc.MemoryAudit(r)
	case path == "/api/memory/identity" && method == http.MethodGet:
		data, err = s.memorySvc.MemoryIdentity(r)
	case path == "/api/memory/identity" && method == http.MethodPut:
		data, err = s.memorySvc.MemoryIdentityUpsert(r)
	case strings.HasPrefix(path, "/api/memory/identity/") && method == http.MethodDelete:
		data, err = s.memorySvc.MemoryIdentityDelete(r)

	// Self-Evolution (Phase 4)
	case path == "/api/evolve/candidates" && method == http.MethodGet:
		data, err = s.CopSvc.ListEvolveCandidates(r)
	case strings.HasPrefix(path, "/api/evolve/candidates/") && method == http.MethodPost:
		data, err = s.CopSvc.EvolveCandidateAction(r)
	case path == "/api/evolve/dream/run" && method == http.MethodPost:
		data, err = s.CopSvc.EvolveDreamRun(r)

	// Channels — Mock channel-control
	case path == "/api/channel-control/deployments" && method == http.MethodGet:
		data, err = s.channelControlDeployments(r)
	case path == "/api/channel-control/deployments" && method == http.MethodPost:
		data, err = s.channelControlCreateDeploy(r)
	case strings.HasPrefix(path, "/api/channel-control/deployments/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch || method == http.MethodDelete):
		data, err = s.channelDeployAction(r)
	case path == "/api/channel-control/policies" && method == http.MethodGet:
		data, err = s.channelControlPolicies(r)
	case strings.HasPrefix(path, "/api/channel-control/policies/") && (method == http.MethodGet || method == http.MethodPost):
		data, err = s.channelControlPolicyAction(r)
	case path == "/api/channel-control/overview" && method == http.MethodGet:
		data, err = s.channelControlOverview(r)
	case path == "/api/channel-control/dead-letters" && method == http.MethodGet:
		data, err = s.channelControlDeadLetters(r)
	case strings.HasPrefix(path, "/api/channel-control/dead-letters/") && strings.HasSuffix(path, "/replay") && method == http.MethodPost:
		data, err = s.replayChannelDLQ(r)
	case strings.HasPrefix(path, "/api/channels/dlq/") && strings.HasSuffix(path, "/replay") && method == http.MethodPost:
		data, err = s.replayChannelDLQ(r)
	case path == "/api/channel-control/audit" && method == http.MethodGet:
		data, err = s.channelControlAudit(r)
	case path == "/api/channel-control/health" && method == http.MethodGet:
		data, err = s.channelControlHealth(r)
	case path == "/api/channel-control/deliveries" && method == http.MethodPost:
		data, err = s.channelControlDeliveries(r)
	case path == "/api/channel-control/inbound" && method == http.MethodGet:
		data, err = s.channelControlInbound(r)
	case strings.HasPrefix(path, "/api/channel/feishu/events/") && method == http.MethodPost:
		s.handleFeishuWebhook(w, r)
		return
	case strings.HasPrefix(path, "/api/channel/wecom/events/") && (method == http.MethodGet || method == http.MethodPost):
		s.handleWecomWebhook(w, r)
		return
	case strings.HasPrefix(path, "/api/channel/dingtalk/events/") && method == http.MethodPost:
		s.handleDingtalkWebhook(w, r)
		return
	case path == "/api/channel-templates" && method == http.MethodGet:
		data, err = s.listChannelTemplates(r)
	case path == "/api/channel-templates" && method == http.MethodPost:
		data, err = s.createChannelTemplate(r)
	case path == "/api/channel-blacklist" && method == http.MethodGet:
		data, err = s.listChannelBlacklist(r)
	case path == "/api/channel-blacklist" && method == http.MethodPost:
		data, err = s.createChannelBlacklist(r)
	case path == "/api/channels" && method == http.MethodGet:
		data, err = s.listChannels(r)
	case path == "/api/channels" && method == http.MethodPost:
		data, err = s.createChannel(r)
	case path == "/api/channels/deployments" && method == http.MethodGet:
		data, err = s.channelControlDeployments(r)
	case path == "/api/channels/outbound" && method == http.MethodPost:
		data, err = s.channelOutbound(r)
	case path == "/api/channels/dlq" && method == http.MethodGet:
		data, err = s.listChannelDLQ(r)

	// Home / ops / settings
	case path == "/api/home/kpis" && method == http.MethodGet:
		data, err = s.opsH.HomeKPIs(r)
	case path == "/api/home/extra" && method == http.MethodGet:
		data, err = s.opsH.HomeExtra(r)
	case path == "/api/home/events" && method == http.MethodGet:
		data, err = s.opsH.HomeEvents(r)
	case path == "/api/home/team" && method == http.MethodGet:
		data, err = s.opsH.HomeTeam(r)
	case path == "/api/home/alerts" && method == http.MethodGet:
		data, err = s.opsH.HomeAlerts(r)
	case strings.HasPrefix(path, "/api/home/alerts/") && (strings.HasSuffix(path, "/acknowledge") || strings.HasSuffix(path, "/ack")) && method == http.MethodPost:
		data, err = s.ackAlertPath(r)
	case path == "/api/operations/overview" && method == http.MethodGet:
		data, err = s.opsH.OpsOverview(r)
	case path == "/api/billing" && method == http.MethodGet:
		data, err = s.settingsSvc.GetBilling(r)
	case path == "/api/billing/quota" && method == http.MethodGet:
		data, err = s.settingsSvc.GetBillingQuota(r)
	case path == "/api/backups" && method == http.MethodGet:
		data, err = s.settingsSvc.ListBackups(r)
	case path == "/api/backups" && method == http.MethodPost:
		data, err = s.settingsSvc.RequestBackup(r)
	case strings.HasPrefix(path, "/api/backups/") && method == http.MethodPost:
		data, err = s.settingsSvc.BackupAction(r)
	case path == "/api/notification-channels" && method == http.MethodGet:
		data, err = s.settingsSvc.ListNotificationChannels(r)
	case strings.HasPrefix(path, "/api/notification-channels/") && method == http.MethodPatch:
		data, err = s.settingsSvc.PatchNotificationChannel(r)
	case path == "/api/tenant/profile" && method == http.MethodGet:
		data, err = s.settingsSvc.GetTenantProfile(r)
	case path == "/api/tenant/profile" && method == http.MethodPatch:
		data, err = s.settingsSvc.PatchTenantProfile(r)
	case path == "/api/api-keys" && method == http.MethodGet:
		data, err = s.settingsSvc.ListAPIKeys(r)
	case path == "/api/webhooks-config" && method == http.MethodGet:
		data, err = s.settingsSvc.ListWebhooksConfig(r)

	default:
		if d, e, ok := s.alias(path, method, r); ok {
			data, err = d, e
		} else {
			err = apperr.NotFoundErr(apperr.NotFound, fmt.Sprintf("no route %s %s", method, path))
		}
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	response.OK(w, data)
}

func writeErr(w http.ResponseWriter, err error) {
	response.Fail(w, err)
}

// artifactPolicy reads QZDA_ARTIFACT_MAX_BYTES + QZDA_ARTIFACT_REQUIRE_AUTH
// and returns the gate configuration for /api/skill-artifacts/*. Built
// once at startup via lazy init; env reads are cached on the Server.
func (s *Server) artifactPolicy() *gateway.ArtifactPolicy {
	p := gateway.DefaultArtifactPolicy()
	if v := strings.TrimSpace(os.Getenv("QZDA_ARTIFACT_MAX_BYTES")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			p.MaxBytes = n
		}
	}
	if envFlagFalse("QZDA_ARTIFACT_REQUIRE_AUTH") {
		p.RequireAuth = false
	}
	return p
}

// appendAuditFn adapts store.AppendAudit to gateway.AuditFunc. workspace
// falls back to "w1" so the audit pipeline never receives an empty scope.
func (s *Server) appendAuditFn() gateway.AuditFunc {
	return func(ws, actor, action, target, result, reason string) {
		if s == nil || s.Store == nil {
			return
		}
		if ws == "" {
			ws = s.workspaceID(nil)
		}
		s.Store.AppendAudit(ws, actor, action, target, result, reason)
	}
}

// identityAdapter wraps the request-scoped identity for the gateway's
// IdentityProvider interface, so server-side handlers don't need to
// reach into context plumbing themselves.
func (s *Server) identityAdapter(r *http.Request) gateway.IdentityProvider {
	id := identityFrom(r.Context())
	return &serverIdentity{id: id, wsFallback: s.workspaceID(r)}
}

type serverIdentity struct {
	id         *auth.Identity
	wsFallback string
}

func (s *serverIdentity) ActorName() string {
	if s.id == nil {
		return ""
	}
	return s.id.Name
}

func (s *serverIdentity) WorkspaceID() string {
	if s.id != nil && s.id.WorkspaceID != "" {
		return s.id.WorkspaceID
	}
	return s.wsFallback
}

func (s *Server) alias(path, method string, r *http.Request) (any, error, bool) {
	switch {
	case path == "/api/model/providers" && method == http.MethodGet:
		v, err := s.modelSvc.ListModelProviders(r)
		return v, err, true
	case path == "/api/model/routes" && method == http.MethodGet:
		v, err := s.modelSvc.ListModelRoutes(r)
		return v, err, true
	}
	return nil, nil, false
}

// buildAuthHandler wires the auth package's HTTP handlers with this server's
// store-backed audit writer. AuditWriter takes the Store's RWMutex around the
// AppendAudit call so the auth package stays free of store imports.
func (s *Server) buildAuthHandler() *auth.Handler {
	var auditWriter auth.AuditWriter
	if s.Store != nil {
		auditWriter = &lockedAuditWriter{store: s.Store}
	}
	return &auth.Handler{
		Sign:        auth.Sign,
		Parse:       auth.Parse,
		OIDC:        &s.OIDC,
		AuditWriter: auditWriter,
		Accounts:    pgAccounts{s: s},
	}
}

// lockedAuditWriter adapts *store.Store to auth.AuditWriter by wrapping the
// AppendAudit call in Lock/Unlock — preserves the original server.login /
// server.oidcCallback synchronization.
type lockedAuditWriter struct {
	store *store.Store
}

func (l *lockedAuditWriter) AppendAudit(workspaceID, actor, action, target, result, reason string) {
	l.store.Lock()
	defer l.store.Unlock()
	l.store.AppendAudit(workspaceID, actor, action, target, result, reason)
}

// buildOpsHandler wires the operations package's HTTP handlers with this
// server's store, audit sink, workspace resolver, replica role, and
// instance id. The operations package stays free of server/ imports.
//
// NOTE: the audit sink MUST NOT take Store.Lock — AckAlert holds the
// write lock around the alert mutation AND the sink call (mirroring
// the legacy server.ackAlert semantics where AppendAudit ran inside
// the same Store.Lock that protected the alert row). If the sink
// re-locked here we'd deadlock (Store.Mutex is non-reentrant).
func (s *Server) buildOpsHandler() *operations.Handler {
	var sink operations.AuditSink
	if s.Store != nil {
		sink = func(ws, actor, action, target, status, detail string) {
			s.Store.AppendAudit(ws, actor, action, target, status, detail)
		}
	}
	return &operations.Handler{
		Store:       s.Store,
		AuditSink:   sink,
		Health:      s, // *Server satisfies operations.HealthProbe (HasPostgres / HasRedis)
		WorkspaceID: s.workspaceID,
		ReplicaRole: s.replicaRole,
		InstanceID:  instanceID,
	}
}

// buildCopSvc wires the M02 (Expert Collaboration) backend. The
// copilot package owns the bulk of the module (turn state machine,
// helpers, types). The 8 HTTP handlers stay on *Server for backward
// compatibility, but the 6 handler methods that moved to copilot.Service
// during the M02 P2 deep move are re-exposed via Service exported
// wrappers (ReplayCopilotTurn, CancelCopilotTurn, CopilotMessageFeedback,
// ListEvolveCandidates, EvolveCandidateAction, EvolveDreamRun). CopSvc
// is a typed namespace that carries the in-memory store + deps the
// CopSvc method-wrappers need; the route table dispatches M02 paths
// through s.<method> for handlers that stay on Server and s.CopSvc.<Fn>
// for the rest. Package boundary stays one-way: copilot never imports
// server/.
func (s *Server) buildCopSvc() *copilot.Service {
	deps := copilot.Deps{
		Workspace: copilot.WorkspaceDeps{
			WorkspaceIDFn:             s.workspaceID,
			RequireMemoryGovernanceFn: s.memorySvc.RequireMemoryGovernanceCompat,
			EvaluateZeroTrustFn:       s.evaluateZeroTrust,
		},
		Routing: copilot.RoutingDeps{
			// Cross-module bridge — M02 expert-collab delegates the actual LLM
			// stream to the M08 模型中心 facade (s.modelSvc.StreamLLMForCopilot).
			// Implementation lives in internal/models/handlers_stream.go. The
			// published-policy lookup also moves to M08 since both share the
			// store snapshot; see internal/models/handlers_invoke.go.
			StreamLLMForCopilotFn:     s.modelSvc.StreamLLMForCopilot,
			PublishedPolicyByLevelFn:  s.modelSvc.PublishedPolicyByLevelLocked,
			ResolveDefaultRiskLevelFn: s.resolveDefaultRiskLevel,
			ResolveDefaultSessionModeFn: s.resolveDefaultSessionMode,
			ResolveMessageBucketIDFn:    s.resolveMessageBucketID,
		},
		Memory: copilot.MemoryDeps{
			AppendMemoryAuditLockedFn: s.appendMemoryAuditLocked,
			MemoryCanReadFn:           s.memoryCanRead,
		},
		Tools: copilot.ToolDeps{
			DispatchAuthorizedToolFn: s.dispatchAuthorizedTool,
			RunSkillToolFn:           s.runSkillTool,
		},
		MultiAgent: copilot.MultiAgentDeps{
			BuildParticipantContextFn: func(in copilot.ParticipantCtxInput, emp map[string]any) copilot.ParticipantContext {
				return s.buildParticipantContext(participantCtxInput(in), emp)
			},
			RunParticipantTurnFn: s.runParticipantTurn,
		},
		Sandbox: copilot.SandboxHelperDeps{
			IsDemoModelAliasFn: isDemoModelAlias,
		},
		SkillsRoot: copilot.SkillsRootDeps{
			// BuiltinSkillsRootFn — the M09 (skills) module owns the on-disk
			// builtin skills directory. We expose s.skillsSvc.BuiltinSkillsRoot
			// as a method value so the copilot module can locate the digest.md
			// for each cognitive framework without copilot→server/ or
			// copilot→skills/ direct imports.
			BuiltinSkillsRootFn: s.skillsSvc.BuiltinSkillsRoot,
		},
	}
	svc := copilot.NewService(s.Store, deps)
	svc.SubAgent = s.SubAgent
	svc.Kernel = s.Kernel
	return svc
}

// buildModelSvc wires the M08 模型中心 (Model Center) HTTP-route façade.
// The models package owns the full M08 surface: 17 REST handlers
// (providers CRUD + governance + audit + routing policies + failover
// drills + model invocation) + the SSE stream endpoint + the Copilot
// LLM streaming bridge (StreamLLMForCopilotFn). Server wires Deps
// (workspace/identity helpers, governance gates, audit sink, rate
// limit, metrics, mode detection, cap-base copy) so the package
// boundary stays one-way: models never imports internal/server/.
//
// Why Deps as function fields (not an interface)?
//   - Keeps models free of any internal/server/ import — Deps is the
//     boundary, not a coupled interface.
//   - Lets tests inject stubs selectively — most fields are nil-safe
//     (every M08 handler does `s.<Field>` lookups before calling).
//   - Avoids the breadth of an interface with ~15 methods when callers
//     want one field each.
func (s *Server) buildModelSvc() *models.Service {
	// Adapter for AllowRate: the legacy s.allowModelRate wraps
	// s.Cache.AllowRate with a "model:" key prefix. Service.allowModelRate
	// already prepends that prefix, so this adapter delegates straight to
	// the cache without re-prefixing (avoids double "model:model:" prefix).
	allowRate := func(ctx context.Context, key string, limit int64, window time.Duration) (bool, error) {
		if s.Cache == nil || !s.Cache.Available() {
			return true, nil // fall back to in-process sliding window
		}
		return s.Cache.AllowRate(ctx, key, limit, window)
	}
	// IsCollabMode adapter: nil-safe wrapper around s.Mode. The Cap-hop
	// split was retired when qzda-app absorbed qzda-cap, so this is
	// effectively dead; kept as a bool closure to satisfy any M08
	// consumers that still wire it.
	isCollab := func() bool { return s != nil && s.Mode == ModeApp }
	// AppendAudit adapter: s.Store.AppendAudit returns the audit entry
	// map; the M08 Deps contract expects a void sink that just records
	// the audit line. Wrapping drops the return value cleanly.
	appendAuditSink := func(workspaceID, actor, action, target, result, reason string) {
		s.Store.AppendAudit(workspaceID, actor, action, target, result, reason)
	}
	svc := models.NewService(s.Store, models.Deps{
		WorkspaceID:                   s.workspaceID,
		IdentityFrom:                  identityFrom,
		DecodeMap:                     decodeMap,
		EvaluateWrite:                 s.evaluateWrite,
		RequiresPeerApprovalGate:      requiresPeerApprovalGate,
		RequireProductionDualApproval: requireProductionDualApproval,
		MaybeHoldForCountersign:       maybeHoldForCountersign,
		ProductionLikeEnv:             productionLikeEnv,
		AppendAudit:                   appendAuditSink,
		AllowRate:                     allowRate,
		IncModelVaultError:            IncModelVaultError,
		IncModelProbe:                 IncModelProbe,
		IncModelPolicyPublish:         IncModelPolicyPublish,
		IncModelBudgetDeny:            IncModelBudgetDeny,
		IsCollabMode:                  isCollab,
		CapBaseURL:                    capBaseURL,
		// Late-bound Vault accessor: tests that swap srv.Vault after
		// New() (e.g. TestResolveModelAliasToPublishedRoute) still see
		// their override, because the Service reads through this
		// callback on every resolve / put / delete. The static
		// svc.Vault field below remains for callers that built the
		// Service without going through New() — service.currentVault
		// prefers VaultFn when set.
		VaultFn: func() *vault.Client { return s.Vault },
	})
	svc.Vault = s.Vault
	svc.Cache = s.Cache
	svc.ModelProbe = s.ModelProbe
	svc.TraceRecorder = s.TraceRecorder
	svc.UsageSink = s.UsageSink
	return svc
}

// buildTaskSvc wires the M03 任务中心 (Task Center) HTTP-route façade.
// The tasks package owns the full M03 surface: the 4 M03 REST handlers
// (listTasks / createTask / taskRoute catch-all /
// conversationCreateTask), the lifecycle FSM + audit + version +
// visibility helpers, and the legacy status-edge table (see
// internal/tasks/{service.go,handlers_*.go,domain.go,domain_extra.go,
// fsm.go}). Server wires the cross-package Deps — workspaceID,
// identityFrom, requireWorkspaceAccess, decodeMap, evaluateWriteLocked,
// the working-memory ingest adapter (lock-protected), persistMemory,
// and the IncTask* metrics — so the package boundary stays one-way:
// tasks never imports server/ — only server/ imports tasks/.
func (s *Server) buildTaskSvc() *tasks.Service {
	// ingestRuntimeMemoryAdapter converts the server-side
	// runtimeMemoryInput type into tasks.RuntimeMemoryInput and calls
	// s.ingestRuntimeMemoryLocked (which requires Store.Lock held by
	// the caller — taskRoute holds the lock when invoking this).
	ingestRuntimeMemoryAdapter := func(in tasks.RuntimeMemoryInput) (map[string]any, error) {
		return s.ingestRuntimeMemoryLocked(runtimeMemoryInput{
			WorkspaceID:      in.WorkspaceID,
			OwnerID:          in.OwnerID,
			OwnerName:        in.OwnerName,
			DigitalPartnerID: in.DigitalPartnerID,
			Title:            in.Title,
			Content:          in.Content,
			SourceType:       in.SourceType,
			SourceID:         in.SourceID,
			CorrelationID:    in.CorrelationID,
			Layer:            in.Layer,
			Scope:            in.Scope,
			Classification:   in.Classification,
			Confidence:       in.Confidence,
		})
	}
	return tasks.NewService(s.Store, tasks.Deps{
		IdentityFrom:              identityFrom,
		WorkspaceID:               s.workspaceID,
		RequireWorkspaceAccess:    s.requireWorkspaceAccess,
		DecodeMap:                 decodeMap,
		EvaluateWriteLocked:       s.evaluateWriteLocked,
		IncTaskCreated:            IncTaskCreated,
		IncTaskTransition:         IncTaskTransition,
		IncTaskApprove:            IncTaskApprove,
		IncTaskTakeover:           IncTaskTakeover,
		IncTaskRetry:              IncTaskRetry,
		IngestRuntimeMemoryLocked: ingestRuntimeMemoryAdapter,
		PersistMemory:             s.persistMemory,
	})
}

// buildPartnerSvc wires the M05 数字伙伴 (Digital Partner) HTTP-route
// façade. The partners package owns the full M05 surface — the 11 REST
// route handlers + the partnerConnect binding for Connect-RPC. Server
// constructs the Service once at boot and binds every cross-package
// helper as a method value on Deps.
//
// Why Deps as function fields (not an interface)?
//   - Keeps partners free of any internal/server/ import — Deps is the
//     boundary, not a coupled interface
//   - Lets tests inject stubs selectively — most fields are nil-safe
//   - Avoids the breadth of an interface with ~30 methods when callers
//     want one field each
//
// Required helpers that stay on *Server (and are wired here as method
// values): workspaceID, identityFrom, requireWorkspaceAccess,
// evaluateWriteLocked, actorIsAdmin, requiresPeerApprovalGate,
// requireProductionDualApproval, maybeHoldForCountersign,
// productionLikeEnv, validateEmployeeConfigurationBody,
// validateEmployeeReleaseGates, employeeEvaluateIncomplete,
// validatePublishedCapabilities, employeeWithRuntimeLocked,
// realEmployeeEvidenceLocked, computeEmployeeRuntimeLocked,
// resolveActiveEmployee, persistEmployeesLocked, afterWriteLocked,
// Store.PersistCollection, modelByIDLocked (adapted), peerGET,
// fetchCapCatalogParts, fetchWorkflowCatalogParts, capBaseURL,
// platformToolsRegistryItems, runtimeToolsRegistryItems, providerModels,
// knowledgeSliceMaps, hasCapability.
func (s *Server) buildPartnerSvc() *partners.Service {
	// modelByIDLocked adapts the *Server signature
	// `(string) (map[string]any, map[string]any)` to the partners.Deps
	// signature `(string) (map[string]any, bool)` — the second map in
	// the original return is the provider record (only relevant for
	// budget lookups), not needed by capability-catalog builders.
	modelByID := func(id string) (map[string]any, bool) {
		m, _ := s.modelByIDLocked(id)
		if m == nil {
			return nil, false
		}
		return m, true
	}
	// persistCollectionForEmp is a thin closure that closes over s.Store
	// so the partner package can write "employees" without holding any
	// pointer to *Server.
	persistCollection := func(collection string, rows []map[string]any) {
		s.Store.PersistCollection(collection, rows)
	}
	// catalogRuntimeTools adapter — partners.Deps.CatalogRuntimeTools
	// accepts an optional `filter any` (currently unused); the local
	// registry helper is parameterless.
	catalogRuntime := func(_ any) []map[string]any {
		return runtimeToolsRegistryItems()
	}
	return partners.NewService(s.Store, partners.Deps{
		WorkspaceID:                       s.workspaceID,
		IdentityFrom:                      identityFrom,
		RequireWorkspaceAccess:            s.requireWorkspaceAccess,
		EvaluateWriteLocked:               s.evaluateWriteLocked,
		ActorIsAdmin:                      actorIsAdmin,
		RequiresPeerApprovalGate:          requiresPeerApprovalGate,
		RequireProductionDualApprovalFn:   requireProductionDualApproval,
		MaybeHoldForCountersign:           maybeHoldForCountersign,
		ProductionLikeEnv:                 productionLikeEnv,
		ValidateEmployeeConfigurationBody: s.validateEmployeeConfigurationBody,
		ValidateEmployeeReleaseGates:      s.validateEmployeeReleaseGates,
		EmployeeEvaluateIncomplete:        s.employeeEvaluateIncomplete,
		ValidatePublishedCapabilities:     s.validatePublishedCapabilities,
		EmployeeWithRuntimeLocked:         s.employeeWithRuntimeLocked,
		RealEmployeeEvidenceLocked:        s.realEmployeeEvidenceLocked,
		ComputeEmployeeRuntimeLocked:      s.computeEmployeeRuntimeLocked,
		ResolveActiveEmployee:             s.resolveActiveEmployee,
		PersistEmployeesLocked:            s.persistEmployeesLocked,
		AfterWriteLocked:                  s.afterWriteLocked,
		PersistCollection:                 persistCollection,
		ModelByIDLocked:                   modelByID,
		CapBaseURL:                        capBaseURL,
		PeerGET:                           s.peerGET,
		FetchCapCatalogParts:              s.fetchCapCatalogParts,
		FetchWorkflowCatalogParts:         s.fetchWorkflowCatalogParts,
		CatalogPlatformTools:              platformToolsRegistryItems,
		CatalogRuntimeTools:               catalogRuntime,
		ProviderModels:                    providerModels,
		KnowledgeSliceMaps:                knowledgeSliceMaps,
		HasCapability:                     hasCapability,
		// BindSkillToAgentFn is the M09 cross-module delegate invoked by
		// the partner-skill-binding handler. Implementation lives on
		// skills.Service so the M05 partners module stays free of any
		// internal/skills/ import — Deps is the boundary.
		BindSkillToAgentFn: s.skillsSvc.BindSkillToAgent,
	})
}

// buildWorkflowSvc wires the M06 工作流程 (Workflow) HTTP-route façade.
// The workflows package owns the full M06 surface: 13 REST handlers
// (list / create / workflowByID catch-all / listWorkflowTemplates /
// createWorkflowTemplate / deleteWorkflowTemplate / listWorkflowGenerations
// / generateWorkflow / listWorkflowSkillsAligned / publishWorkflowSkill /
// listWorkflowRuns / runWorkflow / bindWorkflowCapability) + the
// publish-as-skill + catalog sync helpers + the builtin templates
// loader (EnsureBuiltinWorkflowsReady + workflowTemplateOrigin).
// Server wires Deps (workspace/identity helpers, governance gates,
// skill-catalog sync, persistence helpers, the cross-module
// applyWorkflowSkillCatalog adapter) and binds the
// qzdaworkflow.Engine.StartTrial closure at boot so the package
// boundary stays one-way: workflows never imports internal/server/.
//
// Why Deps as function fields (not an interface)?
//   - Keeps workflows free of any internal/server/ import — Deps is the
//     boundary, not a coupled interface
//   - Lets tests inject stubs selectively — most fields are nil-safe
//   - Avoids the breadth of an interface with ~15 methods when callers
//     want one field each
func (s *Server) buildWorkflowSvc() *workflows.Service {
	// StartTrial adapter: qzdaworkflow.Engine.StartTrial has the
	// signature (ctx, runID, workflowID) (*Run, error). The workflows
	// package Deps wants the same shape; binding the closure lets the
	// workflows handlers call s.Deps.StartTrial without importing
	// qzdaworkflow directly to declare the type — except for the return
	// type, which IS the qzdaworkflow.Run struct (workflows/ does import
	// qzdaworkflow for that type only). The closure wires the live
	// qzdaworkflow.Engine stored on Server.
	startTrial := s.Workflows.StartTrial
	return workflows.NewService(s.Store, workflows.Deps{
		WorkspaceID:                   s.workspaceID,
		DecodeMap:                     decodeMap,
		EvaluateWriteLocked:           s.evaluateWriteLocked,
		RequireSkillRead:              requireSkillRead,
		RequireSkillWrite:             requireSkillWrite,
		RequiresPeerApprovalGate:      requiresPeerApprovalGate,
		RequireProductionDualApproval: requireProductionDualApproval,
		MaybeHoldForCountersign:       maybeHoldForCountersign,
		ProductionLikeEnv:             productionLikeEnv,
		AfterWriteLocked:              s.afterWriteLocked,
		AfterWrite:                    s.afterWrite,
		DurableDeleteSync:             s.durableDeleteSync,
		PersistSkills:                 s.persistSkills,
		PersistSkillExtra:             s.persistSkillExtra,
		PersistSkillHealth:            s.persistSkillHealth,
		ApplyWorkflowSkillCatalog:     s.applyWorkflowSkillCatalog,
		StartTrial:                    startTrial,
	})
}

// EnsureBuiltinWorkflowsReady is a thin delegator over the M06 workflow
// service's builtin pack loader. The M06 builtin_workflows.go + the
// builtin loader moved to internal/workflows/ during the M06 P2 deep
// move; the single-monolith apprun boot path still calls this method on
// the freshly-built *Server (DomainAll),
// so we keep a public *Server entry point that closes over the
// workflowSvc built in New().
func (s *Server) EnsureBuiltinWorkflowsReady() {
	if s.workflowSvc == nil {
		return
	}
	s.workflowSvc.EnsureBuiltinWorkflowsReady()
}

// buildKnowledgeSvc wires the M07 知识中心 (Knowledge Center) HTTP-route
// façade. The knowledge package owns the full M07 surface: 25 REST
// handlers (docs CRUD + retrieve + kb-list + packages + sources +
// governance + processing-jobs + retrieval-profiles + evaluations +
// graph + bindings + citation-trace + eval + chunks + review +
// reindex + rescore + evaluation-run) + the ragConnect binding for
// Connect-RPC + the office builtin loader (EnsureBuiltinKnowledgeReady
// + RetrieveBuiltin). Server wires Deps (workspace/identity helpers,
// governance gates, audit sink, RAG sidecar URL, citation / citationlog
// helpers, record usage, builtin tool registry) so the package
// boundary stays one-way: knowledge never imports internal/server/.
//
// Why Deps as function fields (not an interface)?
//   - Keeps knowledge free of any internal/server/ import — Deps is the
//     boundary, not a coupled interface
//   - Lets tests inject stubs selectively — most fields are nil-safe
//   - Avoids the breadth of an interface with ~25 methods when callers
//     want one field each
//
// Required helpers that stay on *Server (and are wired here as method
// values): workspaceID, identityFrom, decodeMap, evaluateWrite,
// requiresPeerApprovalGate, requireProductionDualApproval,
// maybeHoldForCountersign, productionLikeEnv, appendAuditSink,
// afterWriteLocked, afterWrite, durableDeleteSync, recordUsageWS,
// s.RAGURL accessor, citation.ExtractQuote + citation.QuoteHash +
// citationlog.NewLog etc.
func (s *Server) buildKnowledgeSvc() *knowledge.Service {
	// RAGURL is a string; the knowledge package Deps contract expects a
	// closure so the sidecar URL can be swapped (test stubs). Adapter
	// closure closes over s.RAGURL.
	ragURL := func() string { return s.RAGURL }
	// recordUsageWS is already a *Server method that records a usage
	// meter entry; we adapt its signature from (ws, kind, units, corr)
	// to the knowledge.Deps.RecordUsageWS contract.
	recordUsageWS := s.recordUsageWS
	// appendAuditSink wraps s.Store.AppendAudit so the M07 module can
	// record audit rows without holding any pointer to *Server.
	appendAuditSink := func(workspaceID, actor, action, target, result, reason string) {
		s.Store.AppendAudit(workspaceID, actor, action, target, result, reason)
	}
	// afterWrite / afterWriteLocked / durableDeleteSync are existing
	// *Server helpers exposed via method values.
	return knowledge.NewService(s.Store, knowledge.Deps{
		WorkspaceID:                   s.workspaceID,
		IdentityFrom:                  identityFrom,
		DecodeMap:                     decodeMap,
		EvaluateWrite:                 s.evaluateWrite,
		RequiresPeerApprovalGate:      requiresPeerApprovalGate,
		RequireProductionDualApproval: requireProductionDualApproval,
		MaybeHoldForCountersign:       maybeHoldForCountersign,
		ProductionLikeEnv:             productionLikeEnv,
		AppendAudit:                   appendAuditSink,
		AfterWriteLocked:              s.afterWriteLocked,
		AfterWrite:                    s.afterWrite,
		DurableDeleteSync:             s.durableDeleteSync,
		RAGURL:                        ragURL,
		RecordUsageWS:                 recordUsageWS,
	})
}

// EnsureBuiltinKnowledgeReady is a thin delegator over the M07
// knowledge service's office builtin loader. The single-monolith apprun
// boot path (DomainAll) still calls this method
// on the freshly-built *Server so the legacy call sites keep working
// unchanged. Pattern mirrors EnsureBuiltinWorkflowsReady above.
func (s *Server) EnsureBuiltinKnowledgeReady() {
	if s.knowledgeSvc == nil {
		return
	}
	s.knowledgeSvc.EnsureBuiltinKnowledgeReady()
}

// RetrieveBuiltin is a thin delegator over the M07 knowledge service's
// "knowledge.retrieve" copilot builtin tool handler. Used by the M02
// copilot module when it needs to invoke the tool through a Server
// method (e.g. the supervisor shared retrieve path).
func (s *Server) RetrieveBuiltin(ctx context.Context, r *http.Request, query, corr string) (any, error) {
	if s.knowledgeSvc == nil {
		return nil, nil
	}
	return s.knowledgeSvc.RetrieveBuiltin(ctx, r, query, corr)
}

// citationLog is a thin delegator over the M07 knowledge service's
// per-workspace citation log accessor. Used by handlers_c.go +
// session_panel.go to record citations via the Service façade.
func (s *Server) citationLog() *knowledge.CitationLog {
	if s.knowledgeSvc == nil {
		return nil
	}
	return s.knowledgeSvc.CitationLog()
}

// retrievePublished lives in connect_gateway.go (line 189) as the
// canonical implementation surface that handlers_c.go and
// connect_gateway.go's ragConnect call into. The connect_gateway.go
// version does scope.Allowed filtering + RAG fallback that the M07
// service's retrievePublishedNormalized does not need to duplicate.

// appendKnowledgeAuditLocked is a thin delegator over the M07
// knowledge service's audit-row append. Used by handlers_memory.go +
// handlers_pmsop.go + handlers_selfimproving.go to stamp knowledge
// audit rows into the shared Store.KnowledgeExtra["audit"] slice.
//
// Lock-safety: caller MUST hold Store.Lock — the implementation
// enforces that contract (the package-private helper is named
// ...Locked). The Service-side public wrapper does NOT acquire the
// lock again so re-entrant calls don't deadlock Go's non-reentrant
// sync.Mutex.
func (s *Server) appendKnowledgeAuditLocked(ws, actor, action, target, result, reason string) {
	if s.knowledgeSvc == nil {
		return
	}
	s.knowledgeSvc.AppendKnowledgeAuditLocked(ws, actor, action, target, result, reason)
}

// persistKnowledgeExtra is a thin delegator over the M07 knowledge
// service's persist hook. Used by handlers_memory.go +
// handlers_pmsop.go + handlers_selfimproving.go.
func (s *Server) persistKnowledgeExtra() {
	if s.knowledgeSvc == nil {
		return
	}
	s.knowledgeSvc.PersistKnowledgeExtra()
}

// writeKnowledgeBlob is a thin delegator over the M07 knowledge
// service's blob write helper. Used by handlers_selfimproving.go.
func (s *Server) writeKnowledgeBlob(ws, docID, content string) (string, error) {
	if s.knowledgeSvc == nil {
		return "", nil
	}
	return s.knowledgeSvc.WriteKnowledgeBlob(ws, docID, content)
}

// ensureDraftPackageLocked is a thin delegator over the M07 knowledge
// service's draft-package helper. Used by handlers_selfimproving.go.
// Caller MUST hold Store.Lock.
func (s *Server) ensureDraftPackageLocked(ws, owner string) string {
	if s.knowledgeSvc == nil {
		return ""
	}
	return s.knowledgeSvc.EnsureDraftPackageLocked(ws, owner)
}

// attachDocsToPackageLocked is a thin delegator over the M07
// knowledge service's package-attach helper. Used by
// handlers_selfimproving.go. Caller MUST hold Store.Lock.
func (s *Server) attachDocsToPackageLocked(ws, pkgID string, docIDs []string, markReview bool) int {
	if s.knowledgeSvc == nil {
		return 0
	}
	return s.knowledgeSvc.AttachDocsToPackageLocked(ws, pkgID, docIDs, markReview)
}

// runKnowledgeJob is a thin delegator over the M07 knowledge
// service's job runner. Used by handlers_selfimproving.go. Background
// goroutine — not safe to call from a request handler.
func (s *Server) runKnowledgeJob(jobID string) {
	if s.knowledgeSvc == nil {
		return
	}
	s.knowledgeSvc.RunKnowledgeJob(jobID)
}

// HasPostgres reports whether the backing Postgres pool is wired into the
// server. Implements operations.HealthProbe. Returns false when s is nil
// or the pool was never opened (default in-memory mode).
func (s *Server) HasPostgres() bool {
	return s != nil && s.PG != nil
}

// HasRedis reports whether the Redis cache is wired into the server AND
// reachable (Available() handles lazy connect failures). Implements
// operations.HealthProbe.
func (s *Server) HasRedis() bool {
	return s != nil && s.Cache != nil && s.Cache.Available()
}

// buildAuthMiddleware wires the auth middleware. The role gates and mock-header
// checks live here as closures so the middleware itself stays free of server/
// imports.
func (s *Server) buildAuthMiddleware() *auth.Middleware {
	return &auth.Middleware{
		Parse:                  auth.Parse,
		AllowMockIdentity:      auth.AllowMockIdentity,
		HasMockIdentityHeaders: auth.HasMockIdentityHeaders,
		AuditorWriteGate:       s.auditorWriteGate,
		UserWriteGate:          s.userWriteGate,
	}
}

// auditorWriteGate mirrors the auditor write check originally inline in
// server.requireAuth. Self-Evolution approve|reject routes are the only
// exception — auditor may co-sign there.
func (s *Server) auditorWriteGate(r *http.Request, id *auth.Identity) error {
	if id == nil || id.Role != "auditor" {
		return nil
	}
	p := r.URL.Path
	evolveOK := strings.HasPrefix(p, "/api/evolve/candidates/") &&
		(strings.HasSuffix(p, "/approve") || strings.HasSuffix(p, "/reject"))
	if evolveOK {
		return nil
	}
	return apperr.Forbidden(apperr.AuditorReadOnly, "审计用户仅可读取证据，不能修改平台资源")
}

// userWriteGate mirrors the user-role write gate: blocks platform capability
// and access governance routes.
func (s *Server) userWriteGate(r *http.Request, id *auth.Identity) error {
	if id == nil || id.Role != "user" {
		return nil
	}
	p := r.URL.Path
	if r.Method != http.MethodGet && (strings.HasPrefix(p, "/api/model") || strings.HasPrefix(p, "/api/channel") || strings.HasPrefix(p, "/api/access")) {
		return apperr.Forbidden(apperr.RoleForbidden, "普通用户无权管理平台能力或访问治理")
	}
	return nil
}

func decodeMap(r *http.Request) (map[string]any, error) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return map[string]any{}, nil
	}
	return body, nil
}

func str(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}

func contains(ss []string, x string) bool {
	for _, s := range ss {
		if s == x {
			return true
		}
	}
	return false
}

// --- M07 记忆中心 (Memory Center) cross-package wiring ---
//
// After M07 P2 the memory module's HTTP handlers + helpers live in
// internal/memory/ as a standalone service package. The legacy
// (s *Server) receivers (appendMemoryAuditLocked, memoryPolicyFor,
// ingestRuntimeMemoryLocked, identityStore, persistMemory,
// memoryOverviewAligned, RunMemoryTTLForTest, StartMemoryMaintenance)
// are kept here as thin delegators over s.memorySvc so the rest of
// the server package + the copilot / tasks / cap-delegate cross-
// module callers don't need to be rewritten. The route table at the
// top of route() was already migrated to dispatch M07 paths
// through s.memorySvc.<Method> directly; the delegators below only
// exist for the cross-package helper sites that read into Server
// state directly.
//
// RebuildMemorySvc re-wires the memory service after cross-package
// resources (s.PG, s.RAGURL) are injected. server.New() runs before
// apprun sets s.PG, so buildMemorySvc runs once with PG=nil at boot;
// apprun calls this after the pool is ready so Embedder / VectorUpsert /
// VectorSearch actually wire to a live pgxpool + qzda-rag URL. Cancels the
// previous TTL goroutine before re-binding (StartMemoryMaintenance re-arms).
func (s *Server) RebuildMemorySvc() {
	if s.MemoryTTLCancel != nil {
		s.MemoryTTLCancel()
		s.MemoryTTLCancel = nil
	}
	s.memorySvc = s.buildMemorySvc()
	s.MemoryTTLCancel = s.memorySvc.StartMemoryMaintenance()
}
// close over the *Server helpers the memory module needs (workspace
// resolver, identity reader, body decoder, zero-trust evaluator, and
// the knowledge cross-module bridge).

// buildMemorySvc wires the M07 记忆中心 (Memory Center) HTTP-route
// façade. The memory package owns the full M07 surface (13 REST
// handlers + the runtime ingest entrypoint + the TTL expiry
// goroutine + the identity profile CRUD). Server wires Deps
// (workspace / identity helpers, zero-trust evaluation, knowledge
// cross-module bridge) so the package boundary stays one-way:
// memory never imports internal/server/.
func (s *Server) buildMemorySvc() *mem.Service {
	// M11+: 向量召回 — memory 写路径异步把 (title+content) 嵌入并存
	// 到 memory_vectors;读路径 ?q= 走 cosine top-K。Embedder 走 qzda-rag
	// /v1/embed,VectorStore 走同 PG 实例的 memory_vectors 表。
	var embedder mem.Embedder
	var upsert mem.VectorUpsertFn
	var search mem.VectorSearchFn
	var del mem.VectorDeleteFn
	if s.PG != nil {
		vs := mem.NewVectorStore(s.PG)
		upsert = vs.Upsert
		search = vs.Search
		del = vs.Delete
	}
	embedder = mem.NewEmbedClient(s.RAGURL).Embed
	return mem.NewService(s.Store, mem.Deps{
		WorkspaceID:  s.workspaceID,
		IdentityFrom: identityFrom,
		DecodeMap:    decodeMap,
		EvaluateZeroTrust: func(id *auth.Identity, resource, action, classification string, external bool, corr string) (map[string]any, error) {
			return s.evaluateZeroTrust(id, resource, action, classification, external, corr)
		},
		AppendKnowledgeAuditLocked: s.appendKnowledgeAuditLocked,
		PersistKnowledgeExtra:      s.persistKnowledgeExtra,
		KnowledgeSliceMaps:         knowledgeSliceMaps,
		Embedder:                    embedder,
		VectorUpsert:                upsert,
		VectorSearch:                search,
		VectorDelete:                del,
	}, s.IdentityProfiles)
}

// --- Server-side thin delegators over s.memorySvc ---
//
// These methods preserve the legacy (s *Server) call shape so the
// rest of the server package + cross-package helpers (handlers_c.go,
// copilot_evolve.go, handlers_contract.go, session_panel.go,
// cap_delegate.go, handlers_internal.go) keep working unchanged.
// Nil-safe: every delegator no-ops when s.memorySvc is nil so tests
// that don't wire the package keep compiling.

// StartMemoryMaintenance launches the TTL expiry ticker via the
// memory service. Stores the cancel func on s.MemoryTTLCancel so
// Server.Shutdown stops it deterministically (mirrors the legacy
// (s *Server).StartMemoryMaintenance that wired the goroutine in
// server/memory_ttl.go before M07 P2).
func (s *Server) StartMemoryMaintenance() {
	if s.memorySvc == nil {
		return
	}
	s.MemoryTTLCancel = s.memorySvc.StartMemoryMaintenance()
}

// RunMemoryTTLForTest exposes the TTL pass for unit tests (mirrors
// the legacy (s *Server).RunMemoryTTLForTest shim).
func (s *Server) RunMemoryTTLForTest() {
	if s.memorySvc == nil {
		return
	}
	s.memorySvc.RunMemoryTTLForTest()
}

// appendMemoryAuditLocked is a thin delegator over the memory service.
// Caller MUST hold Store.Lock.
func (s *Server) appendMemoryAuditLocked(ws, actor, action, target, result, corr string) {
	if s.memorySvc == nil {
		return
	}
	s.memorySvc.AppendMemoryAuditLocked(ws, actor, action, target, result, corr)
}

// memoryCanRead is a thin delegator over the memory service. Used by
// copilot context assembly to filter records the viewer can read.
func (s *Server) memoryCanRead(id *auth.Identity, item map[string]any) bool {
	if s.memorySvc == nil {
		return false
	}
	return s.memorySvc.MemoryCanRead(id, item)
}

// memoryPolicyFor returns the workspace memory policy (lazily
// materializing the default).
func (s *Server) memoryPolicyFor(ws string) map[string]any {
	if s.memorySvc == nil {
		return defaultMemoryPolicyLegacy(ws)
	}
	return s.memorySvc.MemoryPolicyFor(ws)
}

// defaultMemoryPolicyLegacy is the seed policy used by the Server-
// side memoryPolicyFor fallback when s.memorySvc isn't yet wired (test
// paths that exercise the legacy code without spinning up the new
// module). Mirrors memory.defaultMemoryPolicy; duplicated here so
// the memory package can stay free of any internal/server/ import.
func defaultMemoryPolicyLegacy(ws string) map[string]any {
	return map[string]any{
		"workspaceId": ws, "shortTermTtlHours": 24, "workingMemoryTtlDays": 30, "dailyRefinementTime": "02:00",
		"shortToWorkingEnabled": true, "workingToLongEnabled": true, "longToKnowledgeEnabled": true,
		"minimumConfidence": 0.85, "longTermWriteApproval": true, "sensitiveDataMasking": true,
		"longTermCapacity": 5000, "usedCapacity": 0,
	}
}

// ingestRuntimeMemoryLocked requires Store.Lock held by caller.
// Adapter signature accepts the legacy server.runtimeMemoryInput type
// (which is now a type alias for mem.RuntimeMemoryInput).
func (s *Server) ingestRuntimeMemoryLocked(in runtimeMemoryInput) (map[string]any, error) {
	if s.memorySvc == nil {
		return nil, nil
	}
	return s.memorySvc.IngestRuntimeMemory(in)
}

// persistMemory flushes the four memory collections to the durable
// backend. Mirrors the legacy (s *Server).persistMemory helper.
func (s *Server) persistMemory() {
	if s.memorySvc == nil {
		return
	}
	s.memorySvc.PersistMemory()
}

// identityStore returns the canonical *memid.Store. Mirrors the
// legacy (s *Server).identityStore that lazily initialized a fresh
// store on first use.
func (s *Server) identityStore() *memid.Store {
	if s.memorySvc != nil {
		return s.memorySvc.IdentityStore()
	}
	if s.IdentityProfiles == nil {
		s.IdentityProfiles = memid.NewStore()
	}
	return s.IdentityProfiles
}

// memoryOverviewAligned is a legacy alias for MemoryOverview that
// returns the (map, nil) tuple the route switch expects. Kept so
// the legacy handlers_d.go memoryOverview shim still compiles
// (the shim itself is removed in the migration but tests that
// reference it through Server methods keep working).
func (s *Server) memoryOverviewAligned(r *http.Request) (any, error) {
	if s.memorySvc == nil {
		return nil, nil
	}
	return s.memorySvc.MemoryOverview(r)
}

// runtimeMemoryInput is the legacy input type used by the
// ingestRuntimeMemoryLocked adapter; re-aliased to mem.RuntimeMemoryInput
// so callers that still construct the unexported type (handlers_c.go,
// handlers_contract.go, handlers_internal.go, cap_delegate.go,
// copilot_phase4_test.go) keep working without churning every site.
type runtimeMemoryInput = mem.RuntimeMemoryInput
