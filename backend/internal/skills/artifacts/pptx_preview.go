package artifacts

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/gateway"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

var (
	pptxSolidFillRE = regexp.MustCompile(`(?is)<a:solidFill>\s*<a:srgbClr val="([A-Fa-f0-9]{6})"`)
	pptxThemeSrgbRE = regexp.MustCompile(`(?i)<a:srgbClr val="([A-Fa-f0-9]{6})"`)
)

func pptxPreviewCacheDir(storageName string) string {
	base := strings.TrimSuffix(filepath.Base(storageName), filepath.Ext(storageName))
	return filepath.Join(SkillArtifactDir(), ".pptx-preview", base)
}

func pptxSlideImagePath(storageName string, index int) string {
	return filepath.Join(pptxPreviewCacheDir(storageName), fmt.Sprintf("slide-%d.png", index))
}

func pptxSlideImageURL(storageName string, index int) string {
	return fmt.Sprintf("/api/skill-artifacts/%s/slides/%d.png", url.PathEscape(skillArtifactStorageName(storageName)), index)
}

func isDarkHex(hex string) bool {
	hex = strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(hex)), "#")
	if len(hex) != 6 {
		return false
	}
	var r, g, b int
	_, err := fmt.Sscanf(hex, "%02x%02x%02x", &r, &g, &b)
	if err != nil {
		return false
	}
	return (0.2126*float64(r)+0.7152*float64(g)+0.0722*float64(b))/255.0 < 0.42
}

func pptxSlideBackground(xml string) string {
	if i := strings.Index(strings.ToLower(xml), "<p:bg"); i >= 0 {
		chunk := xml[i:]
		if len(chunk) > 1200 {
			chunk = chunk[:1200]
		}
		if m := pptxSolidFillRE.FindStringSubmatch(chunk); len(m) == 2 {
			return "#" + strings.ToUpper(m[1])
		}
	}
	if m := pptxSolidFillRE.FindStringSubmatch(xml); len(m) == 2 {
		return "#" + strings.ToUpper(m[1])
	}
	return ""
}

func pptxThemeAccent(themeXML string) string {
	cols := pptxThemeSrgbRE.FindAllStringSubmatch(themeXML, -1)
	for _, m := range cols {
		c := strings.ToUpper(m[1])
		if c == "ED7D31" || c == "F26B38" || c == "E67E22" || c == "FFC000" {
			return "#" + c
		}
	}
	if len(cols) >= 4 {
		return "#" + strings.ToUpper(cols[3][1])
	}
	return "#F26B38"
}

func classifyPptxSlideVariant(index int, bg string, texts []string) string {
	joined := strings.Join(texts, "\n")
	low := strings.ToLower(joined)
	if index == 1 || isDarkHex(bg) || strings.Contains(joined, "DIGITAL EMPLOYEE") {
		return "cover"
	}
	if strings.Contains(joined, "目录") || strings.Contains(low, "agenda") ||
		(strings.Contains(joined, "01") && strings.Contains(joined, "02")) {
		return "agenda"
	}
	if strings.Contains(joined, "关键指标") || strings.Contains(joined, "标准值") || strings.Contains(joined, "实际值") {
		return "metrics"
	}
	return "content"
}

