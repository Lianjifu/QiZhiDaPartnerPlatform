package server

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// --- Home ---

func (s *Server) ackAlertPath(r *http.Request) (any, error) {
	// Accept both /acknowledge (Mock) and /ack (legacy). Delegated to the
	// M01 operations package — the legacy server.ackAlert moved into
	// internal/operations/handlers.go during Phase 2 consolidation.
	return s.opsH.AckAlert(r)
}

// --- Tasks (ControlledTask) ---

func (s *Server) listTasksAligned(r *http.Request) (any, error) {
	return s.listTasks(r)
}

func (s *Server) createTaskAligned(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	if !auth.Has(id, "task.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建任务")
	}
	if err := s.requireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	title := strings.TrimSpace(str(body["title"]))
	if title == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "任务标题必填")
	}
	s.Store.Lock()
	item := buildControlledTask(s.Store.ID, ws, body, id)
	item["code"] = nextTaskCode(s.Store.Tasks)
	appendTaskAuditLocked(item, id.Name, "创建任务", title, "success")
	s.Store.Tasks = append([]map[string]any{item}, s.Store.Tasks...)
	s.Store.AppendAudit(ws, id.Name, "创建任务", title, "success", coalesce(str(body["dispatchKind"]), str(body["source"])))
	s.Store.Unlock()
	s.Store.Persist("tasks")
	IncTaskCreated()
	return item, nil
}

func (s *Server) taskRoute(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/tasks/:id[/:action]
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "任务不存在")
	}
	tid := parts[2]
	action := ""
	if len(parts) >= 4 {
		action = parts[3]
	}
	id := identityFrom(r.Context())
	s.Store.Lock()
	defer s.Store.Unlock()
	var task map[string]any
	for _, t := range s.Store.Tasks {
		if str(t["id"]) == tid {
			task = t
			break
		}
	}
	if task == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "任务不存在")
	}
	if err := s.requireWorkspaceAccess(id, str(task["workspaceId"])); err != nil {
		return nil, err
	}
	ensureTaskShape(task)
	if action == "" && r.Method == http.MethodGet {
		return task, nil
	}
	if action == "" && r.Method == http.MethodPatch {
		body, _ := decodeMap(r)
		if err := checkTaskVersion(task, body); err != nil {
			return nil, err
		}
		if !auth.Has(id, "task.write") {
			return nil, apperr.Forbidden(apperr.RoleForbidden, "无权更新任务")
		}
		if id.Role == "user" && !taskVisibleToUser(task, id) {
			return nil, apperr.Forbidden(apperr.TaskOwnerScope, "只能更新自己相关的任务")
		}
		for _, key := range []string{"title", "description", "assignee", "priority", "tags"} {
			if body[key] != nil {
				task[key] = body[key]
			}
		}
		appendTaskAuditLocked(task, id.Name, "更新任务", "字段更新", "info")
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "更新任务", str(task["title"]), "success", "")
		go s.Store.Persist("tasks")
		return task, nil
	}
	if action == "audit" && r.Method == http.MethodGet {
		evs := taskAuditEvents(task)
		out := make([]map[string]any, len(evs))
		copy(out, evs)
		return out, nil
	}
	body, _ := decodeMap(r)
	if err := checkTaskVersion(task, body); err != nil {
		return nil, err
	}
	switch action {
	case "transition":
		if id.Role == "user" && !taskVisibleToUser(task, id) {
			return nil, apperr.Forbidden(apperr.TaskOwnerScope, "只能流转自己相关的任务")
		}
		stage := coalesce(str(body["stage"]), coalesce(str(body["status"]), "pending"))
		if err := applyLifecycleTransition(task, stage, id); err != nil {
			return nil, err
		}
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务流转", str(task["title"])+":"+str(task["lifecycleStage"]), "success", "")
		if str(task["status"]) == "completed" || str(task["status"]) == "review" {
			s.writeTaskWorkingMemoryLocked(task, id, str(task["status"]))
		}
		go s.Store.Persist("tasks")
		IncTaskTransition()
		return task, nil
	case "approve":
		if id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "审批任务仅限管理员")
		}
		if err := s.evaluateWriteLocked(r, "task", "approve", policy.Input{
			SubmitterID: str(task["ownerId"]), ApproverID: id.ID,
		}); err != nil {
			return nil, err
		}
		approved := true
		if body["approved"] != nil {
			approved = boolFrom(body["approved"])
		}
		applyTaskApprove(task, approved, coalesce(str(body["reason"]), str(body["actor"])), id)
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务审批", str(task["title"]), "success", coalesce(str(body["reason"]), ""))
		go s.Store.Persist("tasks")
		IncTaskApprove(approved)
		return task, nil
	case "takeover":
		if id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "操作仅限管理员")
		}
		applyTaskTakeover(task, coalesce(str(body["reason"]), "人工接管"), id)
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务:takeover", str(task["title"]), "success", str(body["reason"]))
		go s.Store.Persist("tasks")
		IncTaskTakeover()
		return task, nil
	case "retry":
		if id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "操作仅限管理员")
		}
		if err := applyTaskRetry(task, coalesce(str(body["reason"]), "重试"), id); err != nil {
			return nil, err
		}
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务:retry", str(task["title"]), "success", str(body["reason"]))
		go s.Store.Persist("tasks")
		IncTaskRetry()
		return task, nil
	default:
		// legacy start/review/complete…
		res, err := s.taskTransitionLocked(task, action, body, id)
		if err == nil {
			go s.Store.Persist("tasks")
		}
		return res, err
	}
}

