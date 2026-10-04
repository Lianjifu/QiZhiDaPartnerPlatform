package tasks

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// taskRoute handles /api/tasks/:id[/...] — the catch-all surface for
// the 6 sub-actions: GET (read), PATCH (update), audit (events),
// transition (FSM), approve (governance), takeover (admin override),
// retry (risk recovery), and the legacy start/review/complete catch-all
// via taskTransitionLocked. Dispatches by HTTP method + the :action
// path segment. Mirrors the legacy handlers_contract.go taskRoute
// implementation byte-for-byte.
//
// Called from Service.TaskRoute; the route table dispatches all
// /api/tasks/:id[/...] paths through that façade.
func (s *Service) taskRoute(r *http.Request) (any, error) {
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
	id := s.Deps.IdentityFrom(r.Context())
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
	if err := s.Deps.RequireWorkspaceAccess(id, str(task["workspaceId"])); err != nil {
		return nil, err
	}
	EnsureTaskShape(task)
	if action == "" && r.Method == http.MethodGet {
		return task, nil
	}
	if action == "" && r.Method == http.MethodPatch {
		body, _ := s.Deps.DecodeMap(r)
		if err := CheckTaskVersion(task, body); err != nil {
			return nil, err
		}
		if !auth.Has(id, "task.write") {
			return nil, apperr.Forbidden(apperr.RoleForbidden, "无权更新任务")
		}
		if id.Role == "user" && !TaskVisibleToUser(task, id) {
			return nil, apperr.Forbidden(apperr.TaskOwnerScope, "只能更新自己相关的任务")
		}
		for _, key := range []string{"title", "description", "assignee", "priority", "tags", "collaboratorNames", "collaboratorIds"} {
			if body[key] != nil {
				task[key] = body[key]
			}
		}
		AppendTaskAuditLocked(task, id.Name, "更新任务", "字段更新", "info")
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "更新任务", str(task["title"]), "success", "")
		go s.Store.Persist("tasks")
		return task, nil
	}
	if action == "audit" && r.Method == http.MethodGet {
		evs := TaskAuditEvents(task)
		out := make([]map[string]any, len(evs))
		copy(out, evs)
		return out, nil
	}
	if action == "comments" && r.Method == http.MethodGet {
		return TaskComments(task), nil
	}
	if action == "comments" && r.Method == http.MethodPost {
		if !auth.Has(id, "task.write") {
			return nil, apperr.Forbidden(apperr.RoleForbidden, "无权留言")
		}
		if id.Role == "user" && !TaskVisibleToUser(task, id) {
			return nil, apperr.Forbidden(apperr.TaskOwnerScope, "只能在自己相关的任务上留言")
		}
		body, _ := s.Deps.DecodeMap(r)
		text := strings.TrimSpace(str(body["body"]))
		if text == "" {
			return nil, apperr.BadReq(apperr.BadRequest, "留言内容必填")
		}
		EnsureTaskShape(task)
		comments, _ := task["comments"].([]map[string]any)
		entry := map[string]any{
			"id": s.Store.ID("cmt"), "at": time.Now().UTC().Format(time.RFC3339), "actor": id.Name, "body": text,
		}
		task["comments"] = append(comments, entry)
		AppendTaskAuditLocked(task, id.Name, "团队留言", text, "info")
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务留言", str(task["title"]), "success", "")
		go s.Store.Persist("tasks")
		return entry, nil
	}
	body, _ := s.Deps.DecodeMap(r)
	if err := CheckTaskVersion(task, body); err != nil {
		return nil, err
	}
	switch action {
	case "transition":
		if id.Role == "user" && !TaskVisibleToUser(task, id) {
			return nil, apperr.Forbidden(apperr.TaskOwnerScope, "只能流转自己相关的任务")
		}
		stage := coalesce(str(body["stage"]), coalesce(str(body["status"]), "pending"))
		if err := ApplyLifecycleTransition(task, stage, id); err != nil {
			return nil, err
		}
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务流转", str(task["title"])+":"+str(task["lifecycleStage"]), "success", "")
		if str(task["status"]) == "completed" || str(task["status"]) == "review" {
			s.writeTaskWorkingMemoryLocked(task, id, str(task["status"]))
		}
		go s.Store.Persist("tasks")
		if s.Deps.IncTaskTransition != nil {
			s.Deps.IncTaskTransition()
		}
		return task, nil
	case "approve":
		if id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "审批任务仅限管理员")
		}
		if err := s.Deps.EvaluateWriteLocked(r, "task", "approve", policy.Input{
			SubmitterID: str(task["ownerId"]), ApproverID: id.ID,
		}); err != nil {
			return nil, err
		}
		approved := true
		if body["approved"] != nil {
			approved = boolFrom(body["approved"])
		}
		ApplyTaskApprove(task, approved, coalesce(str(body["reason"]), str(body["actor"])), id)
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务审批", str(task["title"]), "success", coalesce(str(body["reason"]), ""))
		go s.Store.Persist("tasks")
		if s.Deps.IncTaskApprove != nil {
			s.Deps.IncTaskApprove(approved)
		}
		return task, nil
	case "takeover":
		if id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "操作仅限管理员")
		}
		ApplyTaskTakeover(task, coalesce(str(body["reason"]), "人工接管"), id)
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务:takeover", str(task["title"]), "success", str(body["reason"]))
		go s.Store.Persist("tasks")
		if s.Deps.IncTaskTakeover != nil {
			s.Deps.IncTaskTakeover()
		}
		return task, nil
	case "retry":
		if id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "操作仅限管理员")
		}
		if err := ApplyTaskRetry(task, coalesce(str(body["reason"]), "重试"), id); err != nil {
			return nil, err
		}
		s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务:retry", str(task["title"]), "success", str(body["reason"]))
		go s.Store.Persist("tasks")
		if s.Deps.IncTaskRetry != nil {
			s.Deps.IncTaskRetry()
		}
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

// taskTransitionLocked is the legacy start/review/complete/archive/
// reopen catch-all invoked from taskRoute's default branch. Accepts
// the legacy status vocabulary and folds it through MapStatusToStage
// into the new stage vocabulary before ApplyLifecycleTransition.
// Caller MUST hold s.Store.Lock(). Mirrors the legacy
// handlers_contract.go taskTransitionLocked.
func (s *Service) taskTransitionLocked(task map[string]any, action string, body map[string]any, id *auth.Identity) (any, error) {
	next := map[string]string{"start": "in_progress", "review": "review", "complete": "completed", "archive": "archived", "reopen": "pending"}[action]
	stage := ""
	if next != "" {
		stage = MapStatusToStage(next)
	} else if st := str(body["status"]); st != "" {
		stage = MapStatusToStage(st)
	} else if ls := str(body["stage"]); ls != "" {
		stage = ls
	} else {
		return nil, apperr.BadReq(apperr.BadRequest, "未知任务流转")
	}
	if err := ApplyLifecycleTransition(task, stage, id); err != nil {
		return nil, err
	}
	s.Store.AppendAudit(str(task["workspaceId"]), id.Name, "任务流转:"+action, str(task["title"]), "success", "")
	if str(task["status"]) == "completed" || str(task["status"]) == "review" {
		s.writeTaskWorkingMemoryLocked(task, id, str(task["status"]))
	}
	return task, nil
}
