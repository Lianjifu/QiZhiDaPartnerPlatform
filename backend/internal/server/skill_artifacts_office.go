package server

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var reSkillPDFPrefix = regexp.MustCompile(`(?i)^skill[_-]?pdf[_-]*`)

func isPdfSkillName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return n == "pdf" || strings.Contains(n, "pdf") || n == "pdf生成"
}

func looksLikePdfGenerateRequest(msg string) bool {
	m := strings.ToLower(strings.TrimSpace(msg))
	if m == "" {
		return false
	}
	hasPDF := strings.Contains(m, "pdf") || strings.Contains(msg, "便携文档")
	hasGen := strings.Contains(msg, "生成") || strings.Contains(msg, "做一") || strings.Contains(msg, "制作") || strings.Contains(msg, "输出") || strings.Contains(msg, "导出")
	return hasPDF && hasGen
}

func hasPdfArtifactText(text string) bool {
	low := strings.ToLower(text)
	return strings.Contains(low, ".pdf") && strings.Contains(text, "/api/skill-artifacts/")
}

func normalizePdfTitle(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.Trim(s, "《》「」『』\"'`")
	s = reSkillPDFPrefix.ReplaceAllString(s, "")
	s = regexp.MustCompile(`(?i)\.pdf$`).ReplaceAllString(s, "")
	s = reMultiSpace.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	if s == "" || strings.EqualFold(s, "pdf") {
		return "生成文档"
	}
	runes := []rune(s)
	if len(runes) > 32 {
		s = string(runes[:32])
	}
	return strings.TrimSpace(s)
}

func pdfDownloadBasename(title string) string {
	title = normalizePdfTitle(title)
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
		out = "document"
	}
	if utf8.RuneCountInString(out) > 32 {
		out = string([]rune(out)[:32])
	}
	return out + ".pdf"
}

func pdfStorageName(downloadName string) string {
	base := strings.TrimSuffix(downloadName, filepath.Ext(downloadName))
	id := fmt.Sprintf("%x", time.Now().UnixNano())
	if len(id) > 12 {
		id = id[len(id)-12:]
	}
	return id + "-" + base + ".pdf"
}

func findGeneratePdfScript() (string, error) {
	candidates := []string{
		filepath.Join("..", "..", "services", "qzda-sandbox", "scripts", "generate_pdf.py"),
		filepath.Join("..", "scripts", "generate_pdf.py"),
		filepath.Join("scripts", "generate_pdf.py"),
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append([]string{
			filepath.Join(wd, "services", "qzda-sandbox", "scripts", "generate_pdf.py"),
			filepath.Join(wd, "..", "scripts", "generate_pdf.py"),
			filepath.Join(wd, "..", "..", "scripts", "generate_pdf.py"),
		}, candidates...)
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs, nil
		}
	}
	return "", fmt.Errorf("找不到 generate_pdf.py")
}

func generatePdfArtifactLocal(title, content string) (storageName, downloadPath string, err error) {
	cleanupSkillArtifactsTTL(7*24*time.Hour, 400)
	dir := skillArtifactDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	displayTitle := normalizePdfTitle(title)
	downloadName := pdfDownloadBasename(displayTitle)
	storageName = pdfStorageName(downloadName)
	outPath := filepath.Join(dir, storageName)

	scriptPath, err := findGeneratePdfScript()
	if err != nil {
		return "", "", err
	}
	contentFile, err := os.CreateTemp("", "de-pdf-*.txt")
	if err != nil {
		return "", "", err
	}
	contentPath := contentFile.Name()
	defer os.Remove(contentPath)
	body := strings.TrimSpace(content)
	if body == "" {
		body = displayTitle + "\n\n（正文待补充）"
	}
	if _, err := contentFile.WriteString(body); err != nil {
		_ = contentFile.Close()
		return "", "", err
	}
	_ = contentFile.Close()

	cmd := exec.Command("python3", scriptPath, "--out", outPath, "--title", displayTitle, "--content-file", contentPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", "", fmt.Errorf("pdf 生成失败: %v (%s)", err, truncateRunes(string(out), 240))
	}
	if st, err := os.Stat(outPath); err != nil || st.Size() < 20 {
		return "", "", fmt.Errorf("pdf 产物无效")
	}
	// Magic: %PDF
	raw, _ := os.ReadFile(outPath)
	if len(raw) < 4 || string(raw[:4]) != "%PDF" {
		_ = os.Remove(outPath)
		return "", "", fmt.Errorf("pdf 魔数校验失败")
	}
	downloadPath = "/api/skill-artifacts/" + storageName
	return storageName, downloadPath, nil
}

