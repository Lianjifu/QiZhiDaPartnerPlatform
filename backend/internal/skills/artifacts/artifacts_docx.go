package artifacts

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
)

// DOCX-specific artifact helpers. Companion to artifacts.go (which
// owns the cross-format HTTP handlers + common helpers), pdf.go
// (PDF format), and pptx_preview.go / pptx_validate.go (PPTX inline
// preview + OOXML validation).

// DOCX regex vars — kept package-level so they compile once and
// can be reused by any test in the package.
var (
	reSkillDocxPrefix   = regexp.MustCompile(`(?i)^skill[_-]?docx[_-]*`)
	reDocxSuffix        = regexp.MustCompile(`(?i)(_docx|\.docx)$`)
	reDocxPlaceholderKV = regexp.MustCompile(`(?i)^\s*title\s*=\s*.+\s*,\s*content\s*=`)
)

// LooksLikeCodeAsDocxBody detects python-docx scripts that were
// mistakenly treated as a Word document body. Such scripts look like
// real "document" content to a naïve heuristic but produce broken
// Word files when fed to the docx generator.
func LooksLikeCodeAsDocxBody(content string) bool {
	s := strings.TrimSpace(content)
	if s == "" {
		return false
	}
	lower := strings.ToLower(s)
	strong := []string{
		"from docx import",
		"import docx",
		"document()",
		"qn('w:eastasia')",
		"wd_align_paragraph",
		"python-docx",
		"```python",
		"add_heading(",
		"add_paragraph(",
	}
	for _, sig := range strong {
		if strings.Contains(lower, sig) {
			return true
		}
	}
	lines := strings.Split(s, "\n")
	codeLines := 0
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" {
			continue
		}
		if strings.HasPrefix(trim, "import ") || strings.HasPrefix(trim, "from ") ||
			strings.HasPrefix(trim, "def ") || strings.HasPrefix(trim, "class ") {
			codeLines++
		}
	}
	return codeLines >= 2
}

// looksLikeDocxPlaceholderBody detects LLM summary / "title=content="
// strings that were mistakenly treated as document body.
func looksLikeDocxPlaceholderBody(content string) bool {
	s := strings.TrimSpace(content)
	if s == "" {
		return false
	}
	if reDocxPlaceholderKV.MatchString(s) {
		return true
	}
	runes := len([]rune(s))
	if runes >= 160 && looksLikeStructuredDocxBody(s) {
		return false
	}
	lower := strings.ToLower(s)
	for _, hint := range []string{
		"可编辑", "摘要", "按检索", "整理的正文", "整理的可编辑", "占位", "placeholder",
		"待生成", "模板正文", "正文内容", "详见", "如下所示",
	} {
		if strings.Contains(lower, hint) && runes < 160 {
			return true
		}
	}
	if runes < 80 && !looksLikeStructuredDocxBody(s) {
		return true
	}
	return false
}

func looksLikeStructuredDocxBody(s string) bool {
	for _, marker := range []string{
		"一、", "二、", "三、", "（一）", "##", "###",
		"岗位职责", "任职要求", "招聘信息", "基本信息", "任职资格",
	} {
		if strings.Contains(s, marker) {
			return true
		}
	}
	return strings.Count(s, "\n") >= 4
}

// sanitizeDocxBody drops any content that fails the code / placeholder
// guards above. Empty result = caller should refuse generation.
func sanitizeDocxBody(content string) string {
	if LooksLikeCodeAsDocxBody(content) || looksLikeDocxPlaceholderBody(content) || looksLikeClarificationSpeech(content) {
		return ""
	}
	return strings.TrimSpace(content)
}

// docxToolSucceeded reports whether a docx-class tool completed
// successfully this turn. Walks the toolCalls slice in reverse so the
// last attempt wins.
func docxToolSucceeded(toolCalls []map[string]any) bool {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		tc := toolCalls[i]
		name := strings.ToLower(str(tc["name"]))
		if !IsDocxSkillName(name) && !strings.Contains(name, "docx") {
			continue
		}
		st := strings.ToLower(strings.TrimSpace(str(tc["status"])))
		if st == "" || st == "success" || st == "ok" || st == "succeeded" {
			return true
		}
	}
	return false
}

