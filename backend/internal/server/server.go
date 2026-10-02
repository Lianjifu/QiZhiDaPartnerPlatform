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

	"github.com/qizhida-partner-platform/backend/internal/agentos"
	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/channel"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/qzdaworkflow"
	"github.com/qizhida-partner-platform/backend/internal/heartbeat"
	"github.com/qizhida-partner-platform/backend/internal/infra"
	"github.com/qizhida-partner-platform/backend/internal/multimodal"
	"github.com/qizhida-partner-platform/backend/internal/operations"
	"github.com/qizhida-partner-platform/backend/internal/pmsop"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/modelprov/trace"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/skills/registry"
	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
	"github.com/qizhida-partner-platform/backend/internal/gateway"
	"github.com/qizhida-partner-platform/backend/internal/metrics"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Type aliases — the original copilot-internal types moved to internal/copilot
// during the M02 backend consolidation (M02 P2 deep move). Local aliases
// keep call sites in server/ readable (no copilot.X noise) while the real
// definitions live in the copilot package. These MUST stay byte-identical
// to the originals — see internal/copilot/service.go and copilot_*.go.
type (
	memoryBudgetReport = copilot.MemoryBudgetReport
	toolRunContext     = copilot.ToolRunContext
	registeredTool     = copilot.RegisteredTool
	toolCallRequest    = copilot.ToolCallRequest
	toolExecResult     = copilot.ToolExecResult
	reactTurnInput     = copilot.ReactTurnInput
	reactTurnResult    = copilot.ReactTurnResult
	reactEmitFunc      = copilot.ReactEmitFunc
	participantContext = copilot.ParticipantContext
	participantTurnResult = copilot.ParticipantTurnResult
	cognitiveDecision  = copilot.CognitiveDecision
	memoryHit          = copilot.MemoryHit
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
	// W7-D1 · SQLite durability hooks. nil when DE_STORE_BACKEND != "sqlite".
	SQLite *store.SQLiteHooks
	// W2-D3 · SubAgent dispatch engine. Built in New(); concurrency cap
	// configured via DE_SUBAGENT_MAX_CONCURRENCY.
	SubAgent *agentos.Engine
	// CopSvc is the M02 专家协作 backend service. Built once in New();
	// server handlers dispatch into its methods (rather than the legacy
	// *Server receivers that lived in copilot_*.go before the M02 P2
	// deep move). nil only during very early boot.
	CopSvc *copilot.Service
	// P1-4 · AuditBus is the Redis stream publisher (DE_REDIS_URL). Injected
	// by apprun/runDurable so future code can read or replace it; its
	// underlying *redis.Client is closed via RegisterCloseFunc by runDurable
	// (registered once for Cache — same rdb).
	AuditBus *infra.AuditBus
	// P1-4 · KafkaBus is the optional Kafka audit publisher
	// (DE_KAFKA_BROKERS). nil when env unset; Close is registered by
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

	// closeMu guards closeFuncs + closed; RegisterCloseFunc and Shutdown
	// race in tests where Shutdown runs on a different goroutine than
	// the apprun boot path.
	closeMu    sync.Mutex
	closeFuncs []func() error // external resources, invoked in parallel by Shutdown
	closed     bool           // set after first Shutdown completes
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
		Store:         st,
		Mode:          ModeAll,
		RuntimeURL:    envOr("DE_AGENT_RUNTIME_URL", "http://127.0.0.1:8091"),
		RAGURL:        envOr("DE_RAG_URL", "http://127.0.0.1:8092"),
		Policy:        policy.New(),
		Vault:         vault.NewFromEnv(),
		OIDC:          auth.LoadOIDC(),
		Workflows:     qzdaworkflow.New(),
		ModelProbe:    modelprov.NewClient(),
		TraceRecorder:    trace.NewRecorder(5000),
		SkillRegistry:    defaultSkillRegistry(),
		IdentityProfiles: memid.NewStore(),
		ChannelRegistry:  channel.NewDefaultRegistry(),
		Heartbeat:        heartbeat.New(heartbeatConfigFromEnv(), nil),
	}
	var hbCtx context.Context
	hbCtx, s.HeartbeatCancel = context.WithCancel(context.Background())
	go s.Heartbeat.Run(hbCtx)
	if !vaultRequiredForCredentials() {
		s.hydrateVaultFromSecrets()
	}
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
	// W7-D1 · SQLite durability layer (gated on DE_STORE_BACKEND=sqlite).
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
	// M02 专家协作 (Expert Collaboration) backend. The copilot package
	// owns the full module (HTTP routes, turn/state machine, helpers,
	// types). Server constructs the Service once, wires its Deps to the
	// methods copilot needs from this Server, and the route table
	// dispatches the 8 M02 paths through s.CopSvc.<Method>. Package
	// boundary is real: copilot never imports server/.
	s.CopSvc = s.buildCopSvc()
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
	if v := strings.TrimSpace(os.Getenv("DE_SUBAGENT_MAX_CONCURRENCY")); v != "" {
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
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("DE_STORE_BACKEND")))
	if backend != "sqlite" {
		return
	}
	path := strings.TrimSpace(os.Getenv("DE_SQLITE_PATH"))
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
	tfPath := envOr("DE_TRUSTED_PUBLISHERS_PATH", "data/skill-keys/trusted-publishers.json")
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
	keyPath := envOr("DE_DEV_KEYPAIR_PATH", "data/skill-keys/dev-keypair.json")
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
// SignerResolver when DE_VAULT_ADDR + DE_VAULT_TOKEN are configured and
// DE_SANDBOX_KEYSTORE=vault is set. The dev auto-provision path is skipped
// so no dev-keypair.json ever lands on disk in production. A bootstrap
// lookup against the vault is done to fail fast on misconfiguration.
func (s *Server) bootstrapVaultSkillSigning() {
	if s.Vault == nil || !s.Vault.Enabled() {
		return
	}
	if !envFlagTrue("DE_SANDBOX_KEYSTORE") {
		return
	}
	ks, err := signing.NewVaultKeyStore(s.Vault)
	if err != nil {
		log.Printf("skill signing: vault keystore init failed: %v", err)
		return
	}
	probe := envOr("DE_VAULT_KEYSTORE_PROBE", "ed25519:probe")
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
		if ref != "" && val != "" {
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

// heartbeatConfigFromEnv reads DE_HEARTBEAT_INTERVAL and DE_HEARTBEAT_STALE.
// Both default to heartbeat.DefaultConfig().
func heartbeatConfigFromEnv() heartbeat.Config {
	def := heartbeat.DefaultConfig()
	cfg := def
	if v := strings.TrimSpace(lookupEnv("DE_HEARTBEAT_INTERVAL")); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			cfg.Interval = d
			cfg.SweepEvery = d
			cfg.StaleAfter = d * 3
		}
	}
	if v := strings.TrimSpace(lookupEnv("DE_HEARTBEAT_STALE")); v != "" {
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
	if mode == ModeAll || mode == ModeApp || mode == ModeSys || mode == ModeCollab || mode == ModeCap || mode == ModePolicy || mode == ModeAudit {
		s.mountConnectRPCForMode(mux, mode)
		mux.HandleFunc("/connect/", s.handleConnect)
	}
	if mode == ModeAll || mode == ModeApp || mode == ModePolicy || (mode == ModeSys && sysAbsorbsCrosscutting()) {
		mux.HandleFunc("/v1/evaluate", s.handleLocalPolicyEvaluate)
	}
	mux.HandleFunc("/metrics", s.metricsPrometheus)
	mux.HandleFunc("/", s.route)
	return s.withRecover(cors(s.withHTTPMetrics(s.requireAuth(s.withHeartbeat(mux)))))
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	method := r.Method
	mode := s.Mode
	if mode == "" {
		mode = ModeAll
	}
	if !mode.OwnsPath(path) {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, fmt.Sprintf("route owned by other unit: %s %s (this=%s)", method, path, mode.String())))
		return
	}
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

	// Phase B — Mock-aligned digital employees / tasks
	case path == "/api/partners" && method == http.MethodGet:
		data, err = s.listEmployees(r)
	case path == "/api/partners" && method == http.MethodPost:
		data, err = s.createEmployee(r)
	case path == "/api/partners/overview" && method == http.MethodGet:
		data, err = s.employeeOverview(r)
	case path == "/api/partner-templates" && method == http.MethodGet:
		data, err = s.listEmployeeTemplates(r)
	case path == "/api/partner-templates" && method == http.MethodPost:
		data, err = s.listEmployeeTemplates(r) // create uses same list seed shape via adopt flow primarily
	case path == "/api/partner-template-adoptions" && method == http.MethodGet:
		data, err = s.listTemplateAdoptions(r)
	case path == "/api/partner-capability-catalog" && method == http.MethodGet:
		data, err = s.capabilityCatalog(r)
	case strings.HasPrefix(path, "/api/partner-templates/") && strings.HasSuffix(path, "/adopt") && method == http.MethodPost:
		data, err = s.adoptTemplate(r)
	case strings.HasPrefix(path, "/api/partner-templates/") && method == http.MethodPatch:
		data, err = s.listEmployeeTemplates(r)
	case strings.HasPrefix(path, "/api/partners/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.digitalEmployeeRoute(r)
	case path == "/api/tasks" && method == http.MethodGet:
		data, err = s.listTasksAligned(r)
	case path == "/api/tasks" && method == http.MethodPost:
		data, err = s.createTaskAligned(r)
	case strings.HasPrefix(path, "/api/tasks/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.taskRoute(r)
	case path == "/api/agents" && method == http.MethodGet:
		data, err = s.legacyAgentsProxy(r)

	// Models — Mock paths
	case path == "/api/model-providers" && method == http.MethodGet:
		data, err = s.listModelProvidersFE(r)
	case path == "/api/model-providers" && method == http.MethodPost:
		data, err = s.createModelProviderFE(r)
	case path == "/api/model-providers/discover-models" && method == http.MethodPost:
		data, err = s.discoverModels(r)
	case path == "/api/model-providers/test-connection" && method == http.MethodPost:
		data, err = s.testModelConnection(r)
	case strings.HasPrefix(path, "/api/model-providers/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch || method == http.MethodDelete):
		data, err = s.modelProviderAction(r)
	case path == "/api/model-routing/policies" && method == http.MethodGet:
		data, err = s.listRoutingPolicies(r)
	case path == "/api/model-routing/policies" && method == http.MethodPost:
		data, err = s.createRoutingPolicy(r)
	case strings.HasPrefix(path, "/api/model-routing/policies/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.routingPolicyAction(r)
	case path == "/api/model-routing/failover-tests" && method == http.MethodPost:
		data, err = s.failoverTest(r)
	case path == "/api/model-governance/overview" && method == http.MethodGet:
		data, err = s.modelGovernanceOverview(r)
	case path == "/api/model-audit" && method == http.MethodGet:
		data, err = s.listModelAudit(r)
	case path == "/api/model-invoke" && method == http.MethodPost:
		data, err = s.modelInvoke(r)
	case path == "/api/model-invoke/stream" && method == http.MethodPost:
		s.modelInvokeStream(w, r)
		return
	case path == "/api/models/providers" && method == http.MethodGet:
		data, err = s.listModelProvidersFE(r)
	case path == "/api/models/providers" && method == http.MethodPost:
		data, err = s.createModelProviderFE(r)
	case path == "/api/models/routes" && method == http.MethodGet:
		data, err = s.listRoutingPolicies(r)
	case path == "/api/models/routes" && method == http.MethodPost:
		data, err = s.createModelRoute(r)
	case path == "/api/models/budgets" && method == http.MethodGet:
		data, err = s.listModelBudgets(r)
	case path == "/api/models/usage" && method == http.MethodGet:
		data, err = s.listUsage(r)

	// Knowledge
	case path == "/api/knowledge/docs" && method == http.MethodGet:
		data, err = s.listKnowledgeDocsAuth(r)
	case path == "/api/knowledge/docs" && method == http.MethodPost:
		data, err = s.createKnowledgeDocAuth(r)
	case path == "/api/knowledge/docs/delete" && method == http.MethodPost:
		data, err = s.deleteKnowledgeDocsAuth(r)
	case path == "/api/knowledge/kb-list" && method == http.MethodGet:
		data, err = s.listKBAuth(r)
	case path == "/api/knowledge/retrieve" && method == http.MethodPost:
		data, err = s.knowledgeRetrieveAuth(r)
	case strings.HasPrefix(path, "/api/knowledge/doc/") && method == http.MethodGet:
		data, err = s.knowledgeDocDetailAuth(r)
	case strings.HasPrefix(path, "/api/knowledge/doc/") && method == http.MethodDelete:
		data, err = s.deleteKnowledgeDocAuth(r)
	case path == "/api/knowledge/packages" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "packages")
	case path == "/api/knowledge/packages" && method == http.MethodPost:
		data, err = s.createKnowledgePackage(r)
	case strings.HasPrefix(path, "/api/knowledge/packages/") && method == http.MethodPost:
		data, err = s.knowledgePackageAction(r)
	case path == "/api/knowledge/sources" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "sources")
	case path == "/api/knowledge/sources" && method == http.MethodPost:
		data, err = s.createKnowledgeSource(r)
	case strings.HasPrefix(path, "/api/knowledge/sources/") && strings.HasSuffix(path, "/sync") && method == http.MethodPost:
		data, err = s.syncKnowledgeSource(r)
	case path == "/api/knowledge/governance" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "governance")
	case path == "/api/knowledge/governance" && method == http.MethodPatch:
		data, err = s.patchKnowledgeGovernanceAuth(r)
	case path == "/api/knowledge/audit" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "audit")
	case path == "/api/knowledge/processing-jobs" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "processingJobs")
	case strings.HasPrefix(path, "/api/knowledge/processing-jobs/") && strings.HasSuffix(path, "/retry") && method == http.MethodPost:
		data, err = s.retryKnowledgeJob(r)
	case path == "/api/knowledge/retrieval-profiles" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "retrievalProfiles")
	case path == "/api/knowledge/evaluations" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "evaluations")
	case path == "/api/knowledge/graph/entities" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "graphEntities")
	case path == "/api/knowledge/graph/relations" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "graphRelations")
	case path == "/api/knowledge/bindings" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "bindings")
	case path == "/api/knowledge/citation-trace" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "citationTrace")
	case path == "/api/knowledge/eval" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "eval")
	case path == "/api/knowledge/chunks/top" && method == http.MethodGet:
		data, err = s.knowledgeExtraFiltered(r, "chunksTop")
	case path == "/api/knowledge/docs/review" && method == http.MethodPost:
		data, err = s.reviewKnowledgeDocs(r)
	case path == "/api/knowledge/reindex" && method == http.MethodPost:
		data, err = s.reindexKnowledgeAuth(r)
	case path == "/api/knowledge/chunks/rescore" && method == http.MethodPost:
		data, err = s.rescoreKnowledgeChunks(r)
	case path == "/api/knowledge/evaluations/run" && method == http.MethodPost:
		data, err = s.runKnowledgeEvaluation(r)

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
		data, err = s.conversationCreateTask(r)
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
		data, err = s.listWorkflows(r)
	case path == "/api/workflows" && method == http.MethodPost:
		data, err = s.createWorkflow(r)
	case path == "/api/workflow-templates" && method == http.MethodGet:
		data, err = s.listWorkflowTemplates(r)
	case path == "/api/workflow-templates" && method == http.MethodPost:
		data, err = s.createWorkflowTemplate(r)
	case strings.HasPrefix(path, "/api/workflow-templates/") && method == http.MethodDelete:
		data, err = s.deleteWorkflowTemplate(r)
	case path == "/api/workflows/generations" && method == http.MethodGet:
		data, err = s.listWorkflowGenerations(r)
	case path == "/api/workflows/generate" && method == http.MethodPost:
		data, err = s.generateWorkflow(r)
	case path == "/api/workflow-skills" && method == http.MethodGet:
		data, err = s.listWorkflowSkillsAligned(r)
	case strings.HasPrefix(path, "/api/workflow-skills/") && strings.HasSuffix(path, "/publish") && method == http.MethodPost:
		data, err = s.publishWorkflowSkill(r)
	case path == "/api/workflow-runs" && method == http.MethodGet:
		data, err = s.listWorkflowRuns(r)
	case path == "/api/workflows/run" && method == http.MethodPost:
		data, err = s.runWorkflow(r)
	case strings.HasPrefix(path, "/api/workflows/") && strings.HasSuffix(path, "/capabilities") && method == http.MethodPost:
		data, err = s.bindWorkflowCapability(r)
	case strings.HasPrefix(path, "/api/workflows/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.workflowByID(r)

	// Skills
	case path == "/api/internal/skill-catalog" && method == http.MethodPost:
		data, err = s.upsertSkillCatalogAPI(r)
	case path == "/api/internal/skill/invocation" && method == http.MethodPost:
		data, err = s.skillInvocationAPI(r)

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
		data, err = s.listSkillsAligned(r)
	case path == "/api/skills" && method == http.MethodPost:
		data, err = s.createSkill(r)
	case path == "/api/skills/import" && method == http.MethodPost:
		data, err = s.importSkills(r)
	case path == "/api/skills/import-package" && method == http.MethodPost:
		data, err = s.importSkillPackage(r)
	case path == "/api/skills/catalog" && method == http.MethodGet:
		data, err = s.listSkillCatalog(r)
	case path == "/api/skills/catalog/publish" && method == http.MethodPost:
		data, err = s.publishSkillToCatalog(r)
	case path == "/api/skills/catalog/sync" && method == http.MethodPost:
		data, err = s.syncSkillCatalog(r)
	case path == "/api/skills/apply-general-pack" && method == http.MethodPost:
		data, err = s.applyGeneralPack(r)
	case path == "/api/skills/packs" && method == http.MethodGet:
		data, err = s.listSkillPacks(r)
	case path == "/api/skills/dependency-matrix" && method == http.MethodGet:
		data, err = s.skillDependencyMatrix(r)
	case strings.HasPrefix(path, "/api/skills/apply-pack/") && method == http.MethodPost:
		data, err = s.applySkillPack(r)
	case path == "/api/platform-tools/registry" && method == http.MethodGet:
		data, err = s.platformToolsRegistry(r)
	case path == "/api/skills/governance/overview" && method == http.MethodGet:
		data, err = s.skillsGovernanceOverview(r)
	case path == "/api/skills/governance/health" && method == http.MethodGet:
		data, err = s.skillsGovernanceHealth(r)
	case path == "/api/skills/governance/incidents" && method == http.MethodGet:
		data, err = s.skillsGovernanceIncidents(r)
	case path == "/api/skills/governance/events" && method == http.MethodGet:
		data, err = s.skillsGovernanceEvents(r)
	case path == "/api/skills/governance/trends" && method == http.MethodGet:
		data, err = s.skillsGovernanceTrends(r)
	case path == "/api/skills/governance/batch" && method == http.MethodPost:
		data, err = s.skillsGovernanceBatch(r)
	case path == "/api/skills/audit" && method == http.MethodGet:
		data, err = s.listSkillAudit(r)
	case path == "/api/skills/execute" && method == http.MethodPost:
		data, err = s.executeSkill(r)
	case strings.HasPrefix(path, "/api/skill-artifacts/") && strings.Contains(path, "/slides/") && strings.HasSuffix(strings.ToLower(path), ".png") && (method == http.MethodGet || method == http.MethodHead):
		s.serveSkillArtifactSlidePNG(w, r)
		return
	case strings.HasPrefix(path, "/api/skill-artifacts/") && strings.HasSuffix(path, "/preview") && (method == http.MethodGet || method == http.MethodHead):
		s.serveSkillArtifactPreview(w, r)
		return
	case strings.HasPrefix(path, "/api/skill-artifacts/") && (method == http.MethodGet || method == http.MethodHead):
		s.serveSkillArtifact(w, r)
		return
	case strings.HasPrefix(path, "/api/skills/") && (method == http.MethodGet || method == http.MethodPost || method == http.MethodPatch):
		data, err = s.skillByID(r)
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
		data, err = s.listSkillIntegrations(r)
	case strings.HasPrefix(path, "/api/skill-integrations/") && (method == http.MethodPost || method == http.MethodPatch):
		data, err = s.skillIntegrationAction(r)
	case path == "/api/mcp-connections" && method == http.MethodPost:
		data, err = s.createMCPConnection(r)
	case path == "/api/tools" && method == http.MethodPost:
		data, err = s.createTool(r)
	case strings.HasPrefix(path, "/api/agents/") && strings.HasSuffix(path, "/skills") && method == http.MethodPost:
		data, err = s.bindAgentSkill(r)

	// Memory
	case path == "/api/memory/overview" && method == http.MethodGet:
		data, err = s.memoryOverviewAligned(r)
	case path == "/api/memory/records" && method == http.MethodGet:
		data, err = s.listMemory(r)
	case path == "/api/memory/records" && method == http.MethodPost:
		data, err = s.createMemory(r)
	case strings.HasPrefix(path, "/api/memory/records/") && (method == http.MethodPost || method == http.MethodDelete):
		data, err = s.memoryRecordAction(r)
	case path == "/api/memory/candidates" && method == http.MethodGet:
		data, err = s.listMemoryCandidates(r)
	case strings.HasPrefix(path, "/api/memory/candidates/") && method == http.MethodPost:
		data, err = s.memoryCandidateActionAligned(r)
	case path == "/api/memory/refinement/run" && method == http.MethodPost:
		data, err = s.memoryRefinement(r)
	case path == "/api/memory/policy" && method == http.MethodGet:
		data, err = s.getMemoryPolicy(r)
	case path == "/api/memory/policy" && method == http.MethodPatch:
		data, err = s.patchMemoryPolicy(r)
	case path == "/api/memory/audit" && method == http.MethodGet:
		data, err = s.listMemoryAudits(r)
	case path == "/api/memory/identity" && method == http.MethodGet:
		data, err = s.listMemoryIdentity(r)
	case path == "/api/memory/identity" && method == http.MethodPut:
		data, err = s.upsertMemoryIdentity(r)
	case strings.HasPrefix(path, "/api/memory/identity/") && method == http.MethodDelete:
		data, err = s.deleteMemoryIdentity(r)

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
		data, err = s.getBilling(r)
	case path == "/api/billing/quota" && method == http.MethodGet:
		data, err = s.getBillingQuota(r)
	case path == "/api/backups" && method == http.MethodGet:
		data, err = s.listBackups(r)
	case path == "/api/backups" && method == http.MethodPost:
		data, err = s.requestBackup(r)
	case strings.HasPrefix(path, "/api/backups/") && method == http.MethodPost:
		data, err = s.backupAction(r)
	case path == "/api/notification-channels" && method == http.MethodGet:
		data, err = s.listNotificationChannels(r)
	case strings.HasPrefix(path, "/api/notification-channels/") && method == http.MethodPatch:
		data, err = s.patchNotificationChannel(r)
	case path == "/api/tenant/profile" && method == http.MethodGet:
		data, err = s.getTenantProfile(r)
	case path == "/api/tenant/profile" && method == http.MethodPatch:
		data, err = s.patchTenantProfile(r)
	case path == "/api/api-keys" && method == http.MethodGet:
		data, err = s.listAPIKeys(r)
	case path == "/api/webhooks-config" && method == http.MethodGet:
		data, err = s.listWebhooksConfig(r)

	// Aliases absorbed from former qzda-policy / qzda-audit proxy surfaces
	case path == "/api/governance" && method == http.MethodGet:
		data, err = s.accessGovernance(r)
	case (path == "/api/audit" || path == "/api/audits") && method == http.MethodGet:
		data, err = s.auditCenter(r)

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

// artifactPolicy reads DE_ARTIFACT_MAX_BYTES + DE_ARTIFACT_REQUIRE_AUTH
// and returns the gate configuration for /api/skill-artifacts/*. Built
// once at startup via lazy init; env reads are cached on the Server.
func (s *Server) artifactPolicy() *gateway.ArtifactPolicy {
	p := gateway.DefaultArtifactPolicy()
	if v := strings.TrimSpace(os.Getenv("DE_ARTIFACT_MAX_BYTES")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			p.MaxBytes = n
		}
	}
	if envFlagFalse("DE_ARTIFACT_REQUIRE_AUTH") {
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
		v, err := s.listModelProviders(r)
		return v, err, true
	case path == "/api/model/routes" && method == http.MethodGet:
		v, err := s.listModelRoutes(r)
		return v, err, true
	case path == "/api/channel/deployments" && method == http.MethodGet:
		v, err := s.listChannelDeploys(r)
		return v, err, true
	case path == "/api/channels/list" && method == http.MethodGet:
		v, err := s.listChannels(r)
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
		WorkspaceIDFn:               s.workspaceID,
		RequireMemoryGovernanceFn:   s.requireMemoryGovernance,
		EvaluateZeroTrustFn:         s.evaluateZeroTrust,
		ResolveDefaultRiskLevelFn:   s.resolveDefaultRiskLevel,
		ResolveDefaultSessionModeFn: s.resolveDefaultSessionMode,
		ResolveMessageBucketIDFn:    s.resolveMessageBucketID,
		StreamLLMForCopilotFn:       s.streamLLMForCopilot,
		AppendMemoryAuditLockedFn:   s.appendMemoryAuditLocked,
		RunParticipantTurnFn:        s.runParticipantTurn,
		RunSkillToolFn:              s.runSkillTool,
		DispatchAuthorizedToolFn:    s.dispatchAuthorizedTool,
		BuildParticipantContextFn: func(in copilot.ParticipantCtxInput, emp map[string]any) copilot.ParticipantContext {
			return s.buildParticipantContext(participantCtxInput(in), emp)
		},
		IsDemoModelAliasFn:            isDemoModelAlias,
		PublishedPolicyByLevelFn:      s.publishedPolicyByLevelLocked,
	}
	svc := copilot.NewService(s.Store, deps)
	svc.SubAgent = s.SubAgent
	svc.Kernel = s.Kernel
	return svc
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
		Parse:                auth.Parse,
		AllowMockIdentity:    auth.AllowMockIdentity,
		HasMockIdentityHeaders: auth.HasMockIdentityHeaders,
		AuditorWriteGate:     s.auditorWriteGate,
		UserWriteGate:        s.userWriteGate,
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
