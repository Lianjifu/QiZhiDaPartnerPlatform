package pmsop_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/pmsop"
)

func fixedNow() time.Time { return time.Date(2026, 9, 8, 10, 0, 0, 0, time.UTC) }

func TestEngineRegistersDefaults(t *testing.T) {
	e := pmsop.New()
	ts := e.Templates()
	if len(ts) < 2 {
		t.Fatalf("want ≥2 default templates, got %d", len(ts))
	}
	got := map[string]bool{}
	for _, tpl := range ts {
		got[tpl.ID] = true
	}
	if !got["agile-sprint"] || !got["launch-checklist"] {
		t.Fatalf("missing bundled templates: %+v", got)
	}
}

func TestEngineRegisterCustom(t *testing.T) {
	e := pmsop.New()
	e.Register(pmsop.Template{ID: "x", Name: "X"})
	if _, ok := e.Template("x"); !ok {
		t.Fatal("missing custom template after register")
	}
}

func TestRenderAgileSprint(t *testing.T) {
	e := pmsop.New()
	plan, err := e.Render("agile-sprint", "p-1", "w1", "alice", fixedNow)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if plan.ID != "p-1" || plan.WorkspaceID != "w1" || plan.Owner != "alice" {
		t.Fatalf("plan header wrong: %+v", plan)
	}
	if plan.Status != pmsop.PlanDraft {
		t.Fatalf("plan status: %s", plan.Status)
	}
	if len(plan.Stages) != 3 {
		t.Fatalf("want 3 stages, got %d", len(plan.Stages))
	}
	totalTasks := 0
	for _, s := range plan.Stages {
		totalTasks += len(s.Tasks)
		if s.Status != pmsop.StageActive {
			t.Fatalf("stage %s status: %s", s.ID, s.Status)
		}
	}
	if totalTasks < 5 {
		t.Fatalf("too few tasks rendered: %d", totalTasks)
	}
	for _, s := range plan.Stages {
		for _, task := range s.Tasks {
			if task.Status != pmsop.TaskPending {
				t.Fatalf("task %s status: %s", task.ID, task.Status)
			}
			if task.Title == "" {
				t.Fatalf("task %s missing title", task.ID)
			}
		}
	}
}

func TestRenderMissingTemplate(t *testing.T) {
	e := pmsop.New()
	_, err := e.Render("nope", "p-1", "w1", "a", fixedNow)
	if !errors.Is(err, pmsop.ErrTemplateNotFound) {
		t.Fatalf("want ErrTemplateNotFound, got %v", err)
	}
}

func TestApplyStartAndComplete(t *testing.T) {
	e := pmsop.New()
	plan, _ := e.Render("agile-sprint", "p-1", "w1", "a", fixedNow)

	plan, err := e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskStart, TaskID: "ds-1", Actor: "a", Now: fixedNow})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if plan.Status != pmsop.PlanActive {
		t.Fatalf("plan should be active after start, got %s", plan.Status)
	}
	task := findTask(plan, "ds-1")
	if task.Status != pmsop.TaskInProgress {
		t.Fatalf("task status: %s", task.Status)
	}
	if task.StartedAt == "" {
		t.Fatal("startedAt not stamped")
	}

	plan, err = e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskComplete, TaskID: "ds-1", Actor: "a", Now: fixedNow})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if taskAt(plan, "ds-1").Status != pmsop.TaskDone {
		t.Fatal("task should be done")
	}
	if taskAt(plan, "ds-1").CompletedAt == "" {
		t.Fatal("completedAt not stamped")
	}
}

func TestApplyStageAutoComplete(t *testing.T) {
	e := pmsop.New()
	plan, _ := e.Render("launch-checklist", "p-1", "w1", "a", fixedNow)

	// Complete every task in "pre" stage.
	for _, ev := range []pmsop.Event{
		{Type: pmsop.EventTaskStart, TaskID: "pr-1", Actor: "a", Now: fixedNow},
		{Type: pmsop.EventTaskComplete, TaskID: "pr-1", Actor: "a", Now: fixedNow},
		{Type: pmsop.EventTaskStart, TaskID: "pr-2", Actor: "a", Now: fixedNow},
		{Type: pmsop.EventTaskComplete, TaskID: "pr-2", Actor: "a", Now: fixedNow},
		{Type: pmsop.EventTaskStart, TaskID: "pr-3", Actor: "a", Now: fixedNow},
		{Type: pmsop.EventTaskComplete, TaskID: "pr-3", Actor: "a", Now: fixedNow},
	} {
		var err error
		plan, err = e.Apply(plan, ev)
		if err != nil {
			t.Fatalf("apply %s/%s: %v", ev.Type, ev.TaskID, err)
		}
	}
	for _, s := range plan.Stages {
		if s.ID == "pre" && s.Status != pmsop.StageCompleted {
			t.Fatalf("pre stage should be completed, got %s", s.Status)
		}
	}
}

