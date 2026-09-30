package server

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/digital-employee-platform/backend/internal/auth"
	apperr "github.com/digital-employee-platform/backend/pkg/errors"
)

// createPendingAuthorizationLocked builds a single-approver authorization request.
// Copilot 写操作由智能体发起、登录用户人工审核：requester 记数字伙伴，不把会话用户当作发起人。
// Caller must hold Store.Lock. Returns actionID and the authorizationRequest map.
func (s *Server) createPendingAuthorizationLocked(
	ws, cid, deID string,
	tool *registeredTool,
	call toolCallRequest,
	viewer *auth.Identity,
	riskLevel string,
	corr string,
) (actionID string, authReq map[string]any) {
	actionID = s.Store.ID("act")
	requesterID, requesterName, requesterKind := "", "未知", "user"
	triggeredByID, triggeredByName := "", ""
	if viewer != nil {
		triggeredByID = viewer.ID
		triggeredByName = viewer.Name
	}
	approverHint := "admin"
	if deID != "" {
		requesterKind = "agent"
		requesterID = deID
		requesterName = "工作伙伴"
		for _, emp := range s.Store.Employees {
			if str(emp["id"]) != deID {
				continue
			}
			requesterName = coalesce(str(emp["name"]), coalesce(str(emp["role"]), "工作伙伴"))
			if eo := strings.TrimSpace(str(emp["escalationOwner"])); eo != "" {
				approverHint = eo
			}
			break
		}
	} else if viewer != nil {
		// 无绑定专家时仍由会话用户触发；自批规则仅对此类人类发起人生效
		requesterID = viewer.ID
		requesterName = viewer.Name
		requesterKind = "user"
	}
	candidateIDs, candidateNames := s.resolveApproverCandidatesLocked(ws, approverHint)
	now := time.Now().UTC().Format(time.RFC3339)
	authReq = map[string]any{
		"action":                 coalesce(tool.Name, call.Name),
		"resource":               cid,
		"reason":                 "智能体受控执行需人工审核授权：" + coalesce(tool.Name, call.Name),
		"riskLevel":              normalizeRiskLevelSession(riskLevel),
		"status":                 "pending",
		"requesterId":            requesterID,
		"requesterName":          requesterName,
		"requesterKind":          requesterKind,
		"triggeredByUserId":      triggeredByID,
		"triggeredByUserName":    triggeredByName,
		"approverRoleHint":       approverHint,
		"approverCandidateIds":   candidateIDs,
		"approverCandidateNames": candidateNames,
		"toolKey":                tool.Key,
		"toolKind":               tool.Kind,
		"toolName":               tool.Name,
		"args":                   call.Args,
		"correlationId":          corr,
		"createdAt":              now,
	}
	if plan := buildSkillTurnPlan(tool, call); plan != nil {
		authReq["skillTurn"] = plan
		authReq["reason"] = "智能体 Skill Turn 需人工审核：" + coalesce(str(plan["summary"]), coalesce(tool.Name, call.Name))
	}
	s.Store.Actions[actionID] = map[string]any{
		"id": actionID, "conversationId": cid, "workspaceId": ws,
		"status": "pending", "authorizationRequest": authReq,
		"digitalEmployeeId": deID, "createdAt": now, "updatedAt": now,
	}
	return actionID, authReq
}

func (s *Server) canApproveActionLocked(id *auth.Identity, authReq map[string]any, ws string) (bool, string) {
	if id == nil {
		return false, "请先登录"
	}
	// 智能体发起的待审单：登录用户即为人工审核人，不适用「发起人自批」
	if str(authReq["requesterKind"]) != "agent" {
		if str(authReq["requesterId"]) != "" && str(authReq["requesterId"]) == id.ID {
			return false, "发起人不可审核授权自己的请求"
		}
	}
	if id.Role == "admin" {
		return true, ""
	}
	for _, cand := range stringSlice(authReq["approverCandidateIds"]) {
		if cand != "" && cand == id.ID {
			return true, ""
		}
	}
	hint := str(authReq["approverRoleHint"])
	if hint != "" && (strings.EqualFold(id.Name, hint) || strings.Contains(id.Name, hint)) {
		return true, ""
	}
	for _, name := range stringSlice(authReq["approverCandidateNames"]) {
		if name != "" && (strings.EqualFold(id.Name, name) || strings.Contains(id.Name, name)) {
			return true, ""
		}
	}
	if auth.Has(id, "action.approve") || auth.Has(id, "agent.write") {
		return true, ""
	}
	_ = ws
	return false, "当前身份无权审核授权（需管理员、escalationOwner 对应用户或审批权限）"
}