func extractPptxSlideTexts(xml string) (title string, lines, bullets, all []string) {
	paras := pptxParaRE.FindAllStringSubmatch(xml, -1)
	firstText := true
	for _, pm := range paras {
		paraXML := pm[1]
		tm := pptxSlideTextRE.FindStringSubmatch(paraXML)
		if len(tm) < 2 {
			continue
		}
		t := strings.TrimSpace(tm[1])
		if t == "" {
			continue
		}
		all = append(all, t)
		if firstText {
			title = t
			firstText = false
			continue
		}
		isBullet := pptxBuCharRE.MatchString(paraXML) ||
			strings.HasPrefix(t, "•") || strings.HasPrefix(t, "-")
		trim := strings.TrimSpace(strings.TrimLeft(t, "•·*- "))
		if trim == "" {
			continue
		}
		lines = append(lines, trim)
		if isBullet {
			bullets = append(bullets, trim)
		}
	}
	if len(all) == 0 {
		texts := pptxSlideTextRE.FindAllStringSubmatch(xml, -1)
		for i, tm := range texts {
			t := strings.TrimSpace(tm[1])
			if t == "" {
				continue
			}
			all = append(all, t)
			if i == 0 {
				title = t
				continue
			}
			lines = append(lines, t)
		}
	}
	if title == "" && len(all) > 0 {
		title = all[0]
	}
	return title, lines, bullets, all
}

func ensurePptxSlideRenders(storageName string, pageCount int) {
	storageName = skillArtifactStorageName(storageName)
	if storageName == "" || pageCount <= 0 {
		return
	}
	cache := pptxPreviewCacheDir(storageName)
	first := pptxSlideImagePath(storageName, 1)
	if st, err := os.Stat(first); err == nil && st.Size() > 0 {
		return
	}
	src := skillArtifactFilePath(storageName)
	if _, err := os.Stat(src); err != nil {
		return
	}
	_ = os.MkdirAll(cache, 0o755)
	if renderPptxWithLibreOffice(src, cache, pageCount) {
		return
	}
	renderPptxCoverWithQLManage(src, cache)
}

