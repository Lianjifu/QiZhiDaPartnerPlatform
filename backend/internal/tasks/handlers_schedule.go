package tasks

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Service) listScheduledTasks(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	if err := s.Deps.RequireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	q := r.URL.Query()
	status := q.Get("status")
	search := strings.ToLower(strings.TrimSpace(coalesce(q.Get("q"), q.Get("search"))))
	s.Store.Lock()
	s.fireDueSchedulesLocked(ws, id)
	s.Store.Unlock()
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, item := range s.Store.ScheduledTasks {
		if str(item["workspaceId"]) != ws {
			continue
		}
		if status != "" && status != "all" && str(item["status"]) != status {
			continue
		}
		if search != "" {
			blob := strings.ToLower(str(item["title"]) + " " + str(item["code"]) + " " + str(item["digitalPartnerName"]))
			if !strings.Contains(blob, search) {
				continue
			}
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *Service) createScheduledTask(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	if !auth.Has(id, "task.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建定时任务")
	}
	if err := s.Deps.RequireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	item, err := BuildScheduledTask(s.Store.ID, ws, body, id)
	if err != nil {
		return nil, err
	}
	s.Store.Lock()
	item["code"] = NextScheduleCode(s.Store.ScheduledTasks)
	s.Store.ScheduledTasks = append([]map[string]any{item}, s.Store.ScheduledTasks...)
	s.Store.AppendAudit(ws, id.Name, "创建定时任务", str(item["title"]), "success", str(item["cadence"]))
	s.Store.Unlock()
	s.Store.Persist("scheduled_tasks")
	return item, nil
}

func (s *Service) scheduledTaskRoute(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "定时任务不存在")
	}
	sid := parts[2]
	action := ""
	if len(parts) >= 4 {
		action = parts[3]
	}
	id := s.Deps.IdentityFrom(r.Context())
	s.Store.Lock()
	defer s.Store.Unlock()
	var item map[string]any
	for _, row := range s.Store.ScheduledTasks {
		if str(row["id"]) == sid {
			item = row
			break
		}
	}
	if item == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "定时任务不存在")
	}
	if err := s.Deps.RequireWorkspaceAccess(id, str(item["workspaceId"])); err != nil {
		return nil, err
	}
	if action == "" && r.Method == http.MethodGet {
		return item, nil
	}
	if action == "runs" && r.Method == http.MethodGet {
		out := make([]map[string]any, 0)
		for _, run := range s.Store.ScheduledRuns {
			if str(run["scheduleId"]) == sid {
				out = append(out, run)
			}
		}
		return out, nil
	}
	if !auth.Has(id, "task.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权变更定时任务")
	}
	if action == "" && r.Method == http.MethodPatch {
		body, _ := s.Deps.DecodeMap(r)
		PatchScheduledTask(item, body)
		s.Store.AppendAudit(str(item["workspaceId"]), id.Name, "更新定时任务", str(item["title"]), "success", "")
		go s.Store.Persist("scheduled_tasks")
		return item, nil
	}
	if action == "" && r.Method == http.MethodDelete {
		keep := make([]map[string]any, 0, len(s.Store.ScheduledTasks))
		for _, row := range s.Store.ScheduledTasks {
			if str(row["id"]) != sid {
				keep = append(keep, row)
			}
		}
		s.Store.ScheduledTasks = keep
		s.Store.AppendAudit(str(item["workspaceId"]), id.Name, "删除定时任务", str(item["title"]), "success", "")
		go s.Store.Persist("scheduled_tasks")
		return map[string]any{"ok": true, "id": sid}, nil
	}
	switch action {
	case "pause":
		PatchScheduledTask(item, map[string]any{"enabled": false})
		s.Store.AppendAudit(str(item["workspaceId"]), id.Name, "暂停定时任务", str(item["title"]), "success", "")
		go s.Store.Persist("scheduled_tasks")
		return item, nil
	case "resume":
		PatchScheduledTask(item, map[string]any{"enabled": true})
		s.Store.AppendAudit(str(item["workspaceId"]), id.Name, "恢复定时任务", str(item["title"]), "success", "")
		go s.Store.Persist("scheduled_tasks")
		return item, nil
	case "run":
		run := s.executeScheduleLocked(item, id, "manual")
		go func() {
			s.Store.Persist("scheduled_tasks")
			s.Store.Persist("scheduled_runs")
			s.Store.Persist("tasks")
		}()
		return run, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "定时任务操作不存在")
}

func (s *Service) fireDueSchedulesLocked(ws string, actor *auth.Identity) {
	now := time.Now().UTC()
	fired := 0
	for _, item := range s.Store.ScheduledTasks {
		if str(item["workspaceId"]) != ws || !boolFrom(item["enabled"]) || str(item["status"]) != "active" {
			continue
		}
		nextRaw := str(item["nextRunAt"])
		if nextRaw == "" {
			continue
		}
		next, err := time.Parse(time.RFC3339, nextRaw)
		if err != nil || next.After(now) {
			continue
		}
		s.executeScheduleLocked(item, actor, "due")
		fired++
		if fired >= 20 {
			break
		}
	}
	if fired > 0 {
		go func() {
			s.Store.Persist("scheduled_tasks")
			s.Store.Persist("scheduled_runs")
			s.Store.Persist("tasks")
		}()
	}
}

func (s *Service) executeScheduleLocked(item map[string]any, actor *auth.Identity, trigger string) map[string]any {
	now := time.Now().UTC()
	started := now.Format(time.RFC3339)
	body := map[string]any{
		"title":              "定时：" + str(item["title"]),
		"description":        coalesce(str(item["description"]), "由定时任务自动创建的团队协助。"),
		"priority":           "P2",
		"source":             "workflow",
		"assignee":           coalesce(str(item["owner"]), actor.Name),
		"digitalPartnerId":   item["digitalPartnerId"],
		"digitalPartnerName": item["digitalPartnerName"],
		"tags":               []string{"定时任务", str(item["code"])},
	}
	task := BuildControlledTask(s.Store.ID, str(item["workspaceId"]), body, actor)
	task["code"] = NextTaskCode(s.Store.Tasks)
	AppendTaskAuditLocked(task, actor.Name, "定时触发", str(item["code"])+" · "+trigger, "info")
	s.Store.Tasks = append([]map[string]any{task}, s.Store.Tasks...)
	run := map[string]any{
		"id":          s.Store.ID("schr"),
		"scheduleId":  str(item["id"]),
		"workspaceId": str(item["workspaceId"]),
		"startedAt":   started,
		"finishedAt":  time.Now().UTC().Format(time.RFC3339),
		"status":      "success",
		"message":     "已创建团队协助 " + str(task["code"]),
		"taskId":      str(task["id"]),
		"taskCode":    str(task["code"]),
		"trigger":     trigger,
	}
	s.Store.ScheduledRuns = append([]map[string]any{run}, s.Store.ScheduledRuns...)
	item["lastRunAt"] = started
	item["lastStatus"] = "success"
	item["runCount"] = ToInt(item["runCount"]) + 1
	item["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	next := NextScheduleRun(item, time.Now().UTC().Add(time.Second))
	if str(item["cadence"]) == "once" || next.IsZero() {
		item["status"] = "expired"
		item["enabled"] = false
		delete(item, "nextRunAt")
	} else {
		item["nextRunAt"] = next.Format(time.RFC3339)
	}
	s.Store.AppendAudit(str(item["workspaceId"]), actor.Name, "执行定时任务", str(item["title"]), "success", str(task["code"]))
	return run
}