// resolveApproverCandidatesLocked maps escalationOwner / role hint to workspace members.
// Order: exact name → name contains hint → workspace admins when hint is admin/empty.
func (s *Server) resolveApproverCandidatesLocked(ws, hint string) (ids []string, names []string) {
	hint = strings.TrimSpace(hint)
	seen := map[string]struct{}{}
	add := func(uid, name string) {
		uid = strings.TrimSpace(uid)
		name = strings.TrimSpace(name)
		if uid == "" {
			return
		}
		if _, ok := seen[uid]; ok {
			return
		}
		seen[uid] = struct{}{}
		ids = append(ids, uid)
		if name != "" {
			names = append(names, name)
		}
	}
	members := s.Store.Members[ws]
	matchHint := func(m map[string]any) bool {
		name := str(m["name"])
		role := strings.ToLower(str(m["role"]))
		if hint == "" || strings.EqualFold(hint, "admin") {
			return role == "admin"
		}
		if strings.EqualFold(name, hint) {
			return true
		}
		if strings.Contains(name, hint) || strings.Contains(hint, name) {
			return true
		}
		// hint may be a role title like「运营负责人」stored on the member.
		if title := str(m["title"]); title != "" && (strings.EqualFold(title, hint) || strings.Contains(title, hint)) {
			return true
		}
		return false
	}
	for _, m := range members {
		if !matchHint(m) {
			continue
		}
		uid := coalesce(str(m["userId"]), "")
		if uid == "" {
			// Dev seed: map known emails to identity IDs.
			switch strings.ToLower(str(m["email"])) {
			case "admin@acme.com":
				uid = "u1"
			case "user@acme.com":
				uid = "u2"
			case "audit@acme.com":
				uid = "u3"
			default:
				uid = str(m["id"])
			}
		}
		add(uid, str(m["name"]))
	}
	// Fallback: if hint named a person but no member matched, still allow admins.
	if len(ids) == 0 && hint != "" && !strings.EqualFold(hint, "admin") {
		for _, m := range members {
			if strings.ToLower(str(m["role"])) != "admin" {
				continue
			}
			uid := coalesce(str(m["userId"]), "")
			if uid == "" {
				switch strings.ToLower(str(m["email"])) {
				case "admin@acme.com":
					uid = "u1"
				default:
					uid = str(m["id"])
				}
			}
			add(uid, str(m["name"]))
		}
	}
	return ids, names
}

func authorizationSignature(actionID, userID string) string {
	nonce := fmt.Sprintf("%d", time.Now().UnixNano())
	sum := sha256.Sum256([]byte(actionID + "|" + userID + "|" + nonce))
	return hex.EncodeToString(sum[:16])
}

func (s *Server) rejectAction(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.UnauthorizedErr("请先登录")
	}
	actionID := actionIDFromPath(r.URL.Path)
	if actionID == "" {
		return nil, apperr.NotFoundErr(apperr.NotFound, "行动不存在")
	}
	body, _ := decodeMap(r)
	rawConv := strings.TrimSpace(str(body["conversationId"]))
	note := strings.TrimSpace(str(body["reason"]))
	if note == "" {
		note = strings.TrimSpace(str(body["decisionNote"]))
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)

	s.Store.Lock()
	action := s.Store.Actions[actionID]
	if action == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "行动不存在")
	}
	authReq, _ := action["authorizationRequest"].(map[string]any)
	if authReq == nil {
		authReq = map[string]any{}
	}
	if st := str(action["status"]); st != "pending" && str(authReq["status"]) != "pending" {
		s.Store.Unlock()
		return nil, apperr.Conflict(apperr.BadRequest, "仅待审核请求可拒绝")
	}
	if ok, msg := s.canApproveActionLocked(id, authReq, ws); !ok {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.RoleForbidden, msg)
	}
	authReq["status"] = "rejected"
	authReq["decidedById"] = id.ID
	authReq["decidedByName"] = id.Name
	authReq["decidedAt"] = now
	authReq["decisionNote"] = note
	action["authorizationRequest"] = authReq
	action["status"] = "rejected"
	action["updatedAt"] = now
	s.Store.Actions[actionID] = action

	cid := coalesce(str(action["conversationId"]), rawConv)
	if cid != "" {
		msgs := s.Store.Messages[cid]
		for i, m := range msgs {
			ar, _ := m["authorizationRequest"].(map[string]any)
			if ar == nil {
				ar, _ = m["approvalRequest"].(map[string]any)
			}
			if str(m["id"]) == actionID || (ar != nil && str(action["id"]) == actionID && str(m["id"]) == actionID) {
				m["authorizationRequest"] = authReq
				msgs[i] = m
				break
			}
			if ar != nil && coalesce(str(m["actionId"]), "") == actionID {
				m["authorizationRequest"] = authReq
				msgs[i] = m
				break
			}
		}
		// also match by actionId field on message
		for i, m := range msgs {
			if str(m["actionId"]) == actionID {
				m["authorizationRequest"] = authReq
				msgs[i] = m
				break
			}
		}
		s.Store.Messages[cid] = msgs
	}
	s.Store.AppendAudit(ws, id.Name, "人工审核拒绝", actionID, "success", note)
	s.Store.Unlock()
	s.Store.Persist("actions")
	s.Store.Persist("messages")
	return map[string]any{"id": actionID, "status": "rejected", "decidedAt": now}, nil
}

