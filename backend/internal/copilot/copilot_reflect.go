package copilot

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

const reflectMaxRounds = 2

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
	b.WriteString("请对助手回答做简短自我批评（3 条以内），指出事实缺口、步骤遗漏或工具失败未处理处，然后给出修订后的最终中文回答。\n")
	b.WriteString("不要输出 TOOL/PLAN 标记。\n")
	b.WriteString("触发原因：")
	b.WriteString(reason)
	b.WriteString("\n")
	if reason == "cognitive_structure_weak" {
		b.WriteString("请按当前认知框架补齐：结论/依据或问题定义/行动或候选方案/有条件推荐等可见结构。\n")
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

// applyReflection optionally revises the answer up to reflectMaxRounds.
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
		text, rt, err := s.Deps.StreamLLMForCopilotFn(ctx, in.Request, in.WorkspaceID, in.ModelID, msgs, system, func(chunk, mid string) error {
			if mid != "" {
				current.ModelID = mid
			}
			buf.WriteString(chunk)
			return nil
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
