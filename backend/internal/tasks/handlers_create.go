package tasks

import (
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// createTask handles POST /api/tasks — assembles a fresh controlled
// task via BuildControlledTask, writes the audit trail, and persists.
// Mirrors the legacy handlers_contract.go createTaskAligned
// implementation byte-for-byte (input validation order: task.write →
// requireWorkspaceAccess → title). The IncTaskCreated counter is fired
// after the persist call (mirrors the legacy ordering).
//
// Called from Service.CreateTask; the route table dispatches POST
// /api/tasks through that façade.
func (s *Service) createTask(r *http.Request) (any, error) {
	id := s.Deps.IdentityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	if !auth.Has(id, "task.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建任务")
	}
	if err := s.Deps.RequireWorkspaceAccess(id, ws); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	title := strings.TrimSpace(str(body["title"]))
	if title == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "任务标题必填")
	}
	s.Store.Lock()
	item := BuildControlledTask(s.Store.ID, ws, body, id)
	item["code"] = NextTaskCode(s.Store.Tasks)
	AppendTaskAuditLocked(item, id.Name, "创建任务", title, "success")
	s.Store.Tasks = append([]map[string]any{item}, s.Store.Tasks...)
	s.Store.AppendAudit(ws, id.Name, "创建任务", title, "success", coalesce(str(body["dispatchKind"]), str(body["source"])))
	s.Store.Unlock()
	s.Store.Persist("tasks")
	if s.Deps.IncTaskCreated != nil {
		s.Deps.IncTaskCreated()
	}
	return item, nil
}

// conversationCreateTask handles POST /api/conversations/:id/tasks —
// the M02 协作会话 → M03 任务中心 cross-module entry point. Stamps
// source=conversation on the body and threads conversationId into the
// task's links before delegating to BuildControlledTask. Mirrors the
// legacy handlers_contract.go conversationCreateTask.
//
// Called from Service.ConversationCreateTask; the route table dispatches
// the /api/conversations/:id/tasks path through that façade.
func (s *Service) conversationCreateTask(r *http.Request) (any, error) {
	body, _ := s.Deps.DecodeMap(r)
	id := s.Deps.IdentityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	if !auth.Has(id, "task.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建任务")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/conversations/:id/tasks
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
	item := BuildControlledTask(s.Store.ID, ws, body, id)
	item["code"] = NextTaskCode(s.Store.Tasks)
	AppendTaskAuditLocked(item, id.Name, "创建任务", "会话派生 · "+str(item["title"]), "success")
	s.Store.Tasks = append([]map[string]any{item}, s.Store.Tasks...)
	s.Store.AppendAudit(ws, id.Name, "会话派生任务", str(item["title"]), "success", conversationID)
	s.Store.Unlock()
	s.Store.Persist("tasks")
	if s.Deps.IncTaskCreated != nil {
		s.Deps.IncTaskCreated()
	}
	return item, nil
}