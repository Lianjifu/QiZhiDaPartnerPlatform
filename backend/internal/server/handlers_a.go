package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) listWorkspaces(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	out := s.visibleWorkspaces(id)
	if len(out) == 0 {
		created := s.Store.EnsureDefaultWorkspace()
		s.Store.RebuildWorkspaceAccessGrants()
		if created {
			s.Store.Persist("workspaces")
		}
		if id != nil && !contains(id.WorkspaceIDs, store.DefaultWorkspaceID) {
			id.WorkspaceIDs = append(id.WorkspaceIDs, store.DefaultWorkspaceID)
		}
		if id != nil && (id.WorkspaceID == "" || !contains(id.WorkspaceIDs, id.WorkspaceID)) {
			id.WorkspaceID = store.DefaultWorkspaceID
		}
		out = s.visibleWorkspaces(id)
	}
	return out, nil
}

func (s *Server) visibleWorkspaces(id *auth.Identity) []map[string]any {
	out := make([]map[string]any, 0)
	if id == nil {
		return out
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, w := range s.Store.Workspaces {
		if str(w["tenantId"]) != id.TenantID {
			continue
		}
		wsID := str(w["id"])
		if id.Role == "admin" || contains(id.WorkspaceIDs, wsID) || str(w["ownerId"]) == id.ID {
			out = append(out, w)
		}
	}
	return out
}

func (s *Server) createWorkspace(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "workspace.write") {
		return nil, apperr.Forbidden(apperr.WorkspaceWriteForbidden, "无权创建工作区")
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.WorkspaceNameRequired, "工作区名称必填")
	}
	item := map[string]any{
		"id": s.Store.ID("workspace"), "tenantId": id.TenantID, "ownerId": id.ID, "status": "active",
		"name": name, "region": coalesce(str(body["region"]), "cn-east-1"),
		"plan": coalesce(str(body["plan"]), "enterprise"), "memberCount": 1, "complianceScore": 80,
		"createdAt": time.Now().UTC().Format(time.RFC3339),
	}
	wsID := str(item["id"])
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Workspaces = append([]map[string]any{item}, s.Store.Workspaces...)
	s.Store.Members[wsID] = []map[string]any{
		{"id": id.ID, "name": id.Name, "role": id.Role, "email": id.Email},
	}
	s.Store.Quotas[wsID] = buildWorkspaceQuota(body)
	s.Store.ActorExtraWorkspaces[id.ID] = append(s.Store.ActorExtraWorkspaces[id.ID], wsID)
	id.WorkspaceIDs = append(id.WorkspaceIDs, wsID)
	s.Store.AppendAudit(wsID, id.Name, "创建工作区", name, "success", "")
	s.Store.PersistCollection("workspaces", s.Store.Workspaces)
	return item, nil
}

func buildWorkspaceQuota(body map[string]any) map[string]any {
	quotaBody, _ := body["quota"].(map[string]any)
	return map[string]any{
		"seats":       map[string]any{"used": 1, "limit": quotaLimit(quotaBody, "seats", 50, 1, 500)},
		"agents":      map[string]any{"used": 0, "limit": quotaLimit(quotaBody, "agents", 20, 1, 200)},
		"tokens":      map[string]any{"used": 0, "limit": quotaLimit(quotaBody, "tokens", 1_000_000, 100_000, 500_000_000)},
		"concurrency": map[string]any{"used": 0, "limit": quotaLimit(quotaBody, "concurrency", 10, 1, 200)},
		"budgetUsd":   map[string]any{"used": 0, "limit": quotaLimit(quotaBody, "budgetUsd", 5000, 100, 1_000_000)},
	}
}

func quotaLimit(quota map[string]any, key string, def, min, max int) int {
	if quota == nil {
		return def
	}
	raw, ok := quota[key]
	if !ok || raw == nil {
		return def
	}
	switch v := raw.(type) {
	case map[string]any:
		if lim, ok := asInt(v["limit"]); ok {
			return clampInt(lim, min, max)
		}
	case float64:
		return clampInt(int(v), min, max)
	case int:
		return clampInt(v, min, max)
	case int64:
		return clampInt(int(v), min, max)
	}
	return def
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}

