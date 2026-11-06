package copilot

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestDelegationPolicyDefaultsToDisabled covers the P5 safety default: a
// partner that never configured delegationPolicy cannot spawn sub-agents.
func TestDelegationPolicyDefaultsToDisabled(t *testing.T) {
	p := delegationPolicyFor(map[string]any{})
	if p.Enabled {
		t.Fatal("delegation must be disabled by default")
	}
	if delegationEnabled(map[string]any{}) {
		t.Fatal("delegationEnabled must be false without policy")
	}
	p2 := delegationPolicyFor(map[string]any{"delegationPolicy": map[string]any{
		"enabled": true, "maxDepth": 3, "maxConcurrent": 2,
		"inheritCapabilities": []any{"knowledge.retrieve"},
		"allowedTargets":      []any{"de-2"},
	}})
	if !p2.Enabled {
		t.Fatal("policy not parsed")
	}
	if p2.MaxDepth != delegationMaxDepth {
		t.Fatalf("maxDepth must be capped at %d, got %d", delegationMaxDepth, p2.MaxDepth)
	}
	if p2.MaxConcurrent != 2 || len(p2.InheritCapabilities) != 1 || len(p2.AllowedTargets) != 1 {
		t.Fatalf("policy parse: %#v", p2)
	}
}

// TestFilterDelegationRegistryRemovesAgentTool is the depth guard: a child
// can never delegate again.
func TestFilterDelegationRegistryRemovesAgentTool(t *testing.T) {
	// "agent" 只有在伙伴显式装配时才会进注册表。
	emp := map[string]any{"capabilities": map[string]any{"tools": []any{"agent"}}}
	reg := buildToolRegistry(emp, nil)
	hasAgent := false
	for _, t0 := range reg {
		if t0.Name == "agent" {
			hasAgent = true
		}
	}
	if !hasAgent {
		t.Fatalf("fixture must contain the agent tool: %#v", reg)
	}
	filtered := filterDelegationRegistry(reg, nil)
	for _, t0 := range filtered {
		if t0.Name == "agent" {
			t.Fatal("child registry must not contain the agent tool")
		}
	}
	if len(filtered) >= len(reg) {
		t.Fatalf("expected the agent tool to be dropped (%d → %d)", len(reg), len(filtered))
	}
}

// TestFilterDelegationRegistryAppliesCapabilityWhitelist makes sure the
// capability whitelist really restricts what the child can touch.
func TestFilterDelegationRegistryAppliesCapabilityWhitelist(t *testing.T) {
	reg := buildToolRegistry(nil, nil)
	filtered := filterDelegationRegistry(reg, []string{"knowledge.retrieve"})
	if len(filtered) != 1 || filtered[0].Name != "knowledge.retrieve" {
		t.Fatalf("whitelist not applied: %#v", filtered)
	}
}

// TestDelegationTargetAllowed covers the cross-partner whitelist.
func TestDelegationTargetAllowed(t *testing.T) {
	policy := DelegationPolicy{AllowedTargets: []string{"de-2"}}
	if !delegationTargetAllowed(policy, "de-2") {
		t.Fatal("allowed target must pass")
	}
	if delegationTargetAllowed(policy, "de-9") {
		t.Fatal("target outside whitelist must be denied")
	}
	if !delegationTargetAllowed(policy, "") {
		t.Fatal("same-role delegation must be allowed")
	}
	empty := DelegationPolicy{}
	if delegationTargetAllowed(empty, "de-2") {
		t.Fatal("without allowedTargets cross-partner delegation must be denied")
	}
}

// TestRunDelegatedTurnRefusesWhenDisabled proves the delegation path is
// closed by default — no fake success.
func TestRunDelegatedTurnRefusesWhenDisabled(t *testing.T) {
	svc := &Service{Store: store.New()}
	res := svc.RunDelegatedTurn(context.Background(), DelegationInput{
		WorkspaceID: "w1", ParentPartnerID: "de-1", Task: "查资料",
	})
	if res.Status != "unavailable" {
		t.Fatalf("expected unavailable, got %#v", res)
	}
	if res.Summary != "" {
		t.Fatalf("disabled delegation must not produce a summary: %#v", res)
	}
}

// TestRunDelegatedTurnRunsIsolatedChild covers the happy path: the child runs
// its own turn with an isolated context and only the conclusion comes back.
func TestRunDelegatedTurnRunsIsolatedChild(t *testing.T) {
	svc := &Service{Store: store.New()}
	svc.Store.Employees = append(svc.Store.Employees, map[string]any{
		"id": "de-parent", "name": "父伙伴", "role": "分析",
		"delegationPolicy": map[string]any{
			"enabled":             true,
			"inheritCapabilities": []any{"knowledge.retrieve"},
		},
	})
	var gotMsgs []modelprov.ChatMessage
	svc.Deps.Routing.StreamLLMForCopilotFn = func(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, opts LLMCallOptions, onDelta func(text, resolvedModelID string) error) (string, []modelprov.ToolCall, ResolvedTurn, error) {
		gotMsgs = messages
		return "子伙伴结论:Redis 延迟来自慢查询", nil, ResolvedTurn{ModelID: "m"}, nil
	}
	res := svc.RunDelegatedTurn(context.Background(), DelegationInput{
		WorkspaceID: "w1", ConversationID: "conv-1", ParentPartnerID: "de-parent",
		Task: "查 Redis 延迟原因", ModelID: "m",
	})
	if res.Status != "success" {
		t.Fatalf("expected success, got %#v", res)
	}
	if !strings.Contains(res.Summary, "Redis") {
		t.Fatalf("summary: %q", res.Summary)
	}
	if res.ChildPartnerID != "de-parent" {
		t.Fatalf("child id: %q", res.ChildPartnerID)
	}
	// 上下文隔离:子伙伴只看到自己的任务,不带父对话历史。
	if len(gotMsgs) != 1 || !strings.Contains(gotMsgs[0].Content, "查 Redis 延迟原因") {
		t.Fatalf("child context not isolated: %#v", gotMsgs)
	}
}

// TestRunDelegatedTurnDeniesTargetOutsideWhitelist covers the governance
// refusal path.
func TestRunDelegatedTurnDeniesTargetOutsideWhitelist(t *testing.T) {
	svc := &Service{Store: store.New()}
	svc.Store.Employees = append(svc.Store.Employees, map[string]any{
		"id": "de-parent", "name": "父伙伴",
		"delegationPolicy": map[string]any{"enabled": true},
	})
	res := svc.RunDelegatedTurn(context.Background(), DelegationInput{
		WorkspaceID: "w1", ParentPartnerID: "de-parent", Task: "x", TargetPartnerID: "de-other",
	})
	if res.Status != "denied" {
		t.Fatalf("expected denied, got %#v", res)
	}
}