// approveActionSingle performs one-person authorization (replaces dual-sign flow for new actions).
func (s *Server) approveActionSingle(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.UnauthorizedErr("请先登录后再授权")
	}
	actionID := actionIDFromPath(r.URL.Path)
	if actionID == "" {
		return nil, apperr.NotFoundErr(apperr.NotFound, "行动不存在")
	}
	body, _ := decodeMap(r)
	rawConv := strings.TrimSpace(str(body["conversationId"]))
	note := strings.TrimSpace(str(body["decisionNote"]))
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)

	s.Store.Lock()
	action := s.Store.Actions[actionID]
	cid := coalesce(rawConv, str(action["conversationId"]))
	if cid != "" {
		cid = s.resolveMessageBucketID(ws, cid)
	}

	// Legacy dual-sign seed path: fall back when no Actions entry / authorizationRequest
	if action == nil || action["authorizationRequest"] == nil {
		s.Store.Unlock()
		return s.approveActionLegacyWithBody(r, body, actionID, ws, id)
	}

	authReq, _ := action["authorizationRequest"].(map[string]any)
	if str(action["status"]) != "pending" && str(authReq["status"]) != "pending" {
		s.Store.Unlock()
		return nil, apperr.Conflict(apperr.BadRequest, "仅待审核请求可授权")
	}
	if ok, msg := s.canApproveActionLocked(id, authReq, ws); !ok {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.RoleForbidden, msg)
	}
	sig := authorizationSignature(actionID, id.ID)
	authReq["status"] = "approved"
	authReq["decidedById"] = id.ID
	authReq["decidedByName"] = id.Name
	authReq["decidedAt"] = now
	authReq["decisionNote"] = note
	authReq["signatureHash"] = sig
	action["authorizationRequest"] = authReq
	action["status"] = "approved"
	action["updatedAt"] = now
	s.Store.Actions[actionID] = action

	if cid != "" {
		plan, _ := authReq["skillTurn"].(map[string]any)
		planSummary := ""
		if plan != nil {
			planSummary = str(plan["summary"])
		}
		for i, m := range s.Store.Messages[cid] {
			if str(m["actionId"]) == actionID {
				m["authorizationRequest"] = authReq
				// keep approvalRequest mirror for older FE
				m["approvalRequest"] = map[string]any{
					"action": authReq["action"], "resource": cid, "reason": authReq["reason"],
					"required": 1, "signed": 1, "decision": "approved",
					"skillTurn": plan, "planSummary": planSummary,
					"approverRoleHint": authReq["approverRoleHint"],
					"approverCandidateIds": authReq["approverCandidateIds"],
					"approverCandidateNames": authReq["approverCandidateNames"],
					"signers": []map[string]any{{
						"userId": id.ID, "name": id.Name, "role": "approver",
						"signed": true, "signedAt": now, "signatureHash": sig,
					}},
				}
				s.Store.Messages[cid][i] = m
				break
			}
		}
	}
	s.Store.AppendAudit(ws, id.Name, "人工审核授权", actionID, "success", "")
	s.Store.Unlock()
	s.Store.Persist("actions")
	s.Store.Persist("messages")
	return map[string]any{
		"id": actionID, "conversationId": cid, "status": "approved",
		"signedAt": now, "signatureHash": sig, "completed": true,
	}, nil
}