// docxPreviewText flattens the blocks[] array returned by
// generate_docx.py --preview-json into a single paragraph stream.
func docxPreviewText(payload map[string]any) string {
	raw, ok := payload["blocks"].([]any)
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, item := range raw {
		m, _ := item.(map[string]any)
		b.WriteString(str(m["text"]))
		b.WriteByte('\n')
	}
	return strings.TrimSpace(b.String())
}

func docxPreviewLooksLikeCode(payload map[string]any) bool {
	return LooksLikeCodeAsDocxBody(docxPreviewText(payload))
}

func docxPreviewLooksLikePlaceholder(payload map[string]any) bool {
	return looksLikeDocxPlaceholderBody(docxPreviewText(payload))
}

// docxPreviewSubstantiallyShorterThan triggers a regenerate when the
// on-disk preview is much shorter than the body we just synthesized
// (the previous preview must be stale).
func docxPreviewSubstantiallyShorterThan(payload map[string]any, body string) bool {
	preview := docxPreviewText(payload)
	if preview == "" || body == "" {
		return false
	}
	pr, br := len([]rune(preview)), len([]rune(body))
	if looksLikeDocxPlaceholderBody(preview) {
		return br > pr+20
	}
	return br >= 200 && pr < br/3
}

// normalizeDocxTitle turns LLM / tool noise into a short readable
// Chinese title. Strips skill-docx prefixes, suffix `.docx`,
// punctuation, and collapses whitespace.
func normalizeDocxTitle(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.Trim(s, "《》「」『』\"'`")
	s = reSkillDocxPrefix.ReplaceAllString(s, "")
	s = reDocxSuffix.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "__", " ")
	s = strings.ReplaceAll(s, "_", " ")
	s = reMultiSpace.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	// Drop leading hex id if title itself was a storage name
	s = reArtifactIDPref.ReplaceAllString(s, "")
	s = reSkillDocxPrefix.ReplaceAllString(s, "")
	s = reDocxSuffix.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)
	if s == "" || strings.EqualFold(s, "docx") || s == "文档生成" || s == "word" {
		return "生成文档"
	}
	runes := []rune(s)
	if len(runes) > 32 {
		s = string(runes[:32])
	}
	return strings.TrimSpace(s)
}

// docxDownloadBasename is the user-facing download name,
// e.g. 招聘岗位模板.docx.
func docxDownloadBasename(title string) string {
	title = normalizeDocxTitle(title)
	var b strings.Builder
	for _, r := range title {
		switch {
		case unicode.Is(unicode.Han, r):
			b.WriteRune(r)
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
		case r == '-' || r == '·':
			b.WriteRune(r)
		case unicode.IsSpace(r):
			// skip spaces in filenames for cleaner downloads
		default:
			// drop punctuation / book marks
		}
	}
	base := strings.Trim(b.String(), ".-")
	if base == "" {
		base = "生成文档"
	}
	if utf8.RuneCountInString(base) > 32 {
		base = string([]rune(base)[:32])
	}
	return base + ".docx"
}

// docxStorageName keeps a short id prefix to avoid collisions on disk.
func docxStorageName(downloadBasename string) string {
	base := filepath.Base(downloadBasename)
	if !strings.HasSuffix(strings.ToLower(base), ".docx") {
		base += ".docx"
	}
	id := fmt.Sprintf("%x", time.Now().UnixNano()%0xffffffffffff)
	if len(id) > 12 {
		id = id[len(id)-12:]
	}
	return id + "-" + base
}

// docxDisplayNameFromStorage strips the collision id for
// Content-Disposition / UI display.
func docxDisplayNameFromStorage(storage string) string {
	name := filepath.Base(strings.TrimSpace(storage))
	if reArtifactIDPref.MatchString(name) {
		rest := reArtifactIDPref.ReplaceAllString(name, "")
		if rest != "" {
			return docxDownloadBasename(rest)
		}
	}
	return docxDownloadBasename(name)
}

