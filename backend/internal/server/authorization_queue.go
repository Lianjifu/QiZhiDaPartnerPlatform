package server

import (
	"strings"
	"time"
)

// queueToolAuthorization creates a pending single-approver request and notifies the SSE client.
func (s *Server) queueToolAuthorization(ctx toolRunContext, tool *registeredTool, call toolCallRequest, risk string, emit reactEmitFunc) toolExecResult {
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
	s.Store.Lock()
	actionID, authReq := s.createPendingAuthorizationLocked(
		ctx.WorkspaceID, ctx.ConversationID, ctx.DigitalPartner,
		tool, call, ctx.Viewer, risk, ctx.CorrelationID,
	)
	now := time.Now().UTC().Format(time.RFC3339)
	plan, _ := authReq["skillTurn"].(map[string]any)
	planSummary := ""
	if plan != nil {
		planSummary = str(plan["summary"])
	}
	candIDs := stringSlice(authReq["approverCandidateIds"])
	candNames := stringSlice(authReq["approverCandidateNames"])
	signerUID, signerName := "", "管理员/授权人"
	if len(candIDs) > 0 {
		signerUID = candIDs[0]
	}
	if len(candNames) > 0 {
		signerName = candNames[0]
	}
	approvalMirror := map[string]any{
		"action": authReq["action"], "resource": ctx.ConversationID,
		"reason": authReq["reason"], "riskLevel": authReq["riskLevel"],
		"required": 1, "signed": 0, "decision": "pending",
		"skillTurn":              authReq["skillTurn"],
		"planSummary":            planSummary,
		"approverRoleHint":       authReq["approverRoleHint"],
		"approverCandidateIds":   candIDs,
		"approverCandidateNames": candNames,
		"signers": []map[string]any{{
			"userId": signerUID, "name": signerName,
			"role": "approver", "signed": false,
		}},
	}
	content := "智能体已申请执行「" + tool.Name + "」，等待登录用户人工审核授权后方可执行。"
	if planSummary != "" {
		content = "智能体已申请 Skill Turn（" + planSummary + "），等待登录用户人工审核；批准后可手动执行至产物。"
	}
	msg := map[string]any{
		"id": actionID, "role": "assistant",
		"content":  content,
		"actionId": actionID, "authorizationRequest": authReq, "approvalRequest": approvalMirror,
		"createdAt": now, "correlationId": ctx.CorrelationID,
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
			"riskLevel": authReq["riskLevel"], "authorizationRequest": authReq,
			"approvalRequest": approvalMirror, "messageId": actionID,
		})
	}
	return toolExecResult{
		Status: "pending_authorization", Permission: "approval_required",
		Output: "工具「" + tool.Name + "」已进入人工审核队列，等待授权人批准后才能执行。请勿声称已执行成功。",
	}
}

func isAllowlistedExecutableTool(name, kind string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	k := strings.ToLower(strings.TrimSpace(kind))
	if k == "skill" || strings.Contains(n, "docx") || strings.Contains(n, "xlsx") || strings.Contains(n, "pptx") || strings.Contains(n, "pdf") {
		return isDocxSkillName(n) || isPdfSkillName(n) || strings.Contains(n, "xlsx") || strings.Contains(n, "pptx") ||
			strings.Contains(n, "excel") || strings.Contains(n, "word") || strings.Contains(n, "ppt") || strings.Contains(n, "pdf")
	}
	if n == "knowledge.retrieve" || n == "memory.recall" || isCMDBTool(n) {
		return true
	}
	return false
}

func isBlockedEnterpriseWrite(name string) bool {
	n := strings.ToLower(name)
	for _, p := range []string{"kubectl", "apply", "delete", "terraform", "ansible", "helm", "production", "prod-write", "config set"} {
		if strings.Contains(n, p) {
			return true
		}
	}
	return false
}
