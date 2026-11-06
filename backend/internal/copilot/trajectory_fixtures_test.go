package copilot

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/copilot/trajectory"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// scriptedTurn 是轨迹用例里的一次"模型应答"。
//
// Text 是纯文本回复;ToolCalls 是结构化工具调用(P3 的原生路径)。
type scriptedTurn struct {
	Text      string
	ToolCalls []modelprov.ToolCall
}

// scriptedLLM 按顺序回放脚本化应答,并记录收到的消息(用于断言上下文)。
type scriptedLLM struct {
	turns   []scriptedTurn
	idx     int
	seen    [][]modelprov.ChatMessage
	lastMsg []modelprov.ChatMessage
}

func (s *scriptedLLM) fn(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, opts LLMCallOptions, onDelta func(text, resolvedModelID string) error) (string, []modelprov.ToolCall, ResolvedTurn, error) {
	s.seen = append(s.seen, append([]modelprov.ChatMessage{}, messages...))
	s.lastMsg = messages
	if s.idx >= len(s.turns) {
		return "（脚本已耗尽）", nil, ResolvedTurn{ModelID: "m"}, nil
	}
	turn := s.turns[s.idx]
	s.idx++
	if turn.Text != "" && onDelta != nil {
		_ = onDelta(turn.Text, "m")
	}
	return turn.Text, turn.ToolCalls, ResolvedTurn{ModelID: "m"}, nil
}

// textTurn 造一个纯文本应答。
func textTurn(text string) scriptedTurn { return scriptedTurn{Text: text} }

// toolTurn 造一个结构化工具调用应答。
func toolTurn(name string, args map[string]any) scriptedTurn {
	raw, _ := json.Marshal(args)
	return scriptedTurn{ToolCalls: []modelprov.ToolCall{{ID: "call_" + name, Name: name, Arguments: raw}}}
}

// toolTurnText 造一个"先调工具再说话"的应答。
func toolTurnText(name string, args map[string]any, text string) scriptedTurn {
	turn := toolTurn(name, args)
	turn.Text = text
	return turn
}

// trajectoryFixture 是轨迹用例的脚手架。
type trajectoryFixture struct {
	svc      *Service
	llm      *scriptedLLM
	registry []registeredTool
	results  map[string]toolExecResult
}

func newTrajectoryFixture(t *testing.T, employee map[string]any, turns []scriptedTurn) *trajectoryFixture {
	t.Helper()
	st := store.New()
	svc := &Service{Store: st}
	llm := &scriptedLLM{turns: turns}
	svc.Deps.Routing.StreamLLMForCopilotFn = llm.fn
	fixture := &trajectoryFixture{svc: svc, llm: llm, results: map[string]toolExecResult{}}
	svc.Deps.Tools.DispatchAuthorizedToolFn = func(runCtx toolRunContext, reg []registeredTool, call toolCallRequest, sessionMode, risk string, emit reactEmitFunc) (*registeredTool, toolExecResult) {
		res, ok := fixture.results[call.Name]
		if !ok {
			res = toolExecResult{Status: "success", Output: call.Name + " 完成"}
		}
		return &registeredTool{Name: call.Name}, res
	}
	fixture.registry = buildToolRegistry(employee, nil)
	return fixture
}

// run 执行一次 ReAct 回合并返回轨迹。
func (f *trajectoryFixture) run(t *testing.T, employee map[string]any, userMessage string) trajectory.Trajectory {
	t.Helper()
	res := f.svc.runReactTurn(context.Background(), reactTurnInput{
		WorkspaceID:    "w1",
		ConversationID: "conv-1",
		CorrelationID:  "corr-1",
		ModelID:        "m",
		UserMessage:    userMessage,
		Registry:       f.registry,
		Employee:       employee,
		MaxSteps:       4,
		NoBootstrap:    true,
	})
	tr := trajectory.New("conv-1", "corr-1")
	for _, tc := range res.ToolCalls {
		tr.AddStep(str(tc["name"]), mapArgAny(tc["args"]), str(tc["status"]), intFromAny(tc["durationMs"], 0))
	}
	tr.FinalText = res.Text
	tr.TerminatedBy = "final"
	if res.Awaiting {
		tr.TerminatedBy = "awaiting"
	}
	return tr
}

// TestTrajectoryFixtureDirectAnswer covers the simplest case: no tool at all.
func TestTrajectoryFixtureDirectAnswer(t *testing.T) {
	f := newTrajectoryFixture(t, nil, []scriptedTurn{textTurn("结论是 42")})
	tr := f.run(t, nil, "1+1 等于几")
	if err := trajectory.Check(tr,
		trajectory.ExpectNoTool("knowledge.retrieve"),
		trajectory.ExpectFinalContains("42"),
		trajectory.ExpectTerminateWithin(4),
	); err != nil {
		t.Fatalf("trajectory assertions: %v", err)
	}
}

// TestTrajectoryFixtureSingleTool covers one retrieval step.
func TestTrajectoryFixtureSingleTool(t *testing.T) {
	f := newTrajectoryFixture(t, nil, []scriptedTurn{
		toolTurn("knowledge.retrieve", map[string]any{"query": "报销制度"}),
		textTurn("报销标准是 200 元"),
	})
	tr := f.run(t, nil, "报销标准是多少")
	if err := trajectory.Check(tr,
		trajectory.ExpectTool("knowledge.retrieve"),
		trajectory.ExpectToolCount("knowledge.retrieve").AtMost(1),
		trajectory.ExpectArgs("knowledge.retrieve", "query").Contains("报销"),
		trajectory.ExpectFinalContains("200"),
	); err != nil {
		t.Fatalf("trajectory assertions: %v", err)
	}
}

