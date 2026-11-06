package server

import (
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
)

// escalateSessionLocked 把会话标记为人工接管中,并返回接管人信息。
// Caller must hold Store.Lock.
func (s *Server) escalateSessionLocked(sess map[string]any, ownerID, ownerName, note string) map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	handoff := map[string]any{
		"active":    true,
		"ownerId":   ownerID,
		"ownerName": ownerName,
		"note":      note,
		"at":        now,
	}
	sess["handoff"] = handoff
	sess["handoffActive"] = true
	sess["updatedAt"] = now
	return handoff
}

// findSessionByConversationLocked 按会话 ID 找 session 行(找不到时返回 nil)。
// Caller must hold Store.Lock.
func (s *Server) findSessionByConversationLocked(ws, convID string) map[string]any {
	if convID == "" {
		return nil
	}
	for _, sess := range s.Store.Sessions {
		if ws != "" && str(sess["workspaceId"]) != "" && str(sess["workspaceId"]) != ws {
			continue
		}
		if str(sess["conversationId"]) == convID || str(sess["id"]) == convID {
			return sess
		}
	}
	return nil
}

// employeeForIDLocked 按 ID 取数字伙伴记录。Caller must hold Store.Lock.
func (s *Server) employeeForIDLocked(deID string) map[string]any {
	deID = strings.TrimSpace(deID)
	if deID == "" {
		return nil
	}
	for _, emp := range s.Store.Employees {
		if str(emp["id"]) == deID {
			return emp
		}
	}
	return nil
}

// escalateDigitalPartner 是 copilot.Deps.Escalation.EscalateFn 的实现:
// 伙伴命中自身配置的升级触发条件时,把会话移交给接管人并暂停写操作。
//
// 接管人取自伙伴档案的 escalationOwner(上岗闸门强制必填),并用
// resolveApproverCandidatesLocked 解析成具体的工作区成员;伙伴没配
// escalationOwner 时回落到 handoff.approvers 的第一项。
//
// 幂等:会话已在接管中时直接返回 escalated=false,不重复移交。
func (s *Server) escalateDigitalPartner(in copilot.EscalationInput) (map[string]any, error) {
	s.Store.Lock()
	sess := s.findSessionByConversationLocked(in.WorkspaceID, in.ConversationID)
	if sess == nil {
		s.Store.Unlock()
		return map[string]any{"escalated": false, "reason": "会话不存在"}, nil
	}
	if sessionHandoffActive(sess) {
		owner := ""
		if h, ok := sess["handoff"].(map[string]any); ok {
			owner = coalesce(str(h["ownerName"]), str(h["ownerId"]))
		}
		s.Store.Unlock()
		return map[string]any{"escalated": false, "reason": "已在人工接管中", "ownerName": owner}, nil
	}

	emp := s.employeeForIDLocked(in.DigitalPartnerID)
	ownerHint := ""
	ownerID := ""
	if emp != nil {
		ownerHint = strings.TrimSpace(str(emp["escalationOwner"]))
	}
	if ownerHint == "" && emp != nil {
		if bp, _ := emp["boundaryPolicy"].(map[string]any); bp != nil {
			if h, _ := bp["handoff"].(map[string]any); h != nil {
				if approvers := stringSliceAny(h["approvers"]); len(approvers) > 0 {
					ownerHint = strings.TrimSpace(approvers[0])
				}
			}
		}
	}
	if ownerHint != "" {
		ids, names := s.resolveApproverCandidatesLocked(in.WorkspaceID, ownerHint)
		if len(ids) > 0 {
			ownerID = ids[0]
		}
		if len(names) > 0 {
			ownerHint = names[0]
		}
	}
	if ownerHint == "" {
		ownerHint = "值班负责人"
	}

	note := in.Reason
	if note == "" {
		note = "数字伙伴触发升级条件，已移交人工接管"
	}
	s.escalateSessionLocked(sess, ownerID, ownerHint, note)
	partnerName := "数字伙伴"
	if emp != nil {
		partnerName = coalesce(str(emp["name"]), str(emp["role"]))
		if partnerName == "" {
			partnerName = "数字伙伴"
		}
	}
	s.Store.AppendAudit(in.WorkspaceID, partnerName, "自动升级交接", str(in.ConversationID), "success", note)
	s.Store.Unlock()
	s.Store.Persist("sessions")
	s.Store.Persist("audits")

	return map[string]any{
		"escalated": true,
		"ownerId":   ownerID,
		"ownerName": ownerHint,
		"trigger":   in.Trigger,
		"reason":    note,
	}, nil
}
