package artifacts

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// XLSX-specific artifact helpers. Companion to artifacts.go (cross-format
// HTTP handlers + common helpers), artifacts_docx.go (DOCX), and
// artifacts_pptx.go (PPTX).

// XLSX regex vars. Kept at package level for the same reason as the
// docx/pptx regex vars in their respective files.
var reSkillXlsxPrefix = regexp.MustCompile(`(?i)^skill[_-]?xlsx[_-]*`)

// IsSpreadsheetSkillName classifies a tool/skill name as belonging to
// the Excel spreadsheet family. Mirrors IsDocxSkillName /
// IsPptxSkillName for the spreadsheet format.
func IsSpreadsheetSkillName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return n == "xlsx" || n == "spreadsheets" || n == "spreadsheet" ||
		n == "excel" || strings.Contains(n, "spreadsheet") || n == "表格生成"
}

// normalizeXlsxTitle turns LLM / tool noise into a short readable
// Chinese title for spreadsheets.
func normalizeXlsxTitle(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.Trim(s, "《》「」『》\"'`")
	s = reSkillXlsxPrefix.ReplaceAllString(s, "")
	s = regexp.MustCompile(`(?i)(\.xlsx|_xlsx)$`).ReplaceAllString(s, "")
	s = reMultiSpace.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	if s == "" || strings.EqualFold(s, "xlsx") || s == "表格" || s == "excel" {
		return "数据明细"
	}
	runes := []rune(s)
	if len(runes) > 32 {
		s = string(runes[:32])
	}
	return strings.TrimSpace(s)
}

// xlsxDownloadBasename is the user-facing download name, e.g.
// 预算明细.xlsx.
func xlsxDownloadBasename(title string) string {
	title = normalizeXlsxTitle(title)
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
		out = "spreadsheet"
	}
	return out + ".xlsx"
}

// xlsxStorageName builds a unique storage key (12-hex-id + basename).
func xlsxStorageName(downloadName string) string {
	base := strings.TrimSuffix(downloadName, filepath.Ext(downloadName))
	id := fmt.Sprintf("%x", time.Now().UnixNano())
	if len(id) > 12 {
		id = id[len(id)-12:]
	}
	return id + "-" + base + ".xlsx"
}

// xlsxDisplayNameFromStorage strips the collision id for
// Content-Disposition / UI display.
func xlsxDisplayNameFromStorage(storage string) string {
	name := filepath.Base(strings.TrimSpace(storage))
	if reArtifactIDPref.MatchString(name) {
		rest := reArtifactIDPref.ReplaceAllString(name, "")
		if rest != "" {
			return xlsxDownloadBasename(rest)
		}
	}
	return xlsxDownloadBasename(name)
}

// findGenerateXlsxScript locates the spreadsheet.sh CLI from the
// spreadsheets skill. The script must be available for both build +
// inspect subcommands.
func findGenerateXlsxScript() (string, error) {
	candidates := []string{
		filepath.Join("..", "..", "..", "services", "qzda-sandbox", "builtin", "skills", "spreadsheets", "scripts", "spreadsheet.sh"),
		filepath.Join("..", "..", "builtin", "skills", "spreadsheets", "scripts", "spreadsheet.sh"),
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append([]string{
			filepath.Join(wd, "..", "..", "..", "services", "qzda-sandbox", "builtin", "skills", "spreadsheets", "scripts", "spreadsheet.sh"),
			filepath.Join(wd, "..", "..", "builtin", "skills", "spreadsheets", "scripts", "spreadsheet.sh"),
			filepath.Join(wd, "builtin", "skills", "spreadsheets", "scripts", "spreadsheet.sh"),
		}, candidates...)
	}
	for _, c := range candidates {
		if st, e := os.Stat(c); e == nil && !st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs, nil
		}
	}
	return "", fmt.Errorf("找不到 spreadsheet.sh")
}

// generateXlsxArtifactLocal builds an .xlsx via the spreadsheet
// skill CLI (markdown table → xlsx).
func generateXlsxArtifactLocal(title, content string) (storageName, downloadPath string, err error) {
	cleanupSkillArtifactsTTL(7*24*time.Hour, 400)
	dir := SkillArtifactDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	displayTitle := normalizeXlsxTitle(title)
	downloadName := xlsxDownloadBasename(displayTitle)
	storageName = xlsxStorageName(downloadName)
	outPath := filepath.Join(dir, storageName)

	// Save content to temp file for build
	contentFile, err := os.CreateTemp("", "de-xlsx-*.md")
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

	scriptPath, err := findGenerateXlsxScript()
	if err != nil {
		return "", "", err
	}
	cmd := exec.Command("bash", scriptPath, "build", "--title", displayTitle, "--spec", contentPath, "--out", outPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", "", fmt.Errorf("xlsx 生成失败: %v (%s)", err, truncateRunes(string(out), 240))
	}
	if st, statErr := os.Stat(outPath); statErr != nil || st.Size() < 100 {
		return "", "", fmt.Errorf("xlsx 产物无效")
	}
	downloadPath = "/api/skill-artifacts/" + storageName
	return storageName, downloadPath, nil
}

