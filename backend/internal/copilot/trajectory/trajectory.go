// Package trajectory —— 数字伙伴的轨迹格式与断言器(P7)。
//
// 为什么需要:伙伴的"能力好不好"目前只能在配置期评一次(evaluation.status/score),
// 运行期没有回归手段 —— 改了工具契约、换了模型、调了边界策略之后,
// 没人能回答"这个岗位的行为有没有变"。
//
// 轨迹把一次回合的"行为"抽出来:调了哪些工具、参数是什么、结果如何、
// 怎么终止。断言器让这些行为可以被固定下来,变成可回归的用例。
//
// 数据来源全部是既有的落库记录(会话消息里的 toolCalls + 回合状态),
// 不需要新的采集通道。
package trajectory

import (
	"fmt"
	"strings"
)

// Step 是一次工具调用。
type Step struct {
	Seq        int
	Tool       string
	Args       map[string]any
	Status     string
	DurationMs int
	// Permission 记录授权状态(approval_required / prohibited / …)。
	Permission string
	// SubAgent 表示这一步发生在子伙伴里(P5)。
	SubAgent bool
}

// Trajectory 是一次回合的行为轨迹。
type Trajectory struct {
	ConversationID   string
	CorrelationID    string
	DigitalPartnerID string
	ModelID          string
	Steps            []Step
	FinalText        string
	// Tokens 是本回合的估算 token 数。
	Tokens int
	// TerminatedBy: final | max_steps | budget | cancelled | awaiting
	TerminatedBy string
}

// New 建一条空轨迹。
func New(conversationID, correlationID string) Trajectory {
	return Trajectory{ConversationID: conversationID, CorrelationID: correlationID, TerminatedBy: "final"}
}

// AddStep 追加一步。
func (t *Trajectory) AddStep(tool string, args map[string]any, status string, durationMs int) {
	t.Steps = append(t.Steps, Step{
		Seq: len(t.Steps) + 1, Tool: tool, Args: args, Status: status, DurationMs: durationMs,
	})
}

// Tools 返回按序的工具名。
func (t Trajectory) Tools() []string {
	out := make([]string, 0, len(t.Steps))
	for _, s := range t.Steps {
		out = append(out, s.Tool)
	}
	return out
}

// Count 返回某工具的调用次数。
func (t Trajectory) Count(tool string) int {
	n := 0
	for _, s := range t.Steps {
		if s.Tool == tool {
			n++
		}
	}
	return n
}

// IndexOf 返回某工具第一次出现的序号(1 起);没有则返回 0。
func (t Trajectory) IndexOf(tool string) int {
	for _, s := range t.Steps {
		if s.Tool == tool {
			return s.Seq
		}
	}
	return 0
}

// ArgsOf 返回某次调用的参数。
func (t Trajectory) ArgsOf(tool string) map[string]any {
	for _, s := range t.Steps {
		if s.Tool == tool {
			return s.Args
		}
	}
	return nil
}

// Assertion 是对轨迹的一条断言。
type Assertion interface {
	Check(t Trajectory) error
	// Describe 返回断言的可读描述(失败信息里用)。
	Describe() string
}

// Check 依次执行断言,返回第一个失败的错误。
func Check(t Trajectory, assertions ...Assertion) error {
	for _, a := range assertions {
		if a == nil {
			continue
		}
		if err := a.Check(t); err != nil {
			return fmt.Errorf("%s: %w", a.Describe(), err)
		}
	}
	return nil
}

// expectTool 断言某个工具被调用过。
type expectTool struct{ tool string }

func (e expectTool) Describe() string { return "期望调用工具 " + e.tool }
func (e expectTool) Check(t Trajectory) error {
	if t.Count(e.tool) == 0 {
		return fmt.Errorf("轨迹里没有 %s(实际:%s)", e.tool, strings.Join(t.Tools(), " → "))
	}
	return nil
}

// ExpectTool 断言工具被调用过。
func ExpectTool(tool string) Assertion { return expectTool{tool: tool} }

// expectNoTool 断言工具没有被调用。
type expectNoTool struct{ tool string }

func (e expectNoTool) Describe() string { return "期望不调用工具 " + e.tool }
func (e expectNoTool) Check(t Trajectory) error {
	if t.Count(e.tool) > 0 {
		return fmt.Errorf("轨迹里出现了不该出现的 %s", e.tool)
	}
	return nil
}

// ExpectNoTool 断言工具没有被调用。
func ExpectNoTool(tool string) Assertion { return expectNoTool{tool: tool} }

// expectOrder 断言两个工具的先后顺序。
type expectOrder struct {
	first, second string
}

func (e expectOrder) Describe() string { return "期望 " + e.first + " 先于 " + e.second }
func (e expectOrder) Check(t Trajectory) error {
	i, j := t.IndexOf(e.first), t.IndexOf(e.second)
	if i == 0 || j == 0 {
		return fmt.Errorf("%s / %s 未全部出现(实际:%s)", e.first, e.second, strings.Join(t.Tools(), " → "))
	}
	if i > j {
		return fmt.Errorf("%s(%d) 出现在 %s(%d) 之后", e.first, i, e.second, j)
	}
	return nil
}

// ExpectToolBefore 断言 first 在 second 之前被调用。
func ExpectToolBefore(first, second string) Assertion {
	return expectOrder{first: first, second: second}
}

// ArgsAssertion 对某个工具的某个参数做子串断言。
type ArgsAssertion struct {
	tool, key, want string
}