func (s *Server) taskTransitionLocked(task map[string]any, action string, body map[string]any, id *auth.Identity) (any, error) {
	next := map[string]string{"start": "in_progress", "review": "review", "complete": "completed", "archive": "archived", "reopen": "pending"}[action]
	stage := ""
	if next != "" {
		stage = mapStatusToStage(next)
	} else if st := str(body["status"]); st != "" {
		stage = mapStatusToStage(st)
	} else if ls := str(body["stage"]); ls != "" {
		stage = ls
	} else {
		return nil, apperr.BadReq(apperr.BadRequest, "未知任务流转")
	}
	if err := applyLifecycleTransition(task, stage, id); err != nil {
		return nil, err
	}
	s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务流转:"+action, str(task["title"]), "success", "")
	if str(task["status"]) == "completed" || str(task["status"]) == "review" {
		s.writeTaskWorkingMemoryLocked(task, id, str(task["status"]))
	}
	return task, nil
}

func (s *Server) writeTaskWorkingMemoryLocked(task map[string]any, id *auth.Identity, status string) {
	title := coalesce(str(task["code"]), str(task["id"])) + " · " + coalesce(str(task["title"]), "任务")
	content := "任务状态更新为 " + status + "；保留执行上下文以便人工接手与复盘。"
	if note := strings.TrimSpace(str(task["summary"])); note != "" {
		content = note + "\n" + content
	}
	_, _ = s.ingestRuntimeMemoryLocked(runtimeMemoryInput{
		WorkspaceID: str(task["workspaceId"]), OwnerID: coalesce(str(task["ownerId"]), id.ID), OwnerName: id.Name,
		DigitalPartnerID: str(task["digitalPartnerId"]),
		Title:             title, Content: content,
		SourceType: "task", SourceID: str(task["id"]),
		CorrelationID: "corr_task_" + str(task["id"]),
		Layer:         "working", Scope: "team", Confidence: 0.9,
	})
	go s.persistMemory()
}

func toInt(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	default:
		return 0
	}
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return 0
	}
}

func mapStageToStatus(stage string) string {
	return statusForLifecycle(stage)
}

func mapStatusToStage(status string) string {
	switch status {
	case "in_progress":
		return stageRunning
	case "review":
		return stageHumanAction
	case "completed":
		return stageCompleted
	case "archived":
		return stageArchived
	default:
		return stagePending
	}
}

// --- Digital employees (Mock-shaped) ---

