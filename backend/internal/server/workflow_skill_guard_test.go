package server

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestPublishWorkflowAsSkillSkipsCapSliceWhenGuarded(t *testing.T) {
	st := store.New()
	st.SetWriteDomain(store.DomainWorkflow)
	before := len(st.Skills)
	srv := New(st)
	srv.Mode = ModeWorkflow
	st.Lock()
	if len(st.Workflows) == 0 {
		st.Unlock()
		t.Fatal("expected seeded workflow")
	}
	wf := st.Workflows[0]
	wf["lifecycleStatus"] = "published"
	wf["status"] = "published"
	st.WorkflowRuns = append(st.WorkflowRuns, map[string]any{
		"id": "run-guard-1", "workflowId": wf["id"], "status": "succeeded",
	})
	actor := &auth.Identity{ID: "u1", Name: "平台管理员", Role: "admin"}
	// M06 P2: publishWorkflowAsSkillLocked lives on the workflowSvc
	// (internal/workflows/). The service was wired in New() with the
	// default governance gates — requiresPeerApprovalGate is bound
	// there so the gate still flips the row to pending_approval when
	// Mode != production. We assert the guard semantics by checking
	// that the WorkflowSkills slice still records the row but the
	// Store.Skills catalog slice stays untouched (write-domain guard).
	skill, err := srv.workflowSvc.PublishWorkflowAsSkillLockedForTest(actor, "w1", wf, "守卫技能")
	st.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if skill == nil {
		t.Fatal("expected workflow skill row")
	}
	if id, _ := skill["id"].(string); id == "" {
		t.Fatal("expected workflow skill id")
	}
	if len(st.Skills) != before {
		t.Fatalf("workflow process must not append Skills: before=%d after=%d", before, len(st.Skills))
	}
	found := false
	for _, item := range st.WorkflowSkills {
		if id, _ := item["id"].(string); id != "" && id == skill["id"] {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("workflow_skills should still record the skill")
	}
}
