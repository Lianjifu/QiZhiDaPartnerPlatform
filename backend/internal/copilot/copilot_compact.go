// copilot_compact.go —— P4 会话压缩(context compaction)。
//
// 问题:会话历史按固定窗口(copilotHistoryMaxMessages = 24 条)截断,
//
//	超出部分直接丢弃 —— 一个岗位连做几十轮之后,最初的任务目标、
//	边界条件、已经确认的结论全没了,伙伴开始"失忆"。
//
// 做法:历史超过阈值时,把较早的部分压成一段摘要(优先用模型总结,
//
//	失败则退回确定性摘要),保留最近若干轮原文。
//
// 关键约束:
//   - 压缩不删除任何原始记录:原始消息仍在会话里落库,可审计、可回放
//   - 摘要失败时退回确定性摘要,不阻断回合
package copilot

import (
	"context"
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

const (
	// compactTriggerMessages 是触发压缩的历史消息条数阈值(约 24 轮)。
	compactTriggerMessages = 48
	// compactKeepMessages 是压缩后原样保留的最近消息条数。
	compactKeepMessages = 24
	// compactSummaryMaxRunes 是确定性摘要的最大长度。
	compactSummaryMaxRunes = 1200
)

// CompactConversationHistory 把过长的会话历史压成"摘要 + 最近若干轮"。
//
// 返回 (压缩后的消息列表, 压缩信息)。未触发压缩时原样返回,信息里的
// compacted 为 false。
func (s *Service) CompactConversationHistory(
	ctx context.Context,
	r *http.Request,
	ws, cid, modelID, corr string,
	stored []map[string]any,
) ([]map[string]any, map[string]any) {
	info := map[string]any{"compacted": false}
	if len(stored) <= compactTriggerMessages {
		return stored, info
	}
	keep := compactKeepMessages
	if keep >= len(stored) {
		keep = len(stored) / 2
	}
	older := stored[:len(stored)-keep]
	recent := stored[len(stored)-keep:]

	summary := s.summarizeHistory(ctx, r, ws, cid, modelID, corr, older)
	head := map[string]any{
		"role":             "user",
		"content":          "【会话历史摘要 · 早期 " + itoa(len(older)) + " 条】\n" + summary,
		"compactedSummary": true,
	}
	out := make([]map[string]any, 0, len(recent)+1)
	out = append(out, head)
	out = append(out, recent...)
	info["compacted"] = true
	info["compactedFrom"] = len(older)
	info["keptMessages"] = len(recent)
	info["summaryRunes"] = len([]rune(summary))
	return out, info
}

// summarizeHistory 生成早期历史的摘要。
//
// 优先用模型总结(一句话保留目标 / 结论 / 约束 / 待办);模型不可用时退回
// 确定性摘要 —— 宁可粗糙,也不能因为摘要失败而丢掉上下文。
func (s *Service) summarizeHistory(
	ctx context.Context,
	r *http.Request,
	ws, cid, modelID, corr string,
	older []map[string]any,
) string {
	digest := buildHistoryDigest(older)
	if s == nil || s.Deps.Routing.StreamLLMForCopilotFn == nil || strings.TrimSpace(digest) == "" {
		return fallbackHistoryDigest(older)
	}
	msgs := []modelprov.ChatMessage{{Role: "user", Content: digest}}
	prompt := "请把上面的会话历史压缩成不超过 300 字的要点摘要,保留:任务目标、已确认的结论、边界与约束、待办事项。只输出摘要正文。"
	text, _, _, err := s.Deps.Routing.StreamLLMForCopilotFn(ctx, r, ws, modelID, msgs, prompt, LLMCallOptions{}, func(string, string) error { return nil })
	if err != nil || strings.TrimSpace(text) == "" {
		return fallbackHistoryDigest(older)
	}
	return truncateRunes(strings.TrimSpace(text), compactSummaryMaxRunes)
}

// buildHistoryDigest 把历史消息拼成可摘要的文本。
func buildHistoryDigest(older []map[string]any) string {
	var b strings.Builder
	for _, m := range older {
		role := strings.ToLower(strings.TrimSpace(str(m["role"])))
		content := strings.TrimSpace(str(m["content"]))
		if content == "" {
			continue
		}
		switch role {
		case "user":
			b.WriteString("用户: ")
			b.WriteString(truncateRunes(content, 300))
			b.WriteString("\n")
		case "assistant":
			b.WriteString("伙伴: ")
			b.WriteString(truncateRunes(content, 300))
			b.WriteString("\n")
		}
	}
	return strings.TrimSpace(b.String())
}

// fallbackHistoryDigest 是模型不可用时的确定性摘要。
func fallbackHistoryDigest(older []map[string]any) string {
	var b strings.Builder
	b.WriteString("早期会话要点:\n")
	for _, m := range older {
		role := strings.ToLower(strings.TrimSpace(str(m["role"])))
		content := strings.TrimSpace(str(m["content"]))
		if content == "" {
			continue
		}
		if role == "user" {
			b.WriteString("- 提问: ")
			b.WriteString(truncateRunes(content, 120))
			b.WriteString("\n")
			continue
		}
		if role == "assistant" {
			b.WriteString("- 回答: ")
			b.WriteString(truncateRunes(content, 120))
			b.WriteString("\n")
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		return "（早期会话无有效内容）"
	}
	return truncateRunes(out, compactSummaryMaxRunes)
}
