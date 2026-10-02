package copilot

import (
	"fmt"
	"regexp"
	"strings"
)

var pendingAssistantReplyRE = regexp.MustCompile(`(?i)(^请稍候|[，。！\s]请稍候[。.！]?$|正在为您生成|正在生成|马上为您|即将为您|请等待|稍等片刻)`)

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

func toolCallSucceeded(tc map[string]any) bool {
	st := strings.ToLower(strings.TrimSpace(str(tc["status"])))
	return st == "" || st == "success" || st == "ok" || st == "succeeded"
}

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
