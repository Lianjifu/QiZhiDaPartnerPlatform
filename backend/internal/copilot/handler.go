// Package copilot is the M02 专家协作 (Expert Collaboration) HTTP
// façade for the monolith. It owns only the route surface and
// delegates every handler to its parent server's existing methods (no
// business logic lives here). Mirrors the layout of internal/auth/ and
// internal/operations/ — Handler is wired with function fields pointing
// at *server.Server methods, so the package stays free of any
// internal/server/ import cycle and is ready to lift into the standalone
// `qzda-collab` microservice later (at which point the function fields
// become concrete methods on a separate service client).
//
// 8 HTTP entry points + 1 internal hook — see Field docs on Handler:
//
//	GET   /api/copilot/conversations                       → ListConversations
//	POST  /api/copilot/conversations                       → CreateConversation
//	GET   /api/copilot/conversations/{id}/turns/{corr}/status → GetTurnStatus
//	GET   /api/copilot/conversations/{id}/turns/{corr}/replay → ReplayTurn
//	POST  /api/copilot/conversations/{id}/cancel           → CancelTurn
//	POST  /api/copilot/conversations/{id}/stream           → Stream  (SSE)
//	POST  /api/copilot/conversations/{cid}/messages/{mid}/feedback → MessageFeedback
//	POST  /api/internal/copilot/post-turn                  → PostTurnAPI
//
// Behavior contract — preserved byte-for-byte from the previous
// internal/server/copilot_*.go layout:
//   - SSE stream shape (delta / stage / tool / plan / agent /
//     memory.budget / reflect / evolve.candidate / done) unchanged
//   - Turn state machine (registerCopilotTurn → running → done /
//     cancelled / refused) unchanged
//   - Rate-limit buckets (per-workspace / per-user) unchanged
//   - Audit rows text byte-identical
//   - 4 copilot POST-turn evolution paths (dream compress, feedback
//     evolve, post-turn evolve, countersign) unchanged
//
// Wiring: server.New() constructs the handler with method values bound
// to the parent *Server. Server's route switch then dispatches the 8
// M02 paths to s.copH.<Field>(r) — same call shape as before, just
// funneled through one struct so future qzda-collab extraction has a
// single seam.
package copilot

// handler.go — HTTP handler 适配层:把 *copilot.Service 的方法注册到 chi 路由。
//
// 负责请求解析、响应编码、错误映射;业务逻辑全在 Service 里,handler 只做"翻译"。
// 替换底层 Service 实现(例如测试时)不影响路由层。

import (
	"net/http"
	"strings"
)

// Handler 是 7 个 JSON 路由 + 1 个 SSE 流 + 1 个内部钩子的函数字段集合。
// Handler holds the 7 JSON M02 HTTP handlers + 1 SSE stream + 1
// internal hook. The underlying logic lives on *server.Server —
// Phase 2 keeps the business logic in internal/server/copilot_*.go
// (the helper files) to avoid the helper-file refactor surface
// (see docs/整合方案/专家协作模块整合方案.md §5.9).
//
// Each field is a method value bound at New() time so this package
// never imports internal/server/, never participates in the import
// cycle, and trivially lifts into the qzda-collab microservice
// later (at which point the function values become RPC calls).
type Handler struct {
	// 7 JSON routes — return (any, error) for the response envelope.
	ListConversations      func(r *http.Request) (any, error)
	CreateConversation     func(r *http.Request) (any, error)
	GetCopilotTurnStatus   func(r *http.Request) (any, error)
	ReplayCopilotTurn      func(r *http.Request) (any, error)
	CancelCopilotTurn      func(r *http.Request) (any, error)
	CopilotMessageFeedback func(r *http.Request) (any, error)
	CopilotPostTurnAPI     func(r *http.Request) (any, error)
	// 1 SSE route — owns the ResponseWriter (writes delta / stage /
	// tool / plan / agent / memory.budget / reflect / evolve.candidate /
	// done events directly).
	CopilotStream func(w http.ResponseWriter, r *http.Request)
	// E2E fallback: routes outside the canonical 8 (e.g. evolve candidate
	// approve) that copilot-internal integration tests exercise through
	// CopH().ServeHTTP. Production wires these directly on the server's
	// main route switch.
	EvolveCandidateAction func(r *http.Request) (any, error)
}

// ServeHTTP 把 M02 路由分派到对应的 Handler 字段（用于 copilot 内部 C1-C9 集成测试）。
// ServeHTTP dispatches the M02 routes used by copilot's own integration
// tests (C1-C9). The server's main route table delegates to these
// fields directly in production; ServeHTTP exists so copilot-internal
// tests can wire the Handler to httptest without standing up the
// server's full dispatch loop.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h == nil {
		http.Error(w, "copilot handler not wired", http.StatusInternalServerError)
		return
	}
	p := r.URL.Path
	switch {
	case p == "/api/copilot/conversations" && r.Method == http.MethodGet:
		if h.ListConversations != nil {
			_, _ = h.ListConversations(r)
		}
	case p == "/api/copilot/conversations" && r.Method == http.MethodPost:
		if h.CreateConversation != nil {
			_, _ = h.CreateConversation(r)
		}
	case strings.HasSuffix(p, "/replay") && r.Method == http.MethodGet:
		if h.ReplayCopilotTurn != nil {
			_, _ = h.ReplayCopilotTurn(r)
		}
	case strings.HasSuffix(p, "/cancel") && r.Method == http.MethodPost:
		if h.CancelCopilotTurn != nil {
			_, _ = h.CancelCopilotTurn(r)
		}
	case strings.HasSuffix(p, "/feedback") && r.Method == http.MethodPost:
		if h.CopilotMessageFeedback != nil {
			_, _ = h.CopilotMessageFeedback(r)
		}
	case strings.HasSuffix(p, "/status") && r.Method == http.MethodGet:
		if h.GetCopilotTurnStatus != nil {
			_, _ = h.GetCopilotTurnStatus(r)
		}
	case strings.HasSuffix(p, "/stream") && r.Method == http.MethodPost:
		if h.CopilotStream != nil {
			h.CopilotStream(w, r)
		}
	case p == "/api/internal/copilot/post-turn" && r.Method == http.MethodPost:
		if h.CopilotPostTurnAPI != nil {
			_, _ = h.CopilotPostTurnAPI(r)
		}
	case strings.HasPrefix(p, "/api/evolve/candidates/") && r.Method == http.MethodPost:
		if h.EvolveCandidateAction != nil {
			_, _ = h.EvolveCandidateAction(r)
		}
	default:
		http.Error(w, "copilot handler route not implemented: "+r.URL.Path, http.StatusNotFound)
	}
}