func TestApplyPlanAutoCompleteWhenAllStagesDone(t *testing.T) {
	e := pmsop.New()
	plan, _ := e.Render("launch-checklist", "p-1", "w1", "a", fixedNow)
	for _, stage := range plan.Stages {
		for _, task := range stage.Tasks {
			var err error
			plan, err = e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskStart, TaskID: task.ID, Actor: "a", Now: fixedNow})
			if err != nil {
				t.Fatalf("start %s: %v", task.ID, err)
			}
			plan, err = e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskComplete, TaskID: task.ID, Actor: "a", Now: fixedNow})
			if err != nil {
				t.Fatalf("complete %s: %v", task.ID, err)
			}
		}
	}
	if plan.Status != pmsop.PlanCompleted {
		t.Fatalf("plan should be completed, got %s", plan.Status)
	}
}

func TestApplyBlockAndUnblock(t *testing.T) {
	e := pmsop.New()
	plan, _ := e.Render("agile-sprint", "p-1", "w1", "a", fixedNow)
	plan, err := e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskBlock, TaskID: "ds-1", Actor: "a", Note: "等待资源", Now: fixedNow})
	if err != nil {
		t.Fatalf("block: %v", err)
	}
	if plan.Status != pmsop.PlanBlocked {
		t.Fatalf("plan should be blocked, got %s", plan.Status)
	}
	if taskAt(plan, "ds-1").Status != pmsop.TaskBlocked {
		t.Fatal("task should be blocked")
	}
	if len(taskAt(plan, "ds-1").Notes) != 1 {
		t.Fatalf("notes: %d", len(taskAt(plan, "ds-1").Notes))
	}
	plan, err = e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskUnblock, TaskID: "ds-1", Actor: "a", Now: fixedNow})
	if err != nil {
		t.Fatalf("unblock: %v", err)
	}
	if taskAt(plan, "ds-1").Status != pmsop.TaskPending {
		t.Fatalf("task should be pending after unblock, got %s", taskAt(plan, "ds-1").Status)
	}
}

func TestApplyNoteAppended(t *testing.T) {
	e := pmsop.New()
	plan, _ := e.Render("agile-sprint", "p-1", "w1", "a", fixedNow)
	plan, err := e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskNote, TaskID: "ds-1", Actor: "a", Note: "外部依赖确认中", Now: fixedNow})
	if err != nil {
		t.Fatal(err)
	}
	task := taskAt(plan, "ds-1")
	if len(task.Notes) != 1 || !strings.Contains(task.Notes[0].Body, "外部依赖") {
		t.Fatalf("note not appended: %+v", task.Notes)
	}
	if task.Status != pmsop.TaskPending {
		t.Fatalf("note must not change status: %s", task.Status)
	}
}

func TestApplyRejectsInvalidTransitions(t *testing.T) {
	e := pmsop.New()
	plan, _ := e.Render("agile-sprint", "p-1", "w1", "a", fixedNow)
	// Block then try to start -> error.
	plan, _ = e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskBlock, TaskID: "ds-1", Actor: "a", Now: fixedNow})
	if _, err := e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskStart, TaskID: "ds-1", Actor: "a", Now: fixedNow}); err == nil {
		t.Fatal("expected error starting a blocked task")
	}
	// Unblock, complete, then try to complete again.
	plan, _ = e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskUnblock, TaskID: "ds-1", Actor: "a", Now: fixedNow})
	plan, _ = e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskStart, TaskID: "ds-1", Actor: "a", Now: fixedNow})
	plan, _ = e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskComplete, TaskID: "ds-1", Actor: "a", Now: fixedNow})
	if _, err := e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskComplete, TaskID: "ds-1", Actor: "a", Now: fixedNow}); err == nil {
		t.Fatal("expected error double-completing")
	}
}

func TestApplyUnknownTask(t *testing.T) {
	e := pmsop.New()
	plan, _ := e.Render("agile-sprint", "p-1", "w1", "a", fixedNow)
	if _, err := e.Apply(plan, pmsop.Event{Type: pmsop.EventTaskStart, TaskID: "nope", Actor: "a", Now: fixedNow}); !errors.Is(err, pmsop.ErrPlanNotFound) {
		t.Fatalf("want ErrPlanNotFound, got %v", err)
	}
}

func TestApplyUnknownEventType(t *testing.T) {
	e := pmsop.New()
	plan, _ := e.Render("agile-sprint", "p-1", "w1", "a", fixedNow)
	if _, err := e.Apply(plan, pmsop.Event{Type: "task.delete", TaskID: "ds-1", Actor: "a", Now: fixedNow}); err == nil {
		t.Fatal("expected error for unknown event type")
	}
}

func findTask(p pmsop.Plan, id string) pmsop.PlanTask {
	for _, s := range p.Stages {
		for _, t := range s.Tasks {
			if t.ID == id {
				return t
			}
		}
	}
	return pmsop.PlanTask{}
}

func taskAt(p pmsop.Plan, id string) pmsop.PlanTask { return findTask(p, id) }