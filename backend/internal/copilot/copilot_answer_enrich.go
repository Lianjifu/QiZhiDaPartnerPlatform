// Package copilot —— 答案富化(answer enrichment)模块。
//
// 职责：把工具调用的成功产物（docx/pptx 链接、占位符文本等）合并到助手最终回复中，
// 避免 LLM 在回合末尾说"请稍候"等占位语时遗漏实际生成的产物。
//
// 关键约束：
//   - 平台严禁旁路伪造 office 产物，docx/pptx/pdf 必须来自 skill 脚本
//   - 已包含 /api/skill-artifacts/ 链接的回复尽量保留，仅替换占位段
//   - 对"请稍候""正在为您生成"等明显占位回复，主动补出"已生成 Word/PPT"行
package copilot

import (
	"fmt"
	"regexp"
	"strings"
)

// pendingAssistantReplyRE 匹配"请稍候""正在为您生成"等 LLM 在回合末尾留的占位口吻。
var pendingAssistantReplyRE = regexp.MustCompile(`(?i)(^请稍候|[，。！\s]请稍候[。.！]?$|正在为您生成|正在生成|马上为您|即将为您|请等待|稍等片刻)`)

// isPendingAssistantReply 判断给定文本是否是 LLM 的"占位等待"口吻，
// 用于在工具产物可用时主动替换占位段。
func isPendingAssistantReply(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	if hasSkillArtifacts(text) {
		return false
	}
	if strings.Contains(text, "已生成 Word 文档") || strings.Contains(text, "下载链接：") {
		return false
	}
	if strings.Contains(text, ".pptx") && strings.Contains(text, "/api/skill-artifacts/") {
		return false
	}
	runes := len([]rune(text))
	if runes > 280 {
		return false
	}
	return pendingAssistantReplyRE.MatchString(text)
}

// toolCallSucceeded 判断一次工具调用是否算"成功"。
// status 字段为空 / success / ok / succeeded 一律视为成功（兼容不同执行器的命名）。
func toolCallSucceeded(tc map[string]any) bool {
	st := strings.ToLower(strings.TrimSpace(str(tc["status"])))
	return st == "" || st == "success" || st == "ok" || st == "succeeded"
}

// bestToolArtifactOutput 从回合的工具调用列表中找出最后一个"成功且产出可下载物"的 result。
// 优先选用最新的工具记录；遇到 skill 产物 / Word 文档 / pptx 后缀即返回。
func bestToolArtifactOutput(toolCalls []map[string]any) string {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		tc := toolCalls[i]
		if !toolCallSucceeded(tc) {
			continue
		}
		result := strings.TrimSpace(str(tc["result"]))
		if result == "" {
			continue
		}
		if hasSkillArtifacts(result) || strings.Contains(result, "已生成 Word 文档") ||
			strings.Contains(strings.ToLower(result), ".pptx") {
			return result
		}
	}
	return ""
}

// docTitleFromToolOutput 从工具输出或用户消息里提取出可读的文档标题。
// 优先匹配"已生成 Word 文档「X」"、《X》、《X》 三种格式；
// 都拿不到时尝试 inferDocxTitleFromMessage 启发式推断，仍没有则回退到"生成文档"。
func docTitleFromToolOutput(toolOut, userMsg string) string {
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`已生成 Word 文档「([^」]+)」`),
		regexp.MustCompile(`《([^》]{2,32})》`),
	} {
		if m := re.FindStringSubmatch(toolOut); len(m) == 2 {
			if t := normalizeDocxTitle(m[1]); t != "生成文档" {
				return t
			}
		}
	}
	if hint := inferDocxTitleFromMessage(userMsg); hint != "" {
		return hint
	}
	if hint := inferDocxTitleFromMessage(toolOut); hint != "" {
		return hint
	}
	return "生成文档"
}

// enrichCopilotFinalText merges successful tool outputs into the assistant reply
// without fabricating office artifacts (docx/pptx/pdf must come from skill scripts).
func enrichCopilotFinalText(full string, toolCalls []map[string]any, userMsg string) string {
	full = strings.TrimSpace(full)
	toolOut := strings.TrimSpace(bestToolArtifactOutput(toolCalls))
	if toolOut == "" {
		return full
	}
	artifactBlock := formatArtifactSegmentContent(toolOut)
	if artifactBlock == "" {
		artifactBlock = strings.TrimSpace(toolOut)
	}
	if artifactBlock == "" {
		return full
	}
	if hasSkillArtifacts(full) {
		if looksLikePptxGenerateRequest(userMsg) || hasPptxArtifactText(full) || hasPptxArtifactText(toolOut) {
			return full
		}
		body := resolveDocxBodyForTurn(full, toolCalls, userMsg)
		if body == "" {
			body = sanitizeDocxBody(extractDocxBodyFromSkillOutput(toolOut))
		}
		if body != "" {
			return ensureSkillArtifactsInOutput(full, docTitleFromToolOutput(toolOut, userMsg), body)
		}
		return full
	}
	title := docTitleFromToolOutput(toolOut, userMsg)
	body := resolveDocxBodyForTurn(full, toolCalls, userMsg)
	if body == "" {
		body = sanitizeDocxBody(extractDocxBodyFromSkillOutput(toolOut))
	}
	if body == "" || isPendingAssistantReply(body) {
		if strings.Contains(strings.ToLower(toolOut), ".pptx") || strings.Contains(strings.ToLower(userMsg), "ppt") {
			body = fmt.Sprintf("已为您生成 PPT 文档「%s」。", coalesce(inferPptxTitleFromMessage(userMsg), title))
		} else {
			body = fmt.Sprintf("已为您生成 Word 文档「%s」。", title)
		}
	}
	if isPendingAssistantReply(full) || full == "" {
		if artifactBlock != "" && !strings.Contains(body, artifactBlock) {
			return strings.TrimSpace(body + "\n\n" + artifactBlock)
		}
		return strings.TrimSpace(coalesce(body, artifactBlock))
	}
	if artifactBlock != "" && !strings.Contains(full, artifactBlock) {
		return strings.TrimSpace(full + "\n\n" + artifactBlock)
	}
	return full
}