func clampInt(n, min, max int) int {
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

func (s *Server) switchHistory(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.SwitchHistory, nil
}

func (s *Server) workspaceSubresource(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/workspaces/:id/:resource
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "无效工作区路径")
	}
	wsID, resource := parts[2], parts[3]
	if err := s.requireWorkspaceAccess(id, wsID); err != nil {
		return nil, err
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	switch resource {
	case "members":
		return s.Store.Members[wsID], nil
	case "quota":
		return s.Store.Quotas[wsID], nil
	case "bindings":
		var out []map[string]any
		for _, b := range s.Store.Bindings {
			if str(b["workspaceId"]) == wsID {
				out = append(out, b)
			}
		}
		return out, nil
	case "environments":
		var out []map[string]any
		for _, e := range s.Store.Environments {
			if str(e["workspaceId"]) == wsID {
				out = append(out, e)
			}
		}
		return out, nil
	case "policy":
		return s.Store.WorkspacePolicy[wsID], nil
	case "audit":
		var out []map[string]any
		for _, a := range s.Store.Audits {
			if str(a["workspaceId"]) == wsID {
				out = append(out, a)
			}
		}
		return out, nil
	case "agents":
		return []any{}, nil
	case "tools":
		return []any{}, nil
	case "report":
		var ws map[string]any
		for _, w := range s.Store.Workspaces {
			if str(w["id"]) == wsID {
				ws = w
				break
			}
		}
		if ws == nil {
			return nil, apperr.NotFoundErr(apperr.WorkspaceNotFound, "工作区不存在")
		}
		count := 0
		for _, a := range s.Store.Audits {
			if str(a["workspaceId"]) == wsID {
				count++
			}
		}
		return map[string]any{"workspace": ws, "quota": s.Store.Quotas[wsID], "governanceScore": ws["complianceScore"], "auditCount": count}, nil
	case "impact":
		var bindings []map[string]any
		blocked := false
		for _, b := range s.Store.Bindings {
			if str(b["workspaceId"]) == wsID {
				bindings = append(bindings, b)
				if str(b["status"]) == "active" {
					blocked = true
				}
			}
		}
		return map[string]any{"blocked": blocked, "bindings": bindings}, nil
	default:
		return nil, apperr.NotFoundErr(apperr.NotFound, "未知工作区资源")
	}
}

func (s *Server) workspaceAction(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "无效工作区动作")
	}
	wsID, action := parts[2], parts[3]
	if err := s.requireWorkspaceAccess(id, wsID); err != nil {
		return nil, err
	}
	if !auth.Has(id, "workspace.write") && action != "report" && action != "impact" {
		return nil, apperr.Forbidden(apperr.WorkspaceWriteForbidden, "无权修改工作区")
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	var ws map[string]any
	for _, w := range s.Store.Workspaces {
		if str(w["id"]) == wsID {
			ws = w
			break
		}
	}
	if ws == nil {
		return nil, apperr.NotFoundErr(apperr.WorkspaceNotFound, "工作区不存在")
	}
	switch action {
	case "freeze", "archive":
		for _, b := range s.Store.Bindings {
			if str(b["workspaceId"]) == wsID && str(b["status"]) == "active" && body["force"] != true {
				return nil, apperr.Conflict(apperr.WorkspaceInUse, "工作区仍有活跃绑定")
			}
		}
		if action == "freeze" {
			ws["status"] = "frozen"
		} else {
			ws["status"] = "archived"
		}
		s.Store.AppendAudit(wsID, id.Name, action+"工作区", str(ws["name"]), "success", str(body["reason"]))
		return ws, nil
	case "transfer":
		if str(body["ownerId"]) == "" {
			return nil, apperr.BadReq(apperr.WorkspaceOwnerRequired, "缺少负责人")
		}
		ws["ownerId"] = body["ownerId"]
		s.Store.AppendAudit(wsID, id.Name, "移交工作区负责人", str(ws["name"]), "success", str(body["reason"]))
		return ws, nil
	case "runtime":
		ev := map[string]any{
			"id": s.Store.ID("runtime"), "workspaceId": wsID, "type": coalesce(str(body["type"]), "incident"),
			"status": "open", "detail": coalesce(str(body["detail"]), "运行治理动作"), "createdAt": time.Now().UTC().Format(time.RFC3339),
		}
		s.Store.AppendAudit(wsID, id.Name, "运行治理："+str(ev["type"]), str(ws["name"]), "success", str(body["reason"]))
		return ev, nil
	default:
		return nil, apperr.NotFoundErr(apperr.NotFound, "未知动作")
	}
}