// ensureDocxArtifactOnDisk guarantees a .docx exists in the local
// artifact dir. Replaces any existing placeholder / code-only docx
// with a fresh one generated from `content`.
func ensureDocxArtifactOnDisk(title, content, preferredStorage string) (storageName, downloadPath string, err error) {
	preferredStorage = skillArtifactStorageName(preferredStorage)
	body := sanitizeDocxBody(content)
	if preferredStorage != "" && skillArtifactExists(preferredStorage) {
		replace := false
		if payload, previewErr := loadDocxPreviewPayload(preferredStorage); previewErr == nil {
			if docxPreviewLooksLikeCode(payload) || docxPreviewLooksLikePlaceholder(payload) {
				replace = true
			} else if body != "" && docxPreviewSubstantiallyShorterThan(payload, body) {
				replace = true
			}
		}
		if replace && body != "" {
			_ = os.Remove(skillArtifactFilePath(preferredStorage))
		} else if !replace {
			return preferredStorage, "/api/skill-artifacts/" + preferredStorage, nil
		} else {
			return preferredStorage, "/api/skill-artifacts/" + preferredStorage, nil
		}
	}
	if preferredStorage != "" {
		if fetchErr := fetchSkillArtifactFromRuntime(preferredStorage); fetchErr == nil && skillArtifactExists(preferredStorage) {
			return preferredStorage, "/api/skill-artifacts/" + preferredStorage, nil
		}
	}
	if body != "" && preferredStorage != "" && strings.HasSuffix(strings.ToLower(preferredStorage), ".docx") {
		return generateDocxArtifactLocalNamed(title, content, preferredStorage)
	}
	return generateDocxArtifactLocal(title, content)
}

func replaceSkillArtifactPath(output, oldStorage, newStorage string) string {
	if oldStorage == "" || newStorage == "" || oldStorage == newStorage {
		return output
	}
	oldPath := "/api/skill-artifacts/" + oldStorage
	newPath := "/api/skill-artifacts/" + newStorage
	out := strings.ReplaceAll(output, oldPath, newPath)
	encOld := "/api/skill-artifacts/" + url.PathEscape(oldStorage)
	encNew := "/api/skill-artifacts/" + url.PathEscape(newStorage)
	return strings.ReplaceAll(out, encOld, encNew)
}

// ensureSkillArtifactsInOutput syncs .docx artifacts already referenced
// in assistant output (no new generation). Skips regeneration when the
// output already mentions a .pptx artifact, so a single PPTX turn
// doesn't accidentally produce a duplicate Word file.
func ensureSkillArtifactsInOutput(output, title, content string) string {
	if strings.TrimSpace(output) == "" {
		return output
	}
	if hasPptxArtifactText(output) {
		re := regexp.MustCompile(`/api/skill-artifacts/([^\s)\]"'` + "`" + `<>]+)`)
		hasDocxLink := false
		for _, m := range re.FindAllStringSubmatch(output, -1) {
			if len(m) >= 2 && strings.HasSuffix(strings.ToLower(skillArtifactStorageName(m[1])), ".docx") {
				hasDocxLink = true
				break
			}
		}
		if !hasDocxLink {
			return output
		}
	}
	re := regexp.MustCompile(`/api/skill-artifacts/([^\s)\]"'` + "`" + `<>]+)`)
	matches := re.FindAllStringSubmatch(output, -1)
	displayTitle := normalizeDocxTitle(title)
	body := sanitizeDocxBody(content)
	if body == "" {
		return output
	}
	if len(matches) == 0 {
		return output
	}
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		storage := skillArtifactStorageName(m[1])
		if storage == "" || !strings.HasSuffix(strings.ToLower(storage), ".docx") {
			continue
		}
		ensured, _, err := ensureDocxArtifactOnDisk(displayTitle, body, storage)
		if err != nil {
			continue
		}
		output = replaceSkillArtifactPath(output, storage, ensured)
	}
	return output
}

// docxBodyFromToolCalls extracts the docx body from any docx-class
// tool call args in this turn. Walks the list in reverse so the
// most recent attempt wins.
func docxBodyFromToolCalls(toolCalls []map[string]any) string {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		tc := toolCalls[i]
		name := strings.ToLower(str(tc["name"]))
		if !IsDocxSkillName(name) && !strings.Contains(name, "docx") {
			continue
		}
		args, _ := tc["args"].(map[string]any)
		if args == nil {
			continue
		}
		if body := sanitizeDocxBody(coalesce(str(args["content"]), coalesce(str(args["input"]), str(args["command"])))); body != "" {
			return body
		}
	}
	return ""
}

