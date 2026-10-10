package partners

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listEmployees returns the digital-employee roster for the caller's
// workspace. Each entry is enriched with the runtime projection via
// Deps.EmployeeWithRuntimeLocked.
func (s *Service) listEmployees(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	if err := s.Deps.RequireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	log.Printf("listEmployees: s.Store.Employees=%d ws=%s", len(s.Store.Employees), ws)
	var out = make([]map[string]any, 0)
	for _, e := range s.Store.Employees {
		if str(e["workspaceId"]) == ws {
			out = append(out, s.Deps.EmployeeWithRuntimeLocked(e))
		}
	}
	return out, nil
}

// employeeOverview is the alias wrapper that the route table wires to
// /api/partners/overview. Defers to employeeOverviewAligned so the two
// names share a single implementation.
func (s *Service) employeeOverview(r *http.Request) (any, error) {
	return s.employeeOverviewAligned(r)
}

// listEmployeeTemplates returns the partner template seed (read-only).
func (s *Service) listEmployeeTemplates(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.EmployeeTemplates, nil
}

// capabilityCatalog is the alias wrapper that wires
// /api/partner-capability-catalog → capabilityCatalogAligned.
func (s *Service) capabilityCatalog(r *http.Request) (any, error) {
	return s.capabilityCatalogAligned(r)
}

// getEmployee handles a direct GET /api/partners/:id (used by the
// digitalEmployeeRoute fallback when path has no action segment). Mirrors
// the legacy handler_b.go L48-L65.
func (s *Service) getEmployee(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	eid := strings.TrimPrefix(r.URL.Path, "/api/partners/")
	if i := strings.Index(eid, "/"); i >= 0 {
		eid = eid[:i]
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, e := range s.Store.Employees {
		if str(e["id"]) == eid {
			if err := s.Deps.RequireWorkspaceAccess(id, str(e["workspaceId"])); err != nil {
				return nil, err
			}
			return s.Deps.EmployeeWithRuntimeLocked(e), nil
		}
	}
	return nil, apperr.NotFoundErr(apperr.DigitalPartnerNotFound, "数字伙伴不存在")
}

// createEmployee handles POST /api/partners (a draft). Mirrors the legacy
// handler_b.go L67-L106.
func (s *Service) createEmployee(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	if err := s.Deps.RequireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	if !authHas(id, "agent.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建数字伙伴")
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.DigitalPartnerInvalid, "名称必填")
	}
	item := map[string]any{
		"id": s.Store.ID("de"), "workspaceId": ws, "name": name,
		"role": coalesce(str(body["role"]), "general"), "department": coalesce(str(body["department"]), "未分配"),
		"description": coalesce(str(body["description"]), "待完善岗位职责说明。"),
		"owner":       id.Name, "ownerId": id.ID, "escalationOwner": coalesce(str(body["escalationOwner"]), "待指定"),
		"serviceObject": coalesce(str(body["serviceObject"]), "内部用户"),
		"version":       "0.1.0", "environment": "sandbox", "lifecycle": "draft", "risk": coalesce(str(body["risk"]), "low"),
		"responsibilities": []string{"待配置岗位职责"}, "prohibitedActions": []string{"待配置禁止行为"},
		"capabilities": body["capabilities"],
		"memoryPolicy": map[string]any{"shortTermHours": 24, "workingDays": 7, "longTermCadence": "daily", "knowledgePromotion": "approval_required"},
		"runtime":      map[string]any{"calls24h": 0, "successRate": 0, "p95Ms": 0, "costToday": 0, "handoffs24h": 0, "anomalies": 0},
		"evaluation":   map[string]any{"status": "not_started"}, "release": map[string]any{"status": "not_released"},
		"updatedAt": time.Now().UTC().Format(time.RFC3339),
	}
	if item["capabilities"] == nil {
		item["capabilities"] = map[string]any{"model": "企业通用路由 v2", "knowledge": []string{}, "skills": []string{}, "tools": []string{}, "workflows": []string{}, "channels": []string{"Web"}}
	}
	copilot.EnsureEmployeeCognitiveSkills(item)
	store.ApplyDefaultReplyModeRuntime(item)
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Employees = append([]map[string]any{item}, s.Store.Employees...)
	s.Store.AppendAudit(ws, id.Name, "创建数字伙伴草稿", name, "success", "")
	if s.Deps.PersistEmployeesLocked != nil {
		s.Deps.PersistEmployeesLocked()
	}
	return item, nil
}

