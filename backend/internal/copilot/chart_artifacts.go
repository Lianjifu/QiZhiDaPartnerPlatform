// Package copilot —— Chart 渲染(SVG 后端,前端 inline 嵌入)。
//
// 给数字伙伴一个 "chart.generate" 工具,把结构化数据渲染成 SVG 图表;
// SVG 作为 artifact 走 copilot_artifacts 的 /api/skill-artifacts/ 下载通道,
// 前端 inline 渲染(M12+ MemoryTab 里类似 <svg> 处理)。
//
// 支持 4 种图:bar(垂直柱)、line(折线)、pie(饼图)、table(HTML table 转 SVG)。
// 输入结构:{"copies": [{"label": str, "value": number}, ...]}
//
// 设计要点:
// - SVG 自包含(viewBox + 显式字体),不依赖外部样式
// - 输出长度控制在 32KB 内,再大退化为 markdown 表格
// - 颜色调色板:走 CSS var(--brand),保证与平台主题一致
package copilot

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// chartSeries 是单个系列的数据点;多系列共享 x 轴。
type chartSeries struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

// chartInput 是 chart.generate 工具的参数。
type chartInput struct {
	Type   string         `json:"type"`            // bar | line | pie | table
	Title  string         `json:"title"`           // optional
	Series []chartSeries  `json:"series"`          // data points
}

// renderChartSVG 是 chart.generate 工具的执行函数。
// 直接返回 SVG 字符串(供 assistant 引用 + 落 artifact)。
func renderChartSVG(raw string) toolExecResult {
	res := toolExecResult{}
	var in chartInput
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		res.Status = "failed"
		res.Error = fmt.Sprintf("chart: 参数 JSON 解析失败: %v", err)
		return res
	}
	in.Type = strings.ToLower(strings.TrimSpace(in.Type))
	if in.Type == "" {
		in.Type = "bar"
	}
	if len(in.Series) == 0 {
		res.Status = "failed"
		res.Error = "chart: 系列数据为空,至少 1 个数据点"
		return res
	}
	if len(in.Series) > 32 {
		res.Status = "failed"
		res.Error = fmt.Sprintf("chart: 数据点过多 (%d, 上限 32)", len(in.Series))
		return res
	}
	var svg string
	switch in.Type {
	case "bar":
		svg = renderBarChart(in)
	case "line":
		svg = renderLineChart(in)
	case "pie":
		svg = renderPieChart(in)
	case "table":
		// table 走 Same markdown 表格(不是 SVG),以兼容不支持 SVG 的下载通道
		svg = renderMarkdownTable(in)
	default:
		res.Status = "failed"
		res.Error = fmt.Sprintf("chart: 不支持的类型 %q (支持 bar/line/pie/table)", in.Type)
		return res
	}
	if len(svg) > 32*1024 {
		// 退化:超长 SVG 退到 markdown table
		svg = renderMarkdownTable(in)
	}
	res.Status = "success"
	res.Output = svg
	return res
}

// chartPalette 是与平台主题兼容的颜色组(浅色背景下区分度足够)。
var chartPalette = []string{
	"#5b4cdb", "#7a3eb3", "#e08e45", "#2f9e6e",
	"#c75a72", "#4f7ab8", "#a884c7", "#5e8e6b",
	"#d27242", "#4878a6", "#855fb5", "#5fa777",
}

// colorFor 返回调色板中的第 i 个颜色(循环)。
func colorFor(i int) string {
	return chartPalette[i%len(chartPalette)]
}

// escXML 转义 XML 特殊字符以避免 label 注入。
func escXML(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&apos;")
	return r.Replace(s)
}

// renderBarChart 渲染垂直柱图。
// viewBox: 600x340(标题 + 60px 内边距 + 280 绘图区 + 60 标签区)
func renderBarChart(in chartInput) string {
	const (
		vw, vh         = 600, 340
		padL, padR     = 60, 16
		padT, padB     = 40, 80
	)
	plotW := vw - padL - padR
	plotH := float64(vh - padT - padB)
	var maxV float64 = 0
	for _, s := range in.Series {
		if s.Value > maxV {
			maxV = s.Value
		}
	}
	if maxV <= 0 {
		maxV = 1
	}
	// y 轴 5 个刻度
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">`, vw, vh))
	if in.Title != "" {
		sb.WriteString(fmt.Sprintf(`<text x="%d" y="20" font-size="14" font-weight="600" fill="#1f2937">%s</text>`, padL, escXML(in.Title)))
	}
	// 网格 + y 轴
	for i := 0; i <= 4; i++ {
		y := padT + plotH - plotH*float64(i)/4
		v := maxV * float64(i) / 4
		sb.WriteString(fmt.Sprintf(`<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#e5e7eb" stroke-width="1"/>`, padL, y, padL+plotW, y))
		sb.WriteString(fmt.Sprintf(`<text x="%d" y="%.1f" text-anchor="end" fill="#6b7280">%.2f</text>`, padL-8, y+4, v))
	}
	// 柱子
	n := len(in.Series)
	gap := float64(plotW) * 0.04
	barW := (float64(plotW) - gap*float64(n+1)) / float64(n)
	for i, s := range in.Series {
		h := plotH * (s.Value / maxV)
		x := float64(padL) + gap + float64(i)*(barW+gap)
		y := float64(padT) + plotH - h
		sb.WriteString(fmt.Sprintf(`<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" rx="2"><title>%s = %.2f</title></rect>`,
			x, y, barW, h, colorFor(i), escXML(s.Label), s.Value))
		// label (旋转避免重叠)
		sb.WriteString(fmt.Sprintf(`<text x="%.1f" y="%d" text-anchor="end" fill="#374151" transform="rotate(-35 %.1f %d)">%s</text>`,
			x+barW/2, padT+plotH+16, x+barW/2, padT+plotH+16, escXML(s.Label)))
		// value 在柱子顶部
		sb.WriteString(fmt.Sprintf(`<text x="%.1f" y="%.1f" text-anchor="middle" fill="#111827" font-weight="600">%.2f</text>`,
			x+barW/2, y-4, s.Value))
	}
	sb.WriteString(`</svg>`)
	return sb.String()
}

