package settings

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listBackups returns the backup roster. Restricted to admin / auditor
// — backups carry the entire workspace state, including secrets
// inventory pointers; non-admin viewers must not see this list.
func (s *Service) listBackups(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if id.Role != "admin" && !auth.Has(id, "audit.read") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权查看备份")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.Backups, nil
}

// requestBackup appends a new pending_approval backup request owned
// by the current workspace. Admin-only — backup creation is gated
// behind human-in-the-loop dual approval (request → approve by a
// second admin), so the request itself is admin-gated. Scope defaults
// to "full" when the caller omits it.
func (s *Service) requestBackup(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "备份申请仅限管理员")
	}
	body, _ := s.decodeMap(r)
	item := map[string]any{
		"id": s.Store.ID("bk"), "workspaceId": s.workspaceID(r),
		"status": "pending_approval", "requestedBy": id.Name,
		"requestedAt": time.Now().UTC().Format(time.RFC3339),
		"scope":       coalesce(str(body["scope"]), "full"),
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Backups = append([]map[string]any{item}, s.Store.Backups...)
	s.persistCollection("backups", s.Store.Backups)
	s.appendAudit(s.workspaceID(r), id.Name, "申请备份", str(item["scope"]), "success", "需双人审批")
	return item, nil
}

// backupAction handles /api/backups/{id}/{action}. Supported actions:
// approve / reject / restore-drill. Approve and restore-drill consult
// the policy engine and enforce SoD (the requester cannot also be
// the approver). Reject is unconstrained — admins can refuse their own
// request without violating dual-control. Audit + persistence are
// performed inside the store lock for atomicity.
func (s *Service) backupAction(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "备份审批仅限管理员")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "备份单不存在")
	}
	bid, action := parts[2], parts[3]
	if action == "approve" || action == "restore-drill" {
		if err := s.evaluateWrite(r, "backup", action, policy.Input{ApproverID: id.ID}); err != nil && id.Role != "admin" {
			return nil, err
		}
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, b := range s.Store.Backups {
		if str(b["id"]) != bid {
			continue
		}
		if !s.actorIsAdmin(id) && str(b["requestedBy"]) == id.Name && (action == "approve" || action == "restore-drill") {
			return nil, apperr.Forbidden(apperr.SODSelfApproval, "申请人不能审批/演练自己的备份")
		}
		switch action {
		case "approve":
			b["status"] = "approved"
			b["approvedBy"] = id.Name
			b["approvedAt"] = time.Now().UTC().Format(time.RFC3339)
		case "reject":
			b["status"] = "rejected"
			b["rejectedBy"] = id.Name
		case "restore-drill":
			if str(b["status"]) != "approved" && str(b["status"]) != "drill_passed" {
				return nil, apperr.BadReq(apperr.BadRequest, "仅已批准备份可演练恢复")
			}
			b["status"] = "drill_passed"
			b["lastDrillAt"] = time.Now().UTC().Format(time.RFC3339)
			b["lastDrillBy"] = id.Name
		default:
			return nil, apperr.NotFoundErr(apperr.NotFound, "未知备份动作")
		}
		s.persistCollection("backups", s.Store.Backups)
		s.appendAudit(str(b["workspaceId"]), id.Name, "备份"+action, bid, "success", "")
		return b, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "备份单不存在")
}
