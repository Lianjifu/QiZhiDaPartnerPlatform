package server

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestCaptureEmployeeBindingFreezesPublishedVersions(t *testing.T) {
	knowledge := []string{"kb-ops"}
	emp := map[string]any{
		"id": "de-1",
		"capabilities": map[string]any{
			"model":        "企业通用路由 v2",
			"modelRouteId": "rp-p0",
			"knowledge":    knowledge,
			"skills":       []string{"docx"},
			"channels":     []string{"web"},
		},
	}
	got := captureEmployeeBinding(emp, "w1")
	if str(got["partnerId"]) != "de-1" || str(got["modelRouteId"]) != "rp-p0" {
		t.Fatalf("%#v", got)
	}
	if str(got["modelId"]) != "rp-p0" {
		t.Fatalf("modelId should prefer route id: %#v", got)
	}
	if got["frozen"] != true {
		t.Fatal("expected frozen")
	}
	ids, _ := got["knowledgeIds"].([]string)
	if len(ids) != 1 || ids[0] != "kb-ops" {
		t.Fatalf("knowledge %#v", got["knowledgeIds"])
	}
	knowledge[0] = "mutated"
	if ids[0] != "kb-ops" {
		t.Fatal("binding must copy knowledge ids")
	}
}

func TestEmployeeBindingFrozenOnSnapshotLookup(t *testing.T) {
	st := store.New()
	srv := New(st)
	emp := map[string]any{
		"id":           "de-freeze",
		"capabilities": map[string]any{"model": "frozen-route-v1"},
	}
	rec := copilot.BuildContextSnapshotRecord(map[string]any{
		"id": "snap-bind", "workspaceId": "w1", "conversationId": "conv-bind",
		"correlationId": "corr-bind-1", "partnerId": "de-freeze",
		"employeeBinding": captureEmployeeBinding(emp, "w1"),
	})
	srv.CopSvc.PersistContextSnapshot(rec)
	emp["capabilities"].(map[string]any)["model"] = "mutated-later"
	got := srv.CopSvc.LookupContextSnapshot("w1", "conv-bind", "corr-bind-1")
	if got == nil {
		t.Fatal("missing snapshot")
	}
	b, _ := got["employeeBinding"].(map[string]any)
	if str(b["modelId"]) != "frozen-route-v1" {
		t.Fatalf("want frozen model, got %#v", b)
	}
}
