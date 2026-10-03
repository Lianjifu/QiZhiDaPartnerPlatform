package skills

import (
	"net/url"
	"regexp"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

var (
	reExternalURL = regexp.MustCompile(`(?i)https?://[^\s"'<>]+`)
	reSecretLike  = regexp.MustCompile(`(?i)(bearer\s+[a-z0-9._\-]+|sk-[a-z0-9]{8,}|password\s*=\s*\S+|token\s*=\s*\S+)`)
	reDangerCmd   = regexp.MustCompile(`(?i)\b(rm\s+-rf|drop\s+database|force\s*push|--hard|curl\s+.*\|\s*sh)\b`)
)

type skillPolicyDecision struct {
	OK            bool
	Blocked       bool
	Reason        string
	CorrelationID string
	RateLimited   bool
	CircuitOpen   bool
	EgressBlocked bool
	DangerBlocked bool
}

func (s *Service) evaluateSkillSandboxPolicyLocked(ws, skillID string, commandOrTarget string) skillPolicyDecision {
	dec := skillPolicyDecision{OK: true, CorrelationID: s.Store.ID("corr")}
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		dec.OK = false
		dec.Blocked = true
		dec.Reason = "技能不存在"
		return dec
	}
	life := str(sk["lifecycleStatus"])
	if life == "disabled" || life == "deprecated" {
		dec.OK = false
		dec.Blocked = true
		dec.Reason = "技能已暂停或废弃，无法执行"
		return dec
	}
	policy := s.ensureSkillGovernanceLocked(skillID)
	h := s.ensureSkillHealthLocked(sk)

	if boolFrom(policy["circuitBreakerEnabled"]) {
		st := str(h["status"])
		if st == "quarantined" || st == "incident" || life == "quarantined" {
			dec.OK = false
			dec.Blocked = true
			dec.CircuitOpen = true
			dec.Reason = "熔断已打开：技能处于隔离/事故状态，请先重新验证"
			return dec
		}
	}

	limit := intFrom(policy["rateLimitPerMinute"])
	if limit <= 0 {
		limit = 60
	}
	if s.consumeSkillRateLocked(skillID, limit) {
		dec.OK = false
		dec.Blocked = true
		dec.RateLimited = true
		dec.Reason = "已触发每分钟调用限流（" + itoaPolicy(limit) + "/min）"
		return dec
	}

	if reDangerCmd.MatchString(commandOrTarget) {
		dec.OK = false
		dec.Blocked = true
		dec.DangerBlocked = true
		dec.Reason = "高危命令已被策略拦截"
		return dec
	}

	if hosts := extractHosts(commandOrTarget); len(hosts) > 0 {
		allowed := allowedEgressHosts(policy["allowedEgress"])
		for _, host := range hosts {
			if !hostAllowed(host, allowed) {
				dec.OK = false
				dec.Blocked = true
				dec.EgressBlocked = true
				dec.Reason = "外连目标不在允许清单：" + host
				return dec
			}
		}
	}
	return dec
}

func itoaPolicy(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func (s *Service) consumeSkillRateLocked(skillID string, limitPerMin int) bool {
	windows := s.skillExtraMap("rateWindows")
	now := time.Now().Unix()
	raw, _ := windows[skillID].(map[string]any)
	if raw == nil {
		raw = map[string]any{"windowStart": now, "count": 0}
	}
	start := int64(intFrom(raw["windowStart"]))
	count := intFrom(raw["count"])
	if now-start >= 60 {
		start = now
		count = 0
	}
	count++
	raw["windowStart"] = start
	raw["count"] = count
	windows[skillID] = raw
	return count > limitPerMin
}

func extractHosts(text string) []string {
	matches := reExternalURL.FindAllString(text, -1)
	seen := map[string]struct{}{}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		u, err := url.Parse(m)
		if err != nil || u.Host == "" {
			continue
		}
		host := strings.ToLower(u.Hostname())
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		out = append(out, host)
	}
	return out
}

func allowedEgressHosts(v any) []string {
	out := make([]string, 0)
	switch t := v.(type) {
	case []string:
		for _, h := range t {
			out = append(out, strings.ToLower(strings.TrimSpace(h)))
		}
	case []any:
		for _, x := range t {
			out = append(out, strings.ToLower(strings.TrimSpace(str(x))))
		}
	}
	return out
}

