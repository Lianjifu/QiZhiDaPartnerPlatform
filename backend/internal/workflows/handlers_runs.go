package workflows

import (
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listWorkflowRuns → GET /api/workflow-runs
// Returns all workflow runs (the route is intentionally unfiltered;
// the Workflows page client filters by workspace).
func (s *Service) listWorkflowRuns(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.WorkflowRuns, nil
}

// runWorkflow → POST /api/workflows/run
// Requires workflow.execute. Calls the qzdaworkflow engine via the
// StartTrial Deps function (bound in buildWorkflowSvc to
// qzdaworkflow.Engine.StartTrial). When the body sets publishSkill=true
// and the trial succeeded, the workflow is also published as a skill —
// the same publish-as-skill path the WorkflowsTab.Skills panel uses.
func (s *Service) runWorkflow(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if !auth.Has(id, "workflow.execute") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权执行流程")
	}
	body, _ := s.Deps.DecodeMap(r)
	wfID := str(body["workflowId"])
	runID := s.Store.ID("run")
	engRun, err := s.Deps.StartTrial(r.Context(), runID, wfID)
	if err != nil {
		return nil, apperr.Unavailable(apperr.RuntimeUnavailable, err.Error())
	}
	run := engRun.ToMap()
	run["workspaceId"] = s.Deps.WorkspaceID(r)
	s.Store.Lock()
	s.Store.WorkflowRuns = append([]map[string]any{run}, s.Store.WorkflowRuns...)
	if body["publishSkill"] == true && str(run["status"]) == "succeeded" {
		var wf map[string]any
		for _, w := range s.Store.Workflows {
			if str(w["id"]) == wfID {
				wf = w
				break
			}
		}
		if skill, err := s.publishWorkflowAsSkillLocked(id, s.Deps.WorkspaceID(r), wf, coalesce(str(body["skillName"]), "流程技能")); err != nil {
			s.Store.Unlock()
			return nil, err
		} else {
			cat, _ := skill["_catalog"].(map[string]any)
			delete(skill, "_catalog")
			s.Store.Unlock()
			s.Store.Persist("workflow_runs")
			s.Store.Persist("workflow_skills")
			s.Deps.ApplyWorkflowSkillCatalog(id, cat, r)
			s.Store.Lock()
		}
	}
	s.Store.AppendAudit(s.Deps.WorkspaceID(r), id.Name, "试运行工作流", wfID, "success", "engine=qzda-workflow")
	s.Store.Unlock()
	s.Store.Persist("workflow_runs")
	s.Store.Persist("workflow_skills")
	s.Deps.PersistSkills()
	return run, nil
}