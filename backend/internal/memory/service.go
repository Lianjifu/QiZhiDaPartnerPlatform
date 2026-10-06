// Package memory is the M07 记忆中心 (Memory Center) module — the HTTP
// façade that owns the memory records / candidates / policy / refinement
// / audit / identity surface (13 REST routes + the TTL expiry goroutine
// + the runtime ingest entrypoint used by tasks + copilot + cap-delegate).
//
// History: prior to M07 P2 all M07 handlers lived in internal/server/ as
// (s *Server) receiver methods across handlers_memory.go, memory_ttl.go,
// and the inline runtimeMemoryInput type. Phase 2 of the M07 记忆中心整合方案
// (docs/整合方案/记忆中心模块整合方案.md) extracts that M07 code into
// internal/memory/ using the standard partners/copilot/tasks/workflows
// pattern: function-value Deps struct + NewService(deps) constructor +
// Service façade methods.
//
// Service is constructed once at server boot via NewService(deps). The
// route table in server.go dispatches the 13 M07 routes through
// s.memorySvc.<Method>(r). The package boundary is one-way:
// internal/memory never imports internal/server/.
//
// Required helpers stay on Server and are bound as method values on Deps:
// workspaceID, identityFrom, decodeMap, evaluateZeroTrust (zero-trust
// gating for requireMemoryGovernance), knowledgeSliceMaps +
// appendKnowledgeAuditLocked + persistKnowledgeExtra (cross-module bridge
// for the candidate→knowledge promotion flow). The
// IngestRuntimeMemoryLocked adapter exposes the lock-protected runtime
// ingest for tasks + copilot + cap-delegate without those packages
// needing to import internal/memory/ directly.
package memory

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// IdentityProfile is a re-export of memory/identity.Profile so the
// Service.IdentityProfiles field + cross-package callers can refer to the
// shape without importing internal/memory/identity/.
type IdentityProfile = memid.Profile

// RuntimeMemoryInput mirrors the input shape used by ingestRuntimeMemoryLocked.
// Exported so tasks.RuntimeMemoryInput → memory.RuntimeMemoryInput conversion
// stays adapter-only (server.New() closes over the conversion in buildTaskSvc
// and buildCopSvc, never leaking internal/server helpers into the tasks /
// copilot packages).
type RuntimeMemoryInput struct {
	WorkspaceID       string
	OwnerID           string
	OwnerName         string
	DigitalPartnerID string
	Title             string
	Content           string
	SourceType        string
	SourceID          string
	CorrelationID     string
	Layer             string // short_term | working
	Scope             string
	Classification    string
	Confidence        float64
}

// Deps groups the cross-package helpers the M07 module needs. Server.New()
// constructs the Service once and passes method values bound to its own
// *Server methods. The package boundary stays one-way: internal/memory/
// never imports internal/server/.
//
// All fields are required for production callers (Server.New wires them
// all). Tests can leave any subset nil and nil-check at the call site
// (each M07 handler does `s.<Field>` lookups before calling).
type Deps struct {
	// Workspace / identity / access gating — every handler.
	WorkspaceID  func(r *http.Request) string
	IdentityFrom func(ctx context.Context) *auth.Identity
	DecodeMap    func(r *http.Request) (map[string]any, error)

	// Zero-trust evaluation — requireMemoryGovernance gate.
	EvaluateZeroTrust func(id *auth.Identity, resource, action, classification string, external bool, corr string) (map[string]any, error)

	// Knowledge cross-module bridge — memoryCandidateActionAligned writes a
	// draft knowledge package + knowledge audit row when a candidate is
	// approved. Server.go wires appendKnowledgeAuditLocked +
	// persistKnowledgeExtra + knowledgeSliceMaps (the helpers from
	// knowledge_compat.go) so memory never imports internal/knowledge/.
	AppendKnowledgeAuditLocked func(ws, actor, action, target, result, reason string)
	PersistKnowledgeExtra      func()
	KnowledgeSliceMaps         func(v any) []map[string]any

	// Vector + embedder — semantic recall wiring. Server.go binds these
	// to (*memory.EmbedClient).Embed and (*memory.VectorStoreClient)
	// .{Upsert,Search,Delete}. Tests / older builds can leave any of
	// them nil: nil Embedder / VectorUpsertFn / VectorSearchFn / VectorDeleteFn
	// gracefully degrade to "no vector side-effect" / "no semantic recall".
	// The memory package still has all BM25 + token-overlap retrieval via
	// the pure-Go retrieval package; vectors are additive, not a replacement.
	Embedder        func(ctx context.Context, text string) ([]float32, error)
	VectorUpsert    func(ctx context.Context, recordID, workspaceID string, vec []float32) error
	VectorSearch    func(ctx context.Context, workspaceID string, vec []float32, topK int) ([]VectorHit, error)
	VectorDelete    func(ctx context.Context, recordID string) error
}

