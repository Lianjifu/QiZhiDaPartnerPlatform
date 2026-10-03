package artifacts

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// PPTX-specific artifact helpers. Companion to artifacts.go (cross-format
// HTTP handlers + common helpers), artifacts_docx.go (DOCX), and
// artifacts_xlsx.go (XLSX). The pptxPreview rendering lives in
// pptx_preview.go; PPTX OOXML validation lives in pptx_validate.go.

// PPTX regex vars. Consumed by both this file and pptx_preview.go
// (slide/paragraph/bullet matching). Kept at package level so all
// files share one compiled copy.
var (
	pptxSlideTextRE = regexp.MustCompile(`(?s)<a:t[^>]*>([^<]*)</a:t>`)
	pptxParaRE      = regexp.MustCompile(`(?s)<a:p\b[^>]*>(.*?)</a:p>`)
	pptxBuCharRE    = regexp.MustCompile(`(?i)<a:buChar\b`)
)

func findGeneratePptxScript() (string, error) {
	candidates := []string{
		filepath.Join("..", "..", "services", "qzda-sandbox", "scripts", "generate_pptx.py"),
		filepath.Join("..", "scripts", "generate_pptx.py"),
		filepath.Join("scripts", "generate_pptx.py"),
	}
	for _, c := range candidates {
		if st, e := os.Stat(c); e == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("找不到 generate_pptx.py")
}

func findGeneratePptxProdScript() (string, error) {
	candidates := []string{
		filepath.Join("..", "..", "services", "qzda-sandbox", "scripts", "generate_pptx_prod.sh"),
		filepath.Join("..", "scripts", "generate_pptx_prod.sh"),
		filepath.Join("scripts", "generate_pptx_prod.sh"),
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append([]string{
			filepath.Join(wd, "services", "qzda-sandbox", "scripts", "generate_pptx_prod.sh"),
			filepath.Join(wd, "..", "scripts", "generate_pptx_prod.sh"),
			filepath.Join(wd, "..", "..", "scripts", "generate_pptx_prod.sh"),
		}, candidates...)
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs, nil
		}
	}
	return "", fmt.Errorf("找不到 generate_pptx_prod.sh")
}

// normalizePptxTitle turns LLM / tool noise into a short readable
// Chinese title. Strips skill-pptx prefixes, suffix `.pptx`,
// punctuation, and collapses whitespace.
func normalizePptxTitle(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.Trim(s, "《》「」『』\"'`")
	s = regexp.MustCompile(`(?i)^skill[_-]?pptx[_-]*`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`(?i)(\.pptx|_pptx)$`).ReplaceAllString(s, "")
	s = reMultiSpace.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	if s == "" || strings.EqualFold(s, "pptx") || strings.EqualFold(s, "ppt") || s == "生成ppt" || s == "演示文稿" {
		return "演示文稿"
	}
	runes := []rune(s)
	if len(runes) > 40 {
		s = string(runes[:40])
	}
	return strings.TrimSpace(s)
}

