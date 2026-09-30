package server

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/auth"
)

func TestBuildControlledTaskDispatchAssist(t *testing.T) {
	actor := &auth.Identity{ID: "u1", Name: "管理员", Role: "admin"}
	item := buildControlledTask(func(p string) string { return p + "-1" }, "w1", map[string]any{
		"title": "跨部协办", "dispatchKind": "assist", "assignee": "李婷",
		"digitalPartnerId": "de-it", "collaboratorIds": []any{"de-it"},
	}, actor)
	if str(item["source"]) != "dispatch" {
		t.Fatalf("source=%v", item["source"])
	}
	if str(item["lifecycleStage"]) != stageHumanAction {
		t.Fatalf("stage=%v", item["lifecycleStage"])
	}
	gov, _ := item["governance"].(map[string]any)
	if str(gov["approvalStatus"]) != "pending" {
		t.Fatalf("gov=%v", gov)
	}
}

func TestLifecycleApprovalGate(t *testing.T) {
	actor := &auth.Identity{ID: "u1", Name: "管理员", Role: "admin"}
	task := map[string]any{
		"lifecycleStage": stageHumanAction, "status": "review",
		"governance": map[string]any{"approvalRequired": true, "approvalStatus": "pending"},
		"sla":        map[string]any{"risk": "none"},
		"execution":  map[string]any{"retryCount": 0, "paused": false},
		"links":      map[string]any{}, "auditEvents": []map[string]any{}, "version": 0,
	}
	if err := applyLifecycleTransition(task, stageRunning, actor); err == nil {
		t.Fatal("expected approval gate")
	}
	applyTaskApprove(task, true, "ok", actor)
	if err := applyLifecycleTransition(task, stageRunning, actor); err != nil {
		t.Fatal(err)
	}
}

func TestApproveRejectAssist(t *testing.T) {
	actor := &auth.Identity{ID: "u1", Name: "管理员", Role: "admin"}
	task := map[string]any{
		"dispatchKind": "assist", "lifecycleStage": stageHumanAction, "status": "review",
		"governance": map[string]any{"approvalRequired": true, "approvalStatus": "pending"},
		"execution":  map[string]any{"retryCount": 0, "paused": false},
		"sla":        map[string]any{"risk": "none"},
		"links":      map[string]any{}, "auditEvents": []map[string]any{}, "version": 0,
	}
	applyTaskApprove(task, false, "没空", actor)
	if str(task["assistStatus"]) != "rejected" {
		t.Fatalf("assist=%v", task["assistStatus"])
	}
	gov, _ := task["governance"].(map[string]any)
	if str(gov["approvalStatus"]) != "rejected" {
		t.Fatalf("gov=%v", gov)
	}
}

func TestRetryGateAndTakeover(t *testing.T) {
	actor := &auth.Identity{ID: "u1", Name: "管理员", Role: "admin"}
	task := map[string]any{
		"lifecycleStage": stagePending, "status": "pending",
		"sla": map[string]any{"risk": "none"}, "execution": map[string]any{"retryCount": 0, "paused": false},
		"governance": map[string]any{"approvalRequired": false, "approvalStatus": "not_required"},
		"links":      map[string]any{}, "auditEvents": []map[string]any{}, "version": 0,
	}
	if err := applyTaskRetry(task, "x", actor); err == nil {
		t.Fatal("expected retry gate")
	}
	task["lifecycleStage"] = stageRisk
	task["sla"] = map[string]any{"risk": "failed"}
	if err := applyTaskRetry(task, "retry", actor); err != nil {
		t.Fatal(err)
	}
	if str(task["lifecycleStage"]) != stageRunning {
		t.Fatalf("stage=%v", task["lifecycleStage"])
	}
	applyTaskTakeover(task, "人工", actor)
	gov, _ := task["governance"].(map[string]any)
	if str(gov["takeoverBy"]) != "管理员" {
		t.Fatalf("takeover=%v", gov)
	}
}

func TestTaskVersionConflict(t *testing.T) {
	task := map[string]any{"version": 2}
	if err := checkTaskVersion(task, map[string]any{"version": 1}); err == nil {
		t.Fatal("expected conflict")
	}
	if err := checkTaskVersion(task, map[string]any{"version": 2}); err != nil {
		t.Fatal(err)
	}
}

func TestTaskVisibleToUser(t *testing.T) {
	task := map[string]any{"ownerId": "u2", "assignee": "业务构建者", "createdBy": "u2"}
	user := &auth.Identity{ID: "u2", Name: "业务构建者", Role: "user"}
	other := &auth.Identity{ID: "u9", Name: "路人", Role: "user"}
	if !taskVisibleToUser(task, user) {
		t.Fatal("owner should see")
	}
	if taskVisibleToUser(task, other) {
		t.Fatal("other should not see")
	}
	admin := &auth.Identity{ID: "u1", Name: "管理员", Role: "admin"}
	if !taskVisibleToUser(task, admin) {
		t.Fatal("admin should see")
	}
}

func TestParseAuditNotPlaceholder(t *testing.T) {
	task := map[string]any{"auditEvents": []map[string]any{}, "version": 0, "links": map[string]any{}}
	appendTaskAuditLocked(task, "管理员", "创建任务", "demo", "success")
	evs := taskAuditEvents(task)
	if len(evs) != 1 || str(evs[0]["action"]) == "查看审计" {
		t.Fatalf("evs=%v", evs)
	}
	if toInt(task["version"]) != 1 {
		t.Fatalf("version=%v", task["version"])
	}
}

func TestConversationLinksInBuild(t *testing.T) {
	actor := &auth.Identity{ID: "u1", Name: "管理员", Role: "admin"}
	item := buildControlledTask(func(p string) string { return "x" }, "w1", map[string]any{
		"title": "派生", "source": "conversation", "conversationId": "conv-1",
	}, actor)
	links, _ := item["links"].(map[string]any)
	if str(links["conversationId"]) != "conv-1" {
		t.Fatalf("links=%v", links)
	}
}
