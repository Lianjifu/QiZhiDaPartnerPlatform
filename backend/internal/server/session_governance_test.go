package server

import (
	"errors"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func TestNormalizeSessionModeAndFilter(t *testing.T) {
	if normalizeSessionMode("exec") != sessionModeExecute {
		t.Fatalf("exec -> execute")
	}
	reg := []registeredTool{
		{Key: "builtin:knowledge.retrieve", Name: "knowledge.retrieve", Kind: "builtin", Mode: copilot.ToolModeExecute, Enabled: true},
		{Key: "skill:docx", Name: "docx", Kind: "skill", Mode: copilot.ToolModeApproval, Enabled: true, RequiresApproval: true},
	}
	out := filterRegistryBySessionMode(reg, sessionModeInvestigate)
	if len(out) != 2 {
		t.Fatalf("investigate should keep docx allowlist skill, got %d", len(out))
	}
	for _, t0 := range out {
		if t0.Key == "skill:docx" && !t0.Enabled {
			t.Fatalf("docx should stay enabled in investigate for sandbox artifact runs")
		}
	}
	out2 := filterRegistryBySessionMode(reg, sessionModeExecute)
	if len(out2) != 2 {
		t.Fatalf("execute keeps all, got %d", len(out2))
	}
}

func TestApplySessionGovernanceRunMode(t *testing.T) {
	sess := map[string]any{"sessionMode": sessionModeInvestigate}
	applySessionGovernancePatch(sess, map[string]any{
		"runMode":          "agent",
		"reasoningEffort":  "deep",
		"sessionMode":      sessionModeExecute,
	}, nil, nowRFC3339())
	if str(sess["runMode"]) != "agent" {
		t.Fatalf("runMode=%v", sess["runMode"])
	}
	if str(sess["reasoningEffort"]) != "deep" {
		t.Fatalf("reasoningEffort=%v", sess["reasoningEffort"])
	}
	if str(sess["sessionMode"]) != sessionModeExecute {
		t.Fatalf("sessionMode=%v", sess["sessionMode"])
	}
	applySessionGovernancePatch(sess, map[string]any{"runMode": "nope", "reasoningEffort": "max"}, nil, nowRFC3339())
	if str(sess["runMode"]) != "agent" || str(sess["reasoningEffort"]) != "deep" {
		t.Fatalf("invalid values must be ignored")
	}
}

func TestReasoningEffortGuidance(t *testing.T) {
	if copilot.ReasoningEffortGuidance("off") == "" {
		t.Fatal("off should inject guidance")
	}
	if copilot.ReasoningEffortGuidance("deep") == "" {
		t.Fatal("deep should inject guidance")
	}
	if copilot.ReasoningEffortGuidance("standard") != "" {
		t.Fatal("standard keeps default prompt")
	}
}

func TestContentSafetyRedact(t *testing.T) {
	t.Setenv("DE_CONTENT_SAFETY", "redact")
	r := copilot.ApplyContentSafety("联系我 13800138000")
	if !r.Redacted || r.Blocked {
		t.Fatalf("expected redact: %+v", r)
	}
	if r.Text == "联系我 13800138000" {
		t.Fatalf("phone not redacted")
	}
}

func TestAssertSessionWritable(t *testing.T) {
	err := assertSessionWritableLocked(map[string]any{"status": "closed"})
	if err == nil {
		t.Fatal("closed should forbid")
	}
	var closed *apperr.AppError
	if !errors.As(err, &closed) || closed.Code != apperr.SessionClosed {
		t.Fatalf("want E_SESSION_CLOSED, got %v", err)
	}
	err = assertSessionWritableLocked(map[string]any{"handoff": map[string]any{"active": true}})
	if err == nil {
		t.Fatal("handoff should forbid")
	}
	var handoff *apperr.AppError
	if !errors.As(err, &handoff) || handoff.Code != apperr.SessionHandoff {
		t.Fatalf("want E_SESSION_HANDOFF, got %v", err)
	}
}

func TestResolveRunModeAndPromptClause(t *testing.T) {
	if resolveRunMode("ask", "plan", sessionModeExecute) != "ask" {
		t.Fatal("body runMode should win")
	}
	if resolveRunMode("", "agent", sessionModeInvestigate) != "agent" {
		t.Fatal("session runMode should win when body empty")
	}
	if resolveRunMode("", "", sessionModeExecute) != "agent" {
		t.Fatal("execute ABI should map to agent")
	}
	if resolveRunMode("", "", sessionModeInvestigate) != "plan" {
		t.Fatal("investigate ABI should default to plan")
	}
	ask := runModePromptClause("ask")
	if !strings.Contains(ask, "「问答」") || strings.Contains(ask, "研判模式：") {
		t.Fatalf("ask clause=%q", ask)
	}
	plan := runModePromptClause("plan")
	if !strings.Contains(plan, "「方案」") {
		t.Fatalf("plan clause=%q", plan)
	}
	agent := runModePromptClause("agent")
	if !strings.Contains(agent, "「执行」") {
		t.Fatalf("agent clause=%q", agent)
	}
}
