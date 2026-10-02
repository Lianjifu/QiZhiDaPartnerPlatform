package workflows

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listWorkflows → GET /api/workflows
// Returns all workflows in the requester's workspace.
func (s *Service) listWorkflows(r *http.Request) (any, error) {
	ws := s.Deps.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, w := range s.Store.Workflows {
		if str(w["workspaceId"]) == ws {
			out = append(out, w)
		}
	}
	return out, nil
}

// createWorkflow → POST /api/workflows
// Requires workflow.write. Persists a new draft workflow with status=draft
// and version=0.1.0; the graph body is stored verbatim.
func (s *Service) createWorkflow(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if !auth.Has(id, "workflow.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建流程")
	}
	body, _ := s.Deps.DecodeMap(r)
	item := map[string]any{
		"id": s.Store.ID("wf"), "workspaceId": s.Deps.WorkspaceID(r),
		"name": coalesce(str(body["name"]), "未命名流程"), "status": "draft", "version": "0.1.0",
		"ownerId": id.ID, "updatedAt": time.Now().UTC().Format(time.RFC3339),
		"graph": body["graph"],
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Workflows = append([]map[string]any{item}, s.Store.Workflows...)
	s.Store.PersistCollection("workflows", s.Store.Workflows)
	s.Store.AppendAudit(s.Deps.WorkspaceID(r), id.Name, "创建工作流", str(item["name"]), "success", "")
	return item, nil
}

// listWorkflowGenerations → GET /api/workflows/generations
// LLM-generated workflow drafts (separate from committed workflows).
func (s *Service) listWorkflowGenerations(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.WorkflowGens, nil
}

