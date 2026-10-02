package partners

import (
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// digitalEmployeeRoute handles /api/partners/:id and /api/partners/:id/:action
// paths. The single 12-sub-action surface includes evidence, runtime,
// configuration-versions[/:id/approve], configuration, evaluate, release
// ({default, withdraw, reject}), lifecycle, submit, approve, reject, pause,
// and the generic PATCH fallback.
//
// Returns the receiver on every successful mutation so the route table's
// `data, err = s.partnerSvc.DigitalEmployeeRoute(r)` returns a single
// JSON envelope.
func (s *Service) digitalEmployeeRoute(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/partners/:id[/...]; the partner Connect binding reuses this
	// entry point too.
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.DigitalPartnerNotFound, "数字伙伴不存在")
	}
	eid := parts[2]
	action, sub := "", ""
	if len(parts) >= 4 {
		action = parts[3]
	}
	if len(parts) >= 5 {
		sub = parts[4]
	}
	id := s.Deps.IdentityFrom(r.Context())
	if s.Store == nil {
		return nil, apperr.NotFoundErr(apperr.DigitalPartnerNotFound, "数字伙伴不存在")
	}
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

	if action == "" && r.Method == http.MethodGet {
		return s.Deps.EmployeeWithRuntimeLocked(emp), nil
	}
	if action == "evidence" && r.Method == http.MethodGet {
		return s.Deps.RealEmployeeEvidenceLocked(emp, 20), nil
	}
	if action == "runtime" && r.Method == http.MethodGet {
		return s.Deps.ComputeEmployeeRuntimeLocked(emp), nil
	}
	if action == "configuration-versions" {
		if sub == "" && r.Method == http.MethodGet {
			var out []map[string]any
			for _, v := range s.Store.ConfigVersions {
				if str(v["partnerId"]) == eid {
					out = append(out, v)
				}
			}
			return out, nil
		}
		if sub != "" && len(parts) >= 6 && parts[5] == "approve" && r.Method == http.MethodPost {
			if id.Role != "admin" {
				return nil, apperr.Forbidden(apperr.AdminRequired, "批准员工受控配置变更")
			}
			for _, v := range s.Store.ConfigVersions {
				if str(v["id"]) != sub {
					continue
				}
				if !s.Deps.ActorIsAdmin(id) && str(v["updatedById"]) == id.ID {
					return nil, apperr.Forbidden(apperr.SODSelfApproval, "配置提交人不能批准自己的受控变更")
				}
				v["status"] = "current"
				v["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
				if draft := s.Store.ConfigDrafts[sub]; draft != nil {
					s.applyEmployeeConfig(emp, draft)
					delete(s.Store.ConfigDrafts, sub)
					empSnap := make([]map[string]any, len(s.Store.Employees))
					copy(empSnap, s.Store.Employees)
					if s.Deps.PersistCollection != nil {
						s.Deps.PersistCollection("employees", empSnap)
					}
				}
				s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "批准员工受控配置变更", str(emp["name"]), "success", "")
				return v, nil
			}
			return nil, apperr.NotFoundErr(apperr.NotFound, "配置版本不存在")
		}
	}
	if action == "configuration" && r.Method == http.MethodPost {
		if id.Role == "auditor" {
			return nil, apperr.Forbidden(apperr.RoleForbidden, "无权写入数字伙伴")
		}
		body, _ := decodeMap(r)
		if err := s.Deps.ValidateEmployeeConfigurationBody(body); err != nil {
			return nil, err
		}
		// 岗位授权契约与能力装配均直接生效；历史 pending 版本仍可通过 approve 接口处理。
		summary := "更新岗位授权契约"
		if str(body["scope"]) == "capability" {
			summary = "更新能力装配"
		}
		ver := map[string]any{
			"id": s.Store.ID("cfg"), "partnerId": eid, "version": "配置 v" + itoa(len(s.Store.ConfigVersions)+1),
			"status": "current", "changeSummary": summary, "changedFields": []string{"岗位档案", "能力装配", "授权契约"},
			"updatedBy": id.Name, "updatedById": id.ID, "updatedAt": time.Now().UTC().Format(time.RFC3339),
			"requiresApproval": false,
		}
		for _, prev := range s.Store.ConfigVersions {
			if str(prev["partnerId"]) == eid && str(prev["status"]) == "current" {
				prev["status"] = "superseded"
			}
		}
		s.applyEmployeeConfig(emp, body)
		s.Store.ConfigVersions = append([]map[string]any{ver}, s.Store.ConfigVersions...)
		s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "更新员工配置", str(emp["name"]), "success", "")
		empSnap := make([]map[string]any, len(s.Store.Employees))
		copy(empSnap, s.Store.Employees)
		if s.Deps.PersistCollection != nil {
			s.Deps.PersistCollection("employees", empSnap)
		}
		if s.Deps.AfterWriteLocked != nil {
			s.Deps.AfterWriteLocked("config_versions")
		}
		return ver, nil
	}

	if id.Role == "auditor" && r.Method != http.MethodGet {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权写入数字伙伴")
	}
	body, _ := decodeMap(r)

	switch action {
	case "evaluate":
		incomplete := s.Deps.EmployeeEvaluateIncomplete(emp) || body["forceFail"] == true
		if incomplete {
			emp["evaluation"] = map[string]any{"status": "failed", "score": 68.0, "lastRunAt": time.Now().UTC().Format(time.RFC3339)}
		} else {
			emp["evaluation"] = map[string]any{"status": "passed", "score": 93.5, "lastRunAt": time.Now().UTC().Format(time.RFC3339)}
			if str(emp["lifecycle"]) == "draft" {
				emp["lifecycle"] = "testing"
			}
		}
	case "release":
		rel, _ := emp["release"].(map[string]any)
		if rel == nil {
			rel = map[string]any{}
			emp["release"] = rel
		}
		switch sub {
		case "withdraw":
			if str(rel["status"]) != "pending_approval" {
				return nil, apperr.BadReq(apperr.DigitalPartnerInvalid, "仅待审批申请可撤回")
			}
			if str(rel["requestedById"]) != id.ID {
				return nil, apperr.Forbidden(apperr.RoleForbidden, "仅申请人可撤回上岗申请")
			}
			emp["release"] = map[string]any{"status": "not_released"}
			emp["lifecycle"] = "testing"
		case "reject":
			if id.Role != "admin" {
				return nil, apperr.Forbidden(apperr.AdminRequired, "驳回上岗申请")
			}
			if str(rel["requestedById"]) == id.ID {
				return nil, apperr.Forbidden(apperr.SODSelfApproval, "上岗申请人不能驳回自己的申请")
			}
			emp["release"] = map[string]any{"status": "not_released", "rejectedReason": coalesce(str(body["reason"]), "未满足上岗门禁"), "rejectedBy": id.Name}
			emp["lifecycle"] = "testing"
		default:
			if err := s.Deps.ValidateEmployeeReleaseGates(emp); err != nil {
				return nil, err
			}
			now := time.Now().UTC().Format(time.RFC3339)
			if s.Deps.ProductionLikeEnv() {
				if id.Role == "admin" {
					emp["lifecycle"] = "active"
					emp["release"] = map[string]any{
						"status": "released", "releasedAt": now,
						"requestedBy": id.Name, "requestedById": id.ID,
						"approver": id.Name, "approverId": id.ID,
					}
					break
				}
				emp["lifecycle"] = "pending_approval"
				emp["release"] = map[string]any{
					"status": "pending_approval", "requestedAt": now,
					"requestedBy": id.Name, "requestedById": id.ID,
				}
				break
			}
			emp["lifecycle"] = "active"
			emp["release"] = map[string]any{
				"status": "released", "releasedAt": now,
				"requestedBy": id.Name, "requestedById": id.ID,
			}
		}
	case "lifecycle":
		target := str(body["lifecycle"])
		rel, _ := emp["release"].(map[string]any)
		if target == "active" {
			if rel != nil && (str(rel["status"]) == "pending_approval" || str(rel["status"]) == "pending_countersign") {
				if err := s.Deps.RequireProductionDualApprovalFn(str(rel["requestedById"]), str(rel["requestedBy"]), id, "上岗"); err != nil {
					return nil, err
				}
				if hold, err := s.Deps.MaybeHoldForCountersign(rel, id, str(emp["risk"]), "上岗"); err != nil {
					return nil, err
				} else if hold {
					emp["lifecycle"] = "pending_countersign"
					emp["release"] = rel
					break
				}
				emp["release"] = map[string]any{
					"status": "released", "releasedAt": time.Now().UTC().Format(time.RFC3339),
					"requestedBy": rel["requestedBy"], "requestedById": rel["requestedById"],
					"approver": id.Name, "approverId": id.ID,
					"firstApprover": rel["firstApprover"], "firstApproverId": rel["firstApproverId"],
					"countersigner": rel["countersigner"], "countersignerId": rel["countersignerId"],
				}
			} else if rel == nil || str(rel["status"]) != "released" {
				return nil, apperr.BadReq(apperr.DigitalPartnerPublish, "须先完成评测并申请上岗")
			}
		}
		if target == "paused" || target == "quarantined" {
			if id.Role != "admin" {
				return nil, apperr.Forbidden(apperr.AdminRequired, "暂停/隔离仅限管理员")
			}
			if strings.TrimSpace(str(body["reason"])) == "" {
				return nil, apperr.BadReq(apperr.BadRequest, "暂停/隔离须填写处置原因")
			}
		}
		if target != "" {
			emp["lifecycle"] = target
		}
	case "submit":
		if err := s.Deps.ValidateEmployeeReleaseGates(emp); err != nil {
			return nil, err
		}
		now := time.Now().UTC().Format(time.RFC3339)
		if s.Deps.ProductionLikeEnv() {
			if id.Role == "admin" {
				emp["lifecycle"] = "active"
				emp["release"] = map[string]any{
					"status": "released", "releasedAt": now,
					"requestedBy": id.Name, "requestedById": id.ID,
					"approver": id.Name, "approverId": id.ID,
				}
				break
			}
			emp["lifecycle"] = "pending_approval"
			emp["release"] = map[string]any{
				"status": "pending_approval", "requestedAt": now,
				"requestedBy": id.Name, "requestedById": id.ID,
			}
			break
		}
		emp["lifecycle"] = "active"
		emp["release"] = map[string]any{
			"status": "released", "releasedAt": now,
			"requestedBy": id.Name, "requestedById": id.ID,
		}
	case "approve":
		rel, _ := emp["release"].(map[string]any)
		requestedBy, requestedById := "", ""
		if rel != nil {
			requestedBy = str(rel["requestedBy"])
			requestedById = str(rel["requestedById"])
		}
		if requestedById == "" {
			requestedById = str(emp["ownerId"])
		}
		if requestedBy == "" {
			requestedBy = str(emp["owner"])
		}
		if err := s.Deps.RequireProductionDualApprovalFn(requestedById, requestedBy, id, "上岗"); err != nil {
			return nil, err
		}
		relMap := rel
		if relMap == nil {
			relMap = map[string]any{"requestedBy": requestedBy, "requestedById": requestedById}
		}
		if hold, err := s.Deps.MaybeHoldForCountersign(relMap, id, str(emp["risk"]), "上岗"); err != nil {
			return nil, err
		} else if hold {
			emp["lifecycle"] = "pending_countersign"
			emp["release"] = relMap
			break
		}
		emp["lifecycle"] = "active"
		emp["release"] = map[string]any{
			"status": "released", "releasedAt": time.Now().UTC().Format(time.RFC3339),
			"requestedBy": requestedBy, "requestedById": requestedById,
			"approver": id.Name, "approverId": id.ID,
			"firstApprover": relMap["firstApprover"], "firstApproverId": relMap["firstApproverId"],
			"countersigner": relMap["countersigner"], "countersignerId": relMap["countersignerId"],
		}
	case "reject":
		if !s.Deps.ActorIsAdmin(id) && str(emp["ownerId"]) == id.ID {
			return nil, apperr.Forbidden(apperr.SODSelfApproval, "创建者不能审批自己的生产发布")
		}
		emp["lifecycle"] = "draft"
		emp["release"] = map[string]any{"status": "not_released"}
	case "pause":
		emp["lifecycle"] = "paused"
	default:
		if r.Method == http.MethodPatch {
			for _, k := range []string{"name", "role", "department", "description", "owner", "escalationOwner", "serviceObject", "risk", "environment"} {
				if body[k] != nil {
					emp[k] = body[k]
				}
			}
		} else if action != "" {
			return nil, apperr.NotFoundErr(apperr.NotFound, "未知数字伙伴动作")
		}
	}
	emp["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "数字伙伴:"+coalesce(action, "更新"), str(emp["name"]), "success", "")
	if s.Deps.PersistEmployeesLocked != nil {
		s.Deps.PersistEmployeesLocked()
	}
	return emp, nil
}

