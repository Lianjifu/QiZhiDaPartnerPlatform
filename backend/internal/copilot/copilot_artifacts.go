package copilot

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	skillArtifactPathRE = regexp.MustCompile(`/api/skill-artifacts/([^\s)\]"'` + "`" + `<>]+)`)
	downloadLineRE      = regexp.MustCompile(`^\s*(?:📄\s*)?(?:下载链接|下载|文件名)\s*[:：]`)
	displayNameLineRE   = regexp.MustCompile(`^\s*(?:📄\s*)?文件名\s*[:：]\s*[` + "`" + `"'《]?([^` + "`" + `"'》\n]+?)[` + "`" + `"'》]?\s*$`)
)

func hasSkillArtifacts(text string) bool {
	return skillArtifactPathRE.MatchString(text)
}

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

func artifactSegmentID(firstMessageID string, idGen func() string) string {
	if firstMessageID != "" {
		return firstMessageID + "_artifact"
	}
	if idGen != nil {
		return idGen()
	}
	return "msg_artifact"
}

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