// previewXlsxArtifact shells out to spreadsheet.sh inspect to get a
// JSON preview (sheet names, headers, sample rows).
func previewXlsxArtifact(storageName string) (map[string]any, error) {
	storageName = skillArtifactStorageName(storageName)
	if storageName == "" || !strings.HasSuffix(strings.ToLower(storageName), ".xlsx") {
		return nil, fmt.Errorf("无效 xlsx 产物名")
	}
	if !skillArtifactExists(storageName) {
		return nil, fmt.Errorf("产物不存在")
	}
	scriptPath, err := findGenerateXlsxScript()
	if err != nil {
		return nil, err
	}
	path := skillArtifactFilePath(storageName)
	tmpJSON, err := os.CreateTemp("", "de-xlsx-preview-*.json")
	if err != nil {
		return nil, err
	}
	tmpPath := tmpJSON.Name()
	_ = tmpJSON.Close()
	defer os.Remove(tmpPath)

	cmd := exec.Command("bash", scriptPath, "inspect", "--input", path, "--out", tmpPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("xlsx 预览失败: %v (%s)", err, truncateRunes(string(out), 240))
	}
	raw, rerr := os.ReadFile(tmpPath)
	if rerr != nil {
		return nil, fmt.Errorf("xlsx 预览读取失败: %w", rerr)
	}
	var payload map[string]any
	if jerr := json.Unmarshal(raw, &payload); jerr != nil {
		return nil, fmt.Errorf("xlsx 预览解析失败: %w", jerr)
	}
	payload["filename"] = storageName
	payload["downloadName"] = xlsxDisplayNameFromStorage(storageName)
	payload["kind"] = "xlsx"
	return payload, nil
}

// InferXlsxTitleFromMessage extracts a short spreadsheet title from
// the user's intent message. Handles 《...》, 「...」, "生成 X" patterns
// + a few keyword shortcuts for 预算 / 考勤 / 花名册.
func InferXlsxTitleFromMessage(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return ""
	}
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`《([^》]{2,32})》`),
		regexp.MustCompile(`「([^」]{2,32})」`),
		regexp.MustCompile(`生成[一份张]*[《「"]?([^《」"\s，。！？,]{2,24})`),
	} {
		if m := re.FindStringSubmatch(msg); len(m) == 2 {
			t := strings.TrimSpace(m[1])
			if t != "" && t != "表格" {
				return t
			}
		}
	}
	if strings.Contains(msg, "预算") {
		return "预算明细"
	}
	if strings.Contains(msg, "考勤") {
		return "考勤明细"
	}
	if strings.Contains(msg, "花名册") || strings.Contains(msg, "人员名单") {
		return "人员花名册"
	}
	return ""
}

// DefaultXlsxOutlineForMessage produces a structured Excel outline
// (markdown table seed) when the model did not supply content. The
// spreadsheet skill consumes markdown tables. Three branches:
// 预算 / 考勤 / generic.
func DefaultXlsxOutlineForMessage(title, userMsg string) string {
	t := coalesce(strings.TrimSpace(title), "数据明细")
	if strings.Contains(userMsg, "预算") {
		return fmt.Sprintf(`# %s

【指令】禁止使用占位符；每个 H2 必须给出 2-3 句实际描述。

| 项目 | 类别 | 金额（元） | 负责人 | 备注 |
| --- | --- | --- | --- | --- |
| 收入预算 | 主营收入 |  |  |  |
| 成本预算 | 人力成本 |  |  |  |
| 成本预算 | 运营成本 |  |  |  |
| 利润预算 | 净利润 |  |  |  |

## 说明
- 数据周期：
- 口径：
- 复核人：`, t)
	}
	if strings.Contains(userMsg, "考勤") {
		return fmt.Sprintf(`# %s

【指令】禁止使用占位符；每个 H2 必须给出 2-3 句实际描述。

| 员工 | 部门 | 出勤天数 | 迟到 | 早退 | 请假 | 加班 |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## 说明
- 统计周期：
- 异常处理：`, t)
	}
	return fmt.Sprintf(`# %s

【指令】禁止使用占位符；每个 H2 必须给出 2-3 句实际描述。

| 序号 | 名称 | 分类 | 数量 | 单位 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |

## 说明
- 数据来源：
- 责任人：`, t)
}
