package skills

import (
	"time"
)

// queueToolAuthorization creates a pending single-approver request and
// notifies the SSE client. Mirrors server.Server.queueToolAuthorization
// (server/authorization_queue.go).
//
// During the M09 P2 extraction the full server-side approval state
// machine lives outside the skills package (the partners + copilot
// modules own the actions queue). The skills package keeps a thin
// local implementation that writes to s.Store directly so the harness
// build passes; server.New() is free to override queueToolAuthorization
// via a Deps hook when tighter integration is needed.

func (s *Service) queueToolAuthorization(ctx toolRunContext, tool *registeredTool, call toolCallRequest, risk string, emit reactEmitFunc) toolExecResult {
	if tool == nil {
		return toolExecResult{
			Status: "denied", Permission: "approval_required",
			Error: "工具需要人工审核后才能执行", Output: "缺少工具定义，无法创建待审单",
		}
	}
	actor := "系统"
	if ctx.Viewer != nil {
		actor = ctx.Viewer.Name
	}
	actionID := s.Store.ID("act")
	now := time.Now().UTC().Format(time.RFC3339)
	authReq := map[string]any{
		"action":            tool.Name,
		"resource":          ctx.ConversationID,
		"reason":            "智能体受控执行需人工审核授权：" + tool.Name,
		"riskLevel":         normalizeRiskLevel(risk),
		"status":            "pending",
		"toolKey":           tool.Key,
		"toolKind":          tool.Kind,
		"toolName":          tool.Name,
		"args":              call.Args,
		"correlationId":     ctx.CorrelationID,
		"createdAt":         now,
		"approverRoleHint":  "admin",
	}
	s.Store.Lock()
	s.Store.Actions[actionID] = map[string]any{
		"id": actionID, "conversationId": ctx.ConversationID, "workspaceId": ctx.WorkspaceID,
		"status": "pending", "authorizationRequest": authReq,
		"digitalPartnerId": ctx.DigitalPartner, "createdAt": now, "updatedAt": now,
	}
	msg := map[string]any{
		"id": actionID, "role": "assistant",
		"content":               "智能体已申请执行「" + tool.Name + "」，等待登录用户人工审核授权后方可执行。",
		"actionId":              actionID,
		"authorizationRequest":  authReq,
		"createdAt":             now,
		"correlationId":         ctx.CorrelationID,
		"toolCalls": []map[string]any{{
			"id": "tc_auth_" + actionID, "name": tool.Name, "args": call.Args,
			"result": "pending_authorization", "status": "pending_authorization",
			"permission": "approval_required",
		}},
	}
	s.Store.Messages[ctx.ConversationID] = append(s.Store.Messages[ctx.ConversationID], msg)
	s.Store.AppendAudit(ctx.WorkspaceID, actor, "创建待审授权", actionID, "success", tool.Name)
	s.Store.Unlock()
	s.Store.Persist("actions")
	s.Store.Persist("messages")

	if emit != nil {
		emit("authorization", "approval", map[string]any{
			"actionId": actionID, "status": "pending", "tool": tool.Name,
			"riskLevel": risk, "authorizationRequest": authReq,
			"messageId": actionID,
		})
	}
	return toolExecResult{
		Status: "pending_authorization", Permission: "approval_required",
		Output: "工具「" + tool.Name + "」已进入人工审核队列，等待授权人批准后才能执行。请勿声称已执行成功。",
	}
}