func findSofficeBin() string {
	if p := strings.TrimSpace(os.Getenv("PPTX_SKILL_SOFFICE")); p != "" {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	candidates := []string{
		"soffice", "libreoffice",
		"/Applications/LibreOffice.app/Contents/MacOS/soffice",
		"/usr/bin/soffice", "/usr/local/bin/soffice",
	}
	for _, c := range candidates {
		if strings.Contains(c, "/") {
			if _, err := os.Stat(c); err == nil {
				return c
			}
			continue
		}
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	return ""
}

func findPdfToPPM() string {
	for _, c := range []string{"pdftoppm", "/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"} {
		if strings.Contains(c, "/") {
			if _, err := os.Stat(c); err == nil {
				return c
			}
			continue
		}
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	return ""
}

func renderPptxWithLibreOffice(src, cache string, pageCount int) bool {
	soffice := findSofficeBin()
	pdftoppm := findPdfToPPM()
	if soffice == "" || pdftoppm == "" {
		return false
	}
	tmp, err := os.MkdirTemp("", "pptx-preview-*")
	if err != nil {
		return false
	}
	defer os.RemoveAll(tmp)
	cmd := exec.Command(soffice, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", tmp, src)
	cmd.Env = append(os.Environ(), "HOME="+tmp)
	if _, err := cmd.CombinedOutput(); err != nil {
		return false
	}
	pdfs, _ := filepath.Glob(filepath.Join(tmp, "*.pdf"))
	if len(pdfs) == 0 {
		return false
	}
	prefix := filepath.Join(tmp, "slide")
	cmd2 := exec.Command(pdftoppm, "-png", "-r", "144", pdfs[0], prefix)
	if _, err := cmd2.CombinedOutput(); err != nil {
		return false
	}
	ok := false
	for i := 1; i <= pageCount+2; i++ {
		candidates := []string{
			fmt.Sprintf("%s-%d.png", prefix, i),
			fmt.Sprintf("%s-%02d.png", prefix, i),
			fmt.Sprintf("%s-%03d.png", prefix, i),
		}
		for _, c := range candidates {
			if st, err := os.Stat(c); err == nil && st.Size() > 0 {
				data, err := os.ReadFile(c)
				if err != nil {
					continue
				}
				dest := filepath.Join(cache, fmt.Sprintf("slide-%d.png", i))
				if err := os.WriteFile(dest, data, 0o644); err == nil {
					ok = true
				}
			}
		}
	}
	return ok
}

func renderPptxCoverWithQLManage(src, cache string) {
	ql, err := exec.LookPath("qlmanage")
	if err != nil {
		return
	}
	tmp, err := os.MkdirTemp("", "pptx-ql-*")
	if err != nil {
		return
	}
	defer os.RemoveAll(tmp)
	cmd := exec.Command(ql, "-t", "-s", "1280", "-o", tmp, src)
	if _, err := cmd.CombinedOutput(); err != nil {
		return
	}
	entries, _ := os.ReadDir(tmp)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".png") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(tmp, e.Name()))
		if err != nil || len(data) == 0 {
			continue
		}
		_ = os.WriteFile(filepath.Join(cache, "slide-1.png"), data, 0o644)
		return
	}
}

func previewPptxArtifact(storageName string) (map[string]any, error) {
	storageName = skillArtifactStorageName(storageName)
	if storageName == "" || !strings.HasSuffix(strings.ToLower(storageName), ".pptx") {
		return nil, fmt.Errorf("无效 pptx 产物名")
	}
	path := skillArtifactFilePath(storageName)
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("无法打开 PPT：%w", err)
	}
	defer zr.Close()

	themeXML := ""
	type slideFile struct {
		idx int
		rc  io.ReadCloser
	}
	var slides []slideFile
	reSlide := regexp.MustCompile(`(?i)^ppt/slides/slide(\d+)\.xml$`)
	for _, f := range zr.File {
		if strings.EqualFold(f.Name, "ppt/theme/theme1.xml") {
			if rc, err := f.Open(); err == nil {
				raw, _ := io.ReadAll(io.LimitReader(rc, 256<<10))
				_ = rc.Close()
				themeXML = string(raw)
			}
			continue
		}
		m := reSlide.FindStringSubmatch(f.Name)
		if len(m) != 2 {
			continue
		}
		n := 0
		fmt.Sscanf(m[1], "%d", &n)
		rc, err := f.Open()
		if err != nil {
			continue
		}
		slides = append(slides, slideFile{idx: n, rc: rc})
	}
	sort.Slice(slides, func(i, j int) bool { return slides[i].idx < slides[j].idx })

	accent := pptxThemeAccent(themeXML)
	blocks := make([]map[string]any, 0, len(slides)*4)
	slidePayloads := make([]map[string]any, 0, len(slides))
	pageCount := 0
	for _, sf := range slides {
		raw, err := io.ReadAll(io.LimitReader(sf.rc, 512<<10))
		_ = sf.rc.Close()
		if err != nil {
			continue
		}
		pageCount++
		xml := string(raw)
		title, lines, bullets, all := extractPptxSlideTexts(xml)
		if title == "" {
			title = fmt.Sprintf("第 %d 页", pageCount)
		}
		bg := pptxSlideBackground(xml)
		variant := classifyPptxSlideVariant(pageCount, bg, all)
		if bg == "" {
			if variant == "cover" {
				bg = "#102A43"
			} else {
				bg = "#FFFFFF"
			}
		}
		eyebrow, subtitle, footer := "", "", ""
		bodyLines := lines
		if variant == "cover" && len(all) > 0 {
			if strings.EqualFold(all[0], "DIGITAL EMPLOYEE") || strings.Contains(strings.ToUpper(all[0]), "DIGITAL") {
				eyebrow = all[0]
				if len(all) > 1 {
					title = all[1]
				}
				if len(all) > 2 {
					subtitle = all[2]
				}
				if len(all) > 3 {
					footer = all[len(all)-1]
				}
				bodyLines = nil
				if subtitle != "" {
					bodyLines = []string{subtitle}
				}
			} else if len(all) > 1 {
				subtitle = all[1]
			}
		}

		item := map[string]any{
			"index":      pageCount,
			"title":      title,
			"lines":      bodyLines,
			"bullets":    bullets,
			"variant":    variant,
			"background": bg,
			"accent":     accent,
			"textColor":  "#FFFFFF",
		}
		if !isDarkHex(bg) {
			item["textColor"] = "#102A43"
		}
		if eyebrow != "" {
			item["eyebrow"] = eyebrow
		}
		if subtitle != "" {
			item["subtitle"] = subtitle
		}
		if footer != "" {
			item["footer"] = footer
		}
		imgPath := pptxSlideImagePath(storageName, pageCount)
		if st, err := os.Stat(imgPath); err == nil && st.Size() > 0 {
			item["imageUrl"] = pptxSlideImageURL(storageName, pageCount)
		}
		slidePayloads = append(slidePayloads, item)

		blocks = append(blocks, map[string]any{"type": "h2", "text": title})
		bulletSet := map[string]struct{}{}
		for _, b := range bullets {
			bulletSet[b] = struct{}{}
		}
		for _, line := range bodyLines {
			if _, ok := bulletSet[line]; ok {
				blocks = append(blocks, map[string]any{"type": "li", "text": line, "ordered": false})
			} else {
				blocks = append(blocks, map[string]any{"type": "p", "text": line})
			}
		}
		blocks = append(blocks, map[string]any{"type": "blank"})
	}
	if pageCount == 0 {
		return nil, fmt.Errorf("PPT 中未找到幻灯片")
	}

	ensurePptxSlideRenders(storageName, pageCount)
	for i := range slidePayloads {
		idx := i + 1
		imgPath := pptxSlideImagePath(storageName, idx)
		if st, err := os.Stat(imgPath); err == nil && st.Size() > 0 {
			slidePayloads[i]["imageUrl"] = pptxSlideImageURL(storageName, idx)
		}
	}

	displayTitle := normalizePptxTitle(inferTitleFromPptxStorage(storageName))
	downloadName := pptxDownloadBasename(displayTitle)
	payload := map[string]any{
		"kind":         "pptx",
		"title":        displayTitle,
		"filename":     storageName,
		"downloadName": downloadName,
		"pageCount":    pageCount,
		"slides":       slidePayloads,
		"blocks":       blocks,
		"previewMode":  "visual",
		"accent":       accent,
	}
	for _, s := range slidePayloads {
		if str(s["imageUrl"]) != "" {
			payload["previewMode"] = "raster"
			break
		}
	}
	if warn := pptxOOXMLContentWarning(path); warn != "" {
		payload["contentWarning"] = warn
	}
	return payload, nil
}