// patchEmployee handles PATCH /api/partners/:id (a shallow merge). Mirrors
// the legacy handler_b.go L108-L133. The full multi-action route lives on
// digitalEmployeeRoute; this entry point only catches the bare PATCH.
func (s *Service) patchEmployee(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	eid := strings.TrimPrefix(r.URL.Path, "/api/partners/")
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, e := range s.Store.Employees {
		if str(e["id"]) != eid {
			continue
		}
		if err := s.Deps.RequireWorkspaceAccess(id, str(e["workspaceId"])); err != nil {
			return nil, err
		}
		for k, v := range body {
			if k == "id" || k == "workspaceId" {
				continue
			}
			e[k] = v
		}
		e["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		s.Store.AppendAudit(str(e["workspaceId"]), id.Name, "更新数字伙伴配置", str(e["name"]), "success", "")
		if s.Deps.PersistEmployeesLocked != nil {
			s.Deps.PersistEmployeesLocked()
		}
		return e, nil
	}
	return nil, apperr.NotFoundErr(apperr.DigitalPartnerNotFound, "数字伙伴不存在")
}

// adoptTemplate handles POST /api/partner-templates/:id/adopt. Mirrors
// the legacy handler_contract.go L674-L722.
func (s *Service) adoptTemplate(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	if id.Role == "auditor" {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权采用模板")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "模板不存在")
	}
	tid := parts[2]
	ws := s.Deps.WorkspaceID(r)
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	var tpl map[string]any
	for _, t := range s.Store.EmployeeTemplates {
		if str(t["id"]) == tid {
			tpl = t
			break
		}
	}
	if tpl == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "模板不存在")
	}
	emp := map[string]any{
		"id": s.Store.ID("de"), "workspaceId": ws, "name": coalesce(str(body["name"]), str(tpl["name"])),
		"role": tpl["role"], "department": coalesce(str(body["department"]), str(tpl["department"])),
		"description": tpl["description"], "owner": coalesce(str(body["owner"]), id.Name),
		"escalationOwner": coalesce(str(body["escalationOwner"]), "待指定"), "serviceObject": tpl["serviceObject"],
		"version": tpl["version"], "environment": coalesce(str(body["environment"]), "sandbox"),
		"lifecycle": "draft", "risk": tpl["risk"], "responsibilities": tpl["responsibilities"],
		"prohibitedActions": tpl["prohibitedActions"], "capabilities": tpl["capabilities"],
		"memoryPolicy": tpl["memoryPolicy"],
		"runtime":      map[string]any{"calls24h": 0, "successRate": 0, "p95Ms": 0, "costToday": 0, "handoffs24h": 0, "anomalies": 0},
		"evaluation":   map[string]any{"status": "not_started"}, "release": map[string]any{"status": "not_released"},
		"templateId": tid, "templateVersion": tpl["version"], "updatedAt": time.Now().UTC().Format(time.RFC3339),
	}
	store.ApplyDefaultReplyModeRuntime(emp)
	s.Store.Employees = append([]map[string]any{emp}, s.Store.Employees...)
	tpl["adoptionCount"] = intFrom(tpl["adoptionCount"]) + 1
	s.Store.TemplateAdoptions = append([]map[string]any{{
		"id": s.Store.ID("adopt"), "templateId": tid, "templateVersion": tpl["version"],
		"partnerId": emp["id"], "workspaceId": ws, "adoptedBy": id.Name, "status": "draft",
		"createdAt": time.Now().UTC().Format(time.RFC3339),
	}}, s.Store.TemplateAdoptions...)
	s.Store.AppendAudit(ws, id.Name, "采用岗位模板", str(tpl["name"]), "success", "")
	if s.Deps.AfterWriteLocked != nil {
		s.Deps.AfterWriteLocked("employees", "template_adoptions")
	}
	return emp, nil
}

// legacyAgentsProxy handles GET /api/agents — a deprecated read-only
// projection of the digital-employee roster. Mirrors the legacy
// handler_b.go L390-L411.
func (s *Service) legacyAgentsProxy(r *http.Request) (any, error) {
	// Deprecated /api/agents — read-only projection of digital employees.
	list, err := s.listEmployees(r)
	if err != nil {
		return nil, err
	}
	items, _ := list.([]map[string]any)
	out := make([]map[string]any, 0, len(items))
	for _, e := range items {
		lifecycle := str(e["lifecycle"])
		status := lifecycle
		switch lifecycle {
		case "active", "released", "published":
			status = "installed"
		}
		out = append(out, map[string]any{
			"id": e["id"], "name": e["name"], "workspaceId": e["workspaceId"],
			"status": status, "ownerId": e["ownerId"], "legacy": true,
		})
	}
	return out, nil
}