// pptxDownloadBasename is the user-facing download name,
// e.g. 团队季度考评.pptx.
func pptxDownloadBasename(title string) string {
	title = normalizePptxTitle(title)
	var b strings.Builder
	for _, r := range title {
		switch {
		case unicode.Is(unicode.Han, r):
			b.WriteRune(r)
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
		case r == '-' || r == '·':
			b.WriteRune(r)
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "presentation"
	}
	return out + ".pptx"
}

// pptxStorageName builds a unique storage key (12-hex-id + basename).
func pptxStorageName(downloadName string) string {
	base := strings.TrimSuffix(downloadName, filepath.Ext(downloadName))
	id := fmt.Sprintf("%x", time.Now().UnixNano())
	if len(id) > 12 {
		id = id[len(id)-12:]
	}
	return id + "-" + base + ".pptx"
}

// generatePptxArtifactLocal builds a .pptx via PilotDeck's
// production layout-library, falling back to the stdlib OOXML script
// when the production script is missing or fails.
func generatePptxArtifactLocal(title, content string) (storageName, downloadPath string, err error) {
	cleanupSkillArtifactsTTL(7*24*time.Hour, 400)
	dir := SkillArtifactDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	displayTitle := normalizePptxTitle(title)
	downloadName := pptxDownloadBasename(displayTitle)
	storageName = pptxStorageName(downloadName)
	outPath := filepath.Join(dir, storageName)

	contentFile, err := os.CreateTemp("", "de-pptx-*.txt")
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

	// Prefer PilotDeck layout-library (production). Fall back to stdlib OOXML.
	if prodScript, perr := findGeneratePptxProdScript(); perr == nil {
		cmd := exec.Command("bash", prodScript, "--out", outPath, "--title", displayTitle, "--outline-file", contentPath)
		out, cerr := cmd.CombinedOutput()
		if cerr == nil {
			if verr := validatePptxOOXMLLoose(outPath); verr == nil {
				downloadPath = "/api/skill-artifacts/" + storageName
				return storageName, downloadPath, nil
			}
			_ = os.Remove(outPath)
		} else {
			// keep going to python fallback; log truncated reason in error only if both fail
			_ = out
		}
	}

	scriptPath, err := findGeneratePptxScript()
	if err != nil {
		return "", "", err
	}
	cmd := exec.Command("python3", scriptPath, "--out", outPath, "--title", displayTitle, "--content-file", contentPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", "", fmt.Errorf("pptx 生成失败: %v (%s)", err, truncateRunes(string(out), 240))
	}
	if err := validatePptxOOXML(outPath); err != nil {
		_ = os.Remove(outPath)
		return "", "", err
	}
	downloadPath = "/api/skill-artifacts/" + storageName
	return storageName, downloadPath, nil
}

// formatPptxToolOutput produces the standardized assistant reply
// string after a successful pptx generation. Strips the storage-id
// prefix for the user-facing filename.
func formatPptxToolOutput(displayTitle, storageName, downloadPath string, localFallback bool) string {
	downloadName := strings.TrimPrefix(storageName, "")
	if i := strings.Index(storageName, "-"); i > 0 && i < len(storageName)-1 {
		downloadName = storageName[i+1:]
	}
	title := normalizePptxTitle(displayTitle)
	suffix := ""
	if localFallback {
		suffix = "（本地回退）"
	}
	return fmt.Sprintf(
		"已生成 PPT 文档「%s」%s\n文件名：%s\n下载链接：%s\n请把下载链接发给用户，不要改写文件名或链接。",
		title, suffix, downloadName, downloadPath,
	)
}

// looksLikePptxGenerateRequest detects "make me a PPT/演示文稿" intent
// from the user message so the SkillTurn planner can preemptively
// route to the pptx skill.
func looksLikePptxGenerateRequest(msg string) bool {
	m := strings.ToLower(strings.TrimSpace(msg))
	if m == "" {
		return false
	}
	hasPPT := strings.Contains(m, "ppt") || strings.Contains(m, "pptx") || strings.Contains(msg, "幻灯") || strings.Contains(msg, "演示文稿")
	hasGen := strings.Contains(msg, "生成") || strings.Contains(msg, "做一") || strings.Contains(msg, "制作") || strings.Contains(msg, "输出")
	return hasPPT && hasGen
}

// InferPptxTitleFromMessage extracts a short slide-deck title from
// the user's intent message. Handles 《...》, 「...」, "生成 X" patterns
// + a few keyword shortcuts for 季度考评 / 述职.

// InferPptxTitleFromMessage + DefaultPptxOutlineForMessage live in artifacts_outlines.go.

// hasPptxArtifactText detects whether an assistant message already
// references a .pptx artifact link — used by DOCX sync logic to avoid
// generating a duplicate Word file on the same turn.
func hasPptxArtifactText(text string) bool {
	low := strings.ToLower(text)
	return strings.Contains(low, ".pptx") && strings.Contains(text, "/api/skill-artifacts/")
}

// pptxRelatedToolAttempted detects whether any tool call in this
// turn looks like it might produce / reference a .pptx artifact.
// Used to seed the assistant's reply with the pptx skill output.
func pptxRelatedToolAttempted(toolCalls []map[string]any) bool {
	for _, tc := range toolCalls {
		name := strings.ToLower(str(tc["name"]))
		if IsPptxSkillName(name) || name == "write_file" || name == "bash" || name == "execute_code" || name == "skill.read" {
			return true
		}
		args, _ := tc["args"].(map[string]any)
		path := strings.ToLower(coalesce(str(args["path"]), coalesce(str(args["command"]), str(args["skill"]))))
		if strings.Contains(path, "pptx") || strings.Contains(path, "ppt") || strings.Contains(path, ".mjs") || strings.Contains(path, ".copilot-ws") {
			return true
		}
	}
	return false
}

// inferTitleFromPptxStorage strips the storage-id prefix from a
// .pptx storage name. Used by the preview pipeline to populate the
// preview header (PDF preview also reuses this for legacy filenames).
func inferTitleFromPptxStorage(storageName string) string {
	base := strings.TrimSuffix(filepath.Base(storageName), filepath.Ext(storageName))
	base = reArtifactIDPref.ReplaceAllString(base, "")
	return strings.TrimSpace(base)
}