func (s *Service) serveSkillArtifactSlidePNG(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/skill-artifacts/")
	parts := strings.Split(path, "/")
	if len(parts) != 3 || parts[1] != "slides" || !strings.HasSuffix(strings.ToLower(parts[2]), ".png") {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "幻灯片预览不存在"))
		return
	}
	// Gateway gate: validates name, size cap (pptx base), auth, audit.
	name, ok := gateway.ValidateArtifactRequest(w, r, parts[0], SkillArtifactDir(), s.artifactPolicy(), s.identityAdapter(r), s.appendAuditFn())
	if !ok {
		return
	}
	name = skillArtifactStorageName(name)
	numStr := strings.TrimSuffix(parts[2], ".png")
	numStr = strings.TrimSuffix(numStr, ".PNG")
	n, err := strconv.Atoi(numStr)
	if err != nil || n < 1 {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "无效页码"))
		return
	}
	imgPath := pptxSlideImagePath(name, n)
	if _, err := os.Stat(imgPath); err != nil {
		ensurePptxSlideRenders(name, n)
	}
	data, err := os.ReadFile(imgPath)
	if err != nil || len(data) == 0 {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "幻灯片预览图尚未生成"))
		return
	}
	w.Header().Set("Content-Type", "image/png")
	// W3-D3 iframe sandbox. The slide image is meant to be embedded by
	// the in-app preview; same-origin frame only + nosniff.
	writePreviewSandboxHeaders(w)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