// renderLineChart 折线图。
func renderLineChart(in chartInput) string {
	const (
		vw, vh         = 600, 340
		padL, padR     = 60, 16
		padT, padB     = 40, 50
	)
	plotW := vw - padL - padR
	plotH := float64(vh - padT - padB)
	var maxV float64 = 0
	for _, s := range in.Series {
		if s.Value > maxV {
			maxV = s.Value
		}
	}
	if maxV <= 0 {
		maxV = 1
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">`, vw, vh))
	if in.Title != "" {
		sb.WriteString(fmt.Sprintf(`<text x="%d" y="20" font-size="14" font-weight="600" fill="#1f2937">%s</text>`, padL, escXML(in.Title)))
	}
	for i := 0; i <= 4; i++ {
		y := padT + plotH - plotH*float64(i)/4
		v := maxV * float64(i) / 4
		sb.WriteString(fmt.Sprintf(`<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#e5e7eb"/>`, padL, y, padL+plotW, y))
		sb.WriteString(fmt.Sprintf(`<text x="%d" y="%.1f" text-anchor="end" fill="#6b7280">%.2f</text>`, padL-8, y+4, v))
	}
	// 折线
	n := len(in.Series)
	stepX := float64(plotW) / float64(maxInt(n-1, 1))
	for i, s := range in.Series {
		x := float64(padL) + stepX*float64(i)
		y := float64(padT) + plotH - plotH*(s.Value/maxV)
		color := colorFor(0) // 单系列
		if i == 0 {
			sb.WriteString(fmt.Sprintf(`<polyline points="%.1f,%.1f `, x, y))
		} else {
			sb.WriteString(fmt.Sprintf(`%.1f,%.1f `, x, y))
		}
		if i == n-1 {
			sb.WriteString(`" fill="none" stroke="` + color + `" stroke-width="2"/>`)
		}
		// data point
		sb.WriteString(fmt.Sprintf(`<circle cx="%.1f" cy="%.1f" r="3" fill="%s"><title>%s = %.2f</title></circle>`,
			x, y, color, escXML(s.Label), s.Value))
		// x label
		sb.WriteString(fmt.Sprintf(`<text x="%.1f" y="%d" text-anchor="middle" fill="#374151">%s</text>`,
			x, padT+plotH+16, escXML(s.Label)))
	}
	sb.WriteString(`</svg>`)
	return sb.String()
}

// renderPieChart 饼图。
func renderPieChart(in chartInput) string {
	const vw, vh = 480, 320
	var sum float64
	for _, s := range in.Series {
		if s.Value > 0 {
			sum += s.Value
		}
	}
	if sum <= 0 {
		sum = 1
	}
	cx, cy := 150.0, float64(vh)/2
	r := 110.0
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">`, vw, vh))
	if in.Title != "" {
		sb.WriteString(fmt.Sprintf(`<text x="20" y="20" font-size="14" font-weight="600" fill="#1f2937">%s</text>`, escXML(in.Title)))
	}
	var angle float64 = -math.Pi / 2 // 12 点钟
	for i, s := range in.Series {
		frac := s.Value / sum
		next := angle + frac*2*math.Pi
		x1 := cx + r*math.Cos(angle)
		y1 := cy + r*math.Sin(angle)
		x2 := cx + r*math.Cos(next)
		y2 := cy + r*math.Sin(next)
		large := 0
		if frac > 0.5 {
			large = 1
		}
		sb.WriteString(fmt.Sprintf(`<path d="M%.1f,%.1f L%.1f,%.1f A%.1f,%.1f 0 %d 1 %.1f,%.1f Z" fill="%s"><title>%s = %.2f (%.1f%%)</title></path>`,
			cx, cy, x1, y1, r, r, large, x2, y2, colorFor(i), escXML(s.Label), s.Value, frac*100))
		angle = next
	}
	// 图例
	for i, s := range in.Series {
		y := 40.0 + float64(i)*16
		sb.WriteString(fmt.Sprintf(`<rect x="290" y="%.0f" width="12" height="12" fill="%s" rx="2"/>`, y-9, colorFor(i)))
		sb.WriteString(fmt.Sprintf(`<text x="308" y="%.0f" fill="#374151">%s = %.2f</text>`, y, escXML(s.Label), s.Value))
	}
	sb.WriteString(`</svg>`)
	return sb.String()
}

// renderMarkdownTable 表格 fallback(超长 SVG / 表格模式直接出 markdown)。
func renderMarkdownTable(in chartInput) string {
	var b strings.Builder
	if in.Title != "" {
		b.WriteString("## ")
		b.WriteString(in.Title)
		b.WriteString("\n\n")
	}
	b.WriteString("| Label | Value |\n|---|---|\n")
	for _, s := range in.Series {
		b.WriteString(fmt.Sprintf("| %s | %.4f |\n", escXML(s.Label), s.Value))
	}
	return b.String()
}

// maxInt 标准库 math 没有 max int,自己写。
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}