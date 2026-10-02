package server

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/tasks"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listTasks is the M03 任务中心 (Task Center) legacy list handler that
// backs the listTasksAligned fallback (handlers_contract.go L29). It
// stays on *Server because it depends on *Server-only helpers
// (requireWorkspaceAccess, Store RLock) that the tasks package does not
// own. tasks.Service binds it as a method value via buildTaskSvc.
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
		tasks.EnsureTaskShape(t)
		if id.Role == "user" && !tasks.TaskVisibleToUser(t, id) {
			continue
		}
		scoped = append(scoped, t)
	}
	filtered := tasks.FilterTasksQuery(scoped, filters)
	if !paged {
		return filtered, nil
	}
	items, total := tasks.PaginateTasks(filtered, limit, offset)
	return map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	}, nil
}

// createTask is a legacy M03 handler kept for backward compatibility
// (pre-M03 P2 routes still hit it through fallback paths in some
// integration tests). It is NOT routed from server.go — only the
// aligned variant `createTaskAligned` is wired.
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
		"ownerId": id.ID, "ownerName": id.Name, "digitalPartnerId": body["digitalPartnerId"],
		"createdAt": time.Now().UTC().Format(time.RFC3339), "updatedAt": time.Now().UTC().Format(time.RFC3339),
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Tasks = append([]map[string]any{item}, s.Store.Tasks...)
	s.Store.AppendAudit(ws, id.Name, "创建任务", title, "success", "")
	return item, nil
}

// taskTransition is a legacy M03 lifecycle transition handler kept for
// backward compatibility. NOT routed from server.go — taskRoute's
// "transition" branch + tasks.ApplyLifecycleTransition handle modern
// transitions. Kept here so external integration tests that exercise
// the legacy path keep compiling.
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