func (s *Server) accessGovernance(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "access.read") {
		return nil, apperr.Forbidden(apperr.AccessReadForbidden, "缺少 access.read")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	conflicts := []map[string]any{}
	for _, g := range s.Store.AccessGrants {
		if str(g["role"]) == "auditor" {
			ws, _ := toStringSlice(g["workspaceIds"])
			if contains(ws, "w1") {
				conflicts = append(conflicts, map[string]any{
					"id": "conflict-" + str(g["id"]), "subjectName": g["subjectName"],
					"reason": "审计角色拥有生产工作区范围，需确认其不含任何写权限", "severity": "medium",
				})
			}
		}
	}
	grants := s.Store.AccessGrants
	if grants == nil {
		grants = []map[string]any{}
	}
	reviews := s.Store.AccessReviews
	if reviews == nil {
		reviews = []map[string]any{}
	}
	rules := s.Store.SodRules
	if rules == nil {
		rules = []map[string]any{}
	}
	return map[string]any{
		"grants": grants, "reviews": reviews,
		"rules": rules, "conflicts": conflicts, "generatedAt": time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) createGrant(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "access.write") {
		return nil, apperr.Forbidden(apperr.AccessWriteForbidden, "缺少 access.write")
	}
	body, _ := decodeMap(r)
	if strings.TrimSpace(str(body["subjectName"])) == "" || str(body["role"]) == "" {
		return nil, apperr.BadReq(apperr.AccessGrantInvalid, "授权参数无效")
	}
	wsIDs, _ := toStringSlice(body["workspaceIds"])
	scopes, _ := toStringSlice(body["environmentScopes"])
	if len(wsIDs) == 0 || len(scopes) == 0 {
		return nil, apperr.BadReq(apperr.AccessGrantInvalid, "授权参数无效")
	}
	status := "active"
	if str(body["expiresAt"]) != "" {
		status = "expiring"
	}
	grant := map[string]any{
		"id": s.Store.ID("grant"), "subjectId": coalesce(str(body["subjectId"]), s.Store.ID("subject")),
		"subjectName": strings.TrimSpace(str(body["subjectName"])), "role": body["role"],
		"tenantId": "tenant-acme", "workspaceIds": wsIDs, "environmentScopes": scopes,
		"status": status, "expiresAt": body["expiresAt"], "grantedBy": id.Name,
		"createdAt": time.Now().UTC().Format(time.RFC3339),
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.AccessGrants = append([]map[string]any{grant}, s.Store.AccessGrants...)
	s.Store.AppendAudit(wsIDs[0], id.Name, "授予访问范围", str(grant["subjectName"])+" · "+str(grant["role"]), "success", "")
	s.afterWriteLocked("access_grants")
	return grant, nil
}

func (s *Server) grantAction(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "access.write") {
		return nil, apperr.Forbidden(apperr.AccessWriteForbidden, "缺少 access.write")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/access/grants/:id/:action
	if len(parts) < 5 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "无效授权动作")
	}
	grantID, action := parts[3], parts[4]
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	var grant map[string]any
	for _, g := range s.Store.AccessGrants {
		if str(g["id"]) == grantID {
			grant = g
			break
		}
	}
	if grant == nil {
		return nil, apperr.NotFoundErr(apperr.AccessGrantNotFound, "授权不存在")
	}
	if str(grant["subjectId"]) == id.ID {
		return nil, apperr.Forbidden(apperr.AccessSelfEscalation, "管理员不能修改自己的授权范围")
	}
	if action == "revoke" {
		grant["status"] = "expired"
	} else {
		grant["status"] = "active"
		grant["expiresAt"] = body["expiresAt"]
	}
	ws, _ := toStringSlice(grant["workspaceIds"])
	wsID := "w1"
	if len(ws) > 0 {
		wsID = ws[0]
	}
	label := "延长临时授权"
	if action == "revoke" {
		label = "回收访问范围"
	}
	s.Store.AppendAudit(wsID, id.Name, label, str(grant["subjectName"])+" · "+str(grant["role"]), "success", "")
	s.afterWriteLocked("access_grants")
	return grant, nil
}

