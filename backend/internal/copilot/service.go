// Package copilot is the M02 专家协作 (Expert Collaboration) module —
// HTTP handlers + the complete turn/state machine that backs them.
//
// History: the legacy `copilot_*.go` files lived in internal/server/ with
// `(s *Server)` receivers — the package boundary was enforced by a thin
// function-field Handler at internal/copilot/handler.go. This file (and
// the rest of internal/copilot/) replaces that wrapper with a real Service
// type that owns the M02 logic.
//
// Service is constructed once at server boot via NewService(store, deps).
// It carries the M02 dependencies directly: Store, plus a small set of
// cross-package function fields for the ~22 Server methods it needs
// (LLM streaming, RAG retrieval, memory governance, runtime skills,
// etc.). Using function fields instead of an interface:
//
//   - Keeps Service free of any internal/server/ import (no cycle risk)
//   - Lets tests inject stubs selectively — set only the deps you exercise
//   - Avoids the breadth of an interface with 22 methods (each with a
//     non-trivial signature) when 99% of callers want one field
//
// Stream-local state (single-slot lastMemoryBudgetReport + per-participant
// map for the supervisor panel) lives on Service so it survives across HTTP
// calls; these fields used to live on *Server.
package copilot

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/agentos"
	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/infra"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// ResolvedTurn 是一次 copilot 回合实际命中的"模型元数据"（provider + model + 协议）。
// ResolvedTurn is the concrete provider + model used for one Copilot turn.
// Mirrors the legacy `resolvedTurn` struct from internal/server/model_invoke.go;
// moved here so model_invoke.go can import copilot for the type and the
// copilot package can use it without an import cycle.
type ResolvedTurn struct {
	ModelID      string
	ModelName    string
	ProviderID   string
	ProviderName string
	Protocol     string
	Level        string
	Source       string // provider | routing | env
	Request      modelprov.ChatRequest
}