// extractDocxBodyFromAssistantText strips tool-output noise
// ("已生成 Word", "下载链接", etc.) from the assistant reply to
// recover the actual document body.
func extractDocxBodyFromAssistantText(full string) string {
	lines := strings.Split(copilot.StripArtifactNoise(full), "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "已生成 Word") || strings.HasPrefix(trim, "已为您生成") ||
			strings.HasPrefix(trim, "文件名：") || strings.HasPrefix(trim, "下载链接：") ||
			strings.Contains(trim, "/api/skill-artifacts/") {
			continue
		}
		if copilot.IsPendingAssistantReply(trim) && len(out) == 0 {
			continue
		}
		out = append(out, line)
	}
	body := strings.TrimSpace(strings.Join(out, "\n"))
	if body == "" || looksLikeDocxPlaceholderBody(body) {
		return ""
	}
	runes := len([]rune(body))
	if runes < 120 && !looksLikeStructuredDocxBody(body) {
		return ""
	}
	return body
}

// resolveDocxBodyForTurn picks the best docx body from assistant
// reply vs tool args.
func resolveDocxBodyForTurn(full string, toolCalls []map[string]any, userMessage string) string {
	if body := extractDocxBodyFromAssistantText(full); body != "" {
		toolBody := docxBodyFromToolCalls(toolCalls)
		if toolBody == "" || len([]rune(body)) > len([]rune(toolBody))+50 || looksLikeDocxPlaceholderBody(toolBody) {
			return body
		}
	}
	if body := docxBodyFromToolCalls(toolCalls); body != "" {
		return body
	}
	if body := sanitizeDocxBody(extractDocxBodyFromSkillOutput(full)); body != "" {
		return body
	}
	user := strings.TrimSpace(userMessage)
	if user != "" && !looksLikeDocxPlaceholderBody(user) && (len([]rune(user)) >= 120 || looksLikeStructuredDocxBody(user)) {
		return user
	}
	return ""
}

func resolveDocxBodyFromExecution(args map[string]any, userMessage, output string, plan map[string]any) string {
	if args != nil {
		path := coalesce(str(args["path"]), str(args["filename"]))
		if looksLikeSkillScriptCommand(path) || strings.HasSuffix(strings.ToLower(path), ".py") {
			// 脚本 write 参数不得作为 docx 正文
		} else if body := sanitizeDocxBody(coalesce(str(args["content"]), str(args["input"]))); body != "" {
			return body
		}
	}
	if plan != nil {
		for _, st := range skillTurnSteps(plan) {
			stepArgs, _ := st["args"].(map[string]any)
			if stepArgs == nil {
				continue
			}
			path := coalesce(str(stepArgs["path"]), coalesce(str(stepArgs["filename"]), str(stepArgs["command"])))
			if looksLikeSkillScriptCommand(path) || strings.HasSuffix(strings.ToLower(path), ".py") {
				continue
			}
			if body := sanitizeDocxBody(coalesce(str(stepArgs["content"]), str(stepArgs["input"]))); body != "" {
				return body
			}
		}
	}
	if body := sanitizeDocxBody(extractDocxBodyFromSkillOutput(output)); body != "" {
		return body
	}
	if body := extractDocxBodyFromAssistantText(output); body != "" {
		return body
	}
	user := strings.TrimSpace(userMessage)
	if LooksLikeCodeAsDocxBody(user) {
		return ""
	}
	return user
}

func extractDocxBodyFromSkillOutput(output string) string {
	lines := strings.Split(output, "\n")
	var body []string
	capture := false
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.Contains(trim, "—— 步骤") || strings.Contains(trim, "—— 授权后执行结果") {
			capture = true
			continue
		}
		if !capture {
			continue
		}
		if strings.HasPrefix(trim, "已生成 Word 文档") ||
			strings.HasPrefix(trim, "文件名：") ||
			strings.HasPrefix(trim, "下载链接：") ||
			strings.Contains(trim, "/api/skill-artifacts/") ||
			strings.HasPrefix(trim, "【Skill Turn】") ||
			strings.HasPrefix(trim, "请把下载链接") {
			continue
		}
		if trim == "" && len(body) == 0 {
			continue
		}
		body = append(body, line)
	}
	return strings.TrimSpace(strings.Join(body, "\n"))
}