func (s *Server) employeeOverviewAligned(r *http.Request) (any, error) {
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

func (s *Server) listTemplateAdoptions(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
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

func (s *Server) digitalEmployeeRoute(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/digital-employees/:id/...
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
	id := identityFrom(r.Context())
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
	if err := s.requireWorkspaceAccess(id, str(emp["workspaceId"])); err != nil {
		return nil, err
	}

	if action == "" && r.Method == http.MethodGet {
		return s.employeeWithRuntimeLocked(emp), nil
	}
	if action == "evidence" && r.Method == http.MethodGet {
		return s.realEmployeeEvidenceLocked(emp, 20), nil
	}
	if action == "runtime" && r.Method == http.MethodGet {
		return s.computeEmployeeRuntimeLocked(emp), nil
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
				if !actorIsAdmin(id) && str(v["updatedById"]) == id.ID {
					return nil, apperr.Forbidden(apperr.SODSelfApproval, "配置提交人不能批准自己的受控变更")
				}
				v["status"] = "current"
				v["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
				if draft := s.Store.ConfigDrafts[sub]; draft != nil {
					applyEmployeeConfig(emp, draft)
					delete(s.Store.ConfigDrafts, sub)
					empSnap := make([]map[string]any, len(s.Store.Employees))
					copy(empSnap, s.Store.Employees)
					s.Store.PersistCollection("employees", empSnap)
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
		if err := validateEmployeeConfigurationBody(body); err != nil {
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
		applyEmployeeConfig(emp, body)
		s.Store.ConfigVersions = append([]map[string]any{ver}, s.Store.ConfigVersions...)
		s.Store.AppendAudit(str(emp["workspaceId"]), id.Name, "更新员工配置", str(emp["name"]), "success", "")
		empSnap := make([]map[string]any, len(s.Store.Employees))
		copy(empSnap, s.Store.Employees)
		s.Store.PersistCollection("employees", empSnap)
		s.afterWriteLocked("config_versions")
		return ver, nil
	}

	if id.Role == "auditor" && r.Method != http.MethodGet {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权写入数字伙伴")
	}
	body, _ := decodeMap(r)

	switch action {
	case "evaluate":
		incomplete := employeeEvaluateIncomplete(emp) || body["forceFail"] == true
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
			if err := validateEmployeeReleaseGates(emp); err != nil {
				return nil, err
			}
			now := time.Now().UTC().Format(time.RFC3339)
			if productionLikeEnv() {
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
				if err := requireProductionDualApproval(str(rel["requestedById"]), str(rel["requestedBy"]), id, "上岗"); err != nil {
					return nil, err
				}
				if hold, err := maybeHoldForCountersign(rel, id, str(emp["risk"]), "上岗"); err != nil {
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
		if err := validateEmployeeReleaseGates(emp); err != nil {
			return nil, err
		}
		now := time.Now().UTC().Format(time.RFC3339)
		if productionLikeEnv() {
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
		if err := requireProductionDualApproval(requestedById, requestedBy, id, "上岗"); err != nil {
			return nil, err
		}
		relMap := rel
		if relMap == nil {
			relMap = map[string]any{"requestedBy": requestedBy, "requestedById": requestedById}
		}
		if hold, err := maybeHoldForCountersign(relMap, id, str(emp["risk"]), "上岗"); err != nil {
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
		if !actorIsAdmin(id) && str(emp["ownerId"]) == id.ID {
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
	s.persistEmployeesLocked()
	return emp, nil
}

func applyEmployeeConfig(emp map[string]any, draft map[string]any) {
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
			mergeImmutableCapabilityTools(caps)
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

func immutableCapabilityToolNames() []string {
	names := make([]string, 0)
	seen := map[string]bool{}
	add := func(list []map[string]any, includeOptIn bool) {
		for _, t := range list {
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
	add(platformToolsRegistryItems(), true)
	add(runtimeToolsRegistryItems(), false)
	return names
}

func mergeImmutableCapabilityTools(caps map[string]any) {
	if caps == nil {
		return
	}
	merged := append(stringSlice(caps["tools"]), immutableCapabilityToolNames()...)
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

func (s *Server) adoptTemplate(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role == "auditor" {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权采用模板")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "模板不存在")
	}
	tid := parts[2]
	ws := s.workspaceID(r)
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
	s.afterWriteLocked("employees", "template_adoptions")
	return emp, nil
}

func intFrom(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int32:
		return int(t)
	case int64:
		return int(t)
	case float64:
		return int(t)
	case float32:
		return int(t)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(t))
		if err != nil {
			return 0
		}
		return n
	case json.Number:
		n, err := t.Int64()
		if err != nil {
			return 0
		}
		return int(n)
	default:
		return 0
	}
}

// Models handlers live in handlers_models.go

// Channel control handlers live in handlers_channels.go

// --- Copilot sessions / conversations ---

func (s *Server) listSessions(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, sess := range s.Store.Sessions {
		sessWS := str(sess["workspaceId"])
		if sessWS == "" {
			sessWS = store.DefaultWorkspaceID
		}
		if sessWS != ws {
			continue
		}
		// Owner scope: non-admin only sees own sessions (and legacy rows without ownerId).
		owner := str(sess["ownerId"])
		if id.Role != "admin" && owner != "" && owner != id.ID {
			continue
		}
		cp := map[string]any{}
		for k, v := range sess {
			cp[k] = v
		}
		// 兼容精简种子：补齐前端会话列表所需字段，避免 Invalid Date 崩溃
		if str(cp["lastMessageAt"]) == "" {
			if v := str(cp["updatedAt"]); v != "" {
				cp["lastMessageAt"] = v
			} else if v := str(cp["createdAt"]); v != "" {
				cp["lastMessageAt"] = v
			}
		}
		if str(cp["createdAt"]) == "" {
			cp["createdAt"] = cp["lastMessageAt"]
		}
		if str(cp["updatedAt"]) == "" {
			cp["updatedAt"] = cp["lastMessageAt"]
		}
		if str(cp["preview"]) == "" {
			cp["preview"] = "暂无消息"
		}
		if str(cp["status"]) == "" {
			cp["status"] = "active"
		}
		if str(cp["agent"]) == "" {
			if name := str(cp["digitalPartnerName"]); name != "" {
				cp["agent"] = name
			} else {
				cp["agent"] = "助手"
			}
		}
		out = append(out, cp)
	}
	return out, nil
}

func (s *Server) createSession(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)
	deID := body["digitalPartnerId"]
	deName := strings.TrimSpace(coalesce(str(body["digitalPartnerName"]), str(body["agent"])))
	if deName == "" {
		if str(deID) != "" {
			deName = "岗位专家"
		} else {
			deName = "助手"
		}
	}
	title := coalesce(str(body["title"]), "新会话")
	modelID := coalesce(str(body["modelId"]), "sonnet-4")
	convID := coalesce(str(body["conversationId"]), s.Store.ID("conv"))
	sessID := coalesce(str(body["id"]), s.Store.ID("sess"))

	conv := map[string]any{
		"id": convID, "workspaceId": ws, "title": title,
		"digitalPartnerId": deID, "modelId": modelID, "updatedAt": now,
	}
	session := map[string]any{
		"id": sessID, "workspaceId": ws, "ownerId": id.ID, "title": title,
		"preview": coalesce(str(body["preview"]), "暂无消息"), "agent": deName,
		"digitalPartnerId": deID, "digitalPartnerName": deName,
		"conversationId": convID, "status": "active", "modelId": modelID,
		"sessionMode": sessionModeInvestigate, "riskLevel": "medium",
		"handoff":   map[string]any{"active": false},
		"createdAt": now, "updatedAt": now, "lastMessageAt": now,
	}
	defaultGovernanceOnCreate(session)

	s.Store.Lock()
	for _, existing := range s.Store.Sessions {
		if str(existing["id"]) == sessID && str(existing["workspaceId"]) == ws {
			s.Store.Unlock()
			return existing, nil
		}
	}
	s.Store.Conversations = append([]map[string]any{conv}, s.Store.Conversations...)
	s.Store.Sessions = append([]map[string]any{session}, s.Store.Sessions...)
	if s.Store.Messages[convID] == nil {
		s.Store.Messages[convID] = []map[string]any{}
	}
	s.Store.AppendAudit(ws, id.Name, "创建专家会话", title, "success", "")
	s.Store.Unlock()
	s.Store.Persist("conversations")
	s.Store.Persist("sessions")
	s.Store.Persist("messages")
	return session, nil
}

func (s *Server) deleteSession(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	headerWS := s.workspaceID(r)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/sessions/:id
	if len(parts) < 3 || parts[2] == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	sessID := parts[2]

	s.Store.Lock()
	tryOrder := workspaceLookupOrder(id, headerWS)
	removed, sessWS := s.findSessionInWorkspacesLocked(sessID, tryOrder)
	if removed == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	if owner := str(removed["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权删除他人会话")
	}
	convID := coalesce(str(removed["conversationId"]), sessID)
	kept := make([]map[string]any, 0, len(s.Store.Sessions))
	for _, sess := range s.Store.Sessions {
		if str(sess["id"]) == sessID && str(sess["workspaceId"]) == sessWS {
			continue
		}
		kept = append(kept, sess)
	}
	s.Store.Sessions = kept
	memDeleted := s.purgeConversationLocked(sessWS, convID)
	s.Store.AppendAudit(sessWS, id.Name, "删除专家会话", coalesce(str(removed["title"]), sessID), "success", "")
	s.Store.Unlock()
	s.Store.Persist("sessions")
	s.Store.Persist("conversations")
	s.Store.Persist("messages")
	if s.Store.CanWrite("memory_records") {
		s.Store.Persist("memory_records")
		if len(memDeleted) > 0 {
			if err := s.Store.PersistDeleteSync("memory_records", memDeleted...); err != nil {
				log.Printf("persist-delete memory_records: %v", err)
			}
		}
	} else if convID != "" {
		go s.delegatePurgeConversationMemory(r, sessWS, convID)
	}
	if err := s.Store.PersistDeleteSync("sessions", sessID); err != nil {
		log.Printf("persist-delete sessions %s: %v", sessID, err)
	}
	if convID != "" {
		if err := s.Store.PersistDeleteSync("conversations", convID); err != nil {
			log.Printf("persist-delete conversations %s: %v", convID, err)
		}
		if err := s.Store.PersistDeleteSync("messages", convID); err != nil {
			log.Printf("persist-delete messages %s: %v", convID, err)
		}
		if err := s.Store.PersistDeleteSync("context_snapshots", convID); err != nil {
			log.Printf("persist-delete context_snapshots %s: %v", convID, err)
		}
	}
	return map[string]any{"ok": true, "id": sessID, "conversationId": convID}, nil
}

func (s *Server) patchSession(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[2] == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	sessID := parts[2]
	body, _ := decodeMap(r)

	s.Store.Lock()
	var cp map[string]any
	for i, sess := range s.Store.Sessions {
		if str(sess["id"]) != sessID || str(sess["workspaceId"]) != ws {
			continue
		}
		if owner := str(sess["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
			s.Store.Unlock()
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权修改他人会话")
		}
		if v, ok := body["title"]; ok {
			if t := strings.TrimSpace(str(v)); t != "" {
				sess["title"] = t
			}
		}
		if v, ok := body["pinned"]; ok {
			sess["pinned"] = boolFrom(v)
		}
		if v, ok := body["starred"]; ok {
			sess["starred"] = boolFrom(v)
		}
		if v, ok := body["status"]; ok {
			st := strings.TrimSpace(str(v))
			switch st {
			case "active", "archived", "closed":
				sess["status"] = st
			}
		}
		if v, ok := body["digitalPartnerId"]; ok {
			deID := strings.TrimSpace(str(v))
			sess["digitalPartnerId"] = deID
			if deID == "" {
				sess["digitalPartnerName"] = "助手"
				sess["agent"] = "助手"
			} else {
				for _, emp := range s.Store.Employees {
					if str(emp["id"]) == deID && str(emp["workspaceId"]) == ws {
						name := coalesce(str(emp["role"]), str(emp["name"]))
						sess["digitalPartnerName"] = name
						sess["agent"] = name
						break
					}
				}
			}
		}
		if v, ok := body["modelId"]; ok {
			sess["modelId"] = str(v)
		}
		if v, ok := body["enabledTools"]; ok {
			sess["enabledTools"] = v
		}
		applySessionGovernancePatch(sess, body, id, time.Now().UTC().Format(time.RFC3339))
		sess["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		s.Store.Sessions[i] = sess
		cp = map[string]any{}
		for k, val := range sess {
			cp[k] = val
		}
		s.Store.AppendAudit(ws, id.Name, "更新专家会话", sessID, "success", governanceAuditDetail(sess))
		break
	}
	s.Store.Unlock()
	if cp == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	s.Store.Persist("sessions")
	return cp, nil
}

func (s *Server) deleteConversation(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	headerWS := s.workspaceID(r)
	cid := conversationIDFromPath(r.URL.Path)
	if cid == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	s.Store.Lock()
	tryOrder := workspaceLookupOrder(id, headerWS)
	foundWS := ""
	if _, ws := s.findConversationInWorkspacesLocked(cid, tryOrder); ws != "" {
		foundWS = ws
	} else if sess, ws := s.findSessionInWorkspacesLocked(cid, tryOrder); sess != nil {
		foundWS = ws
		if owner := str(sess["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
			s.Store.Unlock()
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权删除他人会话")
		}
	} else if _, ok := s.Store.Messages[cid]; ok {
		foundWS = headerWS
	} else {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	memDeleted := s.purgeConversationLocked(foundWS, cid)
	kept := make([]map[string]any, 0, len(s.Store.Sessions))
	var removedSess []string
	for _, sess := range s.Store.Sessions {
		if str(sess["conversationId"]) == cid || str(sess["id"]) == cid {
			if owner := str(sess["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
				continue
			}
			removedSess = append(removedSess, str(sess["id"]))
			continue
		}
		kept = append(kept, sess)
	}
	s.Store.Sessions = kept
	s.Store.AppendAudit(foundWS, id.Name, "删除协作会话", cid, "success", "")
	s.Store.Unlock()
	s.Store.Persist("conversations")
	s.Store.Persist("messages")
	s.Store.Persist("sessions")
	if s.Store.CanWrite("memory_records") {
		s.Store.Persist("memory_records")
		if len(memDeleted) > 0 {
			if err := s.Store.PersistDeleteSync("memory_records", memDeleted...); err != nil {
				log.Printf("persist-delete memory_records: %v", err)
			}
		}
	} else {
		go s.delegatePurgeConversationMemory(r, foundWS, cid)
	}
	if err := s.Store.PersistDeleteSync("conversations", cid); err != nil {
		log.Printf("persist-delete conversations %s: %v", cid, err)
	}
	if err := s.Store.PersistDeleteSync("messages", cid); err != nil {
		log.Printf("persist-delete messages %s: %v", cid, err)
	}
	if err := s.Store.PersistDeleteSync("context_snapshots", cid); err != nil {
		log.Printf("persist-delete context_snapshots %s: %v", cid, err)
	}
	if len(removedSess) > 0 {
		if err := s.Store.PersistDeleteSync("sessions", removedSess...); err != nil {
			log.Printf("persist-delete sessions: %v", err)
		}
	}
	return map[string]any{"ok": true, "id": cid}, nil
}

func (s *Server) listSlashCommands(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.SlashCommands, nil
}

func (s *Server) getConversation(r *http.Request) (any, error) {
	cid := conversationIDFromPath(r.URL.Path)
	if cid == "" {
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()

	if cp, forbidden := s.resolveConversationDetailLocked(id, ws, cid); forbidden {
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权查看他人会话")
	} else if cp != nil {
		return cp, nil
	}

	return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
}

func (s *Server) conversationStream(w http.ResponseWriter, r *http.Request) {
	// Rewrite path to reuse copilotStream internals by temporarily adjusting URL.
	// /api/conversations/:id/stream → same logic
	s.copilotStream(w, r)
}

func (s *Server) conversationCreateTask(r *http.Request) (any, error) {
	body, _ := decodeMap(r)
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	if !auth.Has(id, "task.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建任务")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/conversations/:id/tasks
	conversationID := ""
	if len(parts) >= 3 {
		conversationID = parts[2]
	}
	body["source"] = "conversation"
	body["title"] = coalesce(str(body["title"]), "协作派生任务")
	if conversationID != "" {
		body["conversationId"] = conversationID
		links, _ := body["links"].(map[string]any)
		if links == nil {
			links = map[string]any{}
		}
		links["conversationId"] = conversationID
		body["links"] = links
	}
	s.Store.Lock()
	item := buildControlledTask(s.Store.ID, ws, body, id)
	item["code"] = nextTaskCode(s.Store.Tasks)
	appendTaskAuditLocked(item, id.Name, "创建任务", "会话派生 · "+str(item["title"]), "success")
	s.Store.Tasks = append([]map[string]any{item}, s.Store.Tasks...)
	s.Store.AppendAudit(ws, id.Name, "会话派生任务", str(item["title"]), "success", conversationID)
	s.Store.Unlock()
	s.Store.Persist("tasks")
	IncTaskCreated()
	return item, nil
}
