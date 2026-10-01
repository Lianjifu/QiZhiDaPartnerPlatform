package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) getBilling(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "billing.read") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "缺少 billing.read")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.Billing, nil
}

func (s *Server) getBillingQuota(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "billing.read") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "缺少 billing.read")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	b := s.Store.Billing
	usage, _ := b["usage"].(map[string]any)
	quota, _ := b["quota"].(map[string]any)
	return map[string]any{
		"usage": usage, "quota": quota,
		"progress": map[string]any{
			"tokens": ratio(usage["tokens"], quota["tokens"]),
			"usd":    ratio(usage["usd"], quota["usd"]),
		},
	}, nil
}

func ratio(used, limit any) float64 {
	u, ok1 := asFloat(used)
	l, ok2 := asFloat(limit)
	if !ok1 || !ok2 || l == 0 {
		return 0
	}
	return u / l
}

func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	default:
		return 0, false
	}
}

func (s *Server) listBackups(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" && !auth.Has(id, "audit.read") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权查看备份")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.Backups, nil
}

func (s *Server) requestBackup(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "备份申请仅限管理员")
	}
	body, _ := decodeMap(r)
	item := map[string]any{
		"id": s.Store.ID("bk"), "workspaceId": s.workspaceID(r),
		"status": "pending_approval", "requestedBy": id.Name,
		"requestedAt": time.Now().UTC().Format(time.RFC3339),
		"scope":       coalesce(str(body["scope"]), "full"),
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Backups = append([]map[string]any{item}, s.Store.Backups...)
	s.Store.PersistCollection("backups", s.Store.Backups)
	s.Store.AppendAudit(s.workspaceID(r), id.Name, "申请备份", str(item["scope"]), "success", "需双人审批")
	return item, nil
}

func (s *Server) backupAction(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
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
		if !actorIsAdmin(id) && str(b["requestedBy"]) == id.Name && (action == "approve" || action == "restore-drill") {
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
		s.Store.PersistCollection("backups", s.Store.Backups)
		s.Store.AppendAudit(str(b["workspaceId"]), id.Name, "备份"+action, bid, "success", "")
		return b, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "备份单不存在")
}
