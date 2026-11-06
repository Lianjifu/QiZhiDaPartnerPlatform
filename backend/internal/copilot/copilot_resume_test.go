package copilot

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestResumeTurnExecutesApprovedAction covers the P6 happy path: an approved
// tool actually runs and its result is fed back to the model, so the same
// partner continues the same job.
func TestResumeTurnExecutesApprovedAction(t *testing.T) {
	svc := &Service{Store: store.New()}
	var seenMessages []modelprov.ChatMessage
	svc.Deps.Routing.StreamLLMForCopilotFn = func(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, opts LLMCallOptions, onDelta func(text, resolvedModelID string) error) (string, []modelprov.ToolCall, ResolvedTurn, error) {
		seenMessages = messages
		return "已按审批结果完成检索", nil, ResolvedTurn{ModelID: "m"}, nil
	}

	res := svc.ResumeTurn(context.Background(), ResumeInput{
		WorkspaceID: "w1", ConversationID: "conv-1", CorrelationID: "corr-1",
		Actions: []PendingAction{{
			ID: "act-1", ToolName: "knowledge.retrieve", ToolKey: "builtin:knowledge.retrieve",
			Args: map[string]any{"query": "制度"}, Status: "approved", DecidedBy: "管理员",
		}},
	})
	if len(res.Executed) != 1 || res.Executed[0] != "knowledge.retrieve" {
		t.Fatalf("approved action not executed: %#v", res)
	}
	if !strings.Contains(res.Text, "完成检索") {
		t.Fatalf("text=%q", res.Text)
	}
	joined := ""
	for _, m := range seenMessages {
		joined += m.Content + "\n"
	}
	if !strings.Contains(joined, "审批通过") {
		t.Fatalf("approval result not fed back: %q", joined)
	}
}

// TestResumeTurnFeedsRejectionBack makes sure a rejected action is reported
// to the model instead of being silently dropped.
func TestResumeTurnFeedsRejectionBack(t *testing.T) {
	svc := &Service{Store: store.New()}
	var seenMessages []modelprov.ChatMessage
	svc.Deps.Routing.StreamLLMForCopilotFn = func(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, opts LLMCallOptions, onDelta func(text, resolvedModelID string) error) (string, []modelprov.ToolCall, ResolvedTurn, error) {
		seenMessages = messages
		return "了解,不再重复申请", nil, ResolvedTurn{ModelID: "m"}, nil
	}
	res := svc.ResumeTurn(context.Background(), ResumeInput{
		WorkspaceID: "w1", ConversationID: "conv-1", CorrelationID: "corr-1",
		Actions: []PendingAction{{
			ID: "act-2", ToolName: "shell.exec", Status: "rejected", Note: "生产环境禁止该命令",
		}},
	})
	if len(res.Rejected) != 1 {
		t.Fatalf("rejection not recorded: %#v", res)
	}
	joined := ""
	for _, m := range seenMessages {
		joined += m.Content + "\n"
	}
	if !strings.Contains(joined, "生产环境禁止该命令") {
		t.Fatalf("rejection reason not fed back: %q", joined)
	}
}

// TestResumeTurnWithoutActionsIsNoop keeps the endpoint honest.
func TestResumeTurnWithoutActionsIsNoop(t *testing.T) {
	svc := &Service{Store: store.New()}
	res := svc.ResumeTurn(context.Background(), ResumeInput{WorkspaceID: "w1"})
	if res.Text == "" {
		t.Fatalf("expected an explanatory text, got %#v", res)
	}
}
