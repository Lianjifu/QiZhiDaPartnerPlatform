package models

import (
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// ListRoutingPolicies → GET /api/model-routing/policies
func (s *Service) ListRoutingPolicies(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, p := range s.Store.RoutingPolicies {
		if str(p["workspaceId"]) != ws {
			continue
		}
		cp := map[string]any{}
		for k, v := range p {
			cp[k] = v
		}
		fb := stringSlice(p["fallbackModelIds"])
		if fb == nil {
			fb = []string{}
		}
		cp["fallbackModelIds"] = fb
		issues := stringSlice(p["validationIssues"])
		if issues == nil {
			issues = []string{}
		}
		cp["validationIssues"] = issues
		out = append(out, cp)
	}
	return out, nil
}

// CreateRoutingPolicy → POST /api/model-routing/policies
func (s *Service) CreateRoutingPolicy(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.DecodeMap(r)
	ws := s.WorkspaceID(r)
	dataScope := coalesce(str(body["dataScope"]), "internal")
	egress := body["egressAllowed"] == true
	if dataScope == "restricted" && egress {
		return nil, apperr.Forbidden(apperr.EgressBlocked, "受限数据不允许出境")
	}
	item := map[string]any{
		"id": s.Store.ID("rp"), "workspaceId": ws,
		"level": coalesce(str(body["level"]), "P3"), "primaryModelId": coalesce(str(body["primaryModelId"]), ""),
		"fallbackModelIds": stringSlice(body["fallbackModelIds"]), "dataScope": dataScope,
		"egressAllowed": egress, "budgetLimitUsd": body["budgetLimitUsd"],
		"status": "draft", "validationIssues": []string{},
	}
	if item["budgetLimitUsd"] == nil {
		item["budgetLimitUsd"] = 0
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.RoutingPolicies = append([]map[string]any{item}, s.Store.RoutingPolicies...)
	s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
	s.appendModelAudit(ws, id.Name, "创建路由草稿", str(item["level"]), "success", nil)
	return item, nil
}

// RoutingPolicyAction → /api/model-routing/policies/{id}/{action} catch-all
// (versions / validate / publish / unpublish / rollback / draft).
func (s *Service) RoutingPolicyAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.PolicyNotFound, "策略不存在")
	}
	pid := parts[3]
	action := ""
	if len(parts) >= 5 {
		action = parts[4]
	}
	id := s.IdentityFrom(r.Context())
	ws := s.WorkspaceID(r)

	if action == "versions" && r.Method == http.MethodGet {
		if err := requireModelRead(id); err != nil {
			return nil, err
		}
		s.Store.RLock()
		defer s.Store.RUnlock()
		if _, err := s.findPolicyLocked(pid, ws); err != nil {
			return nil, err
		}
		var out []map[string]any
		for _, v := range s.Store.PolicyVersions {
			if str(v["policyId"]) == pid {
				out = append(out, v)
			}
		}
		return out, nil
	}

	if err := requireModelWrite(id); err != nil {
		return nil, err
	}

	switch action {
	case "draft":
		if r.Method != http.MethodPatch {
			return nil, apperr.NotFoundErr(apperr.NotFound, "未知策略动作")
		}
		body, _ := s.DecodeMap(r)
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		for _, k := range []string{"level", "primaryModelId", "fallbackModelIds", "dataScope", "egressAllowed", "budgetLimitUsd"} {
			if v, ok := body[k]; ok {
				p[k] = v
			}
		}
		p["id"] = pid
		p["workspaceId"] = ws
		p["status"] = "draft"
		p["validationIssues"] = []string{}
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		s.appendModelAudit(ws, id.Name, "更新路由草稿", str(p["level"]), "success", map[string]any{"reason": str(body["reason"])})
		return p, nil
	case "validate":
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		issues := s.validateRoutingPolicyLocked(p)
		p["validationIssues"] = issues
		if len(issues) == 0 {
			p["status"] = "ready"
		} else {
			p["status"] = "draft"
		}
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		result := "success"
		reason := ""
		if len(issues) > 0 {
			result = "failed"
			reason = strings.Join(issues, "；")
		}
		s.appendModelAudit(ws, id.Name, "校验路由草稿", str(p["level"]), result, map[string]any{"reason": reason})
		return p, nil
	case "publish":
		s.Store.Lock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			s.Store.Unlock()
			return nil, err
		}
		st := str(p["status"])
		if st != "ready" && st != "pending_approval" && st != "pending_countersign" {
			s.appendModelAudit(ws, id.Name, "发布路由版本", str(p["level"]), "failed", map[string]any{"reason": "草稿尚未通过校验"})
			s.Store.Unlock()
			return nil, apperr.BadReq(apperr.PolicyNotReady, "草稿尚未通过校验，无法发布")
		}
		if s.RequiresPeerApprovalGate != nil && s.RequiresPeerApprovalGate(id) && st == "ready" {
			p["status"] = "pending_approval"
			p["requestedBy"] = id.Name
			p["requestedById"] = id.ID
			p["requestedAt"] = time.Now().UTC().Format(time.RFC3339)
			s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
			s.appendModelAudit(ws, id.Name, "申请发布路由版本", str(p["level"]), "success", map[string]any{"reason": "待管理员审批"})
			s.Store.Unlock()
			return p, nil
		}
		if err := s.RequireProductionDualApproval(str(p["requestedById"]), str(p["requestedBy"]), id, "路由发布"); err != nil {
			s.Store.Unlock()
			return nil, err
		}
		hold, herr := s.MaybeHoldForCountersign(p, id, str(p["dataScope"]), "路由发布")
		if herr != nil {
			s.Store.Unlock()
			return nil, herr
		} else if hold {
			s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
			s.appendModelAudit(ws, id.Name, "路由发布会签待副署", str(p["level"]), "success", map[string]any{"reason": "pending_countersign"})
			s.Store.Unlock()
			return p, nil
		}
		s.Store.Unlock()
		if err := s.EvaluateWrite(r, "model", "publish", policyInputApprove(id)); err != nil {
			if id.Role != "admin" {
				return nil, err
			}
		}
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err = s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		// supersede other published at same level
		for _, other := range s.Store.RoutingPolicies {
			if str(other["workspaceId"]) == ws && str(other["level"]) == str(p["level"]) && str(other["id"]) != pid && str(other["status"]) == "published" {
				other["status"] = "superseded"
			}
		}
		maxVer := 0
		for _, v := range s.Store.PolicyVersions {
			if str(v["policyId"]) == pid {
				if n := intFrom(v["version"]); n > maxVer {
					maxVer = n
				}
			}
		}
		snap := map[string]any{}
		for k, v := range p {
			snap[k] = v
		}
		snap["fallbackModelIds"] = append([]string{}, stringSlice(p["fallbackModelIds"])...)
		snap["validationIssues"] = []string{}
		ver := map[string]any{
			"id": s.Store.ID("rpv"), "policyId": pid, "version": maxVer + 1,
			"snapshot": snap, "publishedAt": time.Now().UTC().Format(time.RFC3339), "publishedBy": id.Name,
		}
		p["status"] = "published"
		s.Store.PolicyVersions = append([]map[string]any{ver}, s.Store.PolicyVersions...)
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		s.Store.PersistCollection("policy_versions", s.Store.PolicyVersions)
		s.appendModelAudit(ws, id.Name, "发布路由版本", str(p["level"]), "success", map[string]any{"policyVersion": str(ver["id"])})
		if s.AppendAudit != nil {
			s.AppendAudit(ws, id.Name, "发布路由策略", str(p["level"]), "success", "")
		}
		if s.IncModelPolicyPublish != nil {
			s.IncModelPolicyPublish()
		}
		return ver, nil
	case "unpublish":
		body, _ := s.DecodeMap(r)
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		if str(p["status"]) != "published" {
			s.appendModelAudit(ws, id.Name, "取消发布路由", str(p["level"]), "failed", map[string]any{"reason": "仅已发布路由可取消发布"})
			return nil, apperr.BadReq(apperr.PolicyNotPublished, "仅已发布路由可取消发布")
		}
		p["status"] = "draft"
		p["validationIssues"] = []string{}
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		s.appendModelAudit(ws, id.Name, "取消发布路由", str(p["level"]), "success", map[string]any{"reason": str(body["reason"])})
		if s.AppendAudit != nil {
			s.AppendAudit(ws, id.Name, "取消发布路由策略", str(p["level"]), "success", str(body["reason"]))
		}
		return p, nil
	case "rollback":
		body, _ := s.DecodeMap(r)
		versionID := str(body["versionId"])
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		var target map[string]any
		for _, v := range s.Store.PolicyVersions {
			if str(v["id"]) == versionID && str(v["policyId"]) == pid {
				target = v
				break
			}
		}
		if target == nil {
			return nil, apperr.NotFoundErr(apperr.VersionNotFound, "路由版本不存在")
		}
		snap, _ := target["snapshot"].(map[string]any)
		if snap == nil {
			return nil, apperr.BadReq(apperr.RollbackInvalid, "版本快照无效")
		}
		rollbackSnap := map[string]any{}
		for k, v := range snap {
			rollbackSnap[k] = v
		}
		rollbackSnap["status"] = "ready"
		rollbackSnap["fallbackModelIds"] = append([]string{}, stringSlice(snap["fallbackModelIds"])...)
		rollbackSnap["validationIssues"] = []string{}
		issues := s.validateRoutingPolicyLocked(rollbackSnap)
		if len(issues) > 0 {
			s.appendModelAudit(ws, id.Name, "回滚路由版本", str(p["level"]), "failed", map[string]any{
				"reason": strings.Join(issues, "；"), "policyVersion": str(target["id"]),
			})
			return nil, apperr.BadReq(apperr.RollbackInvalid, strings.Join(issues, "；"))
		}
		maxVer := 0
		for _, v := range s.Store.PolicyVersions {
			if str(v["policyId"]) == pid {
				if n := intFrom(v["version"]); n > maxVer {
					maxVer = n
				}
			}
		}
		newSnap := map[string]any{}
		for k, v := range snap {
			newSnap[k] = v
		}
		newSnap["status"] = "published"
		newSnap["fallbackModelIds"] = append([]string{}, stringSlice(snap["fallbackModelIds"])...)
		newSnap["validationIssues"] = []string{}
		ver := map[string]any{
			"id": s.Store.ID("rpv"), "policyId": pid, "version": maxVer + 1,
			"snapshot": newSnap, "publishedAt": time.Now().UTC().Format(time.RFC3339),
			"publishedBy": id.Name, "rollbackOf": target["id"],
		}
		for k, v := range newSnap {
			if k != "id" {
				p[k] = v
			}
		}
		p["status"] = "published"
		s.Store.PolicyVersions = append([]map[string]any{ver}, s.Store.PolicyVersions...)
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		s.Store.PersistCollection("policy_versions", s.Store.PolicyVersions)
		s.appendModelAudit(ws, id.Name, "回滚路由版本", str(p["level"]), "success", map[string]any{"policyVersion": str(ver["id"])})
		if s.AppendAudit != nil {
			s.AppendAudit(ws, id.Name, "回滚路由策略", pid, "success", "")
		}
		return ver, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "未知策略动作")
}