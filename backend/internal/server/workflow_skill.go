package server

import (
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func workflowIsPublished(wf map[string]any) bool {
	st := coalesce(str(wf["lifecycleStatus"]), str(wf["status"]))
	return st == "published" || st == "active"
}

func (s *Server) workflowTrialSucceededLocked(wfID string) bool {
	for _, run := range s.Store.WorkflowRuns {
		if str(run["workflowId"]) == wfID && str(run["status"]) == "succeeded" {
			return true
		}
	}
	return false
}

// publishWorkflowAsSkillLocked registers a workflow as an assemblable skill.
// Caller holds Store.Lock. Unpublished graphs and untried runs are rejected.
func (s *Server) publishWorkflowAsSkillLocked(actor *auth.Identity, ws string, wf map[string]any, skillName string) (map[string]any, error) {
	if wf == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "流程不存在")
	}
	if !workflowIsPublished(wf) {
		return nil, apperr.BadReq(apperr.BadRequest, "仅已发布流程可发布为技能")
	}
	wfID := str(wf["id"])
	if !s.workflowTrialSucceededLocked(wfID) {
		return nil, apperr.BadReq(apperr.BadRequest, "须先试运行成功再发布为技能")
	}
	name := coalesce(skillName, str(wf["name"])+"技能")
	now := time.Now().UTC().Format(time.RFC3339)
	status, life := "published", "enabled"
	if requiresPeerApprovalGate(actor) {
		status, life = "pending_approval", "pending_approval"
	}
	risk := coalesce(str(wf["riskLevel"]), coalesce(str(wf["risk"]), "mid"))
	skill := map[string]any{
		"id": s.Store.ID("wfs"), "workspaceId": ws, "workflowId": wfID,
		"sourceWorkflowId": wfID, "name": name, "status": status, "version": coalesce(str(wf["version"]), "1.0.0"),
		"kind": "workflow", "lifecycleStatus": life, "requestedBy": actor.Name, "requestedById": actor.ID,
		"riskLevel": risk, "createdAt": now, "updatedAt": now,
	}
	s.Store.WorkflowSkills = append([]map[string]any{skill}, s.Store.WorkflowSkills...)
	catalogItem := map[string]any{
		"id": skill["id"], "workspaceId": ws, "ownerId": actor.ID, "owner": actor.Name,
		"name": name, "kind": "workflow", "description": "由流程 " + str(wf["name"]) + " 发布",
		"lifecycleStatus": life, "status": status, "runtime": "de-workflow",
		"version": skill["version"], "workflowId": wfID, "source": "workflow",
		"environment": coalesce(str(wf["environment"]), "production"),
		"riskLevel":   risk,
	}
	if s.Store.CanWrite("skills") {
		s.Store.Skills = append([]map[string]any{catalogItem}, s.Store.Skills...)
		if s.Store.CapabilityCatalog == nil {
			s.Store.CapabilityCatalog = map[string]any{}
		}
		if status == "published" {
			wfs, _ := s.Store.CapabilityCatalog["workflows"].([]map[string]any)
			s.Store.CapabilityCatalog["workflows"] = append([]map[string]any{{
				"id": skill["id"], "name": name, "meta": "流程技能 · " + str(skill["version"]),
			}}, wfs...)
		}
	}
	s.Store.AppendAudit(ws, actor.Name, "发布流程技能", name, "success", status)
	skill["_catalog"] = catalogItem
	return skill, nil
}

func (s *Server) syncWorkflowSkillCatalogLocked(skill map[string]any) {
	if !s.Store.CanWrite("skills") {
		return
	}
	sid := str(skill["id"])
	for _, item := range s.Store.Skills {
		if str(item["id"]) != sid {
			continue
		}
		item["status"] = skill["status"]
		item["lifecycleStatus"] = skill["lifecycleStatus"]
		return
	}
}

func (s *Server) enableWorkflowSkillCatalogLocked(skill map[string]any) {
	if !s.Store.CanWrite("skills") {
		return
	}
	sid := str(skill["id"])
	found := false
	for _, item := range s.Store.Skills {
		if str(item["id"]) != sid {
			continue
		}
		item["status"] = "published"
		item["lifecycleStatus"] = "enabled"
		found = true
		break
	}
	if !found {
		s.Store.Skills = append([]map[string]any{{
			"id": sid, "workspaceId": skill["workspaceId"], "name": skill["name"],
			"kind": "workflow", "lifecycleStatus": "enabled", "status": "published",
			"runtime": "de-workflow", "version": skill["version"], "source": "workflow",
			"workflowId": skill["workflowId"],
		}}, s.Store.Skills...)
	}
	if s.Store.CapabilityCatalog == nil {
		s.Store.CapabilityCatalog = map[string]any{}
	}
	wfs, _ := s.Store.CapabilityCatalog["workflows"].([]map[string]any)
	for _, w := range wfs {
		if str(w["id"]) == sid {
			return
		}
	}
	s.Store.CapabilityCatalog["workflows"] = append([]map[string]any{{
		"id": sid, "name": str(skill["name"]), "meta": "流程技能 · " + coalesce(str(skill["version"]), "—"),
	}}, wfs...)
}