func (s *Server) completeReview(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "access.write") {
		return nil, apperr.Forbidden(apperr.AccessWriteForbidden, "缺少 access.write")
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, rev := range s.Store.AccessReviews {
		if str(rev["id"]) == str(body["id"]) {
			rev["reviewed"] = rev["total"]
			rev["status"] = "completed"
			s.Store.AppendAudit("w1", id.Name, "完成权限复核", str(rev["title"]), "success", "")
			s.afterWriteLocked("access_reviews")
			return rev, nil
		}
	}
	return nil, apperr.NotFoundErr(apperr.AccessReviewNotFound, "复核不存在")
}

func (s *Server) ztOverview(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	enabled := 0
	for _, p := range s.Store.ZTPolicies {
		if p["enabled"] == true {
			enabled++
		}
	}
	blocked, approvals, masked := 0, 0, 0
	for _, e := range s.Store.ZTEvents {
		switch str(e["decision"]) {
		case "deny":
			blocked++
		case "approval_required":
			approvals++
		case "mask":
			masked++
		}
	}
	activeTemp := 0
	for _, a := range s.Store.TempAuths {
		if str(a["status"]) == "active" {
			activeTemp++
		}
	}
	return map[string]any{
		"policyCount": len(s.Store.ZTPolicies), "enabledCount": enabled,
		"eventCount": len(s.Store.ZTEvents), "activeTempAuth": activeTemp,
		// FE-compatible aliases (derived from events / policies)
		"policies": enabled, "blocked": blocked, "approvals": approvals, "masked": masked,
		"risk":      map[bool]string{true: "attention", false: "normal"}[blocked > 0 || approvals > 0],
		"updatedAt": time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) ztPolicies(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.ZTPolicies, nil
}

func (s *Server) createZTPolicy(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "更新零信任策略仅限管理员执行")
	}
	body, _ := decodeMap(r)
	if strings.TrimSpace(str(body["name"])) == "" || str(body["resource"]) == "" || str(body["action"]) == "" || str(body["decision"]) == "" {
		return nil, apperr.BadReq(apperr.ZeroTrustPolicyInvalid, "策略参数无效")
	}
	p := map[string]any{
		"id": s.Store.ID("zt"), "name": strings.TrimSpace(str(body["name"])),
		"resource": body["resource"], "action": body["action"],
		"scope": coalesce(str(body["scope"]), "workspace"), "condition": coalesce(str(body["condition"]), ""),
		"decision": body["decision"], "enabled": true, "baseline": false, "version": 1,
		"updatedAt": time.Now().UTC().Format(time.RFC3339), "updatedBy": id.Name,
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.ZTPolicies = append([]map[string]any{p}, s.Store.ZTPolicies...)
	s.Store.AppendAudit(s.workspaceID(r), id.Name, "创建零信任策略", str(p["name"]), "success", "")
	s.afterWriteLocked("zt_policies")
	return p, nil
}

func (s *Server) patchZTPolicy(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "更新零信任策略仅限管理员执行")
	}
	pid := strings.TrimPrefix(r.URL.Path, "/api/zero-trust/policies/")
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, p := range s.Store.ZTPolicies {
		if str(p["id"]) != pid {
			continue
		}
		if p["baseline"] == true && body["enabled"] == false {
			return nil, apperr.Forbidden(apperr.ZeroTrustBaselineLocked, "租户安全基线不可停用")
		}
		for k, v := range body {
			p[k] = v
		}
		p["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		p["updatedBy"] = id.Name
		s.Store.AppendAudit(s.workspaceID(r), id.Name, "更新零信任策略", str(p["name"]), "success", "")
		s.afterWriteLocked("zt_policies")
		return p, nil
	}
	return nil, apperr.NotFoundErr(apperr.ZeroTrustPolicyNotFound, "策略不存在")
}

