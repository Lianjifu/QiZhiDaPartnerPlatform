// Package copilot —— 出站内容安全门控。
//
// 在 LLM 回复落到 SSE / 持久化前对纯文本做一次"敏感信息扫描+脱敏/拦截"。
// 范围：
//   - 中国大陆手机号（safetyPhoneRe）
//   - 18 位身份证号（safetyIDRe）
//   - API Key / Bearer Token / sk-* 等密钥（safetyKeyRe）
//
// 模式由环境变量 DE_CONTENT_SAFETY 控制：
//   - block   → 命中即整段拒答（返回占位提示文案）
//   - redact  → 默认，把命中片段替换为 "[手机号已脱敏]" 等
//   - off     → 关闭扫描（仅供测试）
package copilot

import (
	"os"
	"regexp"
	"strings"
)

var (
	safetyPhoneRe = regexp.MustCompile(`1[3-9]\d{9}`)
	safetyIDRe    = regexp.MustCompile(`\b\d{17}[\dXx]\b`)
	safetyKeyRe   = regexp.MustCompile(`(?i)(sk-[a-z0-9]{16,}|api[_-]?key\s*[:=]\s*\S{8,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*)`)
)

func contentSafetyMode() string {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("DE_CONTENT_SAFETY")))
	switch v {
	case "block", "redact", "off":
		return v
	default:
		return "redact"
	}
}

// safetyResult 是 applyContentSafety 的返回结构。
//
//   - Text     —— 脱敏/拦截后的最终文本
//   - Blocked  —— true 表示命中 block 模式，整个回复被替换为拒答占位
//   - Redacted —— true 表示命中 redact 模式且至少一条规则被替换
//   - Reasons  —— 命中的规则名列表（phone / id_card / secret），给审计/前端回显
type safetyResult struct {
	Text     string
	Blocked  bool
	Redacted bool
	Reasons  []string
}

func applyContentSafety(raw string) safetyResult {
	mode := contentSafetyMode()
	if mode == "off" || raw == "" {
		return safetyResult{Text: raw}
	}
	var reasons []string
	out := raw
	if safetyPhoneRe.MatchString(out) {
		reasons = append(reasons, "phone")
		if mode == "block" {
			return safetyResult{Blocked: true, Reasons: reasons, Text: "[内容安全拦截：含手机号]"}
		}
		out = safetyPhoneRe.ReplaceAllString(out, "[手机号已脱敏]")
	}
	if safetyIDRe.MatchString(out) {
		reasons = append(reasons, "id_card")
		if mode == "block" {
			return safetyResult{Blocked: true, Reasons: reasons, Text: "[内容安全拦截：含证件号]"}
		}
		out = safetyIDRe.ReplaceAllString(out, "[证件号已脱敏]")
	}
	if safetyKeyRe.MatchString(out) {
		reasons = append(reasons, "secret")
		if mode == "block" {
			return safetyResult{Blocked: true, Reasons: reasons, Text: "[内容安全拦截：含密钥]"}
		}
		out = safetyKeyRe.ReplaceAllString(out, "[密钥已脱敏]")
	}
	return safetyResult{Text: out, Redacted: len(reasons) > 0 && mode == "redact", Reasons: reasons}
}
