package partners

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// employeeAction handles /api/partners/:id/:action (the legacy "action"
// surface used before digitalEmployeeRoute absorbed everything). Mirrors
// the legacy handlers_b.go L135-L258 — submit / approve / reject / pause
// for an employee. Other actions fall back to the digitalEmployeeRoute
// catch-all via the route table.
func (s *Service) employeeAction(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/partners/:id/:action
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "无效动作")
	}
	eid, action := parts[2], parts[3]
	s.Store.Lock()
	defer s.Store.Unlock()
	var emp map[string]any
	for _, e := range s.Store.Employees {
		if str(e["id"]) == eid {
			emp = e
			break
		}
	}
	if emp == nil {
		return nil, apperr.NotFoundErr(apperr.DigitalPartnerNotFound, "数字伙伴不存在")
	}
	if err := s.Deps.RequireWorkspaceAccess(id, str(emp["workspaceId"])); err != nil {
		return nil, err
	}
	mutated := false
	defer func() {
		if mutated && s.Deps.PersistEmployeesLocked != nil {
			s.Deps.PersistEmployeesLocked()
		}
	}()
	switch action {
	case "submit":
		if err := s.Deps.ValidatePublishedCapabilities(emp); err != nil {
			return nil, err
		}
		now := time.Now().UTC().Format(time.RFC3339)
		if s.Deps.RequiresPeerApprovalGate(id) {
			emp["lifecycle"] = "pending_approval"
			emp["release"] = map[string]any{
				"status": "pending_approval", "requestedAt": now,
				"requestedBy": id.Name, "requestedById": id.ID,
			}
			emp["updatedAt"] = now
			s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "申请数字伙伴上岗", str(emp["name"]), "success", "待管理员审批")
			mutated = true
			return emp, nil
		}
		emp["lifecycle"] = "active"
		emp["release"] = map[string]any{
			"status": "released", "releasedAt": now,
			"requestedBy": id.Name, "requestedById": id.ID,
			"approver": id.Name, "approverId": id.ID,
		}
		emp["updatedAt"] = now
		s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "数字伙伴上岗", str(emp["name"]), "success", "")
		mutated = true
		return emp, nil
	case "approve":
		if err := s.Deps.ValidatePublishedCapabilities(emp); err != nil {
			return nil, err
		}
		rel, _ := emp["release"].(map[string]any)
		reqID, reqName := "", ""
		if rel != nil {
			reqID, reqName = str(rel["requestedById"]), str(rel["requestedBy"])
		}
		if reqID == "" {
			reqID = str(emp["ownerId"])
		}
		if reqName == "" {
			reqName = str(emp["owner"])
		}
		if err := s.Deps.RequireProductionDualApprovalFn(reqID, reqName, id, "上岗"); err != nil {
			return nil, err
		}
		relMap := rel
		if relMap == nil {
			relMap = map[string]any{"requestedBy": reqName, "requestedById": reqID}
		}
		if hold, err := s.Deps.MaybeHoldForCountersign(relMap, id, str(emp["risk"]), "上岗"); err != nil {
			return nil, err
		} else if hold {
			now := time.Now().UTC().Format(time.RFC3339)
			emp["lifecycle"] = "pending_countersign"
			emp["release"] = relMap
			emp["updatedAt"] = now
			s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "上岗会签待副署", str(emp["name"]), "success", "pending_countersign")
			mutated = true
			return emp, nil
		}
		now := time.Now().UTC().Format(time.RFC3339)
		emp["lifecycle"] = "active"
		emp["version"] = strings.TrimSuffix(str(emp["version"]), "-draft")
		emp["release"] = map[string]any{
			"status": "released", "releasedAt": now,
			"requestedBy": reqName, "requestedById": reqID,
			"approver": id.Name, "approverId": id.ID,
			"firstApprover": relMap["firstApprover"], "firstApproverId": relMap["firstApproverId"],
			"countersigner": relMap["countersigner"], "countersignerId": relMap["countersignerId"],
		}
		emp["updatedAt"] = now
		s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "确认数字伙伴上岗", str(emp["name"]), "success", "")
		mutated = true
		return emp, nil
	case "reject":
		if !authHas(id, "release.approve") && id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.ReleaseApproveForbidden, "无权驳回")
		}
		if !s.Deps.ActorIsAdmin(id) && str(emp["ownerId"]) == id.ID {
			return nil, apperr.Forbidden(apperr.SODSelfApproval, "创建者不能审批自己的生产发布")
		}
		emp["lifecycle"] = "draft"
		emp["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "驳回数字伙伴上岗", str(emp["name"]), "success", "")
		mutated = true
		return emp, nil
	case "pause":
		emp["lifecycle"] = "paused"
		s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "暂停数字伙伴", str(emp["name"]), "success", "")
		mutated = true
		return emp, nil
	default:
		return nil, apperr.NotFoundErr(apperr.NotFound, "未知动作")
	}
}

// validatePublishedCapabilities enforces the "must have a published model
// binding" gate before approving a partner for production release.
// Mirrors the legacy handler_b.go L260-L270.
func (s *Service) validatePublishedCapabilities(emp map[string]any) error {
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return nil
	}
	// Mock-shaped capabilities use display names / catalog options; allow non-empty model.
	if str(caps["model"]) == "" && str(caps["modelRouteId"]) == "" {
		return apperr.BadReq(apperr.DigitalPartnerBinding, "须装配已发布模型")
	}
	return nil
}

// authHas is a tiny wrapper that mirrors auth.Has("release.approve") so
// the partner package doesn't have to import internal/auth here for a
// single substring check. Returns true when the identity has the named
// permission in its comma-separated Permissions list, OR is admin (which
// implicitly holds all permissions in the platform model).
func authHas(id *auth.Identity, perm string) bool {
	if id == nil {
		return false
	}
	if id.Role == "admin" {
		return true
	}
	for _, p := range id.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}