func findGenerateDocxScript() (string, error) {
	candidates := []string{
		filepath.Join("..", "..", "services", "qzda-sandbox", "scripts", "generate_docx.py"),
		filepath.Join("..", "scripts", "generate_docx.py"),
		filepath.Join("scripts", "generate_docx.py"),
	}
	for _, c := range candidates {
		if st, e := os.Stat(c); e == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("找不到 generate_docx.py")
}

// loadDocxPreviewPayload shells out to generate_docx.py --preview-json
// to get a structured preview of an existing docx file.
func loadDocxPreviewPayload(storageName string) (map[string]any, error) {
	storageName = skillArtifactStorageName(storageName)
	if storageName == "" {
		return nil, fmt.Errorf("无效产物名")
	}
	if !skillArtifactExists(storageName) {
		return nil, fmt.Errorf("产物不存在")
	}
	scriptPath, err := findGenerateDocxScript()
	if err != nil {
		return nil, err
	}
	path := skillArtifactFilePath(storageName)
	cmd := exec.Command("python3", scriptPath, "--preview-json", path)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("docx 预览失败: %v (%s)", err, truncateRunes(string(out), 240))
	}
	var payload map[string]any
	if err := json.Unmarshal(out, &payload); err != nil {
		return nil, fmt.Errorf("docx 预览解析失败: %w", err)
	}
	payload["filename"] = storageName
	payload["downloadName"] = docxDisplayNameFromStorage(storageName)
	return payload, nil
}

// previewDocxArtifact returns the structured preview JSON, refusing
// to serve placeholder / code-only docs.
func previewDocxArtifact(storageName string) (map[string]any, error) {
	payload, err := loadDocxPreviewPayload(storageName)
	if err != nil {
		return nil, err
	}
	if docxPreviewLooksLikeCode(payload) || docxPreviewLooksLikePlaceholder(payload) {
		return nil, fmt.Errorf("文档正文异常（疑似占位符或脚本），请重新生成")
	}
	payload["kind"] = "docx"
	return payload, nil
}

// generateDocxArtifactLocal is the public entry point for the
// "generate a fresh docx" path; delegates to the named variant.
func generateDocxArtifactLocal(title, content string) (storageName, downloadPath string, err error) {
	return generateDocxArtifactLocalNamed(title, content, "")
}

// generateDocxArtifactLocalNamed shells out to generate_docx.py with
// the prepared content file. preferredStorage lets the caller reuse
// an existing storage name (replacement path).
func generateDocxArtifactLocalNamed(title, content, preferredStorage string) (storageName, downloadPath string, err error) {
	content = sanitizeDocxBody(content)
	if content == "" {
		return "", "", fmt.Errorf("docx 正文无效：请提供文档内容，不要传入生成脚本")
	}
	dir := SkillArtifactDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	displayTitle := normalizeDocxTitle(title)
	downloadName := docxDownloadBasename(displayTitle)
	preferredStorage = skillArtifactStorageName(preferredStorage)
	if preferredStorage != "" && strings.HasSuffix(strings.ToLower(preferredStorage), ".docx") {
		storageName = preferredStorage
	} else {
		storageName = docxStorageName(downloadName)
	}
	outPath := filepath.Join(dir, storageName)

	scriptPath, err := findGenerateDocxScript()
	if err != nil {
		return "", "", err
	}

	contentFile, err := os.CreateTemp("", "de-docx-*.txt")
	if err != nil {
		return "", "", err
	}
	contentPath := contentFile.Name()
	defer os.Remove(contentPath)
	if _, err := contentFile.WriteString(content); err != nil {
		_ = contentFile.Close()
		return "", "", err
	}
	_ = contentFile.Close()

	cmd := exec.Command("python3", scriptPath, "--out", outPath, "--title", displayTitle, "--content-file", contentPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", "", fmt.Errorf("docx 生成失败: %v (%s)", err, truncateRunes(string(out), 240))
	}
	downloadPath = "/api/skill-artifacts/" + storageName
	return storageName, downloadPath, nil
}

// formatDocxToolOutput produces the standardized assistant reply
// string after a successful docx generation. The model is
// instructed (via the appended sentence) not to rewrite the link.
func formatDocxToolOutput(displayTitle, storageName, downloadPath string, localFallback bool) string {
	downloadName := docxDisplayNameFromStorage(storageName)
	title := normalizeDocxTitle(displayTitle)
	suffix := ""
	if localFallback {
		suffix = "（本地回退）"
	}
	return fmt.Sprintf(
		"已生成 Word 文档「%s」%s\n文件名：%s\n下载链接：%s\n请把下载链接发给用户，不要改写文件名或链接。",
		title, suffix, downloadName, downloadPath,
	)
}


// Outline templates + title inference for DOCX live in artifacts_outlines.go.