func formatPdfToolOutput(displayTitle, storageName, downloadPath string, localFallback bool) string {
	downloadName := storageName
	if i := strings.Index(storageName, "-"); i > 0 && i < len(storageName)-1 {
		downloadName = storageName[i+1:]
	}
	suffix := ""
	if localFallback {
		suffix = "（本地回退）"
	}
	return fmt.Sprintf(
		"已生成 PDF 文档「%s」%s\n文件名：%s\n下载链接：%s\n请把下载链接发给用户，不要改写文件名或链接。",
		normalizePdfTitle(displayTitle), suffix, downloadName, downloadPath,
	)
}

func defaultPdfBodyForMessage(title, userMsg string) string {
	t := coalesce(normalizePdfTitle(title), "生成文档")
	return fmt.Sprintf("%s\n\n一、概述\n请补充背景与目标。\n\n二、正文\n请补充关键内容要点。\n\n三、结论与下一步\n请补充结论与行动项。\n\n（来源请求：%s）", t, truncateRunes(strings.TrimSpace(userMsg), 80))
}

func previewPdfArtifact(storageName string) (map[string]any, error) {
	storageName = skillArtifactStorageName(storageName)
	if storageName == "" || !strings.HasSuffix(strings.ToLower(storageName), ".pdf") {
		return nil, fmt.Errorf("无效 pdf 产物名")
	}
	path := skillArtifactFilePath(storageName)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("无法打开 PDF：%w", err)
	}
	if len(raw) < 4 || string(raw[:4]) != "%PDF" {
		return nil, fmt.Errorf("PDF 文件损坏")
	}
	title := normalizePdfTitle(inferTitleFromPptxStorage(storageName))
	blocks := []map[string]any{
		{"type": "h1", "text": title},
		{"type": "p", "text": "在线预览仅展示 PDF 元信息；完整排版请下载后用 PDF 阅读器打开。"},
		{"type": "p", "text": fmt.Sprintf("文件大小：%d 字节", len(raw))},
	}
	return map[string]any{
		"kind":         "pdf",
		"title":        title,
		"filename":     storageName,
		"downloadName": pdfDownloadBasename(title),
		"pageCount":    1,
		"blocks":       blocks,
	}, nil
}

// validatePptxOOXML ensures PowerPoint-critical parts exist (strict: our python generator layout).
func validatePptxOOXML(path string) error {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("无法打开 pptx：%w", err)
	}
	defer zr.Close()
	have := map[string]bool{}
	for _, f := range zr.File {
		have[f.Name] = true
	}
	need := []string{
		"[Content_Types].xml",
		"ppt/presentation.xml",
		"ppt/_rels/presentation.xml.rels",
		"ppt/theme/theme1.xml",
		"ppt/slideMasters/slideMaster1.xml",
		"ppt/slideLayouts/slideLayout1.xml",
		"ppt/slides/slide1.xml",
		"ppt/slides/_rels/slide1.xml.rels",
	}
	var missing []string
	for _, n := range need {
		if !have[n] {
			missing = append(missing, n)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("pptx OOXML 不完整（PowerPoint 可能无法打开）：缺少 %s", strings.Join(missing, ", "))
	}
	return nil
}

