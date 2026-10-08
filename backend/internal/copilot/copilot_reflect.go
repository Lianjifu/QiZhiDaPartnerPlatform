// Package copilot —— 反思(reflect)节点。
//
// 在主回合产出 finalText 之后，按 shouldReflect 判定是否需要进入反思轮次，
// 最长 reflectMaxRounds 轮；每轮给 LLM 一段"自我批评 + 修订"prompt，
// 解析出 critique / revised 两个段，再把 revised 替换回去。
//
// 触发原因透传给前端 SSE（reason 字段），便于 UI 显示"为什么 AI 又改了一次"。
package copilot

// copilot_reflect.go — 反思阶段:回合结束后评估输出是否合格,不通过则回流到 react
// 重试(通常有上限次数)。与 self-improving/ 联动,负面反馈会写入反思样本库。

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

const reflectMaxRounds = 2

// shouldReflect 决定要不要进入反思轮。
//
// 触发条件（任一命中即 true）：
//   - reflectHint 非空（用户在前端显式点了"让 AI 再想想"）
//   - finalText 为空或 <8 字
//   - 任一工具调用 status=failed
//   - 有工具被 deny 且回复里出现"无法"
//   - deep 模式下认知结构不达标（缺"行动/结论/推荐"等关键词）
//
// 返回的 reason 会透传给 SSE event，方便前端显示为什么 AI 又改了一版。
func shouldReflect(result reactTurnResult, reflectHint string) (bool, string) {
	if strings.TrimSpace(reflectHint) != "" {
		return true, "user_feedback"
	}
	if strings.TrimSpace(result.Text) == "" || utf8.RuneCountInString(result.Text) < 8 {
		return true, "empty_or_short_answer"
	}
	failed := 0
	denied := 0
	for _, tc := range result.ToolCalls {
		switch str(tc["status"]) {
		case "failed":
			failed++
		case "denied":
			// disabled/approval are expected; only count unexpected deny if permission is policy/runtime
			perm := str(tc["permission"])
			if perm == "policy" || perm == "" || perm == "deny" {
				denied++
			}
		}
	}
	if failed > 0 {
		return true, "tool_failed"
	}
	if denied > 0 && failed == 0 && strings.Contains(strings.ToLower(result.Text), "无法") {
		return true, "tool_denied_weak_answer"
	}
	if lookslikeCognitiveAnswerWeak(result.Text, result.Cognitive) {
		return true, "cognitive_structure_weak"
	}
	return false, ""
}

func buildCritiquePrompt(answer, userMsg, hint, reason string, toolCalls []map[string]any) string {
	var b strings.Builder
	// 反思主指令 + 工具/规划标记禁用规则走版本化注册表
	b.WriteString(promptGet("system.reflect.critique"))
	b.WriteString(promptGet("system.part.tool_plan_rule"))
	b.WriteString("触发原因：")
	b.WriteString(reason)
	b.WriteString("\n")
	if reason == "cognitive_structure_weak" {
		b.WriteString(promptGet("system.reflect.cognitive_structure_weak"))
	}
	if hint != "" {
		b.WriteString("用户反馈：")
		b.WriteString(hint)
		b.WriteString("\n")
	}
	b.WriteString("用户问题：")
	b.WriteString(userMsg)
	b.WriteString("\n原回答：\n")
	b.WriteString(truncateRunes(answer, 1500))
	b.WriteString("\n")
	if len(toolCalls) > 0 {
		b.WriteString("工具轨迹：\n")
		for _, tc := range toolCalls {
			b.WriteString("- ")
			b.WriteString(str(tc["name"]))
			b.WriteString(" · ")
			b.WriteString(str(tc["status"]))
			if e := str(tc["error"]); e != "" {
				b.WriteString(" · ")
				b.WriteString(e)
			}
			b.WriteString("\n")
		}
	}
	b.WriteString("请按格式输出：\n【批评】...\n【修订回答】...\n")
	return b.String()
}

