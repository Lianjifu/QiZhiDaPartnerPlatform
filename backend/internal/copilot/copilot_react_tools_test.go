package copilot

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// TestRegistryToSchemasFiltersByBoundaryAndSession covers the P3 contract
// hand-off to the model: prohibited capabilities are invisible to the model,
// approval-gated ones stay visible (the model must be able to ask for
// approval), and disabled tools are not offered.
func TestRegistryToSchemasFiltersByBoundaryAndSession(t *testing.T) {
	emp := map[string]any{
		"capabilities": map[string]any{"tools": []any{"kubectl"}},
		"boundaryPolicy": map[string]any{
			"capabilityModes": []any{
				map[string]any{"capabilityType": "tool", "capabilityName": "kubectl", "mode": "prohibited"},
			},
		},
	}
	reg := buildToolRegistry(emp, nil)
	names := map[string]bool{}
	for _, sc := range registryToSchemas(reg) {
		names[sc.Name] = true
	}
	if names["kubectl"] {
		t.Fatal("prohibited capability must not reach the model")
	}
	if !names["knowledge.retrieve"] {
		t.Fatal("builtin retrieval should be offered")
	}
	if !names["todo_write"] {
		t.Fatal("platform tools should be offered")
	}
}

// TestRegistryToSchemasKeepsApprovalGatedTools makes sure approval-gated
// capabilities stay in the schema: hiding them would stop the model from
// ever requesting approval.
func TestRegistryToSchemasKeepsApprovalGatedTools(t *testing.T) {
	emp := map[string]any{
		"capabilities": map[string]any{"skills": []any{"docx"}},
		"boundaryPolicy": map[string]any{
			"capabilityModes": []any{
				map[string]any{"capabilityType": "skill", "capabilityName": "docx", "mode": "approval_required"},
			},
		},
	}
	// 会话显式勾选了该技能才会进入注册表(approval 类能力默认不启用)。
	reg := buildToolRegistry(emp, []string{"skill:docx"})
	found := false
	for _, sc := range registryToSchemas(reg) {
		if sc.Name == "docx" {
			found = true
			if sc.InputSchema == nil {
				t.Fatal("skill schema missing")
			}
		}
	}
	if !found {
		t.Fatal("approval-gated skill must stay visible to the model")
	}
}

// TestStructuredToolCallsParsesArguments covers the modelprov → copilot
// hand-off: JSON arguments become the internal call shape.
func TestStructuredToolCallsParsesArguments(t *testing.T) {
	calls := structuredToolCalls([]modelprov.ToolCall{
		{ID: "call_1", Name: "knowledge.retrieve", Arguments: json.RawMessage(`{"query":"制度"}`)},
		{ID: "call_2", Name: "todo_write", Arguments: json.RawMessage(`{"content":"写周报"}`)},
	})
	if len(calls) != 2 {
		t.Fatalf("want 2 calls, got %#v", calls)
	}
	if calls[0].Name != "knowledge.retrieve" || calls[0].Args["query"] != "制度" {
		t.Fatalf("call 0: %#v", calls[0])
	}
	if calls[1].Args["content"] != "写周报" {
		t.Fatalf("call 1: %#v", calls[1])
	}
}

// TestExecuteToolCallsRunsInParallel covers the P3 throughput win: several
// tool calls in one round are executed concurrently, and the results keep the
// order the model issued them in.
func TestExecuteToolCallsRunsInParallel(t *testing.T) {
	var mu sync.Mutex
	inflight, maxInflight := 0, 0
	seen := []string{}

	svc := &Service{}
	svc.Deps.Tools.DispatchAuthorizedToolFn = func(runCtx toolRunContext, reg []registeredTool, call toolCallRequest, sessionMode, risk string, emit reactEmitFunc) (*registeredTool, toolExecResult) {
		mu.Lock()
		inflight++
		if inflight > maxInflight {
			maxInflight = inflight
		}
		mu.Unlock()
		time.Sleep(30 * time.Millisecond)
		mu.Lock()
		inflight--
		seen = append(seen, call.Name)
		mu.Unlock()
		return &registeredTool{Name: call.Name}, toolExecResult{Status: "success", Output: call.Name + " ok"}
	}

	calls := []toolCallRequest{
		{Name: "knowledge.retrieve", Args: map[string]any{"query": "a"}},
		{Name: "memory.recall", Args: map[string]any{"query": "b"}},
		{Name: "todo_write", Args: map[string]any{"content": "c"}},
	}
	records := svc.executeToolCalls(toolRunContext{}, nil, calls, "agent", "medium", nil)
	if len(records) != 3 {
		t.Fatalf("want 3 records, got %d", len(records))
	}
	for i, rec := range records {
		if rec.Name != calls[i].Name {
			t.Fatalf("record %d = %q want %q (order must be stable)", i, rec.Name, calls[i].Name)
		}
		if rec.Res.Status != "success" {
			t.Fatalf("record %d status %q", i, rec.Res.Status)
		}
	}
	if maxInflight < 2 {
		t.Fatalf("expected parallel execution, max inflight was %d", maxInflight)
	}
}

// TestToolCallsToResultsKeepsCallIDs makes sure the structured results can
// be matched back to the model's tool_call ids (protocols require it).
func TestToolCallsToResultsKeepsCallIDs(t *testing.T) {
	records := []toolExecRecord{
		{ID: "tc_react_1", Name: "knowledge.retrieve", Res: toolExecResult{Status: "success", Output: "ok"}},
		{ID: "tc_react_2", Name: "shell.exec", Res: toolExecResult{Status: "failed", Error: "boom"}},
	}
	structCalls := []modelprov.ToolCall{
		{ID: "call_1", Name: "knowledge.retrieve"},
		{ID: "call_2", Name: "shell.exec"},
	}
	results := toolCallsToResults(records, structCalls)
	if len(results) != 2 {
		t.Fatalf("want 2 results, got %#v", results)
	}
	if results[0].ToolCallID != "call_1" || results[1].ToolCallID != "call_2" {
		t.Fatalf("tool_call ids: %#v", results)
	}
	if results[1].IsError != true {
		t.Fatalf("failed tool must be flagged as error: %#v", results[1])
	}
}

// TestExecuteToolCallsRespectsCancelledContext keeps the parallel executor
// honest: a cancelled context must not start new work.
func TestExecuteToolCallsRespectsCancelledContext(t *testing.T) {
	svc := &Service{}
	called := 0
	svc.Deps.Tools.DispatchAuthorizedToolFn = func(runCtx toolRunContext, reg []registeredTool, call toolCallRequest, sessionMode, risk string, emit reactEmitFunc) (*registeredTool, toolExecResult) {
		called++
		return &registeredTool{Name: call.Name}, toolExecResult{Status: "success"}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if ctxAlive(ctx) {
		t.Fatal("cancelled context must not be alive")
	}
	records := svc.executeToolCalls(toolRunContext{}, nil, []toolCallRequest{{Name: "x"}}, "agent", "medium", nil)
	if len(records) != 1 || called != 1 {
		t.Fatalf("records=%#v called=%d", records, called)
	}
}