// validatePptxOOXMLLoose accepts PptxGenJS packages (theme/master names may vary).
func validatePptxOOXMLLoose(path string) error {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("无法打开 pptx：%w", err)
	}
	defer zr.Close()
	haveSlide := false
	haveTheme := false
	haveMaster := false
	haveLayout := false
	havePres := false
	for _, f := range zr.File {
		n := f.Name
		if strings.HasPrefix(n, "ppt/slides/slide") && strings.HasSuffix(n, ".xml") && !strings.Contains(n, "_rels") {
			haveSlide = true
		}
		if strings.HasPrefix(n, "ppt/theme/") {
			haveTheme = true
		}
		if strings.HasPrefix(n, "ppt/slideMasters/") && strings.HasSuffix(n, ".xml") && !strings.Contains(n, "_rels") {
			haveMaster = true
		}
		if strings.HasPrefix(n, "ppt/slideLayouts/") && strings.HasSuffix(n, ".xml") && !strings.Contains(n, "_rels") {
			haveLayout = true
		}
		if n == "ppt/presentation.xml" {
			havePres = true
		}
	}
	if !havePres || !haveSlide || !haveTheme || !haveMaster || !haveLayout {
		return fmt.Errorf("pptx OOXML 不完整（缺 presentation/slide/theme/master/layout）")
	}
	return nil
}

func pptxOOXMLContentWarning(path string) string {
	if err := validatePptxOOXMLLoose(path); err != nil {
		return "该 PPT 包结构不完整，PowerPoint / WPS 可能无法打开。请重新生成后再下载。"
	}
	return ""
}

// registerLocalArtifactFile copies an existing office file into the artifacts dir.
func registerLocalArtifactFile(srcPath, preferredTitle string) (storageName, downloadPath string, err error) {
	cleanupSkillArtifactsTTL(7*24*time.Hour, 400)
	srcPath = filepath.Clean(srcPath)
	st, err := os.Stat(srcPath)
	if err != nil || st.IsDir() {
		return "", "", fmt.Errorf("源文件不存在")
	}
	ext := strings.ToLower(filepath.Ext(srcPath))
	base := strings.TrimSuffix(filepath.Base(srcPath), ext)
	base = reArtifactIDPref.ReplaceAllString(base, "")
	if preferredTitle != "" {
		base = preferredTitle
	}
	var storage string
	switch ext {
	case ".docx":
		storage = docxStorageName(docxDownloadBasename(normalizeDocxTitle(base)))
	case ".pptx":
		storage = pptxStorageName(pptxDownloadBasename(normalizePptxTitle(base)))
	case ".xlsx":
		storage = xlsxStorageName(xlsxDownloadBasename(normalizeXlsxTitle(base)))
	case ".pdf":
		storage = pdfStorageName(pdfDownloadBasename(normalizePdfTitle(base)))
	default:
		return "", "", fmt.Errorf("不支持的产物类型：%s", ext)
	}
	dir := skillArtifactDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	dst := filepath.Join(dir, storage)
	in, err := os.Open(srcPath)
	if err != nil {
		return "", "", err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return "", "", err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		_ = os.Remove(dst)
		return "", "", err
	}
	if ext == ".pptx" {
		if err := validatePptxOOXMLLoose(dst); err != nil {
			_ = os.Remove(dst)
			return "", "", err
		}
	}
	if ext == ".pdf" {
		raw := make([]byte, 4)
		f, _ := os.Open(dst)
		if f != nil {
			_, _ = f.Read(raw)
			_ = f.Close()
		}
		if string(raw) != "%PDF" {
			_ = os.Remove(dst)
			return "", "", fmt.Errorf("pdf 魔数校验失败")
		}
	}
	return storage, "/api/skill-artifacts/" + storage, nil
}

