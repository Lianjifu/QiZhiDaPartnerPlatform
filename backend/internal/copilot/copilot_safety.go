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
