package server

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/digital-employee-platform/backend/internal/auth"
	"github.com/digital-employee-platform/backend/internal/store"
	apperr "github.com/digital-employee-platform/backend/pkg/errors"
)

func (s *Server) listEmployees(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	if err := s.requireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out = make([]map[string]any, 0)
	for _, e := range s.Store.Employees {
		if str(e["workspaceId"]) == ws {
			out = append(out, s.employeeWithRuntimeLocked(e))
		}
	}
	return out, nil
}

func (s *Server) employeeOverview(r *http.Request) (any, error) {
	return s.employeeOverviewAligned(r)
}

func (s *Server) listEmployeeTemplates(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.EmployeeTemplates, nil
}

func (s *Server) capabilityCatalog(r *http.Request) (any, error) {
	return s.capabilityCatalogAligned(r)
}

func (s *Server) getEmployee(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	eid := strings.TrimPrefix(r.URL.Path, "/api/digital-employees/")
	if i := strings.Index(eid, "/"); i >= 0 {
		eid = eid[:i]
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, e := range s.Store.Employees {
		if str(e["id"]) == eid {
			if err := s.requireWorkspaceAccess(id, str(e["workspaceId"])); err != nil {
				return nil, err
			}
			return s.employeeWithRuntimeLocked(e), nil
		}
	}
	return nil, apperr.NotFoundErr(apperr.DigitalEmployeeNotFound, "数字伙伴不存在")
}

func (s *Server) createEmployee(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	if err := s.requireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	if !auth.Has(id, "agent.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建数字伙伴")
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.DigitalEmployeeInvalid, "名称必填")
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
	ensureEmployeeCognitiveSkills(item)
	store.ApplyDefaultReplyModeRuntime(item)
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Employees = append([]map[string]any{item}, s.Store.Employees...)
	s.Store.AppendAudit(ws, id.Name, "创建数字伙伴草稿", name, "success", "")
	s.persistEmployeesLocked()
	return item, nil
}

func (s *Server) patchEmployee(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	eid := strings.TrimPrefix(r.URL.Path, "/api/digital-employees/")
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, e := range s.Store.Employees {
		if str(e["id"]) != eid {
			continue
		}
		if err := s.requireWorkspaceAccess(id, str(e["workspaceId"])); err != nil {
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
		s.persistEmployeesLocked()
		return e, nil
	}
	return nil, apperr.NotFoundErr(apperr.DigitalEmployeeNotFound, "数字伙伴不存在")
}

func (s *Server) employeeAction(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/digital-employees/:id/:action
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
		return nil, apperr.NotFoundErr(apperr.DigitalEmployeeNotFound, "数字伙伴不存在")
	}
	if err := s.requireWorkspaceAccess(id, str(emp["workspaceId"])); err != nil {
		return nil, err
	}
	mutated := false
	defer func() {
		if mutated {
			s.persistEmployeesLocked()
		}
	}()
	switch action {
	case "submit":
		if err := s.validatePublishedCapabilities(emp); err != nil {
			return nil, err
		}
		now := time.Now().UTC().Format(time.RFC3339)
		if requiresPeerApprovalGate(id) {
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
		if err := s.validatePublishedCapabilities(emp); err != nil {
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
		if err := requireProductionDualApproval(reqID, reqName, id, "上岗"); err != nil {
			return nil, err
		}
		relMap := rel
		if relMap == nil {
			relMap = map[string]any{"requestedBy": reqName, "requestedById": reqID}
		}
		if hold, err := maybeHoldForCountersign(relMap, id, str(emp["risk"]), "上岗"); err != nil {
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
		if !auth.Has(id, "release.approve") && id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.ReleaseApproveForbidden, "无权驳回")
		}
		if !actorIsAdmin(id) && str(emp["ownerId"]) == id.ID {
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

func (s *Server) validatePublishedCapabilities(emp map[string]any) error {
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return nil
	}
	// Mock-shaped capabilities use display names / catalog options; allow non-empty model.
	if str(caps["model"]) == "" && str(caps["modelRouteId"]) == "" {
		return apperr.BadReq(apperr.DigitalEmployeeBinding, "须装配已发布模型")
	}
	return nil
}

func (s *Server) listTasks(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	if err := s.requireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	q := r.URL.Query()
	filters := map[string]string{
		"stage":    q.Get("stage"),
		"risk":     q.Get("risk"),
		"assignee": q.Get("assignee"),
		"q":        coalesce(q.Get("q"), q.Get("search")),
		"approval": q.Get("approval"),
		"source":   q.Get("source"),
		"priority": q.Get("priority"),
		"agent":    q.Get("agent"),
		"archived": q.Get("archived"),
		"blocked":  q.Get("blocked"),
	}
	limit := 0
	offset := 0
	if v := q.Get("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	if v := q.Get("offset"); v != "" {
		offset, _ = strconv.Atoi(v)
	}
	paged := q.Get("paged") == "1" || q.Get("paged") == "true" || limit > 0

	s.Store.RLock()
	defer s.Store.RUnlock()
	var scoped = make([]map[string]any, 0)
	for _, t := range s.Store.Tasks {
		if str(t["workspaceId"]) != ws {
			continue
		}
		ensureTaskShape(t)
		if id.Role == "user" && !taskVisibleToUser(t, id) {
			continue
		}
		scoped = append(scoped, t)
	}
	filtered := filterTasksQuery(scoped, filters)
	if !paged {
		return filtered, nil
	}
	items, total := paginateTasks(filtered, limit, offset)
	return map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	}, nil
}

func (s *Server) createTask(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	if !auth.Has(id, "task.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建任务")
	}
	body, _ := decodeMap(r)
	title := strings.TrimSpace(str(body["title"]))
	if title == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "任务标题必填")
	}
	item := map[string]any{
		"id": s.Store.ID("task"), "workspaceId": ws, "code": fmt.Sprintf("T-%d", time.Now().Unix()%100000),
		"title": title, "status": "pending", "priority": coalesce(str(body["priority"]), "P2"),
		"ownerId": id.ID, "ownerName": id.Name, "digitalEmployeeId": body["digitalEmployeeId"],
		"createdAt": time.Now().UTC().Format(time.RFC3339), "updatedAt": time.Now().UTC().Format(time.RFC3339),
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Tasks = append([]map[string]any{item}, s.Store.Tasks...)
	s.Store.AppendAudit(ws, id.Name, "创建任务", title, "success", "")
	return item, nil
}

func (s *Server) taskTransition(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "无效任务动作")
	}
	tid, action := parts[2], parts[3]
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, t := range s.Store.Tasks {
		if str(t["id"]) != tid {
			continue
		}
		if err := s.requireWorkspaceAccess(id, str(t["workspaceId"])); err != nil {
			return nil, err
		}
		if id.Role == "user" && str(t["ownerId"]) != id.ID && action != "comment" {
			return nil, apperr.Forbidden(apperr.TaskOwnerScope, "只能流转自己负责的任务")
		}
		next := map[string]string{
			"start": "in_progress", "review": "review", "complete": "completed",
			"archive": "archived", "reopen": "pending",
		}[action]
		if next == "" {
			if st := str(body["status"]); st != "" {
				next = st
			} else {
				return nil, apperr.BadReq(apperr.BadRequest, "未知任务流转")
			}
		}
		t["status"] = next
		t["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		s.Store.AppendAudit(str(t["workspaceId"]), id.Name, "任务流转:"+action, str(t["title"]), "success", "")
		return t, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "任务不存在")
}

func (s *Server) legacyAgentsProxy(r *http.Request) (any, error) {
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
