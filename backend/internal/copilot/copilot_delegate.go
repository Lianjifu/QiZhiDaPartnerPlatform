// copilot_delegate.go —— P5 子伙伴派生(delegation)。
//
// 产品语义:一个岗位往往不止一种专长。"数据分析岗"可能要同时懂知识库、
// CMDB 与图表。与其让主伙伴把全部历史拖进一个更长的上下文,不如按需
// 派生一个**上下文隔离**的子伙伴,只把它的结论带回来。
//
// 与专家面板(copilot_multi.go)的区别:
//   - 专家面板 = 预配置的固定多岗协作(配置期决定)
//   - 子伙伴派生 = 运行时按需派生(这一回合临时决定)
//
// 治理约束(数字伙伴特有的硬要求):
//   - delegationPolicy.enabled 默认关闭,不配置就不许派生
//   - 嵌套深度 ≤1:子伙伴拿不到 "agent" 工具,无法再派生
//   - 能力白名单:inheritCapabilities / allowedTargets 决定能带走什么、
//     能派给谁;白名单之外的派生直接拒绝并审计
//   - 子伙伴的中间过程不灌回主上下文,只回结论与轨迹
package copilot

import (
	"context"
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// delegationMaxDepth 是允许的最大嵌套深度。
//
// 深度 1 = 主伙伴派子伙伴;子伙伴不能再派。当前实现靠"子伙伴注册表里
// 没有 agent 工具"来保证。
const delegationMaxDepth = 1

// delegationChildMaxSteps 是子伙伴单回合的步数上限。
const delegationChildMaxSteps = 4

// DelegationPolicy 是数字伙伴的派生策略(随配置版本走审批)。
type DelegationPolicy struct {
	// Enabled 是否允许派生。默认 false。
	Enabled bool
	// MaxDepth 允许的嵌套深度,上限 1。
	MaxDepth int
	// MaxConcurrent 允许同时派生的子伙伴数。
	MaxConcurrent int
	// InheritCapabilities 是允许传给子伙伴的能力白名单。
	// 为空表示不额外限制(子伙伴继承父伙伴除 "agent" 外的全部能力)。
	InheritCapabilities []string
	// AllowedTargets 是允许派生到的目标伙伴 ID 白名单。
	// 为空表示只能派生"同岗位"子伙伴(不跨伙伴)。
	AllowedTargets []string
}

// DelegationInput 是派生子伙伴的入参。
type DelegationInput struct {
	Request         *http.Request
	WorkspaceID     string
	ConversationID  string
	CorrelationID   string
	ParentPartnerID string
	// Task 是交给子伙伴的子任务描述。
	Task string
	// TargetPartnerID 指定目标子伙伴;空 = 同岗位子伙伴。
	TargetPartnerID string
	Viewer          *auth.Identity
	SessionMode     string
	RiskLevel       string
	ModelID         string
}

// DelegationResult 是子伙伴的产出。
type DelegationResult struct {
	// Status: success | denied | unavailable | failed
	Status string
	// Summary 是子伙伴的最终结论(回灌主上下文的内容)。
	Summary string
	// ToolCalls 是子伙伴的轨迹(只进审计/度量,不进主上下文)。
	ToolCalls []map[string]any
	// ChildPartnerID 是实际执行的子伙伴 ID。
	ChildPartnerID string
	// Error 说明失败原因。
	Error string
}

// delegationPolicyFor 读取伙伴的派生策略。未配置即关闭。
func delegationPolicyFor(emp map[string]any) DelegationPolicy {
	p := DelegationPolicy{MaxDepth: delegationMaxDepth, MaxConcurrent: 3}
	if emp == nil {
		return p
	}
	raw, _ := emp["delegationPolicy"].(map[string]any)
	if raw == nil {
		return p
	}
	if v, ok := raw["enabled"].(bool); ok {
		p.Enabled = v
	}
	if v := str(raw["maxDepth"]); v != "" {
		if n := intFromAny(raw["maxDepth"], 0); n > 0 {
			p.MaxDepth = n
		}
	}
	if n := intFromAny(raw["maxConcurrent"], 0); n > 0 {
		p.MaxConcurrent = n
	}
	if p.MaxDepth > delegationMaxDepth {
		p.MaxDepth = delegationMaxDepth
	}
	p.InheritCapabilities = stringSlice(raw["inheritCapabilities"])
	p.AllowedTargets = stringSlice(raw["allowedTargets"])
	return p
}

// delegationEnabled 判断伙伴是否允许派生。
func delegationEnabled(emp map[string]any) bool {
	return delegationPolicyFor(emp).Enabled
}

// employeeByID 在 store 里按 ID 取数字伙伴。
func (s *Service) employeeByID(deID string) map[string]any {
	deID = strings.TrimSpace(deID)
	if deID == "" {
		return nil
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, emp := range s.Store.Employees {
		if str(emp["id"]) == deID {
			return emp
		}
	}
	return nil
}

// filterDelegationRegistry 按白名单裁剪子伙伴的能力集。
//
// 无论白名单如何,子伙伴都拿不到 "agent" 工具 —— 嵌套深度硬性封顶 1。
func filterDelegationRegistry(reg []registeredTool, allowed []string) []registeredTool {
	allow := map[string]bool{}
	for _, a := range allowed {
		a = strings.TrimSpace(a)
		if a != "" {
			allow[a] = true
		}
	}
	out := make([]registeredTool, 0, len(reg))
	for _, t := range reg {
		if t.Name == "agent" {
			continue
		}
		if len(allow) > 0 && !allow[t.Name] && !allow[t.Key] {
			continue
		}
		out = append(out, t)
	}
	return out
}

// delegationTargetAllowed 判断目标伙伴是否在白名单内。
func delegationTargetAllowed(policy DelegationPolicy, targetID string) bool {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return true // 同岗位子伙伴
	}
	if len(policy.AllowedTargets) == 0 {
		return false // 未配置目标白名单 → 不允许跨伙伴派生
	}
	for _, t := range policy.AllowedTargets {
		if strings.TrimSpace(t) == targetID {
			return true
		}
	}
	return false
}

// RunDelegatedTurn 派生一个子伙伴执行子任务,只把结论带回主上下文。
func (s *Service) RunDelegatedTurn(ctx context.Context, in DelegationInput) DelegationResult {
	if s == nil {
		return DelegationResult{Status: "failed", Error: "copilot 服务未就绪"}
	}
	parent := s.employeeByID(in.ParentPartnerID)
	policy := delegationPolicyFor(parent)
	if !policy.Enabled {
		return DelegationResult{Status: "unavailable", Error: "该数字伙伴未启用子伙伴派生（delegationPolicy.enabled=false）"}
	}
	task := strings.TrimSpace(in.Task)
	if task == "" {
		return DelegationResult{Status: "failed", Error: "缺少子任务描述"}
	}
	if !delegationTargetAllowed(policy, in.TargetPartnerID) {
		return DelegationResult{Status: "denied",
			Error: "目标伙伴不在 delegationPolicy.allowedTargets 白名单内：" + in.TargetPartnerID}
	}

	child := parent
	childID := in.ParentPartnerID
	if in.TargetPartnerID != "" {
		child = s.employeeByID(in.TargetPartnerID)
		if child == nil {
			return DelegationResult{Status: "failed", Error: "目标伙伴不存在：" + in.TargetPartnerID}
		}
		childID = in.TargetPartnerID
	}

	reg := filterDelegationRegistry(buildToolRegistry(child, nil), policy.InheritCapabilities)
	childConv := in.ConversationID + ":deleg:" + childID
	system := delegationSystemPrompt(child, task)
	messages := []modelprov.ChatMessage{{Role: "user", Content: task}}

	res := s.runReactTurn(ctx, reactTurnInput{
		// 子伙伴的过程不进主 SSE:给一个空发射器。
		Emit:           func(typ, stage string, extra map[string]any) {},
		Request:        in.Request,
		WorkspaceID:    in.WorkspaceID,
		ModelID:        in.ModelID,
		System:         system,
		Messages:       messages,
		Registry:       reg,
		UserMessage:    task,
		ConversationID: childConv,
		CorrelationID:  in.CorrelationID,
		DigitalPartner: childID,
		Viewer:         in.Viewer,
		SkipStream:     true,
		MaxSteps:       delegationChildMaxSteps,
		SessionMode:    in.SessionMode,
		RiskLevel:      in.RiskLevel,
		Employee:       child,
		NoBootstrap:    true,
	})
	if res.Err != nil {
		return DelegationResult{Status: "failed", Error: res.Err.Error(), ChildPartnerID: childID}
	}
	summary := strings.TrimSpace(res.Text)
	if summary == "" {
		summary = "（子伙伴未产出结论）"
	}
	return DelegationResult{
		Status:         "success",
		Summary:        summary,
		ToolCalls:      res.ToolCalls,
		ChildPartnerID: childID,
	}
}

// delegationSystemPrompt 组装子伙伴的 system prompt。
func delegationSystemPrompt(child map[string]any, task string) string {
	role := "数字伙伴"
	name := role
	if child != nil {
		if v := str(child["role"]); v != "" {
			role = v
		}
		if v := str(child["name"]); v != "" {
			name = v
		}
	}
	var b strings.Builder
	b.WriteString("你是「")
	b.WriteString(name)
	b.WriteString("」(")
	b.WriteString(role)
	b.WriteString("),正在作为子伙伴执行一个独立子任务。\n")
	b.WriteString("子任务:")
	b.WriteString(task)
	b.WriteString("\n\n要求:只完成这个子任务,不要过问上下文里没有的信息;")
	b.WriteString("完成后用一段话给出结论,结论会原样带回主伙伴。")
	return b.String()
}
