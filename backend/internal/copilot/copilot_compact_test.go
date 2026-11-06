package copilot

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// TestCompactConversationHistoryKeepsShortHistoryUntouched makes sure the
// compaction never touches a conversation that is still short enough.
func TestCompactConversationHistoryKeepsShortHistoryUntouched(t *testing.T) {
	svc := &Service{}
	stored := make([]map[string]any, 0, 10)
	for i := 0; i < 10; i++ {
		stored = append(stored, map[string]any{"role": "user", "content": "消息"})
	}
	out, info := svc.CompactConversationHistory(context.Background(), nil, "w1", "conv-1", "m", "corr-1", stored)
	if len(out) != len(stored) {
		t.Fatalf("history was modified: %d → %d", len(stored), len(out))
	}
	if compacted, _ := info["compacted"].(bool); compacted {
		t.Fatalf("unexpected compaction: %#v", info)
	}
}

// TestCompactConversationHistorySummarizesOldTurns covers the P4 behaviour:
// a long history is compressed into a summary plus the recent turns, and the
// summary keeps the original goal (which the plain window would have dropped).
func TestCompactConversationHistorySummarizesOldTurns(t *testing.T) {
	svc := &Service{}
	stored := make([]map[string]any, 0, 60)
	stored = append(stored, map[string]any{"role": "user", "content": "最初的约束:只读排查,不要改配置"})
	for i := 0; i < 50; i++ {
		stored = append(stored, map[string]any{"role": "assistant", "content": "中间过程"})
	}
	stored = append(stored, map[string]any{"role": "user", "content": "继续"})

	out, info := svc.CompactConversationHistory(context.Background(), nil, "w1", "conv-1", "m", "corr-1", stored)
	if compacted, _ := info["compacted"].(bool); !compacted {
		t.Fatalf("expected compaction: %#v", info)
	}
	if len(out) != compactKeepMessages+1 {
		t.Fatalf("want %d compacted messages, got %d", compactKeepMessages+1, len(out))
	}
	head := str(out[0]["content"])
	if !strings.Contains(head, "最初的约束") {
		t.Fatalf("summary lost the original constraint: %q", head)
	}
	// The most recent turn must survive verbatim.
	if str(out[len(out)-1]["content"]) != "继续" {
		t.Fatalf("recent turn lost: %#v", out[len(out)-1])
	}
}

// TestCompactConversationHistoryUsesModelSummary checks the model-backed path:
// when the model answers, its summary is used instead of the deterministic one.
func TestCompactConversationHistoryUsesModelSummary(t *testing.T) {
	svc := &Service{}
	svc.Deps.Routing.StreamLLMForCopilotFn = func(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, opts LLMCallOptions, onDelta func(text, resolvedModelID string) error) (string, []modelprov.ToolCall, ResolvedTurn, error) {
		return "摘要:目标是排查 Redis 延迟", nil, ResolvedTurn{ModelID: "m"}, nil
	}
	stored := make([]map[string]any, 0, 60)
	for i := 0; i < 60; i++ {
		stored = append(stored, map[string]any{"role": "user", "content": "闲聊"})
	}
	out, info := svc.CompactConversationHistory(context.Background(), nil, "w1", "conv-1", "m", "corr-1", stored)
	if compacted, _ := info["compacted"].(bool); !compacted {
		t.Fatalf("expected compaction: %#v", info)
	}
	if !strings.Contains(str(out[0]["content"]), "Redis 延迟") {
		t.Fatalf("model summary not used: %q", str(out[0]["content"]))
	}
}

// TestCompactConversationHistoryFallsBackWhenModelFails makes sure a failing
// model never costs us the context: the deterministic digest takes over.
func TestCompactConversationHistoryFallsBackWhenModelFails(t *testing.T) {
	svc := &Service{}
	svc.Deps.Routing.StreamLLMForCopilotFn = func(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, opts LLMCallOptions, onDelta func(text, resolvedModelID string) error) (string, []modelprov.ToolCall, ResolvedTurn, error) {
		return "", nil, ResolvedTurn{}, context.DeadlineExceeded
	}
	stored := make([]map[string]any, 0, 60)
	for i := 0; i < 60; i++ {
		stored = append(stored, map[string]any{"role": "user", "content": "关键约束内容"})
	}
	out, _ := svc.CompactConversationHistory(context.Background(), nil, "w1", "conv-1", "m", "corr-1", stored)
	if !strings.Contains(str(out[0]["content"]), "关键约束内容") {
		t.Fatalf("fallback digest lost content: %q", str(out[0]["content"]))
	}
}
