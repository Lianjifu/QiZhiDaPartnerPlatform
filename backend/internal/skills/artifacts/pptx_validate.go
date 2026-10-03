package artifacts

import (
	"archive/zip"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
)

// pptxLeakagePatterns catches slides that contain LLM-side planning
// material instead of audience-facing copy. Each entry is a substring
// that, if found in any slide's <a:t> run, marks the deck as unfit for
// delivery. Patterns are kept conservative — a hit is unambiguous
// template / instruction leakage, not a legitimate user phrase.
var pptxLeakagePatterns = []*regexp.Regexp{
	regexp.MustCompile(`禁止(使用|输出)占位符`),
	regexp.MustCompile(`每个\s*H[12]\s*必须(给出|紧跟|跟上)?\s*\d[-\d]*\s*句`),
	regexp.MustCompile(`本节(交代|归纳|列出|按主题|用一段话收束)`),
	regexp.MustCompile(`本节.{0,24}与(战略目标|本次汇报希望达成|组织当前的优先事项|关键指标|风险点)`),
	regexp.MustCompile(`(DIGITAL EMPLOYEE|PilotDeck\s*·\s*生产级版式)`),
	regexp.MustCompile(`^【指令】`),
}

// pptxLeakageReason returns the first pattern that leaked into the
// generated deck, or "" if the file looks audience-facing. Path is the
// storage path on disk; reason is the offending slide index + pattern
// when a hit is found.
func pptxLeakageReason(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", fmt.Errorf("无法打开 PPT：%w", err)
	}
	defer zr.Close()

	reSlide := regexp.MustCompile(`(?i)^ppt/slides/slide(\d+)\.xml$`)
	reText := regexp.MustCompile(`<a:t>([^<]*)</a:t>`)

	type slideEntry struct {
		idx  int
		name string
	}
	var slides []slideEntry
	for _, f := range zr.File {
		m := reSlide.FindStringSubmatch(f.Name)
		if len(m) != 2 {
			continue
		}
		var n int
		fmt.Sscanf(m[1], "%d", &n)
		slides = append(slides, slideEntry{idx: n, name: f.Name})
	}
	sort.Slice(slides, func(i, j int) bool { return slides[i].idx < slides[j].idx })
	if len(slides) == 0 {
		return "PPT 中未找到幻灯片", nil
	}

	for _, s := range slides {
		f, err := zr.Open(s.name)
		if err != nil {
			continue
		}
		raw, _ := io.ReadAll(io.LimitReader(f, 1<<20))
		_ = f.Close()
		var b strings.Builder
		for _, m := range reText.FindAllSubmatch(raw, -1) {
			b.Write(m[1])
		}
		text := b.String()
		for _, re := range pptxLeakagePatterns {
			if re.MatchString(text) {
				return fmt.Sprintf("slide %d 检测到模板指令/占位文本（命中 %s）", s.idx, re.String()), nil
			}
		}
	}
	return "", nil
}