// generateWorkflow → POST /api/workflows/generate
// Persists a generation request as a "ready" record; the actual LLM
// graph build is performed by the Workflows page client-side.
func (s *Service) generateWorkflow(r *http.Request) (any, error) {
	body, _ := s.Deps.DecodeMap(r)
	item := map[string]any{
		"id": s.Store.ID("gen"), "prompt": body["prompt"], "status": "ready",
		"createdAt": time.Now().UTC().Format(time.RFC3339),
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.WorkflowGens = append([]map[string]any{item}, s.Store.WorkflowGens...)
	return item, nil
}

// workflowByID handles GET/POST/PATCH /api/workflows/{id} plus action
// suffixes (versions, draft, validate, publish, run, rollback,
// publish-as-skill). The single dispatch entry serves all three verbs
// plus the action switch — mirrors the legacy handler shape exactly.
func (s *Service) workflowByID(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "流程不存在")
	}
	wid := parts[2]
	action := ""
	if len(parts) >= 4 {
		action = parts[3]
	}
	id := s.identityFrom(r.Context())
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	resolveWorkflow := func(want string) map[string]any {
		aliases := []string{want}
		if want == "wf1" {
			aliases = append(aliases, "wf-1")
		} else if want == "wf-1" {
			aliases = append(aliases, "wf1")
		}
		for _, candidate := range aliases {
			for _, w := range s.Store.Workflows {
				if str(w["id"]) == candidate {
					return w
				}
			}
		}
		return nil
	}
	wf := resolveWorkflow(wid)
	if wf == nil && action == "" {
		return nil, apperr.NotFoundErr(apperr.NotFound, "流程不存在")
	}
	if action == "" {
		return wf, nil
	}
	// 后续动作统一使用实际存储的 id，避免 wf1 / wf-1 分叉
	if wf != nil {
		wid = str(wf["id"])
	}
	body, _ := s.Deps.DecodeMap(r)
	switch action {
	case "versions":
		if r.Method == http.MethodGet {
			vers := s.Store.WorkflowVersions[wid]
			if vers == nil && wid == "wf1" {
				vers = s.Store.WorkflowVersions["wf-1"]
			}
			if vers == nil && wid == "wf-1" {
				vers = s.Store.WorkflowVersions["wf1"]
			}
			if vers == nil {
				return []map[string]any{}, nil
			}
			out := make([]map[string]any, 0, len(vers))
			for _, raw := range vers {
				item := map[string]any{}
				for k, v := range raw {
					item[k] = v
				}
				if str(item["label"]) == "" {
					ver := strings.TrimSpace(str(item["version"]))
					switch {
					case ver == "":
						item["label"] = str(item["id"])
					case strings.HasPrefix(ver, "v") || strings.HasPrefix(ver, "V"):
						item["label"] = ver
					default:
						item["label"] = "v" + ver
					}
				}
				if str(item["time"]) == "" && str(item["createdAt"]) != "" {
					item["time"] = strings.ReplaceAll(strings.TrimSuffix(str(item["createdAt"]), "Z"), "T", " ")
				}
				out = append(out, item)
			}
			return out, nil
		}
		verLabel := strings.TrimSpace(str(body["label"]))
		if verLabel == "" {
			verLabel = strings.TrimSpace(coalesce(str(body["version"]), "0.1.0"))
		}
		if verLabel != "" && !strings.HasPrefix(verLabel, "v") && !strings.HasPrefix(verLabel, "V") && str(body["label"]) == "" {
			verLabel = "v" + verLabel
		}
		ver := map[string]any{
			"id": s.Store.ID("wfv"), "workflowId": wid,
			"version": coalesce(str(body["version"]), strings.TrimPrefix(verLabel, "v")),
			"label": verLabel, "status": "draft",
			"desc": coalesce(str(body["desc"]), "从当前画布另存的草稿版本"),
			"time": "刚刚", "createdAt": time.Now().UTC().Format(time.RFC3339),
			"nodes": body["nodes"], "edges": body["edges"],
			"parentVersionId": body["parentVersionId"],
		}
		s.Store.WorkflowVersions[wid] = append([]map[string]any{ver}, s.Store.WorkflowVersions[wid]...)
		return ver, nil
	case "draft":
		if wf == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "流程不存在")
		}
		for k, v := range body {
			wf[k] = v
		}
		wf["status"] = "draft"
		wf["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		return wf, nil
	case "validate":
		return map[string]any{"ok": true, "issues": []string{}}, nil
	case "publish":
		if wf == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "流程不存在")
		}
		if err := s.Deps.EvaluateWriteLocked(r, "workflow", "publish", policy.Input{ApproverID: id.ID, SubmitterID: id.ID}); err != nil {
			return nil, err
		}
		wf["status"] = "active"
		wf["lifecycleStatus"] = "published"
		s.Store.AppendAudit(s.Deps.WorkspaceID(r), id.Name, "发布工作流", str(wf["name"]), "success", "")
		return wf, nil
	case "run":
		run := map[string]any{"id": s.Store.ID("run"), "workspaceId": s.Deps.WorkspaceID(r), "workflowId": wid, "status": "succeeded", "startedAt": time.Now().UTC().Format(time.RFC3339), "finishedAt": time.Now().UTC().Format(time.RFC3339)}
		s.Store.WorkflowRuns = append([]map[string]any{run}, s.Store.WorkflowRuns...)
		return run, nil
	case "rollback":
		if wf == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "流程不存在")
		}
		return wf, nil
	case "publish-as-skill":
		if wf == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "流程不存在")
		}
		skill, err := s.publishWorkflowAsSkillLocked(id, s.Deps.WorkspaceID(r), wf, str(body["name"]))
		if err != nil {
			return nil, err
		}
		cat, _ := skill["_catalog"].(map[string]any)
		delete(skill, "_catalog")
		unlocked = true
		s.Store.Unlock()
		go func() {
			s.Store.Persist("workflow_skills")
			s.Deps.ApplyWorkflowSkillCatalog(id, cat, r)
		}()
		return skill, nil
	}
	if strings.HasPrefix(action, "runs") {
		return s.Store.WorkflowRuns, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "未知流程动作")
}

// identityFrom is a thin wrapper around auth.IdentityFrom so handlers
// can read `s.identityFrom(ctx)` like the legacy *Server receivers.
func (s *Service) identityFrom(ctx context.Context) *auth.Identity {
	return auth.IdentityFrom(ctx)
}
