package workflows

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listWorkflowSkillsAligned → GET /api/workflow-skills
// Mirrors the legacy "Aligned" wrapper from handlers_skills.go: filters
// by workspace and back-fills sourceWorkflowId / sourceVersionId /
// riskLevel / approvalRequired / rollbackSupported / description so
// downstream UI doesn't have to do it.
func (s *Service) listWorkflowSkillsAligned(r *http.Request) (any, error) {
	if err := s.Deps.RequireSkillRead(s.identityFrom(r.Context())); err != nil {
		return nil, err
	}
	ws := s.Deps.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, item := range s.Store.WorkflowSkills {
		if str(item["workspaceId"]) != "" && str(item["workspaceId"]) != ws {
			continue
		}
		m := cloneMap(item)
		if str(m["sourceWorkflowId"]) == "" {
			m["sourceWorkflowId"] = m["workflowId"]
		}
		if str(m["sourceVersionId"]) == "" {
			m["sourceVersionId"] = coalesce(str(m["version"]), "v1")
		}
		if str(m["riskLevel"]) == "" {
			m["riskLevel"] = "mid"
		}
		if m["approvalRequired"] == nil {
			m["approvalRequired"] = true
		}
		if m["rollbackSupported"] == nil {
			m["rollbackSupported"] = true
		}
		if str(m["description"]) == "" {
			m["description"] = "由工作流发布的流程技能"
		}
		out = append(out, m)
	}
	return out, nil
}

// publishWorkflowSkill → POST /api/workflow-skills/{id}/publish
// Governance endpoint: enforces dual-approval + countersign hold when
// applicable, then promotes a pending workflow skill to "published" +
// "enabled" and pushes the catalog entry through ApplyWorkflowSkillCatalog.
func (s *Service) publishWorkflowSkill(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if err := s.Deps.RequireSkillWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "路径无效")
	}
	wfsID := parts[2]
	ws := s.Deps.WorkspaceID(r)
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	for _, item := range s.Store.WorkflowSkills {
		if str(item["id"]) != wfsID {
			continue
		}
		if str(item["workspaceId"]) != "" && str(item["workspaceId"]) != ws {
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "流程技能不在当前工作区")
		}
		st := coalesce(str(item["status"]), str(item["lifecycleStatus"]))
		if st == "published" || st == "enabled" || st == "active" {
			return item, nil
		}
		if s.Deps.ProductionLikeEnv() && st != "pending_approval" && st != "pending_countersign" {
			return nil, apperr.BadReq(apperr.BadRequest, "仅待审批的流程技能可发布")
		}
		if err := s.Deps.RequireProductionDualApproval(str(item["requestedById"]), str(item["requestedBy"]), id, "流程技能发布"); err != nil {
			return nil, err
		}
		if hold, herr := s.Deps.MaybeHoldForCountersign(item, id, coalesce(str(item["riskLevel"]), str(item["risk"])), "流程技能发布"); herr != nil {
			return nil, herr
		} else if hold {
			item["lifecycleStatus"] = "pending_countersign"
			s.syncWorkflowSkillCatalogLocked(item)
			s.Store.AppendAudit(ws, id.Name, "流程技能会签待副署", str(item["name"]), "success", "pending_countersign")
			itemCopy := cloneMap(item)
			unlocked = true
			s.Store.Unlock()
			go func() {
				s.Store.Persist("workflow_skills")
				s.Deps.ApplyWorkflowSkillCatalog(id, itemCopy, r)
			}()
			return item, nil
		}
		item["status"] = "published"
		item["lifecycleStatus"] = "enabled"
		item["approvedBy"] = id.Name
		item["approvedById"] = id.ID
		item["approvedAt"] = time.Now().UTC().Format(time.RFC3339)
		if str(item["sourceWorkflowId"]) == "" {
			item["sourceWorkflowId"] = item["workflowId"]
		}
		s.enableWorkflowSkillCatalogLocked(item)
		s.Store.AppendAudit(ws, id.Name, "治理发布流程技能", str(item["name"]), "success", "")
		itemCopy := cloneMap(item)
		unlocked = true
		s.Store.Unlock()
		go func() {
			s.Store.Persist("workflow_skills")
			s.Deps.ApplyWorkflowSkillCatalog(id, itemCopy, r)
		}()
		return item, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "流程技能不存在")
}

