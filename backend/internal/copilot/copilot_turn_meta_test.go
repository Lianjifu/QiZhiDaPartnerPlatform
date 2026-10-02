package copilot

import (
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

func TestInferNarrativePhase(t *testing.T) {
	if inferNarrativePhase("framework", "") != turnPhaseUnderstand {
		t.Fatal("framework -> understand")
	}
	if inferNarrativePhase("tool_call", "") != turnPhaseExecute {
		t.Fatal("tool_call -> execute")
	}
	if inferNarrativePhase("analyze", "调用 knowledge.retrieve") != turnPhaseExecute {
		t.Fatal("tool analyze -> execute")
	}
}

func TestTurnNarrativeCollector_Snapshot(t *testing.T) {
	c := newTurnNarrativeCollector()
	c.Record(contract.StreamThought, "thought", map[string]any{
		"phase": turnPhaseUnderstand, "kind": "plan", "title": "理解任务",
	})
	c.Record(contract.StreamThought, "thought", map[string]any{
		"phase": turnPhaseExecute, "kind": "tool_call", "title": "调用检索",
	})
	c.Record(contract.StreamTask, "task", map[string]any{
		"taskId": "t1", "title": "梳理方案", "action": "added",
	})
	d := cognitiveDecision{Enabled: true, Primary: cognitiveProblem, Mode: cognitiveModeStandard}
	meta := c.Snapshot(d, modeReact, 3200)
	if str(meta["narrative"]) != "standard" {
		t.Fatalf("narrative=%v", meta["narrative"])
	}
	summary := str(meta["summary"])
	if !strings.Contains(summary, "已思考") || !strings.Contains(summary, "问题解决") {
		t.Fatalf("summary=%q", summary)
	}
	phases, ok := meta["phases"].([]map[string]any)
	if !ok {
		t.Fatalf("phases type %T", meta["phases"])
	}
	if len(phases) < 2 {
		t.Fatalf("phases=%d", len(phases))
	}
	tasks, ok := meta["tasks"].([]map[string]any)
	if !ok || len(tasks) != 1 {
		t.Fatalf("tasks=%v", meta["tasks"])
	}
}

func TestTurnNarrativeCollector_UpsertsTasksByID(t *testing.T) {
	c := newTurnNarrativeCollector()
	c.Record(contract.StreamTask, "task", map[string]any{
		"taskId": "plan_3", "title": "生成 PPT", "action": "added",
	})
	c.Record(contract.StreamTask, "task", map[string]any{
		"taskId": "plan_3", "title": "生成 PPT", "action": "started",
	})
	c.Record(contract.StreamTask, "task", map[string]any{
		"taskId": "plan_3", "title": "生成 PPT", "action": "completed", "detail": "success",
	})
	c.Record(contract.StreamTask, "task", map[string]any{
		"taskId": "plan_4", "title": "上传产物", "action": "added",
	})
	meta := c.Snapshot(cognitiveDecision{Enabled: true}, modePlanExec, 1000)
	tasks, ok := meta["tasks"].([]map[string]any)
	if !ok || len(tasks) != 2 {
		t.Fatalf("want 2 unique tasks, got %v", meta["tasks"])
	}
	if str(tasks[0]["id"]) != "plan_3" || str(tasks[0]["status"]) != "done" {
		t.Fatalf("plan_3=%v", tasks[0])
	}
	if str(tasks[0]["detail"]) != "success" {
		t.Fatalf("detail should persist, got %v", tasks[0]["detail"])
	}
}

func TestEmitThoughtPhase_Dedup(t *testing.T) {
	var payloads []map[string]any
	emit := func(_ string, _ string, extra map[string]any) {
		payloads = append(payloads, extra)
	}
	emitThought(emit, "plan", turnPhaseUnderstand, "理解任务：测试", "")
	emitThought(emit, "plan", turnPhaseUnderstand, "理解任务：测试", "")
	if len(payloads) != 1 {
		t.Fatalf("expected dedup, got %d", len(payloads))
	}
}

func TestThoughtForToolResult(t *testing.T) {
	title, _ := thoughtForToolResult("success", "knowledge.retrieve")
	if !strings.Contains(title, "完成") {
		t.Fatalf("title=%q", title)
	}
	title, _ = thoughtForToolResult("pending_authorization", "bash")
	if !strings.Contains(title, "审批") {
		t.Fatalf("title=%q", title)
	}
}

func TestEmployeeShowNarrative(t *testing.T) {
	if !employeeShowNarrative(nil) {
		t.Fatal("default true")
	}
	emp := map[string]any{
		"capabilities": map[string]any{
			"cognitive": map[string]any{"showNarrative": false},
		},
	}
	if employeeShowNarrative(emp) {
		t.Fatal("expected false")
	}
}