// Service is the M07 记忆中心 (Memory Center) HTTP-route façade. All 13
// REST routes + the runtime ingest entrypoint bind to methods on this
// struct. Constructed once via NewService; the route table in server.go
// dispatches M07 paths through s.memorySvc.<Method>.
type Service struct {
	Deps

	// IdentityProfiles is the durable Mem5 identity store. Server.go wires
	// s.IdentityProfiles (the canonical instance created in Server.New) so
	// the memory package owns the upsert/delete/list contract without
	// owning the store lifecycle. Nil-safe: a nil store is lazily
	// replaced with memid.NewStore() on first use.
	IdentityProfiles *memid.Store

	// Store is the in-memory store backing every read/write the M07
	// handlers perform. Required.
	Store *store.Store
}

// NewService builds a Service. store is required for the M07 module to
// do real work; deps may be partial for tests that exercise only one
// isolated handler. identityProfiles may be nil — the package lazily
// initializes one if nil is passed (so early-boot code paths keep
// working without a wired store).
func NewService(store *store.Store, deps Deps, identityProfiles *memid.Store) *Service {
	if identityProfiles == nil {
		identityProfiles = memid.NewStore()
	}
	return &Service{
		Store:            store,
		Deps:             deps,
		IdentityProfiles: identityProfiles,
	}
}

// identityStore is the package-private accessor — mirrors the legacy
// (s *Server).identityStore() which lazily initialized a fresh memid.Store
// when nil. Exposed via Service.IdentityStore() for cross-package callers.
func (s *Service) identityStore() *memid.Store {
	if s.IdentityProfiles == nil {
		s.IdentityProfiles = memid.NewStore()
	}
	return s.IdentityProfiles
}

// --- 13 REST route entry points ---
// Field naming mirrors the legacy *Server method names exactly so the
// route switch reads "s.memorySvc.MemoryOverview(r)" the same way the
// legacy "s.memoryOverviewAligned(r)" read.

// MemoryOverview → GET /api/memory/overview
func (s *Service) MemoryOverview(r *http.Request) (any, error) {
	return s.memoryOverviewAligned(r), nil
}

// MemoryRecords → GET /api/memory/records
func (s *Service) MemoryRecords(r *http.Request) (any, error) {
	return s.listMemory(r), nil
}

// MemoryRecordCreate → POST /api/memory/records
func (s *Service) MemoryRecordCreate(r *http.Request) (any, error) {
	return s.createMemory(r)
}

// MemoryRecordAction → POST/DELETE /api/memory/records/{id}[/{action}]
func (s *Service) MemoryRecordAction(r *http.Request) (any, error) {
	return s.memoryRecordAction(r)
}

// MemoryCandidates → GET /api/memory/candidates
func (s *Service) MemoryCandidates(r *http.Request) (any, error) {
	return s.listMemoryCandidates(r), nil
}

// MemoryCandidateAction → POST /api/memory/candidates/{id}/{approve|reject|promote}
func (s *Service) MemoryCandidateAction(r *http.Request) (any, error) {
	return s.memoryCandidateActionAligned(r)
}

// MemoryRefinement → POST /api/memory/refinement/run
func (s *Service) MemoryRefinement(r *http.Request) (any, error) {
	return s.memoryRefinement(r)
}

// MemoryPolicy → GET /api/memory/policy
func (s *Service) MemoryPolicy(r *http.Request) (any, error) {
	return s.getMemoryPolicy(r), nil
}

// MemoryPolicyPatch → PATCH /api/memory/policy
func (s *Service) MemoryPolicyPatch(r *http.Request) (any, error) {
	return s.patchMemoryPolicy(r)
}

// MemoryAudit → GET /api/memory/audit
func (s *Service) MemoryAudit(r *http.Request) (any, error) {
	return s.listMemoryAudits(r), nil
}

// MemoryIdentity → GET /api/memory/identity
func (s *Service) MemoryIdentity(r *http.Request) (any, error) {
	return s.listMemoryIdentity(r)
}

// MemoryIdentityUpsert → PUT /api/memory/identity
func (s *Service) MemoryIdentityUpsert(r *http.Request) (any, error) {
	return s.upsertMemoryIdentity(r)
}

// MemoryIdentityDelete → DELETE /api/memory/identity/{digitalPartnerId}
func (s *Service) MemoryIdentityDelete(r *http.Request) (any, error) {
	return s.deleteMemoryIdentity(r)
}

// --- runtime ingest façade (used by tasks / copilot / cap-delegate) ---

