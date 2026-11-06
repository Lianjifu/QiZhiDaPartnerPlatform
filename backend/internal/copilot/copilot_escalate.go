// copilot_escalate.go —— 数字伙伴的自动升级（交接）。
//
// 产品语义：伙伴配置里 boundaryPolicy.handoff.triggers + approvers 声明了
// "什么情况下这个岗位要移交人"。配置在 M05 落库时就已强制要求（见
// internal/server/employee_validate.go 的 validateEmployeeConfigurationBody），
// 但运行期一直没有实现 —— handoffs24h 只是从审计里 grep "交接" 计数。
//
// 本文件补上运行期：
//   - 读伙伴的升级触发条件（白名单式，未配置即不启用）
//   - 命中时调用 Deps.Escalation.EscalateFn，把会话移交给接管人并暂停写操作
//
// 关键约束：
//   - 未配置 handoff 的伙伴永不自动升级（默认关闭，避免打断正常工作）
//   - 升级是"暂停 + 移交"，不是"失败"：伙伴仍可继续只读作答
package copilot

import (
	"strings"
)

// escalateFailureThreshold 是同一工具连续失败多少次后触发自动升级。
const escalateFailureThreshold = 2

// escalateTriggerProhibited 表示伙伴尝试执行被边界策略禁止的能力。
const escalateTriggerProhibited = "prohibited_action"

// escalateTriggerToolFailure 表示工具连续失败、伙伴在同一目标上打转。
const escalateTriggerToolFailure = "tool_failure"

// escalateTriggerUserRequest 表示用户显式要求转人工。
const escalateTriggerUserRequest = "user_request"

// escalateTriggerBoundaryExceeded 表示请求超出岗位职责边界。
const escalateTriggerBoundaryExceeded = "boundary_exceeded"

// escalateTriggerDescriptions 是触发条件的可读说明(用于交接说明文案)。
var escalateTriggerDescriptions = map[string]string{
	escalateTriggerProhibited:       "尝试执行被禁止的能力",
	escalateTriggerToolFailure:      "工具连续失败",
	escalateTriggerUserRequest:      "用户要求转人工",
	escalateTriggerBoundaryExceeded: "超出岗位职责边界",
}

// handoffTriggers 返回伙伴配置的升级触发条件集合。
//
// 存储形状:emp["boundaryPolicy"]["handoff"]["triggers"] = ["prohibited_action", ...]
// 兼容另一种写法:emp["boundaryPolicy"]["handoffTriggers"]。
// 读不到或为空 → 返回空集合(自动升级不启用)。
func handoffTriggers(emp map[string]any) map[string]bool {
	out := map[string]bool{}
	if emp == nil {
		return out
	}
	bp, _ := emp["boundaryPolicy"].(map[string]any)
	if bp == nil {
		return out
	}
	collect := func(v any) {
		for _, t := range stringSlice(v) {
			t = strings.ToLower(strings.TrimSpace(t))
			if t == "" {
				continue
			}
			out[t] = true
		}
	}
	if h, ok := bp["handoff"].(map[string]any); ok {
		collect(h["triggers"])
	}
	collect(bp["handoffTriggers"])
	return out
}

// escalationEnabled 判断伙伴是否配置了自动升级。
func escalationEnabled(emp map[string]any) bool {
	return len(handoffTriggers(emp)) > 0
}

// maybeEscalate 在命中升级条件时把会话移交给接管人。
//
// 返回 true 表示已发起升级(调用方可以在最终回答里告知用户已移交)。
// 未配置 / 未接线 / 命中失败时返回 false,不阻断本回合。
func (s *Service) maybeEscalate(in reactTurnInput, trigger, reason, toolName string) bool {
	if s == nil || s.Deps.Escalation.EscalateFn == nil {
		return false
	}
	triggers := handoffTriggers(in.Employee)
	if len(triggers) == 0 {
		return false
	}
	if !triggers[strings.ToLower(strings.TrimSpace(trigger))] {
		return false
	}
	if reason == "" {
		reason = escalateTriggerDescriptions[strings.ToLower(strings.TrimSpace(trigger))]
	}
	out, err := s.Deps.Escalation.EscalateFn(EscalationInput{
		WorkspaceID:      in.WorkspaceID,
		ConversationID:   in.ConversationID,
		CorrelationID:    in.CorrelationID,
		DigitalPartnerID: in.DigitalPartner,
		Trigger:          trigger,
		Reason:           reason,
		ToolName:         toolName,
	})
	if err != nil {
		return false
	}
	if out == nil {
		return false
	}
	if escalated, _ := out["escalated"].(bool); !escalated {
		return false
	}
	if in.Emit != nil {
		in.Emit("escalation", "handoff", map[string]any{
			"trigger":  trigger,
			"reason":   reason,
			"owner":    out["ownerName"],
			"actionId": out["actionId"],
		})
	}
	return true
}
