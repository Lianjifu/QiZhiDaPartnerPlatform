package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) knowledgeExtra(key string) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	if v, ok := s.Store.KnowledgeExtra[key]; ok {
		return v, nil
	}
	return []any{}, nil
}

func (s *Server) knowledgeDocDetail(r *http.Request) (any, error) {
	id := strings.TrimPrefix(r.URL.Path, "/api/knowledge/doc/")
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["id"]) == id {
			return d, nil
		}
	}
	return map[string]any{"id": id, "title": "文档", "status": "published"}, nil
}

func (s *Server) patchKnowledgeGovernance(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "更新知识治理")
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	gov, _ := s.Store.KnowledgeExtra["governance"].(map[string]any)
	if gov == nil {
		gov = map[string]any{"workspaceId": s.workspaceID(r)}
	}
	for k, v := range body {
		gov[k] = v
	}
	s.Store.KnowledgeExtra["governance"] = gov
	s.Store.AppendAudit(s.workspaceID(r), id.Name, "更新知识治理", "governance", "success", "")
	return gov, nil
}

func (s *Server) workflowByID(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "流程不存在")
	}
	wid := parts[2]
	action := ""
	if len(parts) >= 4 {
		action = parts[3]
	}
	id := identityFrom(r.Context())
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
	body, _ := decodeMap(r)
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
		if err := s.evaluateWriteLocked(r, "workflow", "publish", policy.Input{ApproverID: id.ID, SubmitterID: id.ID}); err != nil {
			return nil, err
		}
		wf["status"] = "active"
		wf["lifecycleStatus"] = "published"
		s.Store.AppendAudit(s.workspaceID(r), id.Name, "发布工作流", str(wf["name"]), "success", "")
		return wf, nil
	case "run":
		run := map[string]any{"id": s.Store.ID("run"), "workspaceId": s.workspaceID(r), "workflowId": wid, "status": "succeeded", "startedAt": time.Now().UTC().Format(time.RFC3339), "finishedAt": time.Now().UTC().Format(time.RFC3339)}
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
		skill, err := s.publishWorkflowAsSkillLocked(id, s.workspaceID(r), wf, str(body["name"]))
		if err != nil {
			return nil, err
		}
		cat, _ := skill["_catalog"].(map[string]any)
		delete(skill, "_catalog")
		unlocked = true
		s.Store.Unlock()
		go func() {
			s.Store.Persist("workflow_skills")
			s.applyWorkflowSkillCatalog(id, cat, r)
		}()
		return skill, nil
	}
	if strings.HasPrefix(action, "runs") {
		return s.Store.WorkflowRuns, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "未知流程动作")
}

func (s *Server) listWorkflowGenerations(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.WorkflowGens, nil
}

func (s *Server) generateWorkflow(r *http.Request) (any, error) {
	body, _ := decodeMap(r)
	item := map[string]any{
		"id": s.Store.ID("gen"), "prompt": body["prompt"], "status": "ready",
		"createdAt": time.Now().UTC().Format(time.RFC3339),
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.WorkflowGens = append([]map[string]any{item}, s.Store.WorkflowGens...)
	return item, nil
}

func (s *Server) listNotificationChannels(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.NotificationChannels, nil
}

func (s *Server) getTenantProfile(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	if s.Store.TenantProfile == nil {
		return map[string]any{"name": "ACME Corp", "tenantId": "tenant-acme", "region": "cn-east-1"}, nil
	}
	out := map[string]any{}
	for k, v := range s.Store.TenantProfile {
		out[k] = v
	}
	return out, nil
}

func (s *Server) patchTenantProfile(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅管理员可更新组织资料")
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	if s.Store.TenantProfile == nil {
		s.Store.TenantProfile = map[string]any{}
	}
	for _, k := range []string{"name", "region", "status"} {
		if v := strings.TrimSpace(str(body[k])); v != "" {
			s.Store.TenantProfile[k] = v
		}
	}
	s.Store.TenantProfile["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	s.Store.TenantProfile["updatedBy"] = id.Name
	s.Store.AppendAudit("tenant", id.Name, "更新组织资料", str(s.Store.TenantProfile["name"]), "success", "")
	out := map[string]any{}
	for k, v := range s.Store.TenantProfile {
		out[k] = v
	}
	return out, nil
}

func (s *Server) patchNotificationChannel(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅管理员可配置通知渠道")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "通知渠道不存在")
	}
	cid := parts[2]
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, ch := range s.Store.NotificationChannels {
		if str(ch["id"]) != cid {
			continue
		}
		if _, ok := body["enabled"]; ok {
			ch["enabled"] = body["enabled"] == true || str(body["enabled"]) == "true"
		}
		if v := strings.TrimSpace(str(body["name"])); v != "" {
			ch["name"] = v
		}
		s.Store.AppendAudit(s.workspaceID(r), id.Name, "更新通知渠道", cid, "success", "")
		return ch, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "通知渠道不存在")
}

func (s *Server) listAPIKeys(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.APIKeys, nil
}

func (s *Server) listWebhooksConfig(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.WebhooksConfig, nil
}

func (s *Server) emptyOK(r *http.Request) (any, error) { return []any{}, nil }