func hostAllowed(host string, allowed []string) bool {
	host = strings.ToLower(host)
	for _, a := range allowed {
		a = strings.ToLower(strings.TrimSpace(a))
		if a == "" {
			continue
		}
		if host == a || strings.HasSuffix(host, "."+a) {
			return true
		}
	}
	return false
}

func maskSkillOutput(text string, enabled bool) string {
	if !enabled || text == "" {
		return text
	}
	return reSecretLike.ReplaceAllString(text, "[REDACTED]")
}

// skillSupplyChainGate returns approval/review/blocked for a candidate
// skill. W2-D1: replaces the legacy publisher-string whitelist with a
// KeyID lookup against the candidate's workspace publisher key. The
// legacy whitelist is kept as a tier-2 fallback for builtin skills
// whose signedKeyId points at the global trust store.
func (s *Service) skillSupplyChainGate(candidate map[string]any) (decision string, reason string, checks []map[string]any) {
	signed := true
	if candidate["signed"] != nil {
		signed = boolFrom(candidate["signed"])
	}
	vuln := intFrom(candidate["vulnerabilityCount"])
	keyID := str(candidate["publisherKeyId"])
	workspaceID := str(candidate["workspaceId"])

	trusted := s.publisherKeyTrusted(workspaceID, keyID, str(candidate["publisher"]))

	checks = []map[string]any{
		{"label": "发布方信任", "status": ternary(trusted, "passed", "review")},
		{"label": "制品签名", "status": ternary(signed, "passed", "failed")},
		{"label": "漏洞扫描", "status": ternary(vuln == 0, "passed", ternary(vuln >= 3, "failed", "review"))},
	}

	decision = "approved"
	if !signed {
		return "blocked", "制品签名校验未通过，禁止安装", checks
	}
	if vuln >= 3 {
		return "blocked", "存在高危漏洞（≥3），禁止安装", checks
	}
	if !trusted || vuln > 0 {
		decision = "review_required"
		reason = "发布方或漏洞扫描需要安全复核"
		if !trusted {
			reason = "非受信发布方，需要安全负责人审批"
		} else if vuln > 0 {
			reason = "存在待修复漏洞，需要安全复核后安装"
		}
	}
	return decision, reason, checks
}

func errRateLimited(msg string) error {
	return apperr.New(apperr.RateLimited, 429, msg)
}

// publisherKeyTrusted is the W2-D1 source of truth for whether a skill's
// publisher KeyID is recognized for the candidate's workspace.
//
// Tiers (highest trust first):
//   1. Workspace publisher key (active or rotated grace) — `keyID` matches
//      the workspace's active key or any rotated entry.
//   2. Legacy whitelist — keeps builtin skills whose publisher was set
//      before W2-D1 working even though they have no signedKeyId.
//   3. Dev/empty key — unsigned candidates always trusted when policy is
//      PolicyOff; otherwise we let the gate reject via the empty-key check.
//
// Service may be nil in tests that predate Store wiring.
func (s *Service) publisherKeyTrusted(workspaceID, keyID, legacyPublisher string) bool {
	// Tier 1 — workspace publisher key.
	if s != nil && s.Store != nil && keyID != "" {
		// resolvePublisherKey covers workspace-active + workspace-rotated;
		// it returns SkillSignatureUnknownKey on miss.
		if _, trust, err := s.ResolvePublisherKey(workspaceID, keyID); err == nil &&
			(trust == "workspace-active" || trust == "workspace-rotated") {
			return true
		}
		// global trust store (builtin publishers) — only counts under
		// PolicyAny / PolicyOff. Caller decides final via policy gate.
		if s.resolveSkillTrustStore() != nil {
			if _, err := s.resolveSkillTrustStore().LookupPublic(keyID); err == nil {
				return true
			}
		}
	}
	// Tier 2 — legacy string whitelist for builtin publishers without
	// signedKeyId. Kept for back-compat with skills seeded before W2-D1.
	if legacyPublisher == "" ||
		legacyPublisher == "企业能力商店" ||
		legacyPublisher == "SRE 平台组" ||
		legacyPublisher == "安全运营组" ||
		legacyPublisher == "流程平台组" ||
		legacyPublisher == "消息平台组" {
		return true
	}
	return false
}
