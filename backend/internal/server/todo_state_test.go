package server

import (
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestRuntimeTodoWriteStateMachine covers the P4 todo state machine:
// a todo is created once and then moved through pending → in_progress → done
// by id, instead of piling up duplicates on every round.
func TestRuntimeTodoWriteStateMachine(t *testing.T) {
	st := store.New()
	srv := New(st)
	ctx := toolRunContext{ConversationID: "conv-1"}
	started := time.Now()

	res := srv.runtimeTodoWrite(ctx, toolCallRequest{Args: map[string]any{
		"todos": []any{map[string]any{"content": "查 Redis 延迟"}},
	}}, started)
	if res.Status != "success" {
		t.Fatalf("write: %#v", res)
	}

	todos := srv.pendingTodosFor("conv-1")
	if len(todos) != 1 {
		t.Fatalf("want 1 todo, got %#v", todos)
	}
	id := str(todos[0]["id"])
	if id == "" {
		t.Fatalf("todo id missing: %#v", todos[0])
	}
	if str(todos[0]["status"]) != "pending" {
		t.Fatalf("initial status: %#v", todos[0])
	}

	// 状态迁移:同一个 id 改状态,不应该新增条目。
	srv.runtimeTodoWrite(ctx, toolCallRequest{Args: map[string]any{
		"todos": []any{map[string]any{"id": id, "status": "in_progress"}},
	}}, started)
	todos = srv.pendingTodosFor("conv-1")
	if len(todos) != 1 {
		t.Fatalf("state transition must not duplicate todos: %#v", todos)
	}
	if str(todos[0]["status"]) != "in_progress" {
		t.Fatalf("status after transition: %#v", todos[0])
	}

	srv.runtimeTodoWrite(ctx, toolCallRequest{Args: map[string]any{
		"todos": []any{map[string]any{"id": id, "status": "done"}},
	}}, started)
	todos = srv.pendingTodosFor("conv-1")
	if len(todos) != 1 || str(todos[0]["status"]) != "done" {
		t.Fatalf("final status: %#v", todos)
	}
}

// TestRuntimeTodoWriteMergeFalseClearsList keeps the original replace
// semantics intact.
func TestRuntimeTodoWriteMergeFalseClearsList(t *testing.T) {
	st := store.New()
	srv := New(st)
	ctx := toolRunContext{ConversationID: "conv-2"}
	started := time.Now()

	srv.runtimeTodoWrite(ctx, toolCallRequest{Args: map[string]any{
		"todos": []any{map[string]any{"content": "第一条"}},
	}}, started)
	srv.runtimeTodoWrite(ctx, toolCallRequest{Args: map[string]any{
		"merge": false,
		"todos": []any{map[string]any{"content": "第二条"}},
	}}, started)
	todos := srv.pendingTodosFor("conv-2")
	if len(todos) != 1 || str(todos[0]["content"]) != "第二条" {
		t.Fatalf("merge=false must replace the list: %#v", todos)
	}
}

// TestNormalizeTodoStatus covers the status vocabulary.
func TestNormalizeTodoStatus(t *testing.T) {
	cases := map[string]string{
		"pending":     "pending",
		"":            "pending",
		"todo":        "pending",
		"in_progress": "in_progress",
		"doing":       "in_progress",
		"done":        "done",
		"completed":   "done",
		"weird":       "pending",
	}
	for in, want := range cases {
		if got := normalizeTodoStatus(in); got != want {
			t.Fatalf("normalizeTodoStatus(%q)=%q want %q", in, got, want)
		}
	}
}