// TestTrajectoryFixtureMultiStepOrder covers the ordering guarantee: a second
// tool must not run before the first one finished.
func TestTrajectoryFixtureMultiStepOrder(t *testing.T) {
	f := newTrajectoryFixture(t, nil, []scriptedTurn{
		toolTurn("knowledge.retrieve", map[string]any{"query": "制度"}),
		toolTurn("memory.recall", map[string]any{"query": "偏好"}),
		textTurn("综合两份材料"),
	})
	tr := f.run(t, nil, "综合一下")
	if err := trajectory.Check(tr,
		trajectory.ExpectToolBefore("knowledge.retrieve", "memory.recall"),
		trajectory.ExpectMinToolCount("knowledge.retrieve").AtLeast(1),
		trajectory.ExpectMinToolCount("memory.recall").AtLeast(1),
	); err != nil {
		t.Fatalf("trajectory assertions: %v", err)
	}
}

// TestTrajectoryFixtureParallelToolsInOneRound covers the P3 win: two tools
// issued in a single model turn are both executed in that round.
func TestTrajectoryFixtureParallelToolsInOneRound(t *testing.T) {
	f := newTrajectoryFixture(t, nil, []scriptedTurn{
		{Text: "我并行查两份材料", ToolCalls: []modelprov.ToolCall{
			{ID: "call_a", Name: "knowledge.retrieve", Arguments: json.RawMessage(`{"query":"A"}`)},
			{ID: "call_b", Name: "memory.recall", Arguments: json.RawMessage(`{"query":"B"}`)},
		}},
		textTurn("汇总完成"),
	})
	tr := f.run(t, nil, "并行查两份")
	if err := trajectory.Check(tr,
		trajectory.ExpectTool("knowledge.retrieve"),
		trajectory.ExpectTool("memory.recall"),
		trajectory.ExpectToolCount("knowledge.retrieve").AtMost(1),
		trajectory.ExpectToolCount("memory.recall").AtMost(1),
	); err != nil {
		t.Fatalf("trajectory assertions: %v", err)
	}
}

// TestTrajectoryFixtureToolFailure covers the failure path: the failed step is
// visible in the trajectory.
func TestTrajectoryFixtureToolFailure(t *testing.T) {
	f := newTrajectoryFixture(t, nil, []scriptedTurn{
		toolTurn("shell.exec", map[string]any{"command": "ls"}),
		textTurn("命令失败了,改用别的办法"),
	})
	f.results["shell.exec"] = toolExecResult{Status: "failed", Error: "命令被拒绝"}
	tr := f.run(t, nil, "列目录")
	if err := trajectory.Check(tr,
		trajectory.ExpectTool("shell.exec"),
		trajectory.ExpectFinalContains("失败"),
	); err != nil {
		t.Fatalf("trajectory assertions: %v", err)
	}
	found := false
	for _, s := range tr.Steps {
		if s.Tool == "shell.exec" && s.Status == "failed" {
			found = true
		}
	}
	if !found {
		t.Fatalf("failed status not recorded: %#v", tr.Steps)
	}
}

// TestTrajectoryFixtureApprovalSuspendsTurn covers the P6 suspension: the
// turn ends as "awaiting" instead of pretending the tool ran.
func TestTrajectoryFixtureApprovalSuspendsTurn(t *testing.T) {
	f := newTrajectoryFixture(t, nil, []scriptedTurn{
		toolTurn("shell.exec", map[string]any{"command": "systemctl restart"}),
		textTurn("（不应走到这里）"),
	})
	f.results["shell.exec"] = toolExecResult{Status: "pending_authorization", Permission: "approval_required", ActionID: "act-1"}
	tr := f.run(t, nil, "重启服务")
	if err := trajectory.Check(tr,
		trajectory.ExpectAwaiting(),
		trajectory.ExpectTool("shell.exec"),
	); err != nil {
		t.Fatalf("trajectory assertions: %v", err)
	}
	if strings.Contains(tr.FinalText, "已执行") || strings.Contains(tr.FinalText, "成功") {
		t.Fatalf("suspended turn must not claim execution: %q", tr.FinalText)
	}
}

// TestTrajectoryFixtureContextCarriesToolResult makes sure the observation of
// a tool actually reaches the next model turn — without it the agent is blind.
func TestTrajectoryFixtureContextCarriesToolResult(t *testing.T) {
	f := newTrajectoryFixture(t, nil, []scriptedTurn{
		toolTurn("knowledge.retrieve", map[string]any{"query": "制度"}),
		textTurn("好的"),
	})
	f.results["knowledge.retrieve"] = toolExecResult{Status: "success", Output: "命中片段:差旅标准 200 元"}
	f.run(t, nil, "差旅标准")
	joined := ""
	for _, m := range f.llm.lastMsg {
		joined += m.Content + "\n"
		for _, tr := range m.ToolResults {
			joined += tr.Content + "\n"
		}
	}
	if !strings.Contains(joined, "差旅标准 200 元") {
		t.Fatalf("tool observation not carried into the next turn: %q", joined)
	}
}