func (s *Server) ztEvaluate(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	body, _ := decodeMap(r)
	resource, action := str(body["resource"]), str(body["action"])
	if resource == "" || action == "" {
		return nil, apperr.BadReq(apperr.ZeroTrustEvalInvalid, "缺少 resource/action")
	}
	return s.evaluateZeroTrust(id, resource, action, str(body["classification"]), body["external"] == true, str(body["correlationId"]))
}

func (s *Server) evaluateZeroTrust(id *auth.Identity, resource, action, classification string, external bool, corr string) (map[string]any, error) {
	s.Store.Lock()
	defer s.Store.Unlock()
	if corr == "" {
		corr = s.Store.ID("corr")
	}
	decision, reason, policyID := "allow", "默认允许", ""
	if id != nil && id.Role == "user" && action == "publish" {
		decision, reason, policyID = "approval_required", "生产发布已转为管理员审批", "zt-user-production"
	}
	if classification == "restricted" && (external || (resource == "model" && action == "run")) {
		decision, reason, policyID = "deny", "受限数据禁止发送到外部模型", "zt-restricted-egress"
	}
	if id != nil && id.Role == "user" && resource == "memory" && action == "write" {
		decision, reason, policyID = "deny", "普通用户不能修改记忆治理策略", "zt-memory-governance"
	}
	if resource == "session" && action == "write" {
		for _, p := range s.Store.ZTPolicies {
			if p["enabled"] != true {
				continue
			}
			if str(p["resource"]) != "session" || str(p["action"]) != "write" {
				continue
			}
			if str(p["decision"]) != contract.PolicyDeny {
				continue
			}
			decision, reason, policyID = contract.PolicyDeny, coalesce(str(p["reason"]), coalesce(str(p["condition"]), "零信任拒绝会话写入")), str(p["id"])
		}
	}
	// temp auth override
	now := time.Now()
	for _, a := range s.Store.TempAuths {
		if str(a["status"]) != "active" {
			continue
		}
		exp, _ := time.Parse(time.RFC3339, str(a["expiresAt"]))
		if now.After(exp) {
			continue
		}
		if str(a["resource"]) == resource && str(a["action"]) == action && (id == nil || str(a["subjectId"]) == id.ID) {
			decision, reason, policyID = "allow", "临时授权放行", str(a["id"])
		}
	}
	ev := map[string]any{
		"id": s.Store.ID("zt-event"), "time": time.Now().UTC().Format(time.RFC3339),
		"tenantId": "tenant-acme", "workspaceId": coalesce(idWorkspace(id), "w1"),
		"actor": coalesce(idName(id), "anonymous"), "resource": resource, "action": action,
		"classification": coalesce(classification, "internal"), "decision": decision,
		"policyId": policyID, "reason": reason, "correlationId": corr,
	}
	s.Store.ZTEvents = append([]map[string]any{ev}, s.Store.ZTEvents...)
	return map[string]any{
		"decision": decision, "reason": reason, "policyId": policyID, "correlationId": corr,
		"resource": resource, "action": action,
	}, nil
}

func (s *Server) ztEvents(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, e := range s.Store.ZTEvents {
		if contains(id.WorkspaceIDs, str(e["workspaceId"])) {
			out = append(out, e)
		}
	}
	return out, nil
}

func (s *Server) listTempAuth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, a := range s.Store.TempAuths {
		if contains(id.WorkspaceIDs, str(a["workspaceId"])) {
			out = append(out, a)
		}
	}
	return out, nil
}

