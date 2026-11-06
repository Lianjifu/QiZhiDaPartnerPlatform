package copilot

import (
	"strings"
	"testing"
)

func TestThoughtForToolChoice(t *testing.T) {
	title, detail := thoughtForToolChoice("skill:docx")
	if title == "" || detail == "" {
		t.Fatalf("docx thought empty: %q %q", title, detail)
	}
	title, _ = thoughtForToolChoice("knowledge.retrieve")
	if !strings.Contains(title, "检索") {
		t.Fatalf("retrieve title=%q", title)
	}
}

func TestThoughtForRouteMode(t *testing.T) {
	title, _ := thoughtForRouteMode(modePlanExec, "plan_hint")
	if title == "" {
		t.Fatal("empty plan mode thought")
	}
}

func TestThoughtUnderstandTask(t *testing.T) {
	title, _ := thoughtUnderstandTask("招聘进度简报")
	if !strings.Contains(title, "招聘进度简报") {
		t.Fatalf("title=%q", title)
	}
}

// TestHumanRouteReasonNoInternalTokens 锁定"内部路由码不得出现在用户可见文案里"。
// 这些 reason 会经 thought 事件流到前端气泡，之前 client_hint / default_react
// 直接透出，回复看起来像日志。
func TestHumanRouteReasonNoInternalTokens(t *testing.T) {
	internal := []string{
		"client_hint", "short_chitchat", "cross_department",
		"complex_multi_step", "default_react", "reflect_requested",
		"plan_hint", "plan_requested", "complex_task",
	}
	for _, reason := range internal {
		got := humanRouteReason(reason)
		if got == "" {
			t.Fatalf("humanRouteReason(%q) empty", reason)
		}
		if got == reason {
			t.Fatalf("humanRouteReason(%q) leaked internal code", reason)
		}
		if strings.ContainsAny(got, "_") {
			t.Fatalf("humanRouteReason(%q)=%q still looks like an internal code", reason, got)
		}
	}
	if got := humanRouteReason(""); got != "" {
		t.Fatalf("humanRouteReason(\"\")=%q want empty", got)
	}
	if got := humanRouteReason("totally_unknown_reason"); got != "" {
		t.Fatalf("humanRouteReason(unknown)=%q want empty", got)
	}
}

// TestHumanCognitiveReasonsNoInternalTokens 同上，覆盖认知框架的 reason 码。
func TestHumanCognitiveReasonsNoInternalTokens(t *testing.T) {
	got := humanCognitiveReasons([]string{
		"default_logic", "soft_analyze", "signal:logic",
		"secondary:problem", "dept_pref:creative",
	})
	if len(got) != 5 {
		t.Fatalf("want 5 labels, got %#v", got)
	}
	for _, label := range got {
		if strings.Contains(label, ":") {
			t.Fatalf("label %q still carries an internal code", label)
		}
	}
	if got := humanCognitiveReasons(nil); len(got) != 0 {
		t.Fatalf("want no labels, got %#v", got)
	}
}

func TestCognitiveModeLabel(t *testing.T) {
	if got := cognitiveModeLabel(cognitiveModeDeep); got != "深度" {
		t.Fatalf("deep mode label=%q", got)
	}
	if got := cognitiveModeLabel("unknown"); got != "标准" {
		t.Fatalf("unknown mode label=%q", got)
	}
}

// TestHumanToolNameNoInternalTokens 锁定"工具技术名不得直接出现在气泡文案里"。
func TestHumanToolNameNoInternalTokens(t *testing.T) {
	cases := map[string]string{
		"knowledge.retrieve":    "知识检索",
		"memory.recall":         "记忆回忆",
		"tool:shell.exec":       "受控命令",
		"builtin:artifact.read": "产物读取",
	}
	for tool, want := range cases {
		if got := humanToolName(tool); got != want {
			t.Fatalf("humanToolName(%q)=%q want %q", tool, got, want)
		}
	}
	if got := humanToolName(""); got != "能力" {
		t.Fatalf("humanToolName(\"\")=%q want 能力", got)
	}
	// 未知工具保留原名,不吞信息。
	if got := humanToolName("hris.lookup"); got != "hris.lookup" {
		t.Fatalf("humanToolName(unknown)=%q", got)
	}
}

// TestThoughtForToolResultUsesHumanName 工具结果文案不得带出技术名。
func TestThoughtForToolResultUsesHumanName(t *testing.T) {
	title, _ := thoughtForToolResult("success", "knowledge.retrieve")
	if strings.Contains(title, "knowledge.retrieve") {
		t.Fatalf("tool result title leaked technical name: %q", title)
	}
	if !strings.Contains(title, "知识检索") {
		t.Fatalf("tool result title=%q", title)
	}
}

func TestHumanPlanAction(t *testing.T) {
	cases := map[string]string{
		"retrieve": "检索知识",
		"memory":   "回忆偏好",
		"tool":     "调用能力",
		"answer":   "整理结论",
		"":         "",
	}
	for action, want := range cases {
		if got := humanPlanAction(action); got != want {
			t.Fatalf("humanPlanAction(%q)=%q want %q", action, got, want)
		}
	}
}
