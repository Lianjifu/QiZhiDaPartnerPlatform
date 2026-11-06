package copilot

import "testing"

func TestHandoffTriggersParsesBoundaryPolicy(t *testing.T) {
	emp := map[string]any{
		"boundaryPolicy": map[string]any{
			"handoff": map[string]any{
				"triggers":  []any{"prohibited_action", "tool_failure"},
				"approvers": []any{"运营负责人"},
			},
		},
	}
	got := handoffTriggers(emp)
	if len(got) != 2 || !got["prohibited_action"] || !got["tool_failure"] {
		t.Fatalf("triggers=%#v", got)
	}
	if !escalationEnabled(emp) {
		t.Fatal("expected escalation enabled")
	}

	// No handoff configuration → automatic escalation stays off.
	if escalationEnabled(map[string]any{}) {
		t.Fatal("expected escalation disabled for unconfigured partner")
	}
	if len(handoffTriggers(map[string]any{"boundaryPolicy": map[string]any{}})) != 0 {
		t.Fatal("expected no triggers")
	}
}

// TestMaybeEscalateOnlyFiresForConfiguredTriggers guards the "配置即承诺"
// contract: a partner that never configured a handoff trigger must never be
// escalated automatically.
func TestMaybeEscalateOnlyFiresForConfiguredTriggers(t *testing.T) {
	svc := &Service{}
	calls := 0
	svc.Deps.Escalation.EscalateFn = func(in EscalationInput) (map[string]any, error) {
		calls++
		return map[string]any{"escalated": true, "ownerName": "运营负责人"}, nil
	}

	in := reactTurnInput{WorkspaceID: "w1", ConversationID: "conv-1", Employee: map[string]any{}}

	// Trigger not configured → no escalation.
	if svc.maybeEscalate(in, escalateTriggerProhibited, "越权", "shell.exec") {
		t.Fatal("escalated without configured trigger")
	}
	if calls != 0 {
		t.Fatalf("escalate fn called %d times", calls)
	}

	// Trigger configured but different one → no escalation.
	in.Employee = map[string]any{"boundaryPolicy": map[string]any{
		"handoff": map[string]any{"triggers": []any{"tool_failure"}},
	}}
	if svc.maybeEscalate(in, escalateTriggerProhibited, "越权", "shell.exec") {
		t.Fatal("escalated on unlisted trigger")
	}

	// Trigger configured → escalation fires.
	in.Employee = map[string]any{"boundaryPolicy": map[string]any{
		"handoff": map[string]any{"triggers": []any{"prohibited_action"}},
	}}
	if !svc.maybeEscalate(in, escalateTriggerProhibited, "越权", "shell.exec") {
		t.Fatal("expected escalation")
	}
	if calls != 1 {
		t.Fatalf("escalate fn called %d times, want 1", calls)
	}
}

// TestMaybeEscalateNoopWhenNotWired keeps the copilot side nil-safe: an
// unwired EscalateFn must not panic and must not claim an escalation.
func TestMaybeEscalateNoopWhenNotWired(t *testing.T) {
	svc := &Service{}
	in := reactTurnInput{Employee: map[string]any{"boundaryPolicy": map[string]any{
		"handoff": map[string]any{"triggers": []any{"prohibited_action"}},
	}}}
	if svc.maybeEscalate(in, escalateTriggerProhibited, "越权", "shell.exec") {
		t.Fatal("expected no escalation when unwired")
	}
}

// TestPendingTodosPromptInjectsOpenTodos covers the P4 todo feedback loop:
// the todos the partner wrote earlier come back into the next turn's system
// prompt, and finished ones drop out.
func TestPendingTodosPromptInjectsOpenTodos(t *testing.T) {
	svc := &Service{}
	svc.Deps.Tools.PendingTodosFn = func(convID string) []map[string]any {
		return []map[string]any{
			{"id": "todo-1", "content": "查 Redis 延迟", "status": "pending"},
			{"id": "todo-2", "content": "写复盘", "status": "in_progress"},
			{"id": "todo-3", "content": "已完成的事", "status": "done"},
		}
	}
	prompt := svc.pendingTodosPrompt("conv-1")
	if prompt == "" {
		t.Fatal("expected todos in prompt")
	}
	if !contains(prompt, "查 Redis 延迟") || !contains(prompt, "写复盘") {
		t.Fatalf("open todos missing: %q", prompt)
	}
	if contains(prompt, "已完成的事") {
		t.Fatalf("done todo must not be pushed: %q", prompt)
	}

	// 无待办时不应产生噪声段落。
	svc.Deps.Tools.PendingTodosFn = func(convID string) []map[string]any { return nil }
	if p := svc.pendingTodosPrompt("conv-1"); p != "" {
		t.Fatalf("expected empty prompt, got %q", p)
	}
}

func contains(hay, needle string) bool {
	return len(hay) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(hay); i++ {
			if hay[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
