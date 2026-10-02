package copilot

import (
	"strings"
	"testing"
)

func TestClassifyCopilotMode(t *testing.T) {
	cases := []struct {
		msg, hint, reflect, wantMode, wantReasonPart string
	}{
		{"你好", "", "", modeDirect, "short"},
		{"请给出入职材料清单并分步办理", "", "", modePlanExec, "complex"},
		{"年假怎么请", "", "", modeReact, "default"},
		{"随便", "plan_exec", "", modePlanExec, "client"},
		{"年假怎么请", "", "用户点踩", modeReact, "reflect"},
		{"请运维和人事一起看", "", "", modeMultiAgent, "cross"},
	}
	for _, tc := range cases {
		got := classifyCopilotMode(tc.msg, tc.hint, tc.reflect)
		if got.Mode != tc.wantMode {
			t.Fatalf("msg=%q hint=%q: mode=%s want %s", tc.msg, tc.hint, got.Mode, tc.wantMode)
		}
		if tc.wantReasonPart != "" && !strings.Contains(got.Reason, tc.wantReasonPart) {
			t.Fatalf("reason=%q want contains %q", got.Reason, tc.wantReasonPart)
		}
	}
}

func TestParsePlanAndHeuristic(t *testing.T) {
	raw := `<<<PLAN>>>
{"goal":"入职办理","steps":[{"id":"1","title":"检索","action":"retrieve","tool":"knowledge.retrieve","query":"入职"},{"id":"2","title":"输出清单","action":"answer"}]}
<<<END>>>`
	p, ok := parsePlan(raw)
	if !ok || p.Goal != "入职办理" || len(p.Steps) != 2 {
		t.Fatalf("%v %#v", ok, p)
	}
	h := heuristicPlan("请列出入职材料清单")
	if len(h.Steps) < 2 {
		t.Fatalf("%#v", h)
	}
	if h.Steps[0].Action != "retrieve" {
		t.Fatalf("first step %#v", h.Steps[0])
	}
}

func TestShouldReflectAndParseOutput(t *testing.T) {
	ok, reason := shouldReflect(reactTurnResult{Text: "短"}, "")
	if !ok || reason == "" {
		t.Fatal("short answer should reflect")
	}
	ok, _ = shouldReflect(reactTurnResult{
		Text:      strings.Repeat("完整可用的人事答复内容足够长。", 3),
		ToolCalls: []map[string]any{{"name": "x", "status": "failed"}},
	}, "")
	if !ok {
		t.Fatal("failed tool should reflect")
	}
	ok, _ = shouldReflect(reactTurnResult{
		Text: strings.Repeat("完整可用的人事答复内容足够长。", 3),
	}, "")
	if ok {
		t.Fatal("good answer should not reflect")
	}
	c, r := parseReflectOutput("【批评】缺步骤\n【修订回答】这是修订后的清单")
	if !strings.Contains(c, "缺步骤") || !strings.Contains(r, "修订后的清单") {
		t.Fatalf("c=%q r=%q", c, r)
	}
}
