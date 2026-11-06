// handler_test.go — copilot 包内集成测试用的 M02 路由夹具。
//
// 这张路由表只服务于包内测试(见 copilot_phase4_test.go /
// service_dispatch_test.go)。生产路由只有一份:internal/server/server.go
// 的 route() switch。历史上的 internal/copilot/handler.go 把这张表放在生产
// 代码里,于是同一批 M02 路径有两处声明、必须手工保持同步 —— 现在它只在测试
// 侧存在,漂移风险随之消失。
//
// 夹具路由(与 server.go 的 M02 分支一一对应):
//
//	GET   /api/copilot/conversations                        → ListConversations
//	POST  /api/copilot/conversations                        → CreateConversation
//	GET   /api/copilot/conversations/{id}/turns/{corr}/status → GetTurnStatus
//	GET   /api/copilot/conversations/{id}/turns/{corr}/replay → ReplayTurn
//	POST  /api/copilot/conversations/{id}/cancel             → CancelTurn
//	POST  /api/copilot/conversations/{id}/stream             → Stream (SSE)
//	POST  /api/copilot/conversations/{cid}/messages/{mid}/feedback → MessageFeedback
//	POST  /api/internal/copilot/post-turn                    → PostTurnAPI
//	POST  /api/evolve/candidates/{id}/approve                → EvolveCandidateAction
package copilot

import (
	"net/http"
	"strings"
)

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

// CopH 返回 8 个标准 M02 路由的 Handler facade。
// 作为 Service 方法保留,让 copilot 内部测试可以路由 M02 HTTP 路径
// 通过 Handler,不必实例化 *server.Server。
// 生产调用方(server.New)直接用自己方法值 wire Handler。
func (s *Service) CopH() *Handler {
	// 只 wire 包内真正实现的两个动作;其余路由在生产里由 server.go 的
	// route() switch 直接分发到 *Server 方法,本夹具里保持 nil(路由命中时
	// 不做任何事,便于测试断言"未接线"这一状态)。
	return &Handler{
		CopilotMessageFeedback: s.copilotMessageFeedback,
		EvolveCandidateAction:  s.evolveCandidateAction,
	}
}
