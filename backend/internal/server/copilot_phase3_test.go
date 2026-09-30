package server

import (
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestClassifyCopilotMode_MultiAgentAndLevels(t *testing.T) {
	cases := []struct {
		msg, hint string
		wantMode  string
		wantLevel string
	}{
		{"你好", "", modeDirect, "P3"},
		{"年假怎么请", "", modeReact, "P1"},
		{"请给出入职材料清单并分步办理", "", modePlanExec, "P0"},
		{"请运维和人事一起看下故障与入职衔接", "", modeMultiAgent, "P0"},
		{"跨部门会商发布与合规", "", modeMultiAgent, "P0"},
		{"x", "multi_agent", modeMultiAgent, "P0"},
		{"x", "direct", modeDirect, "P3"},
	}
	for _, tc := range cases {
		got := classifyCopilotMode(tc.msg, tc.hint, "")
		if got.Mode != tc.wantMode || got.PolicyLevel != tc.wantLevel {
			t.Fatalf("msg=%q hint=%q => %#v want mode=%s level=%s", tc.msg, tc.hint, got, tc.wantMode, tc.wantLevel)
		}
	}
}

func TestResolveModelByPolicyLevel(t *testing.T) {
	st := store.New()
	s := New(st)
	// Explicit model wins
	mid, _, lv := s.resolveModelByPolicyLevel("w1", "mdl-gpt4", "P3", "")
	if mid != "mdl-gpt4" || lv != "" {
		t.Fatalf("explicit: %s %s", mid, lv)
	}
	// Demo alias falls through to published P3 policy
	mid, pid, used := s.resolveModelByPolicyLevel("w1", "sonnet-4", "P3", "")
	if mid != "mdl-mini" || used != "P3" || pid != "rp-p3" {
		t.Fatalf("demo alias resolve: mid=%s pid=%s used=%s", mid, pid, used)
	}
	mid, pid, used = s.resolveModelByPolicyLevel("w1", "", "P0", "")
	if mid != "mdl-gpt4" || used != "P0" || pid != "rp-p0" {
		t.Fatalf("P0 resolve: mid=%s pid=%s used=%s", mid, pid, used)
	}
}

// TestResolveModelByPolicyLevelRiskFloor verifies the risk-level floor
// introduced in M1: a high-risk prompt cannot be silently downgraded to a
// lightweight tier just because no exact-level policy exists.
//
// The publishedPolicyByLevelLocked fixture only has P0 and P1 published, so
// risk=high must floor to P0 and resolve to "mdl-gpt4"; risk=medium floors
// to P1; risk=low asks for P2 which falls back to P3 (no P2 published) so
// we only verify the floor is set as the requested level.
func TestResolveModelByPolicyLevelRiskFloor(t *testing.T) {
	st := store.New()
	s := New(st)
	// Caller asks for P3 (lightest), but risk is high → must floor to P0.
	mid, _, used := s.resolveModelByPolicyLevel("w1", "", "P3", "high")
	if used != "P0" || mid != "mdl-gpt4" {
		t.Fatalf("high risk must floor to P0: used=%s mid=%s", used, mid)
	}
	// Medium risk floor → P1, which is published.
	mid, _, used = s.resolveModelByPolicyLevel("w1", "", "P3", "medium")
	if used != "P1" {
		t.Fatalf("medium risk floor P1: used=%s", used)
	}
	// Caller already at or above the floor: floor is a no-op.
	mid, _, used = s.resolveModelByPolicyLevel("w1", "", "P0", "high")
	if used != "P0" {
		t.Fatalf("P0 caller with high risk: used=%s", used)
	}
	// Empty risk → no floor (existing behavior).
	_, _, used = s.resolveModelByPolicyLevel("w1", "", "P3", "")
	if used != "P3" {
		t.Fatalf("no risk: must respect caller P3, got used=%s", used)
	}
	_ = mid
}

func TestRiskLevelFloorUnit(t *testing.T) {
	cases := map[string]string{
		"":       "",
		"low":    "P2",
		"medium": "P1",
		"high":   "P0",
		"HIGH":   "P0",
		" Medium ": "P1",
	}
	for in, want := range cases {
		if got := riskLevelFloor(in); got != want {
			t.Errorf("riskLevelFloor(%q)=%q want %q", in, got, want)
		}
	}
}

func TestLevelRank(t *testing.T) {
	if levelRank("P0") >= levelRank("P3") {
		t.Fatal("P0 must outrank P3 (lower rank number = stronger tier)")
	}
	if levelRank("P1") <= levelRank("P0") {
		t.Fatal("P1 must be weaker than P0")
	}
	if levelRank("garbage") != 4 {
		t.Fatal("unknown levels rank worst")
	}
}

func TestPickSpecialists(t *testing.T) {
	cands := []map[string]any{
		{"id": "de-sre", "name": "故障自愈助手", "role": "SRE", "department": "信息技术部", "responsibilities": []string{"故障响应"}},
		{"id": "de-hr", "name": "听风", "role": "人事专员", "department": "人事部", "responsibilities": []string{"入职办理"}},
		{"id": "de-qa", "name": "质检", "role": "QA", "department": "运营部"},
	}
	picks := pickSpecialists(cands, "请运维和人事一起看故障与入职", 3)
	if len(picks) < 2 {
		t.Fatalf("want >=2 specialists, got %#v", picks)
	}
	ids := map[string]bool{}
	for _, p := range picks {
		ids[p.ID] = true
	}
	if !ids["de-sre"] || !ids["de-hr"] {
		t.Fatalf("expected SRE+HR, got %#v", picks)
	}
	// SRE should rank above QA for this query
	if picks[0].ID != "de-sre" && picks[0].ID != "de-hr" {
		t.Fatalf("unexpected top %#v", picks[0])
	}
}

func TestLooksLikeMultiAgent(t *testing.T) {
	if !looksLikeMultiAgent("跨部门协作", strings.ToLower("跨部门协作")) {
		t.Fatal("expected multi")
	}
	if looksLikeMultiAgent("年假怎么请", strings.ToLower("年假怎么请")) {
		t.Fatal("single domain should not multi")
	}
	// The old buggy substring match was the literal `转给.*同时` — it
	// would match because `.*` was treated as 3 plain chars. Now real
	// regex: handoff phrases like "转给运维同时知会人事" must hit,
	// but plain prose "转交给下一位审批人" must not.
	if !looksLikeMultiAgent("转给运维同时知会人事", strings.ToLower("转给运维同时知会人事")) {
		t.Fatal("real handoff phrase should match multi_agent")
	}
	if looksLikeMultiAgent("转交给下一位审批人", strings.ToLower("转交给下一位审批人")) {
		t.Fatal("plain handoff prose should not match multi_agent")
	}
}

// TestLooksLikeMultiAgentStrategy locks in the routing intent for
// ambiguous / boundary utterances. If any of these flip, the panel
// surface changes for real users — treat as a policy audit, not a test.
func TestLooksLikeMultiAgentStrategy(t *testing.T) {
	lower := func(s string) string { return strings.ToLower(s) }
	cases := []struct {
		msg  string
		want bool
		why  string
	}{
		// Pure ops — should stay single-agent react.
		{"redis 延迟飙升", false, "single SRE cue"},
		{"kubectl describe pod 怎么用", false, "single SRE cue, single cue cluster"},
		{"帮我看一下 CMDB 里这台机器", false, "single SRE cue (CMDB)"},
		// Single-domain HR — should stay single-agent.
		{"年假怎么请", false, "single HR cue"},
		{"HR 怎么入职", false, "single HR cue"},
		// Single-domain finance — should stay single-agent.
		{"发票怎么报销", false, "single finance cue"},
		// Pure ops + pure HR (cross-domain) — must fire multi.
		{"运维和人事联动", true, "explicit 和人事 handoff"},
		{"入职流程和财务怎么对接", true, "HR + finance cross-domain"},
		{"客服投诉怎么处理并知会法务", true, "QA + legal cross-domain"},
		// Pure phrasal — must fire multi.
		{"联合演练", true, "fixed phrase"},
		{"会商一下", true, "fixed phrase"},
		// Edge: handoff prose that does NOT include 同时 — must stay single.
		{"转交给运维", false, "handoff prose without 同时"},
		{"下一步交给财务", false, "handoff prose without 同时"},
		// Edge: cross-domain but only one domain actually fires (bug guard).
		{"运维故障一起来看看", false, "SRE + 故障 share domain — count must be 1"},
	}
	for _, c := range cases {
		got := looksLikeMultiAgent(c.msg, lower(c.msg))
		if got != c.want {
			t.Errorf("looksLikeMultiAgent(%q) = %v, want %v (%s)", c.msg, got, c.want, c.why)
		}
	}
}
