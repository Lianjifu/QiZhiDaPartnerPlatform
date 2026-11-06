package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// copilotResumeTurn 处理 POST /api/copilot/conversations/{cid}/turns/{corr}/resume。
//
// 场景:工具命中人工授权 → 回合以 awaiting 挂起 → 审批人批准/驳回 →
// 调这个接口把**同一个伙伴、同一个 run** 接着跑完(批准的工具真实执行,
// 驳回的理由喂回模型)。
func (s *Server) copilotResumeTurn(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())
	if id == nil {
		writeErr(w, apperr.UnauthorizedErr("请先登录"))
		return
	}
	rawID := conversationIDFromPath(r.URL.Path)
	corr := copilot.CorrelationIDFromTurnSubPath(r.URL.Path, "resume")
	if rawID == "" || corr == "" {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "缺少会话或 correlationId"))
		return
	}
	ws := s.workspaceID(r)
	if err := s.requireWorkspaceAccess(id, ws); err != nil {
		writeErr(w, err)
		return
	}

	s.Store.RLock()
	cid := s.resolveMessageBucketID(ws, rawID)
	history := append([]map[string]any{}, s.Store.Messages[cid]...)
	partnerID := ""
	sessionMode, riskLevel := "", ""
	for _, conv := range s.Store.Conversations {
		if str(conv["id"]) != cid {
			continue
		}
		partnerID = str(conv["digitalPartnerId"])
	}
	for _, sess := range s.Store.Sessions {
		if str(sess["conversationId"]) != cid && str(sess["id"]) != cid {
			continue
		}
		if v := str(sess["sessionMode"]); v != "" {
			sessionMode = v
		}
		if v := str(sess["riskLevel"]); v != "" {
			riskLevel = v
		}
	}
	actions := s.pendingActionsForCorrelationLocked(ws, cid, corr)
	s.Store.RUnlock()

	if len(actions) == 0 {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "该回合没有待续跑的审批动作"))
		return
	}

	var emp map[string]any
	if partnerID != "" {
		for _, e := range s.Store.Employees {
			if str(e["id"]) == partnerID {
				emp = e
				break
			}
		}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	emit := func(typ, stage string, extra map[string]any) {
		payload := map[string]any{"type": typ, "stage": stage, "correlationId": corr}
		for k, v := range extra {
			payload[k] = v
		}
		writeSSE(w, typ, payload)
		if flusher != nil {
			flusher.Flush()
		}
	}

	emit("stage", "resume", map[string]any{"status": "running", "actions": len(actions)})

	res := s.CopSvc.ResumeTurn(r.Context(), copilot.ResumeInput{
		Request:        r,
		WorkspaceID:    ws,
		ConversationID: cid,
		CorrelationID:  corr,
		Employee:       emp,
		SessionMode:    sessionMode,
		RiskLevel:      riskLevel,
		Viewer:         id,
		Emit:           emit,
		Actions:        actions,
		History:        history,
	})

	// 把续跑结果落回会话,保证前端刷新也能看到。
	s.persistResumedTurn(cid, corr, res)

	if res.Text != "" {
		emit("delta", "resume", map[string]any{"text": res.Text})
	}
	if res.Awaiting {
		emit("awaiting", "approval", map[string]any{"status": "pending_authorization"})
	}
	emit("done", "resume", map[string]any{
		"ok": true, "text": res.Text, "steps": res.Steps,
		"executed": res.Executed, "rejected": res.Rejected,
	})
}

// pendingActionsForCorrelationLocked 取出某回合已决策的审批动作。
// Caller must hold Store.RLock.
func (s *Server) pendingActionsForCorrelationLocked(ws, cid, corr string) []copilot.PendingAction {
	out := []copilot.PendingAction{}
	for _, action := range s.Store.Actions {
		if str(action["conversationId"]) != cid {
			continue
		}
		if w := str(action["workspaceId"]); ws != "" && w != "" && w != ws {
			continue
		}
		req, _ := action["authorizationRequest"].(map[string]any)
		if req == nil {
			continue
		}
		if c := str(req["correlationId"]); c != "" && c != corr {
			continue
		}
		status := strings.ToLower(str(action["status"]))
		if status != "approved" && status != "rejected" {
			continue
		}
		decidedBy := ""
		if signers := knowledgeSliceMaps(req["signers"]); len(signers) > 0 {
			decidedBy = str(signers[len(signers)-1]["name"])
		}
		out = append(out, copilot.PendingAction{
			ID:        str(action["id"]),
			ToolName:  str(req["toolName"]),
			ToolKey:   str(req["toolKey"]),
			Args:      mapArg(req["args"]),
			Status:    status,
			Note:      str(req["note"]),
			DecidedBy: decidedBy,
		})
	}
	return out
}

// mapArg 把任意值转成 map[string]any。
func mapArg(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

// persistResumedTurn 把续跑产生的助手消息写回会话。
func (s *Server) persistResumedTurn(cid, corr string, res copilot.ResumeResult) {
	if strings.TrimSpace(res.Text) == "" {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	msg := map[string]any{
		"id": s.Store.ID("msg"), "role": "assistant", "content": res.Text,
		"createdAt": now, "correlationId": corr, "resumed": true,
		"toolCalls": res.ToolCalls,
	}
	s.Store.Lock()
	s.Store.Messages[cid] = append(s.Store.Messages[cid], msg)
	s.Store.Unlock()
	s.Store.Persist("messages")
}
