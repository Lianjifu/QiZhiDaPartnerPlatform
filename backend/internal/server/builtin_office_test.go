package server

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestEnsureBuiltinKnowledgeReady_OfficePacks(t *testing.T) {
	st := store.NewDemo()
	srv := New(st)
	srv.EnsureBuiltinKnowledgeReady()

	st.RLock()
	defer st.RUnlock()
	packages, _ := st.KnowledgeExtra["packages"].([]map[string]any)
	found := map[string]bool{}
	for _, p := range packages {
		id := str(p["id"])
		if str(p["source"]) == "platform" || p["builtin"] == true {
			found[id] = true
		}
	}
	for _, want := range []string{
		"kp.office.handbook", "kp.office.meeting", "kp.office.writing",
		"kp.office.leave_travel", "kp.office.expense_lite", "kp.office.it_selfservice",
	} {
		if !found[want] {
			t.Fatalf("missing knowledge pack %s", want)
		}
	}
	docCount := 0
	for _, d := range st.KnowledgeDocs {
		if str(d["packageId"]) == "kp.office.handbook" {
			docCount++
		}
	}
	if docCount < 1 {
		t.Fatal("handbook docs not seeded")
	}
}

func TestEnsureBuiltinWorkflowsReady_IncludesOffice(t *testing.T) {
	st := store.NewDemo()
	srv := New(st)
	srv.EnsureBuiltinWorkflowsReady()
	st.RLock()
	defer st.RUnlock()
	found := false
	for _, item := range st.WorkflowTpls {
		if str(item["id"]) == "wf.office.meeting_minutes" {
			found = true
			if str(item["department"]) != "office" {
				t.Fatalf("department=%v", item["department"])
			}
		}
	}
	if !found {
		t.Fatal("office workflow missing")
	}
}

func TestEnsureOfficeEmployee(t *testing.T) {
	st := store.NewDemo()
	st.EnsureOfficeEmployee()
	st.RLock()
	defer st.RUnlock()
	var emp map[string]any
	for _, e := range st.Employees {
		if str(e["id"]) == "de-office" {
			emp = e
			break
		}
	}
	if emp == nil {
		t.Fatal("de-office missing")
	}
	caps, _ := emp["capabilities"].(map[string]any)
	skills, _ := caps["skills"].([]string)
	if len(skills) < 4 {
		// may be []any after map roundtrip
		if raw, ok := caps["skills"].([]any); !ok || len(raw) < 4 {
			t.Fatalf("office skills too few: %#v", caps["skills"])
		}
	}
	rt, _ := emp["runtime"].(map[string]any)
	if str(rt["replyMode"]) != "segmented" {
		t.Fatalf("de-office replyMode=%v want segmented", rt["replyMode"])
	}
}