// StreamLLMForCopilotFn 是 copilot 模块对 LLM 流式调用依赖的函数类型契约。
// StreamLLMForCopilotFn is the function-type the M02 copilot module expects
// its StreamLLMForCopilot dependency to satisfy. The function is implemented
// in internal/models/handlers_invoke.go (a method on *models.Service bound at
// boot time). Defining the type in the consumer package (copilot) lets the
// provider package (models) avoid importing copilot for the type alias — it
// only needs to import copilot for the ResolvedTurn type used in the return.
//
// Signature mirrors the historical `*Server.streamLLMForCopilot` so the
// migration is signature-compatible and existing tests keep working without
// method-count gymnastics.
type StreamLLMForCopilotFn func(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (reply string, resolved ResolvedTurn, err error)

// runtimeMemoryInput 是 ingestRuntimeMemoryLocked 的入参结构体（覆盖范围、来源、置信度等）。
// runtimeMemoryInput is the input shape used by ingestRuntimeMemoryLocked
// (moved from internal/server/handlers_memory.go so copilot can pass it
// through without an import cycle).
type runtimeMemoryInput struct {
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
	Confidence        float64
}

// participantCtxInput 是构造 participantContext 时的输入载体（身份/消息/工具/会话模式等）。
// participantCtxInput is the dispatch-side carrier for building a
// participantContext.
type participantCtxInput struct {
	WorkspaceID     string
	ConversationID  string
	CorrelationID   string
	OwnerID         string
	UserMessage     string
	Channel         string
	EnabledTools    []string
	Viewer          *auth.Identity
	Request         *http.Request
	Emit            reactEmitFunc
	SessionModeHint string
	RiskLevelHint   string
}

// participantContext 是 runParticipantTurn 用的"子专家执行上下文"（含独立身份/记忆/模型/工具）。
// participantContext is the per-specialist execution context.
type participantContext struct {
	WorkspaceID     string
	ConversationID  string
	CorrelationID   string
	DigitalPartner string
	SessionMode     string
	RiskLevel       string
	ModelID         string
	Identity        memid.Profile
	IdentityPresent bool
	MemoryHits      []memoryHit
	Tools           []registeredTool
	Channel         string
	Viewer          *auth.Identity
	OwnerID         string
	UserMessage     string
	Request         *http.Request
	Emit            reactEmitFunc
}

// participantTurnResult 是 runParticipantTurn 的返回结果（文本/状态/时长/硬性拒答原因）。
// participantTurnResult is what runParticipantTurn returns.
type participantTurnResult struct {
	ParticipantID string
	Text          string
	ModelID       string
	Status        string
	Reason        string
	DurationMs    int
	HardNoRefusal string
	ToolCalls     []map[string]any
}

// serviceTestHooks 把"测试用的可替换钩子"集中在一个结构体里（覆盖 runCopilotTool / runPlanExecute）。
// serviceTestHooks groups the optional override hooks used by copilot unit
// tests. Mirrors the legacy serverTestHooks type but scoped to the M02
// module — only runCopilotToolOverride and runPlanExecuteOverride are used
// by copilot (participantTurnOverride stays on serverTestHooks for the
// session_panel tests).
type serviceTestHooks struct {
	runCopilotToolOverride func(ctx toolRunContext, t *registeredTool, call toolCallRequest) toolExecResult
	runPlanExecuteOverride func(in reactTurnInput) reactTurnResult
}

// Deps 是 M02 copilot 模块对 server/ 的"函数字段依赖"集合。
// Deps groups the cross-package Server methods the M02 copilot module
// depends on. Server.New() builds a *Service and passes function values
// bound to its own *Server methods.
//
// Function fields instead of an interface: keeps Service free of any
// internal/server/ import, and lets tests inject selectively. All fields
// are required for production callers (Server.New sets them all); tests
// can leave any subset nil and nil-check at the call site.
type Deps struct {
	// Workspace / request context
	WorkspaceIDFn              func(r *http.Request) string
	RequireMemoryGovernanceFn  func(r *http.Request, actionLabel string) (*auth.Identity, error)
	EvaluateZeroTrustFn        func(id *auth.Identity, resource, action, classification string, external bool, corr string) (map[string]any, error)
	// Routing / model
	ResolveDefaultRiskLevelFn  func(employeeID string) string
	ResolveDefaultSessionModeFn func(employeeID string) string
	ResolveMessageBucketIDFn    func(ws, raw string) string
	PublishedPolicyByLevelFn    func(ws, level string) map[string]any
	StreamLLMForCopilotFn       StreamLLMForCopilotFn
	// Memory / audit
	PersistMemorySyncFn             func()
	IngestRuntimeMemoryLockedFn       func(in runtimeMemoryInput) (map[string]any, error)
	AppendMemoryAuditLockedFn         func(ws, actor, action, target, result, corr string)
	LogCitationsForRAGFn        func(ws, turnID string, hits []map[string]any)
	MemoryPolicyForFn           func(ws string) map[string]any
	MemoryCanReadFn             func(id *auth.Identity, item map[string]any) bool
	// RAG / knowledge
	RetrievePublishedFn         func(r *http.Request, body map[string]any, corr string) (any, error)
	// Skills / tools
	DispatchAuthorizedToolFn    func(runCtx toolRunContext, reg []registeredTool, call toolCallRequest, sessionMode, risk string, emit reactEmitFunc) (tool *registeredTool, res toolExecResult)
	RunSkillToolFn              func(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult
	RunSkillReadToolFn          func(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult
	RunPilotdeckToolFn          func(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult
	RunCMDBLookupFn             func(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult
	RunRuntimeToolFn            func(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult
	PersistSkillHealthFn        func()
	// Multi-agent / panel
	BuildParticipantContextFn   func(in ParticipantCtxInput, emp map[string]any) ParticipantContext
	RunParticipantTurnFn        func(ctx context.Context, pc participantContext) participantTurnResult
	// Persistence
	DurableDeleteSyncFn         func(collection string, ids ...string)
	// Skill turn / sandbox paths / model aliases (small helpers — promoted
	// to Deps to dodge pulling their full dependency chain into copilot).
	RequireProductionDualApprovalFn func(submitterID, submitterName string, actor *auth.Identity, verb string) error
	IsSandboxCopilotWsPathFn         func(pathOrCmd string) bool
	IsDemoModelAliasFn               func(id string) bool
	ParseNextRunCommandFn            func(output string) string
	ShouldAutoRunAfterSkillWriteFn   func(res toolExecResult, runCmd string) bool
	IsSkillWorkspaceWriteCallFn      func(call toolCallRequest, tool *registeredTool) bool
	BuildAutoRunToolCallAfterWriteFn func(reg []registeredTool, tool *registeredTool, writeCall toolCallRequest, runCmd string) toolCallRequest
	// BuiltinSkillsRootFn resolves the on-disk directory containing the
	// bundled builtin skills. Provided by *Server so the copilot module
	// stays free of any internal/server/ import (the lookup is a package
	// of M09 skills/, owned outside copilot). Nil-safe — falls back to
	// the in-package builtinSkillsRoot default.
	BuiltinSkillsRootFn func() string
}

// Service is the M02 专家协作 (Expert Collaboration) HTTP handler + state
// machine. All 8 routes + the SSE stream bind to methods on this struct.
type Service struct {
	// Store is the in-memory store backing every read/write the copilot
	// handlers perform. Required.
	Store *store.Store

	// SubAgent is the bounded-concurrency dispatch engine used by the
	// multi-agent panel (runMultiAgentTurn → dispatchParticipants). Mirrors
	// the legacy Server.SubAgent field — server.New() builds the engine and
	// hands it to copilot.NewService so the M02 module can fan out
	// participants in parallel with shared concurrency caps. Nil means
	// "use the default zero-value Engine" (tests + early boot).
	SubAgent *agentos.Engine

	// Kernel is the durable Agent-OS store. Optional; nil means "fall back
	// to in-memory store reads for snapshot replay". Server.New wires the
	// KernelStore once at boot.
	Kernel *infra.KernelStore

	// Deps holds the cross-package Server methods the copilot module calls
	// into (LLM streaming, RAG retrieval, memory governance, runtime
	// skills, ...). See Deps for the full list.
	Deps Deps

	// lastMemoryBudgetReport is set by retrieveMemoryForTurnLocked so the
	// copilot stream can flush a `memory.budget` SSE event. Single-slot:
	// concurrent turns overwrite; that's acceptable for an observability tail
	// (the live SSE always sees the latest write for its own turn).
	lastMemoryBudgetReport *memoryBudgetReport

	// participantMemoryBudgetReports collects per-participant memory budget
	// reports during a panel dispatch so the supervisor can flush a single
	// consolidated `memory.budget` event after the panel completes.
	participantMemoryBudgetReports map[string]*memoryBudgetReport
	// participantMemoryBudgetMu guards participantMemoryBudgetReports.
	participantMemoryBudgetMu sync.Mutex

	// testHooks lets *_test.go files override behavior at well-defined seams
	// (runPlanExecuteTurn, runCopilotTool) without standing up the full
	// LLM/RAG stack. Nil in production; nil fields inside mean "no override
	// at that seam".
	testHooks *serviceTestHooks

	// HTTP-handler function values for the 8 M02 routes. Production
	// callers (server.New) wire these to *Server methods at construction
	// time. The Handler struct consumes them as method values so the
	// package boundary stays one-way (copilot never imports server/).
	// The CopH() method below fills these with itself-pointing closures
	// when the package is exercised in isolation (e.g. copilot-internal
	// tests).
	listConversationsFn      func(r *http.Request) (any, error)
	createConversationFn     func(r *http.Request) (any, error)
	getCopilotTurnStatusFn   func(r *http.Request) (any, error)
	replayCopilotTurnFn      func(r *http.Request) (any, error)
	cancelCopilotTurnFn      func(r *http.Request) (any, error)
	copilotMessageFeedbackFn func(r *http.Request) (any, error)
	copilotPostTurnAPIFn     func(r *http.Request) (any, error)
	copilotStreamFn          func(w http.ResponseWriter, r *http.Request)
	evolveCandidateActionFn  func(r *http.Request) (any, error)
}

// NewService 用给定的 Store + Deps 构造一个生产可用的 Service。
// NewService builds a Service. store is required for the M02 module to do
// real work; deps may be partial for tests that exercise only the SSE /
// turn state machine (no LLM/RAG calls).
func NewService(store *store.Store, deps Deps) *Service {
	return &Service{
		Store: store,
		Deps:  deps,
	}
}

// New 是 NewService 的零 Deps 便捷别名，供 copilot 内部不接 server/ 依赖的测试使用。
// New is a thin alias for NewService with zero-value Deps. Used by
// copilot-internal tests that exercise logic without wiring server-side
// dependencies (rate limiting, model routing, etc.).
func New(store *store.Store) *Service {
	return NewService(store, Deps{})
}

// CopH 返回 8 个标准 M02 路由的 Handler facade。
// CopH returns the Handler facade for the canonical 8 routes. Kept as
// a Service method so copilot-internal tests can route M02 HTTP paths
// through the Handler without instantiating a *server.Server. Production
// callers (server.New) wire the Handler directly with their own method
// values.
func (s *Service) CopH() *Handler {
	return &Handler{
		ListConversations:      s.listConversationsFn,
		CreateConversation:     s.createConversationFn,
		GetCopilotTurnStatus:   s.getCopilotTurnStatusFn,
		ReplayCopilotTurn:      s.replayCopilotTurnFn,
		CancelCopilotTurn:      s.cancelCopilotTurnFn,
		// Wire the in-package methods directly so copilot-internal tests
		// can route through CopH() without instantiating a *server.Server.
		// Production callers (server.New) overwrite these with their own
		// method values for cross-package dispatch.
		CopilotMessageFeedback: s.copilotMessageFeedback,
		CopilotPostTurnAPI:     s.copilotPostTurnAPIFn,
		CopilotStream:          s.copilotStreamFn,
		EvolveCandidateAction:  s.evolveCandidateAction,
	}
}

// SetTestHooks 给 Service 挂上测试用的可替换钩子（panic 注入 / 假 LLM 响应等）。
// SetTestHooks wires the optional override hooks onto the Service.
// Production callers leave this alone; tests call it once after
// NewService() to swap in panics / fake LLM responses / etc.
func (s *Service) SetTestHooks(hooks *serviceTestHooks) {
	s.testHooks = hooks
}

// Convenience accessors for the cross-package deps. Centralizing them
// here keeps nil-checks at one site; the methods just call them.
//
// Each accessor is safe to call with a nil receiver for tests that
// exercise only the SSE/turn state machine. Production callers always
// wire deps via NewService, so nil here means "test mode".

// depWorkspaceID 从 Request 里取出当前请求归属的工作区 ID；Deps 未注入时返回空串。
func (s *Service) depWorkspaceID(r *http.Request) string {
	if s == nil || s.Deps.WorkspaceIDFn == nil {
		return ""
	}
	return s.Deps.WorkspaceIDFn(r)
}