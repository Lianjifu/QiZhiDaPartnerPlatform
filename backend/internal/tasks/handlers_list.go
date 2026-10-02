package tasks

import (
	"net/http"
	"strconv"
)

// listTasks handles GET /api/tasks — workspace-scoped task list with
// filter + pagination. Mirrors the legacy handlers_b.go listTasks
// implementation, formerly reached through the listTasksAligned wrapper
// in handlers_contract.go. Returns []map[string]any directly when no
// pagination is requested, or {items, total, limit, offset} envelope
// otherwise — preserved byte-for-byte from the pre-move contract so
// the frontend (TasksPage listTasks query) sees no behaviour drift.
//
// Called from Service.ListTasks; the route table in server.go dispatches
// GET /api/tasks through that façade. Internal — any receiver on Service.
func (s *Service) listTasks(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	if err := s.Deps.RequireWorkspaceAccess(id, ws); err != nil {
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
	scoped := make([]map[string]any, 0)
	for _, t := range s.Store.Tasks {
		if str(t["workspaceId"]) != ws {
			continue
		}
		EnsureTaskShape(t)
		if id.Role == "user" && !TaskVisibleToUser(t, id) {
			continue
		}
		scoped = append(scoped, t)
	}
	filtered := FilterTasksQuery(scoped, filters)
	if !paged {
		return filtered, nil
	}
	items, total := PaginateTasks(filtered, limit, offset)
	return map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	}, nil
}