func (s *Server) createTempAuth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "授予临时访问仅限管理员执行")
	}
	body, _ := decodeMap(r)
	if strings.TrimSpace(str(body["subjectName"])) == "" || str(body["workspaceId"]) == "" || str(body["environment"]) == "" ||
		str(body["resource"]) == "" || str(body["action"]) == "" || strings.TrimSpace(str(body["reason"])) == "" || str(body["expiresAt"]) == "" {
		return nil, apperr.BadReq(apperr.TemporaryAuthInvalid, "临时授权参数无效")
	}
	if str(body["environment"]) == "production" {
		return nil, apperr.Forbidden(apperr.TemporaryAuthProdDual, "生产临时授权须双人审批")
	}
	exp, err := time.Parse(time.RFC3339, str(body["expiresAt"]))
	if err != nil || !exp.After(time.Now()) || exp.After(time.Now().Add(24*time.Hour)) {
		return nil, apperr.BadReq(apperr.TemporaryAuthTTLInvalid, "临时授权最长 24 小时")
	}
	if err := s.requireWorkspaceAccess(id, str(body["workspaceId"])); err != nil {
		return nil, err
	}
	authz := map[string]any{
		"id": s.Store.ID("zta"), "subjectId": coalesce(str(body["subjectId"]), s.Store.ID("subject")),
		"subjectName": strings.TrimSpace(str(body["subjectName"])), "workspaceId": body["workspaceId"],
		"environment": body["environment"], "resource": body["resource"], "action": body["action"],
		"reason": strings.TrimSpace(str(body["reason"])), "status": "active",
		"expiresAt": body["expiresAt"], "approvedBy": id.Name,
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.TempAuths = append([]map[string]any{authz}, s.Store.TempAuths...)
	s.Store.AppendAudit(str(body["workspaceId"]), id.Name, "授予临时零信任授权", str(authz["subjectName"]), "success", "")
	s.afterWriteLocked("temp_auths")
	return authz, nil
}

func (s *Server) revokeTempAuth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "回收临时访问仅限管理员执行")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		return nil, apperr.NotFoundErr(apperr.TemporaryAuthNotFound, "临时授权不存在")
	}
	aid := parts[3]
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, a := range s.Store.TempAuths {
		if str(a["id"]) == aid {
			a["status"] = "revoked"
			s.Store.AppendAudit(str(a["workspaceId"]), id.Name, "回收临时零信任授权", str(a["subjectName"]), "success", "")
			s.afterWriteLocked("temp_auths")
			return a, nil
		}
	}
	return nil, apperr.NotFoundErr(apperr.TemporaryAuthNotFound, "临时授权不存在")
}

func (s *Server) listReleases(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "audit.read") && id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.ReleaseReadForbidden, "无权查看发布审批")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, a := range s.Store.ReleaseApprovals {
		if contains(id.WorkspaceIDs, str(a["workspaceId"])) {
			out = append(out, a)
		}
	}
	return out, nil
}

func (s *Server) createRelease(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role == "auditor" {
		return nil, apperr.Forbidden(apperr.ReleaseRequestForbidden, "审计用户不能提交发布")
	}
	body, _ := decodeMap(r)
	if strings.TrimSpace(str(body["resourceName"])) == "" || str(body["resourceType"]) == "" {
		return nil, apperr.BadReq(apperr.ReleaseRequestInvalid, "发布申请无效")
	}
	wsID := coalesce(str(body["workspaceId"]), s.workspaceID(r))
	if err := s.requireWorkspaceAccess(id, wsID); err != nil {
		return nil, err
	}
	eval, err := s.evaluateZeroTrust(id, str(body["resourceType"]), "publish", "internal", false, str(body["correlationId"]))
	if err != nil {
		return nil, err
	}
	if str(eval["decision"]) == "deny" {
		return nil, apperr.Forbidden(apperr.ZeroTrustDeny, str(eval["reason"]))
	}
	approval := map[string]any{
		"id": s.Store.ID("approval"), "workspaceId": wsID, "environment": "production",
		"resourceType": body["resourceType"], "resourceName": strings.TrimSpace(str(body["resourceName"])),
		"submittedBy": id.Name, "submittedById": id.ID, "submittedAt": time.Now().UTC().Format(time.RFC3339),
		"status": "pending", "risk": coalesce(str(body["risk"]), "medium"), "correlationId": eval["correlationId"],
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.ReleaseApprovals = append([]map[string]any{approval}, s.Store.ReleaseApprovals...)
	s.Store.AppendAudit(wsID, id.Name, "提交生产发布申请", str(approval["resourceName"]), "success", "")
	s.afterWriteLocked("release_approvals")
	return approval, nil
}

func (s *Server) releaseAction(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "release.approve") {
		return nil, apperr.Forbidden(apperr.ReleaseApproveForbidden, "无权审批发布")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.ReleaseNotFound, "发布单不存在")
	}
	aid, action := parts[2], parts[3]
	if action == "approve" {
		if err := s.evaluateWrite(r, "release", "approve", policy.Input{ApproverID: id.ID}); err != nil {
			return nil, err
		}
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, a := range s.Store.ReleaseApprovals {
		if str(a["id"]) != aid {
			continue
		}
		if !actorIsAdmin(id) && str(a["submittedById"]) == id.ID {
			return nil, apperr.Forbidden(apperr.SODSelfApproval, "创建者不能审批自己的生产发布")
		}
		if action == "approve" {
			a["status"] = "approved"
		} else {
			a["status"] = "rejected"
		}
		label := "驳回生产发布"
		if a["status"] == "approved" {
			label = "审批生产发布"
		}
		s.Store.AppendAudit(str(a["workspaceId"]), id.Name, label, str(a["resourceName"]), "success", "")
		s.afterWriteLocked("release_approvals")
		return a, nil
	}
	return nil, apperr.NotFoundErr(apperr.ReleaseNotFound, "发布单不存在")
}