// harvestOfficeArtifactsFromDir finds newest office files under root and registers one.
func harvestOfficeArtifactsFromDir(root string) (storageName, downloadPath, kind string, err error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return "", "", "", fmt.Errorf("empty root")
	}
	var candidates []string
	_ = filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info == nil || info.IsDir() {
			return nil
		}
		low := strings.ToLower(info.Name())
		if strings.HasSuffix(low, ".pptx") || strings.HasSuffix(low, ".docx") || strings.HasSuffix(low, ".xlsx") || strings.HasSuffix(low, ".pdf") {
			// Skip node_modules / .git noise
			if strings.Contains(path, "node_modules") || strings.Contains(path, "/.git/") {
				return nil
			}
			candidates = append(candidates, path)
		}
		return nil
	})
	if len(candidates) == 0 {
		return "", "", "", fmt.Errorf("no office artifacts")
	}
	// Prefer most recently modified
	best := candidates[0]
	bestMod := time.Time{}
	for _, c := range candidates {
		if st, e := os.Stat(c); e == nil {
			if st.ModTime().After(bestMod) {
				bestMod = st.ModTime()
				best = c
			}
		}
	}
	// Only harvest files touched in the last 15 minutes (this run)
	if time.Since(bestMod) > 15*time.Minute {
		return "", "", "", fmt.Errorf("no recent artifacts")
	}
	storage, download, err := registerLocalArtifactFile(best, "")
	if err != nil {
		return "", "", "", err
	}
	kind = "file"
	switch strings.ToLower(filepath.Ext(best)) {
	case ".docx":
		kind = "docx"
	case ".pptx":
		kind = "pptx"
	case ".xlsx":
		kind = "xlsx"
	case ".pdf":
		kind = "pdf"
	}
	return storage, download, kind, nil
}

func looksLikeClarificationSpeech(content string) bool {
	s := strings.TrimSpace(content)
	if s == "" {
		return false
	}
	runes := len([]rune(s))
	if runes > 400 && looksLikeStructuredDocxBody(s) {
		return false
	}
	hints := []string{
		"请告诉我", "请问您", "请补充", "方便提供", "您希望", "能否确认",
		"需要确认", "还请提供", "请先说明", "我需要了解", "为了生成",
		"请提供以下信息", "请问需要", "您可以提供",
	}
	hits := 0
	for _, h := range hints {
		if strings.Contains(s, h) {
			hits++
		}
	}
	if hits >= 2 {
		return true
	}
	if hits >= 1 && runes < 220 && !looksLikeStructuredDocxBody(s) {
		return true
	}
	return false
}

// cleanupSkillArtifactsTTL removes old artifact files beyond maxAge / caps count.
func cleanupSkillArtifactsTTL(maxAge time.Duration, maxFiles int) {
	dir := skillArtifactDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type item struct {
		name string
		mod  time.Time
		size int64
	}
	var files []item
	now := time.Now()
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		low := strings.ToLower(name)
		if !(strings.HasSuffix(low, ".docx") || strings.HasSuffix(low, ".pptx") || strings.HasSuffix(low, ".xlsx") || strings.HasSuffix(low, ".pdf")) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if maxAge > 0 && now.Sub(info.ModTime()) > maxAge {
			_ = os.Remove(filepath.Join(dir, name))
			continue
		}
		files = append(files, item{name: name, mod: info.ModTime(), size: info.Size()})
	}
	if maxFiles <= 0 || len(files) <= maxFiles {
		return
	}
	// Sort oldest first by bubbling (small N)
	for i := 0; i < len(files); i++ {
		for j := i + 1; j < len(files); j++ {
			if files[j].mod.Before(files[i].mod) {
				files[i], files[j] = files[j], files[i]
			}
		}
	}
	drop := len(files) - maxFiles
	for i := 0; i < drop; i++ {
		_ = os.Remove(filepath.Join(dir, files[i].name))
	}
}
