package trajectory

import "testing"

func TestTrajectoryAsserters(t *testing.T) {
	tr := New("conv-1", "corr-1")
	tr.AddStep("knowledge.retrieve", map[string]any{"query": "Redis 延迟"}, "success", 12)
	tr.AddStep("shell.exec", map[string]any{"command": "ls"}, "failed", 8)
	tr.FinalText = "结论:Redis 慢查询"

	if err := Check(tr,
		ExpectTool("knowledge.retrieve"),
		ExpectNoTool("web.fetch"),
		ExpectToolBefore("knowledge.retrieve", "shell.exec"),
		ExpectArgs("knowledge.retrieve", "query").Contains("Redis"),
		ExpectToolCount("knowledge.retrieve").AtMost(2),
		ExpectMinToolCount("shell.exec").AtLeast(1),
		ExpectTerminateWithin(5),
		ExpectFinalContains("慢查询"),
	); err != nil {
		t.Fatalf("assertions: %v", err)
	}
}

func TestTrajectoryAssertersFailLoudly(t *testing.T) {
	tr := New("conv-1", "corr-1")
	tr.AddStep("shell.exec", map[string]any{"command": "ls"}, "success", 8)

	cases := map[string]Assertion{
		"missing tool":  ExpectTool("knowledge.retrieve"),
		"unexpected":    ExpectNoTool("shell.exec"),
		"wrong order":   ExpectToolBefore("shell.exec", "knowledge.retrieve"),
		"wrong arg":     ExpectArgs("shell.exec", "command").Contains("rm"),
		"too many":      ExpectToolCount("shell.exec").AtMost(0),
		"too few":       ExpectMinToolCount("knowledge.retrieve").AtLeast(1),
		"too long":      ExpectTerminateWithin(0),
		"wrong term":    ExpectTerminatedBy("awaiting"),
		"wrong final":   ExpectFinalContains("不存在的词"),
		"not escalated": ExpectEscalated(),
	}
	for name, a := range cases {
		if err := Check(tr, a); err == nil {
			t.Fatalf("%s: expected failure", name)
		}
	}
}

func TestTrajectoryHelpers(t *testing.T) {
	tr := New("conv-1", "corr-1")
	tr.AddStep("a", nil, "success", 1)
	tr.AddStep("b", nil, "success", 2)
	tr.AddStep("a", nil, "success", 3)
	if tr.Count("a") != 2 {
		t.Fatalf("count=%d", tr.Count("a"))
	}
	if tr.IndexOf("b") != 2 {
		t.Fatalf("index=%d", tr.IndexOf("b"))
	}
	if tr.IndexOf("zzz") != 0 {
		t.Fatalf("missing index should be 0")
	}
	if len(tr.Tools()) != 3 || tr.Tools()[0] != "a" {
		t.Fatalf("tools=%#v", tr.Tools())
	}
}