// applyEmployeeConfig merges a draft configuration body into the live
// employee map. Mirrors the legacy implementation in handlers_contract.go
// L600-L633.
func (s *Service) applyEmployeeConfig(emp map[string]any, draft map[string]any) {
	scope := strings.TrimSpace(str(draft["scope"]))
	if scope == "" {
		scope = "role"
	}
	if profile, ok := draft["profile"].(map[string]any); ok {
		for k, v := range profile {
			emp[k] = v
		}
	}
	if scope == "capability" {
		if caps, ok := draft["capabilities"].(map[string]any); ok {
			s.mergeImmutableCapabilityTools(caps)
			emp["capabilities"] = caps
		}
	}
	if mem, ok := draft["memoryPolicy"]; ok {
		emp["memoryPolicy"] = mem
	}
	if boundary, ok := draft["boundary"].(map[string]any); ok {
		if resp := boundary["responsibilities"]; resp != nil {
			emp["responsibilities"] = resp
		}
		if prohib := boundary["prohibitedActions"]; prohib != nil {
			emp["prohibitedActions"] = prohib
		}
		if policy := boundary["boundaryPolicy"]; policy != nil {
			emp["boundaryPolicy"] = policy
		} else if policy := boundary["policy"]; policy != nil {
			emp["boundaryPolicy"] = policy
		}
	}
	emp["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
}

// immutableCapabilityToolNames returns the canonical list of capability
// tools that every digital employee must carry (platform defaults +
// runtime opt-ins). The platform list is sourced via Deps; the runtime
// list is sourced via Deps; mergeImmutableCapabilityTools folds them in.
func (s *Service) immutableCapabilityToolNames() []string {
	names := make([]string, 0)
	seen := map[string]bool{}
	add := func(items []map[string]any, includeOptIn bool) {
		for _, t := range items {
			name := strings.TrimSpace(str(t["name"]))
			if name == "" || seen[name] {
				continue
			}
			if !includeOptIn && coalesce(str(t["availability"]), "default") == "opt_in" {
				continue
			}
			seen[name] = true
			names = append(names, name)
		}
	}
	if s.Deps.CatalogPlatformTools != nil {
		add(s.Deps.CatalogPlatformTools(), true)
	}
	if s.Deps.CatalogRuntimeTools != nil {
		add(s.Deps.CatalogRuntimeTools(nil), false)
	}
	return names
}

// mergeImmutableCapabilityTools folds the canonical platform + runtime
// tool list into a capability map's `tools` slice, deduplicating and
// stripping blanks.
func (s *Service) mergeImmutableCapabilityTools(caps map[string]any) {
	if caps == nil {
		return
	}
	merged := append(stringSlice(caps["tools"]), s.immutableCapabilityToolNames()...)
	seen := map[string]bool{}
	out := make([]string, 0, len(merged))
	for _, name := range merged {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	caps["tools"] = out
}

// listTemplateAdoptions returns the list of adopted templates for the
// caller's workspace.
func (s *Service) listTemplateAdoptions(r *http.Request) (any, error) {
	ws := s.Deps.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, a := range s.Store.TemplateAdoptions {
		if str(a["workspaceId"]) == ws {
			out = append(out, a)
		}
	}
	return out, nil
}

// employeeOverviewAligned computes the partner overview counters (active /
// anomalies / cost-today / pending) used by the Operations dashboard.
// Reuses listEmployees to derive the totals.
func (s *Service) employeeOverviewAligned(r *http.Request) (any, error) {
	list, err := s.listEmployees(r)
	if err != nil {
		return nil, err
	}
	items, _ := list.([]map[string]any)
	active, pending, anomalies := 0, 0, 0
	cost := 0.0
	for _, e := range items {
		if str(e["lifecycle"]) == "active" {
			active++
		}
		rel, _ := e["release"].(map[string]any)
		if str(e["lifecycle"]) == "pending_approval" || (rel != nil && str(rel["status"]) == "pending_approval") {
			pending++
		}
		rt, _ := e["runtime"].(map[string]any)
		if rt != nil {
			if n, ok := asFloat(rt["anomalies"]); ok && n > 0 {
				anomalies++
			}
			if c, ok := asFloat(rt["costToday"]); ok {
				cost += c
			}
		}
	}
	return map[string]any{
		"total": len(items), "active": active, "pending": pending,
		"anomalies": anomalies, "handoffAttention": 0, "costToday": cost,
	}, nil
}

// Unused guard placeholder — reserved for future cross-package
// import promotions as the M05 module grows.
