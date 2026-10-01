// Package manifest 提供技能包 ``SKILL.md`` 元数据解析。
//
// 阶段 2:仅识别 front-matter 内的 ``egress:`` 字段(技能声明的外联白名单)。
// 不引入 yaml 依赖;自己写 split+trim,只覆盖我们关心的语法:
//
//	---
//	egress: ["wttr.in", "api.weather.gov"]
//	---
//
// 或 list 形式:
//
//	---
//	egress:
//	  - wttr.in
//	  - api.weather.gov
//	---
//
// 无 front-matter 或无 egress 字段 → 返回 ``nil``,调用方按 deny-all 处理。
package manifest

import (
	"bufio"
	"os"
	"regexp"
	"strings"
)

// ExtractEgress reads SKILL.md front-matter and returns the declared egress
// allow-list. Empty result means "no declaration" (caller should fall back to
// the admin policy, which defaults to deny-all after Phase 2).
//
// Errors are non-fatal: file missing / no front-matter / parse failure all
// return ``nil`` — the absence of a declaration is itself meaningful.
func ExtractEgress(skillMDPath string) []string {
	f, err := os.Open(skillMDPath)
	if err != nil {
		return nil
	}
	defer f.Close()
	return extractEgressReader(f)
}

func extractEgressReader(r *os.File) []string {
	// 只读前 4KB,front-matter 几乎不会超过这个尺寸;避免巨型 SKILL.md 拖累启动
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024)
	if !scanner.Scan() {
		return nil
	}
	first := strings.TrimSpace(scanner.Text())
	if first != "---" {
		return nil
	}
	var lines []string
	for scanner.Scan() {
		trim := strings.TrimSpace(scanner.Text())
		if trim == "---" {
			return parseEgressBlock(lines)
		}
		lines = append(lines, trim)
	}
	return nil
}

var (
	// 匹配 `egress: ["a", "b", 'c']` 这种 inline list
	reEgressInline = regexp.MustCompile(`(?i)^\s*egress\s*:\s*\[(.*?)\]\s*$`)
	// 匹配 `egress:` 起始(list block)
	reEgressKey = regexp.MustCompile(`(?i)^\s*egress\s*:\s*$`)
	// 单个 list 项前缀 `- foo`
	reEgressItem = regexp.MustCompile(`^\s*-\s+(.+?)\s*$`)
)

func parseEgressBlock(lines []string) []string {
	var rawInline string
	var inlineMatch bool
	for _, line := range lines {
		if m := reEgressInline.FindStringSubmatch(line); m != nil {
			rawInline = m[1]
			inlineMatch = true
			break
		}
	}
	if inlineMatch {
		return splitQuotedList(rawInline)
	}
	// list-block 形式:找到 `egress:` 后的 `- item` 行直到下一个顶层 key
	var inEgressBlock bool
	var hosts []string
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if reEgressKey.MatchString(trim) {
			inEgressBlock = true
			continue
		}
		if !inEgressBlock {
			continue
		}
		// list-block 中,如果出现新的顶层 key(`xxx:` 但不以 `- ` 起),结束
		if trim != "" && !strings.HasPrefix(trim, "-") && strings.Contains(trim, ":") {
			break
		}
		if m := reEgressItem.FindStringSubmatch(line); m != nil {
			host := strings.Trim(strings.TrimSpace(m[1]), `"'`)
			if host != "" {
				hosts = append(hosts, host)
			}
		}
	}
	return hosts
}

func splitQuotedList(raw string) []string {
	// 按逗号分,但支持引号内的逗号不分割
	var out []string
	var buf strings.Builder
	inQuote := byte(0)
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if inQuote != 0 {
			if c == inQuote {
				inQuote = 0
			} else {
				buf.WriteByte(c)
			}
			continue
		}
		if c == '"' || c == '\'' {
			inQuote = c
			continue
		}
		if c == ',' {
			if s := strings.TrimSpace(buf.String()); s != "" {
				out = append(out, strings.Trim(s, `"'`))
			}
			buf.Reset()
			continue
		}
		buf.WriteByte(c)
	}
	if s := strings.TrimSpace(buf.String()); s != "" {
		out = append(out, strings.Trim(s, `"'`))
	}
	return out
}