func (e ArgsAssertion) Describe() string {
	return fmt.Sprintf("期望 %s 的 %s 包含 %q", e.tool, e.key, e.want)
}
func (e ArgsAssertion) Check(t Trajectory) error {
	args := t.ArgsOf(e.tool)
	if args == nil {
		return fmt.Errorf("轨迹里没有 %s", e.tool)
	}
	got, _ := args[e.key].(string)
	if !strings.Contains(got, e.want) {
		return fmt.Errorf("%s 的 %s=%q,不含 %q", e.tool, e.key, got, e.want)
	}
	return nil
}

// Contains 设定期望包含的子串。
func (e ArgsAssertion) Contains(want string) ArgsAssertion {
	e.want = want
	return e
}

// ExpectArgs 返回参数子串断言器(用 .Contains 设定期望)。
func ExpectArgs(tool, key string) ArgsAssertion { return ArgsAssertion{tool: tool, key: key} }

// ToolCountAssertion 断言某工具的调用次数上限。
type ToolCountAssertion struct {
	tool string
	max  int
}

func (e ToolCountAssertion) Describe() string {
	return fmt.Sprintf("期望 %s 调用次数 ≤ %d", e.tool, e.max)
}
func (e ToolCountAssertion) Check(t Trajectory) error {
	if n := t.Count(e.tool); n > e.max {
		return fmt.Errorf("%s 调用了 %d 次(上限 %d)", e.tool, n, e.max)
	}
	return nil
}

// AtMost 设置调用次数上限。
func (e ToolCountAssertion) AtMost(n int) ToolCountAssertion {
	e.max = n
	return e
}

// ExpectToolCount 断言某工具的调用次数上限(用 .AtMost 设定)。
func ExpectToolCount(tool string) ToolCountAssertion { return ToolCountAssertion{tool: tool} }

// MinToolCountAssertion 断言某工具至少被调用若干次。
type MinToolCountAssertion struct {
	tool string
	min  int
}

func (e MinToolCountAssertion) Describe() string {
	return fmt.Sprintf("期望 %s 调用次数 ≥ %d", e.tool, e.min)
}
func (e MinToolCountAssertion) Check(t Trajectory) error {
	if n := t.Count(e.tool); n < e.min {
		return fmt.Errorf("%s 调用了 %d 次(下限 %d)", e.tool, n, e.min)
	}
	return nil
}

// AtLeast 设置调用次数下限。
func (e MinToolCountAssertion) AtLeast(n int) MinToolCountAssertion {
	e.min = n
	return e
}

// ExpectMinToolCount 断言某工具至少被调用若干次(用 .AtLeast 设定)。
func ExpectMinToolCount(tool string) MinToolCountAssertion { return MinToolCountAssertion{tool: tool} }

// expectTerminateWithin 断言步数不超过上限。
type expectTerminateWithin struct{ max int }

func (e expectTerminateWithin) Describe() string {
	return fmt.Sprintf("期望步数 ≤ %d", e.max)
}
func (e expectTerminateWithin) Check(t Trajectory) error {
	if len(t.Steps) > e.max {
		return fmt.Errorf("走了 %d 步(上限 %d)", len(t.Steps), e.max)
	}
	return nil
}

// ExpectTerminateWithin 断言步数不超过上限。
func ExpectTerminateWithin(max int) Assertion { return expectTerminateWithin{max: max} }

// expectTerminatedBy 断言终止原因。
type expectTerminatedBy struct{ by string }

func (e expectTerminatedBy) Describe() string { return "期望终止原因为 " + e.by }
func (e expectTerminatedBy) Check(t Trajectory) error {
	if t.TerminatedBy != e.by {
		return fmt.Errorf("终止原因=%q,期望 %q", t.TerminatedBy, e.by)
	}
	return nil
}

// ExpectTerminatedBy 断言终止原因(final / max_steps / awaiting …)。
func ExpectTerminatedBy(by string) Assertion { return expectTerminatedBy{by: by} }

// expectFinalContains 断言最终回答包含子串。
type expectFinalContains struct{ want string }

func (e expectFinalContains) Describe() string { return "期望最终回答包含 " + e.want }
func (e expectFinalContains) Check(t Trajectory) error {
	if !strings.Contains(t.FinalText, e.want) {
		return fmt.Errorf("最终回答=%q,不含 %q", t.FinalText, e.want)
	}
	return nil
}

// ExpectFinalContains 断言最终回答包含子串。
func ExpectFinalContains(want string) Assertion { return expectFinalContains{want: want} }

// expectEscalated 断言发生过人工升级(交接)。
type expectEscalated struct{}

func (e expectEscalated) Describe() string { return "期望触发人工升级(交接)" }
func (e expectEscalated) Check(t Trajectory) error {
	for _, s := range t.Steps {
		if s.Permission == "escalated" || s.Status == "escalated" {
			return nil
		}
	}
	return fmt.Errorf("轨迹里没有升级事件(实际:%s)", strings.Join(t.Tools(), " → "))
}

// ExpectEscalated 断言发生过人工升级(交接)。
func ExpectEscalated() Assertion { return expectEscalated{} }

// expectAwaiting 断言回合因人工审核挂起。
type expectAwaiting struct{}

func (e expectAwaiting) Describe() string { return "期望回合因人工审核挂起" }
func (e expectAwaiting) Check(t Trajectory) error {
	if t.TerminatedBy != "awaiting" {
		return fmt.Errorf("终止原因=%q,期望 awaiting", t.TerminatedBy)
	}
	return nil
}

// ExpectAwaiting 断言回合因人工审核挂起。
func ExpectAwaiting() Assertion { return expectAwaiting{} }