// IngestRuntimeMemory writes a controlled runtime memory (short_term /
// working). Acquires Store.Lock() for the duration of the write. Returns
// the persisted record so callers can echo sourceId / correlationId
// back into their audit trail.
func (s *Service) IngestRuntimeMemory(in RuntimeMemoryInput) (map[string]any, error) {
	s.Store.Lock()
	defer s.Store.Unlock()
	item, err := s.ingestRuntimeMemoryLocked(in)
	if err != nil {
		return nil, err
	}
	go s.persistMemory()
	// 异步嵌入并写入 memory_vectors;失败静默(BM25 检索仍可用)
	go s.embedAndUpsertVector(context.Background(), str(item["id"]), in.WorkspaceID, coalesce(str(item["title"]), "")+"\n"+coalesce(str(item["content"]), ""))
	return item, nil
}

// --- read-only accessors exported for cross-package callers ---

// --- read-only accessors exported for cross-package callers ---

// MemoryPolicyFor returns the workspace memory policy, lazily materializing
// a default if none exists. Used by handlers_c.go (the
// captureEmployeeBinding site) so the memory package owns the policy
// lookup semantics.
func (s *Service) MemoryPolicyFor(ws string) map[string]any {
	return s.memoryPolicyFor(ws)
}// MemoryCanRead mirrors the legacy free-function policy: admin / auditor
// see all; non-admin can read restricted/confidential only if they own
// the record. Used by copilot (replacing the duplicate inline impl in
// copilot/helpers.go).
func (s *Service) MemoryCanRead(id *auth.Identity, item map[string]any) bool {
	return memoryCanRead(id, item)
}

// PersistMemory flushes the four memory collections to the durable
// backend. Called by handlers via the deferred goroutine pattern (write
// → go s.persistMemory).
func (s *Service) PersistMemory() { s.persistMemory() }

// embedAndUpsertVector fires-and-forgets an embed call + vector upsert.
// Used by all memory write paths (createMemory / IngestRuntimeMemory) to
// keep semantic recall in sync. Errors are logged but never surface:
// vector store is additive to BM25 retrieval, and the control plane
// must not fail a memory write because the embedder is briefly down.
func (s *Service) embedAndUpsertVector(ctx context.Context, recordID, workspaceID, text string) {
	if s.Embedder == nil {
		fmt.Printf("memory: skip embed record=%s: Embedder not wired\n", recordID)
		return
	}
	if s.VectorUpsert == nil {
		fmt.Printf("memory: skip embed record=%s: VectorUpsert not wired\n", recordID)
		return
	}
	if text == "" {
		return
	}
	vec, err := s.Embedder(ctx, text)
	if err != nil || len(vec) == 0 {
		fmt.Printf("memory: embed record=%s failed: %v\n", recordID, err)
		return
	}
	if err := s.VectorUpsert(ctx, recordID, workspaceID, vec); err != nil {
		fmt.Printf("memory: vector upsert record=%s failed: %v\n", recordID, err)
		return
	}
}

// deleteVector fires-and-forgets the vector row for a record. Idempotent
// (VectorStore.Delete returns nil for missing rows).
func (s *Service) deleteVector(ctx context.Context, recordID string) {
	if s.VectorDelete == nil {
		return
	}
	_ = s.VectorDelete(ctx, recordID)
}

// AppendMemoryAuditLocked is the public version of appendMemoryAuditLocked.
// Caller MUST hold Store.Lock.
func (s *Service) AppendMemoryAuditLocked(ws, actor, action, target, result, corr string) {
	s.appendMemoryAuditLocked(ws, actor, action, target, result, corr)
}

// RecountLongTermCapacityLocked is the public version of
// recountLongTermCapacityLocked. Caller MUST hold Store.Lock.
func (s *Service) RecountLongTermCapacityLocked(ws string) {
	s.recountLongTermCapacityLocked(ws)
}

// IdentityStore returns the IdentityProfiles accessor backing Mem5. Used
// by session_panel.go (which reads the DE's preferred name + hard-no list
// before every copilot turn) and by the IdentityStoreAccessor wiring in
// server.go. Lazy-initializes a fresh memid.Store if nil.
func (s *Service) IdentityStore() *memid.Store {
	return s.identityStore()
}

// RequireMemoryGovernanceCompat is the exported form of
// requireMemoryGovernance — keeps the legacy (s *Server).requireMemoryGovernance
// callers (copilot_evolve.evolveDreamRun + any future cross-package
// admin gate) compiling after the M07 extraction.
func (s *Service) RequireMemoryGovernanceCompat(r *http.Request, actionLabel string) (*auth.Identity, error) {
	return s.requireMemoryGovernance(r, actionLabel)
}

// nowStr is a small helper for handlers that need RFC3339 timestamps.
// Centralized so test code that monkey-patches time.Now() finds a single
// place to override.
func nowStr() string { return time.Now().UTC().Format(time.RFC3339) }