func (s *Server) auditCenter(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "audit.read") {
		return nil, apperr.Forbidden(apperr.AuditReadForbidden, "缺少 audit.read")
	}
	seen := map[string]bool{}
	var out []map[string]any

	// Prefer OpenSearch when configured, else PG audit.events (owned by de-sys).
	if s.Search != nil && s.Search.Available() {
		if rows, err := s.Search.SearchRecent(r.Context(), id.WorkspaceIDs, 200); err == nil && len(rows) > 0 {
			for _, a := range rows {
				aid := str(a["id"])
				if aid != "" {
					seen[aid] = true
				}
				out = append(out, a)
			}
		}
	}
	if s.AuditSink != nil {
		if pgRows, err := s.AuditSink.ListRecent(r.Context(), id.WorkspaceIDs, 200); err == nil {
			for _, a := range pgRows {
				aid := str(a["id"])
				if aid != "" && seen[aid] {
					continue
				}
				if aid != "" {
					seen[aid] = true
				}
				out = append(out, a)
			}
		}
	}

	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, a := range s.Store.Audits {
		if !contains(id.WorkspaceIDs, str(a["workspaceId"])) {
			continue
		}
		aid := str(a["id"])
		if aid != "" && seen[aid] {
			continue
		}
		out = append(out, a)
	}
	for _, e := range s.Store.ZTEvents {
		if !contains(id.WorkspaceIDs, str(e["workspaceId"])) {
			continue
		}
		result := "success"
		if str(e["decision"]) == "deny" {
			result = "failed"
		}
		out = append(out, map[string]any{
			"id": e["id"], "time": e["time"], "workspaceId": e["workspaceId"], "actor": e["actor"],
			"action": "零信任：" + str(e["decision"]),
			"target": str(e["resource"]) + ":" + str(e["action"]) + " · " + str(e["reason"]),
			"result": result, "correlationId": e["correlationId"],
		})
	}
	return out, nil
}

func (s *Server) auditExport(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "audit.export") {
		return nil, apperr.Forbidden(apperr.AuditExportForbidden, "缺少 audit.export")
	}
	ws := s.workspaceID(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	count := 0
	for _, a := range s.Store.Audits {
		if contains(id.WorkspaceIDs, str(a["workspaceId"])) {
			count++
		}
	}
	s.Store.AppendAudit(ws, id.Name, "登记导出脱敏审计证据", "共 "+itoa(count)+" 条记录", "success", "")
	return map[string]any{
		"id": s.Store.ID("export"), "status": "registered",
		"filename":    "audit-evidence-" + time.Now().UTC().Format("2006-01-02") + ".zip",
		"recordCount": count, "masked": true,
		"registered": true, "downloadAvailable": false,
	}, nil
}

func coalesce(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func idWorkspace(id *auth.Identity) string {
	if id == nil {
		return ""
	}
	return id.WorkspaceID
}

func idName(id *auth.Identity) string {
	if id == nil {
		return ""
	}
	return id.Name
}

func toStringSlice(v any) ([]string, bool) {
	switch t := v.(type) {
	case []string:
		return t, true
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			out = append(out, str(x))
		}
		return out, true
	default:
		return nil, false
	}
}

func itoa(n int) string { return fmt.Sprintf("%d", n) }
