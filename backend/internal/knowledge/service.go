package knowledge

import (
	"context"
	"net/http"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citation"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citationlog"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/eval"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// evalGold is the local re-export of eval.GoldItem so the rest of this
// package can refer to it without bouncing through `eval.X` at every
// call site.
type evalGold = eval.GoldItem

// CitationFn is the function-type the session_panel path uses to
// project raw RAG hits into the canonical citation slice. The session
// module can't import internal/knowledge/citation directly after the
// M07 P2 boundary inversion; server.go binds the closure to
// citation.Build at boot so the package boundary stays one-way
// (server → knowledge → citation).
type CitationFn func(hits []citation.Hit, now time.Time) []citation.Citation

// CitationlogFn appends one row to the per-workspace citation log.
// Bound to citationlog.Record by buildKnowledgeSvc.
type CitationlogFn func(rec citationlog.Record) string

// CitationQuoteFn is the (quote, hash) projection the audit row needs
// to stay in sync with citation.Build's dedup / retraction logic.
// Bound to citation.ExtractQuote at boot; session_panel.go calls it as
// `s.Deps.CitationQuoteFn(snippet)` and re-uses the result.
type CitationQuoteFn func(snippet string) (string, string)

// RecordUsageFn records a usage-meter entry. Bound to the server's
// recordUsageWS closure so the M07 module can stay free of the usage
// infrastructure. nil-safe; knowledge retrieval / reindex silently skip
// metering when nil (test mode).
type RecordUsageFn func(workspaceID, kind string, units int, corr string)

// LogCitationsForRAGFn writes one citationlog row per hit into the
// global citation log keyed by turnID. Bound to
// (s *Server).logCitationsForRAG closure — session_panel keeps its
// local method but delegates here for production wiring.
type LogCitationsForRAGFn func(ws, turnID string, hits []map[string]any)

// Deps groups the cross-package Server methods the M07 知识中心 module
// depends on. server.New() builds a *Service once and passes function
// values bound to its own *Server methods. The package boundary stays
// one-way: internal/knowledge/ never imports internal/server/.
//
// Function fields instead of an interface: keeps Service free of any
// internal/server/ import, and lets tests inject stubs selectively.
// All fields are required for production callers (Server.New sets them
// all); tests can leave any subset nil and nil-check at the call site.
type Deps struct {
	// Workspace / identity / access gating — every M07 handler.
	WorkspaceID   func(r *http.Request) string
	IdentityFrom  func(ctx context.Context) *auth.Identity
	DecodeMap     func(r *http.Request) (map[string]any, error)
	EvaluateWrite func(r *http.Request, resource, action string, extra policy.Input) error

	// Governance / dual approval — package publish + countersign hold.
	RequiresPeerApprovalGate    func(actor *auth.Identity) bool
	RequireProductionDualApproval func(submitterID, submitterName string, actor *auth.Identity, verb string) error
	MaybeHoldForCountersign      func(entity map[string]any, actor *auth.Identity, risk, verb string) (bool, error)
	ProductionLikeEnv            func() bool

	// Audit sink — used by every mutation (package action, doc upload,
	// doc delete, source sync, reindex, evaluation run, ...).
	AppendAudit func(workspaceID, actor, action, target, result, reason string)

	// Persistence — called after successful mutations.
	AfterWriteLocked       func(collections ...string)
	AfterWrite             func(collections ...string)
	DurableDeleteSync      func(collection string, ids ...string)
	DurableDeleteSyncKnown func() bool // optional; nil-safe

	// RAG sidecar — POST {s.RAGURL}/v1/ingest (reindex) and
	// {s.RAGURL}/v1/retrieve (retrieve). Bound to buildKnowledgeSvc via
	// closures over s.RAGURL so the knowledge package stays free of any
	// server URL config.
	RAGURL           func() string
	RecordUsageWS    RecordUsageFn

	// Citation / audit plumbing — server.go wires:
	//   CitationFn       → citation.Build
	//   CitationlogFn    → citationlog.Record (the Append helper in
	//                      citationlog appends a single row)
	//   CitationQuoteFn  → (citation.ExtractQuote + citation.QuoteHash)
	//                      combined so the session panel can keep a single
	//                      call site
	//   LogCitationsForRAGFn → (s *Server).logCitationsForRAG — used by
	//                      session_panel.go for the supervisor tool loop
	// These four callbacks replace the previous direct
	// internal/knowledge/citation + citationlog imports from server/.
	CitationFn            CitationFn
	CitationlogFn         CitationlogFn
	CitationQuoteFn       CitationQuoteFn
	LogCitationsForRAGFn  LogCitationsForRAGFn

	// RetrieveBuiltinFn injection — when the M02 copilot module calls
	// the "knowledge.retrieve" builtin tool, it routes here. The M07
	// service provides RetrieveBuiltin (the implementation). server.go
	// binds the closure both ways: knowledgeSvc.RetrieveBuiltin is the
	// canonical handler, and a self-reference back into the Service so
	// session_panel can reuse the same code path.
	RetrieveBuiltinFn func(ctx context.Context, r *http.Request, query, corr string) (any, error)
}

// Service is the M07 知识中心 (Knowledge Center) HTTP-route façade.
// All 25 REST routes + the ragConnect binding bind to methods on this
// struct. Constructed once via NewService; the route table in server.go
// dispatches M07 paths through s.knowledgeSvc.<Method>.
type Service struct {
	Deps

	// Store is the in-memory store backing every read/write the M07
	// handlers perform. Required.
	Store *store.Store
}

// NewService builds a Service. store is required for the M07 module to
// do real work; deps may be partial for tests that exercise only one
// isolated handler.
func NewService(store *store.Store, deps Deps) *Service {
	return &Service{
		Store: store,
		Deps:  deps,
	}
}

// --- 25 REST route entry points ---
// Field naming mirrors the legacy *Server method names exactly so the
// route switch reads "s.knowledgeSvc.ListKnowledgeDocs(r)" the same
// way the legacy "s.listKnowledgeDocsAuth(r)" read.

// Citation types re-exported for callers that want to import the M07
// package as the canonical source. session_panel.go uses these names
// when binding the Deps callbacks (instead of reaching through
// internal/knowledge/citation + citationlog directly).
type (
	Citation     = citation.Citation
	Hit          = citation.Hit
	Tier         = citation.Tier
	CitationLog  = citationlog.Log
	CitationRec  = citationlog.Record
	EvalReport   = eval.EvalReport
	EvalGold     = evalGold
)

// CopilotCitationTierFromDocStatus delegates to the copilot helper so
// the M07 handlers can derive the citation tier from a doc status
// string without importing internal/copilot everywhere.
func CopilotCitationTierFromDocStatus(status string) citation.Tier {
	return copilot.CitationTierFromDocStatus(status)
}