func parseReflectOutput(text string) (critique, revised string) {
	text = strings.TrimSpace(text)
	critique = text
	revised = text
	if i := strings.Index(text, "【修订回答】"); i >= 0 {
		revised = strings.TrimSpace(text[i+len("【修订回答】"):])
		critique = strings.TrimSpace(text[:i])
		critique = strings.TrimPrefix(critique, "【批评】")
		critique = strings.TrimSpace(critique)
	} else if i := strings.Index(text, "修订回答"); i >= 0 {
		// softer split
		parts := strings.SplitN(text, "修订回答", 2)
		if len(parts) == 2 {
			critique = strings.TrimSpace(parts[0])
			revised = strings.TrimSpace(strings.TrimPrefix(parts[1], "："))
			revised = strings.TrimSpace(strings.TrimPrefix(revised, ":"))
		}
	}
	if revised == "" {
		revised = text
	}
	return critique, revised
}

// applyReflection 把反思循环挂到主回合之后，最多 reflectMaxRounds 轮。
//
// 每轮流程：
//  1. emit "reflect running" SSE
//  2. 用 buildCritiquePrompt 拼自我批评 + 修订 prompt
//  3. 调 StreamLLMForCopilotFn 拿回应
//  4. parseReflectOutput 切分 【批评】/【修订回答】 两段
//  5. emit "reflect ok" + thought 事件
//  6. revised 为空或与上一版相同 → break（修订收敛）
//  7. 再次跑 shouldReflect(, "") 决定是否继续（仅在有用户反馈时多轮）
//
// 把修订后的 current.Text 回填给上层（copilot_stream 的 finalize）做最终段流式。
func (s *Service) applyReflection(ctx context.Context, in reactTurnInput, result reactTurnResult, reflectHint string) reactTurnResult {
	result.Cognitive = in.Cognitive
	ok, reason := shouldReflect(result, reflectHint)
	if !ok {
		return result
	}

	messages := append([]modelprov.ChatMessage{}, in.Messages...)
	system := strings.TrimSpace(in.System)
	if system != "" {
		system += "\n\n"
	}
	system += "你是质量审阅与自我修正节点。优先修正事实与可执行性，保持岗位边界。"

	current := result
	for round := 1; round <= reflectMaxRounds; round++ {
		in.Emit("reflect", "reflect", map[string]any{
			"status": "running", "round": round, "reason": reason, "maxRounds": reflectMaxRounds,
		})
		prompt := buildCritiquePrompt(current.Text, in.UserMessage, reflectHint, reason, current.ToolCalls)
		msgs := append([]modelprov.ChatMessage{}, messages...)
		msgs = append(msgs, modelprov.ChatMessage{Role: "user", Content: prompt})

		var buf strings.Builder
		text, rt, err := withLLMRetry(ctx, func(ctx context.Context) (string, ResolvedTurn, error) {
			return s.Deps.Routing.StreamLLMForCopilotFn(ctx, in.Request, in.WorkspaceID, in.ModelID, msgs, system, func(chunk, mid string) error {
				if mid != "" {
					current.ModelID = mid
				}
				buf.WriteString(chunk)
				return nil
			})
		})
		if err != nil && buf.Len() == 0 && text == "" {
			in.Emit("reflect", "reflect", map[string]any{"status": "failed", "round": round, "error": err.Error()})
			break
		}
		if err == nil {
			current.Resolved = rt
			current.ModelID = coalesce(rt.ModelID, current.ModelID)
		}
		raw := coalesce(text, buf.String())
		critique, revised := parseReflectOutput(raw)
		in.Emit("reflect", "reflect", map[string]any{
			"status": "ok", "round": round, "reason": reason,
		})
		if c := strings.TrimSpace(critique); c != "" {
			emitThought(in.Emit, "reflect", turnPhaseReflect, "反思："+truncateRunes(c, 80), reason)
		} else {
			emitThought(in.Emit, "reflect", turnPhaseReflect, "已复核回复质量", reason)
		}
		if strings.TrimSpace(revised) == "" || revised == current.Text {
			current.ReflectRounds = round
			break
		}
		current.Text = stripToolCallMarkers(revised)
		current.ReflectRounds = round
		// Only continue if still failing hard criteria and user feedback remains
		again, nextReason := shouldReflect(current, "")
		if !again || reflectHint == "" {
			break
		}
		reason = nextReason
	}
	return current
}
