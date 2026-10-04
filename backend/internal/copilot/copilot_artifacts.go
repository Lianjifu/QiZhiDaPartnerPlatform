// Package copilot —— 产物段(artifact segment)渲染模块。
//
// 职责：把 assistant 回复中的 /api/skill-artifacts/ 链接
// 渲染成独立的"下载"段（或 inline 卡片），并对噪声行（文件名/下载链接/裸链接）
// 做去重清理。
package copilot

import (
	"fmt"
	"regexp"
	"strings"
)

// skillArtifactPathRE 匹配文本中的 /api/skill-artifacts/<id> 链接。
// downloadLineRE / displayNameLineRE 匹配常见的"下载链接：""文件名："前缀噪声行。
var (
	skillArtifactPathRE = regexp.MustCompile(`/api/skill-artifacts/([^\s)\]"'` + "`" + `<>]+)`)
	downloadLineRE      = regexp.MustCompile(`^\s*(?:📄\s*)?(?:下载链接|下载|文件名)\s*[:：]`)
	displayNameLineRE   = regexp.MustCompile(`^\s*(?:📄\s*)?文件名\s*[:：]\s*[` + "`" + `"'《]?([^` + "`" + `"'》\n]+?)[` + "`" + `"'》]?\s*$`)
)

// hasSkillArtifacts 判断文本中是否包含 /api/skill-artifacts/ 链接。
func hasSkillArtifacts(text string) bool {
	return skillArtifactPathRE.MatchString(text)
}

// stripArtifactNoise 把"文件名：""下载链接："前缀行、裸链接行从 assistant 正文里去掉。
// 保留正文中其他内容；不命中产物链接时不做处理。
func stripArtifactNoise(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return text
	}
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if downloadLineRE.MatchString(line) && skillArtifactPathRE.MatchString(line) {
			continue
		}
		if displayNameLineRE.MatchString(line) && skillArtifactPathRE.MatchString(line) {
			continue
		}
		if skillArtifactPathRE.MatchString(trim) && strings.Count(trim, " ") < 4 {
			continue
		}
		cleaned := skillArtifactPathRE.ReplaceAllString(line, "")
		cleaned = strings.TrimRight(cleaned, " ")
		if strings.TrimSpace(cleaned) == "" {
			continue
		}
		out = append(out, cleaned)
	}
	merged := strings.TrimSpace(strings.Join(out, "\n"))
	for strings.Contains(merged, "\n\n\n") {
		merged = strings.ReplaceAll(merged, "\n\n\n", "\n\n")
	}
	return merged
}

// formatArtifactSegmentContent 把 assistant 全文里所有产物链接整理成"下载链接：X / 文件名：Y"的展示行。
// 多次出现同一行会去重；只识别 .docx / .pptx / .pdf 等以 /api/skill-artifacts/ 为前缀的真实产物。
func formatArtifactSegmentContent(full string) string {
	full = strings.TrimSpace(full)
	if full == "" || !hasSkillArtifacts(full) {
		return ""
	}
	var lines []string
	seen := map[string]struct{}{}
	for _, line := range strings.Split(full, "\n") {
		if !skillArtifactPathRE.MatchString(line) {
			continue
		}
		trim := strings.TrimSpace(line)
		if trim == "" {
			continue
		}
		if _, ok := seen[trim]; ok {
			continue
		}
		seen[trim] = struct{}{}
		if downloadLineRE.MatchString(trim) || displayNameLineRE.MatchString(trim) {
			lines = append(lines, trim)
			continue
		}
		m := skillArtifactPathRE.FindStringSubmatch(trim)
		if len(m) < 2 {
			continue
		}
		name := docxDisplayNameFromStorage(m[1])
		lines = append(lines, fmt.Sprintf("下载链接：%s", m[0]))
		if name != "" {
			lines = append(lines, fmt.Sprintf("文件名：%s", name))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n")
}

// artifactSegmentSeparate 为 true 时下载卡片独立成段；默认 inline（单气泡内卡片）。
func artifactSegmentSeparate() bool {
	if envFlagTrue("DE_COPILOT_ARTIFACT_SEGMENT") {
		return true
	}
	return envFlagFalse("DE_COPILOT_ARTIFACT_INLINE")
}

// artifactSegmentID 产出下载段的 ID：优先复用 firstMessageID 后缀，否则用 idGen，
// 都不可用时回退到 "msg_artifact" 常量。
func artifactSegmentID(firstMessageID string, idGen func() string) string {
	if firstMessageID != "" {
		return firstMessageID + "_artifact"
	}
	if idGen != nil {
		return idGen()
	}
	return "msg_artifact"
}

// appendArtifactSegments 把 assistant 段列表里的"正文/总结/确认"段先清一遍产物噪声，
// 再把整理好的下载行作为独立的 artifact 段追加到尾部。
func appendArtifactSegments(segs []AssistantSegment, full, firstMessageID string, idGen func() string) []AssistantSegment {
	art := formatArtifactSegmentContent(full)
	for i := range segs {
		switch segs[i].Kind {
		case segmentKindBody, segmentKindSummary, segmentKindAck:
			segs[i].Content = stripArtifactNoise(segs[i].Content)
		}
	}
	if art == "" {
		return segs
	}
	return append(segs, AssistantSegment{
		ID:      artifactSegmentID(firstMessageID, idGen),
		Kind:    segmentKindArtifact,
		Title:   "下载",
		Content: art,
	})
}