// bindWorkflowCapability → POST /api/workflows/{id}/capabilities
// Creates a workflow → skill binding (used by the partner version approval
// flow to wire approved partners into a workflow). Dedupes on existing
// active bindings.
func (s *Service) bindWorkflowCapability(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if err := s.Deps.RequireSkillWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/workflows/:id/capabilities
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "路径无效")
	}
	workflowID := parts[2]
	body, _ := s.Deps.DecodeMap(r)
	capID := str(body["capabilityId"])
	kind := coalesce(str(body["capabilityKind"]), "skill")
	pinned := coalesce(str(body["pinnedVersion"]), "")
	ws := s.Deps.WorkspaceID(r)

	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	var wf map[string]any
	for _, w := range s.Store.Workflows {
		if str(w["id"]) == workflowID && (str(w["workspaceId"]) == ws || str(w["workspaceId"]) == "") {
			wf = w
			break
		}
	}
	if wf == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "工作流不存在")
	}
	sk := s.findSkillLocked(ws, capID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "能力不存在")
	}
	if pinned == "" {
		pinned = coalesce(str(sk["version"]), "0.1.0")
	}
	bindings := s.skillExtraSlice("bindings")
	for _, b := range bindings {
		if str(b["targetType"]) == "workflow" && str(b["targetId"]) == workflowID && str(b["capabilityId"]) == capID && str(b["status"]) == "active" {
			return b, nil
		}
	}
	item := map[string]any{
		"id": s.Store.ID("cap"), "workspaceId": ws,
		"targetType": "workflow", "targetId": workflowID, "targetName": wf["name"],
		"capabilityKind": kind, "capabilityId": capID, "pinnedVersion": pinned,
		"status": "active", "createdBy": id.Name,
		"createdAt": time.Now().UTC().Format(time.RFC3339),
		"auditId":   s.Store.ID("audit"),
	}
	s.Store.SkillExtra["bindings"] = append([]map[string]any{item}, bindings...)
	s.skillImpactLocked(ws, capID)
	s.Store.AppendAudit(ws, id.Name, "引用技能到工作流", str(sk["name"])+":"+str(wf["name"]), "success", "")
	unlocked = true
	s.Store.Unlock()
	go func() { s.Deps.PersistSkills(); s.Deps.PersistSkillExtra() }()
	return item, nil
}

// --- skill-catalog helpers (used by publishWorkflowAsSkillLocked and
// publishWorkflowSkill). They read/mutate Store.Skills and Store.
// CapabilityCatalog under Store.Lock; caller must hold it.

func workflowIsPublished(wf map[string]any) bool {
	st := coalesce(str(wf["lifecycleStatus"]), str(wf["status"]))
	return st == "published" || st == "active"
}

func (s *Service) workflowTrialSucceededLocked(wfID string) bool {
	for _, run := range s.Store.WorkflowRuns {
		if str(run["workflowId"]) == wfID && str(run["status"]) == "succeeded" {
			return true
		}
	}
	return false
}

// findSkillLocked looks up a skill in Store.Skills + the SkillExtra
// "skills" slice by id+workspace. Returns nil when not found. Caller
// holds Store.Lock.
func (s *Service) findSkillLocked(ws, id string) map[string]any {
	if id == "" {
		return nil
	}
	if s.Store.SkillExtra != nil {
		if arr, ok := s.Store.SkillExtra["skills"].([]map[string]any); ok {
			for _, item := range arr {
				if str(item["id"]) == id && (str(item["workspaceId"]) == "" || str(item["workspaceId"]) == ws) {
					return item
				}
			}
		}
	}
	for _, item := range s.Store.Skills {
		if str(item["id"]) == id && (str(item["workspaceId"]) == "" || str(item["workspaceId"]) == ws) {
			return item
		}
	}
	return nil
}

// skillExtraSlice reads a typed []map[string]any out of SkillExtra,
// returning nil when the key is missing.
func (s *Service) skillExtraSlice(key string) []map[string]any {
	if s.Store.SkillExtra == nil {
		return nil
	}
	out, _ := s.Store.SkillExtra[key].([]map[string]any)
	return out
}

// skillImpactLocked notes that a skill binding changed so the impact
// gauge can be recomputed. Mirrors handlers_skills_detail.go's
// Server.skillImpactLocked shape; writes nothing today.
func (s *Service) skillImpactLocked(ws, skillID string) map[string]any {
	return map[string]any{"workspaceId": ws, "skillId": skillID}
}

// publishWorkflowAsSkillLocked registers a workflow as an assemblable
// skill. Caller holds Store.Lock. Unpublished graphs and untried runs
// are rejected.
func (s *Service) publishWorkflowAsSkillLocked(actor *auth.Identity, ws string, wf map[string]any, skillName string) (map[string]any, error) {
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
	if s.Deps.RequiresPeerApprovalGate(actor) {
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
		"lifecycleStatus": life, "status": status, "runtime": "qzda-workflow",
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

// PublishWorkflowAsSkillLockedForTest exposes the package-private
// publishWorkflowAsSkillLocked so the legacy workflow_skill_guard_test.go
// (still in internal/server/) can verify the write-domain guard without
// re-creating the service in isolation.
func (s *Service) PublishWorkflowAsSkillLockedForTest(actor *auth.Identity, ws string, wf map[string]any, skillName string) (map[string]any, error) {
	return s.publishWorkflowAsSkillLocked(actor, ws, wf, skillName)
}

func (s *Service) syncWorkflowSkillCatalogLocked(skill map[string]any) {
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

func (s *Service) enableWorkflowSkillCatalogLocked(skill map[string]any) {
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
			"runtime": "qzda-workflow", "version": skill["version"], "source": "workflow",
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