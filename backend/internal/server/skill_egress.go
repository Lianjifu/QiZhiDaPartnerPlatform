package server

import (
	"path/filepath"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/skills/manifest"
)

// resolveSkillEgress 把技能包声明的 ``egress`` 与 admin policy 的
// ``allowedEgress`` 求交集,作为本次执行真正下发的白名单。
//
// 设计要点(阶段 2):
//   - 技能必须在 ``SKILL.md`` front-matter 显式声明 ``egress:`` 才允许外联;
//     未声明 → 视同 deny-all,不读 admin policy 兜底,防 skill 隐式外联。
//   - admin 可通过 policy 进一步收紧(交集),不能让 skill 绕过 admin 限定的范围。
//   - 比较前先 lower-case + 去前后空白,匹配 Python 侧 host_allowed() 语义;
//     避免两端因大小写分歧导致"声明放行但被 Python 端 502"。
//
// 入参:
//   - sk:从 ``findSkillLocked`` 拿到的技能 map(可能为 nil;为 nil 直接返回空切片)
//   - govPolicy:``ensureSkillGovernanceLocked`` 返回的 governance map(同上)
//
// 返回值:交集切片(已规范化,空字符串已剔除)。若任一侧为空 → 整体为空(deny-all)。
func resolveSkillEgress(sk map[string]any, govPolicy map[string]any) []string {
	if sk == nil {
		return nil
	}
	pkgPath := strings.TrimSpace(str(sk["packagePath"]))
	if pkgPath == "" {
		return nil
	}
	mdPath := filepath.Join(pkgPath, coalesce(str(sk["skillMdPath"]), "SKILL.md"))
	declared := manifest.ExtractEgress(mdPath)
	policy := normalizeEgress(decodeStringSlice(govPolicy["allowedEgress"]))
	declared = normalizeEgress(declared)
	if len(declared) == 0 {
		// 阶段 2:无声明 → 拒绝全部外联(防 skill 隐式上外网)。
		return []string{}
	}
	if len(policy) == 0 {
		// 声明了 egress 但 admin policy 为空 → 也拒绝(保守策略)。
		return []string{}
	}
	policySet := make(map[string]struct{}, len(policy))
	for _, p := range policy {
		policySet[p] = struct{}{}
	}
	out := make([]string, 0, len(declared))
	for _, h := range declared {
		if _, ok := policySet[h]; ok {
			out = append(out, h)
		}
	}
	return out
}

// normalizeEgress 统一 lowercase + 去前后空白 + 去空字符串;不保留顺序。
func normalizeEgress(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, h := range in {
		h = strings.ToLower(strings.TrimSpace(h))
		if h == "" {
			continue
		}
		if _, dup := seen[h]; dup {
			continue
		}
		seen[h] = struct{}{}
		out = append(out, h)
	}
	return out
}

// egressUsedString 把 Python 返回的 egressUsed/egressDenied 拼成短串写进 audit detail,
// 空 list 返回 `[]`,便于审计检索(`grep egress=wttr.in`)。
func egressUsedString(result map[string]any, key string) string {
	hosts := decodeStringSlice(result[key])
	if len(hosts) == 0 {
		return "[]"
	}
	return strings.Join(hosts, ",")
}