// Package copilot —— 包内共享辅助函数（与 internal/server/ 同名辅助镜像）。
//
// 镜像的目的是让 copilot 包不反向依赖 server/。
// 名字/签名必须与 server/ 原版 1:1 一致，改一边必须同步另一边。
//
// 覆盖范围：env 读取 / 字符串拼接 / 类型转换 / env flag 解析 / builtin skills 路径解析 /
// 字符串/数组归一化 / RAG snippet 抽取 / 记忆读取授权 / 切片/记忆/数字 ID 处理等。
//
// Package-private helpers shared across the copilot package. Duplicates
// of helpers in internal/server/ — kept here so copilot never imports
// server/. The original implementations in server/ continue to exist for
// the server-side callers (skill_artifacts.go, etc.).
package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/qizhida-partner-platform/backend/internal/auth"
)

// str 是"防御性字符串转换"：nil-safe，对非字符串值用 fmt.Sprint 兜底。
// str is a defensive string conversion: nil-safe, falls back to fmt.Sprint
// for non-string values (numbers, bools, etc.). Mirrors server.str —
// duplicated instead of imported to keep copilot free of server imports.
func str(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}

// coalesce 在 v 非空（TrimSpace 后）时返回 v，否则返回 def。
// coalesce returns v if non-empty (after TrimSpace), else def.
// Mirrors server.coalesce.
func coalesce(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// envFlagTrue 判断环境变量值是否为 "1" / "true"（大小写不敏感）。
// envFlagTrue reports whether the named env var is set to a truthy value
// ("1" or "true" case-insensitive).
func envFlagTrue(key string) bool {
	v := strings.TrimSpace(os.Getenv(key))
	return v == "1" || strings.EqualFold(v, "true")
}

// envFlagFalse 判断环境变量值是否为 "0" / "false"（大小写不敏感）。
// envFlagFalse reports whether the named env var is set to a falsy value
// ("0" or "false" case-insensitive).
func envFlagFalse(key string) bool {
	v := strings.TrimSpace(os.Getenv(key))
	return v == "0" || strings.EqualFold(v, "false")
}

// intFrom 把任意 v 转成 int；缺字段或解析失败返回 0。
// intFrom converts v to int with a zero default. Mirrors server.intFrom.
func intFrom(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int32:
		return int(t)
	case int64:
		return int(t)
	case float64:
		return int(t)
	case float32:
		return int(t)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(t))
		if err != nil {
			return 0
		}
		return n
	case json.Number:
		n, err := t.Int64()
		if err != nil {
			return 0
		}
		return int(n)
	default:
		return 0
	}
}

// intFromAny 是 intFrom 的严格变体：缺失或非数字字符串返回 def。
// intFromAny is a stricter variant: returns def when the value is missing
// or unparseable (string non-numeric).
func intFromAny(v any, def int) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case string:
		n, err := strconv.Atoi(x)
		if err == nil {
			return n
		}
	}
	return def
}

// builtinSkillsRoot 解析内置技能目录：先看 DE_BUILTIN_SKILLS_DIR，再按三种常见布局探测。
// builtinSkillsRoot resolves the directory containing the bundled builtin
// skills. Honors DE_BUILTIN_SKILLS_DIR override, otherwise probes the
// three common layouts (cwd-relative + workspace-relative).
func builtinSkillsRoot() string {
	if v := strings.TrimSpace(os.Getenv("DE_BUILTIN_SKILLS_DIR")); v != "" {
		return v
	}
	candidates := []string{
		filepath.Join("backend", "builtin", "skills"),
		filepath.Join("..", "backend", "builtin", "skills"),
		filepath.Join("builtin", "skills"),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return filepath.Join("backend", "builtin", "skills")
}

// BuiltinSkillsRoot 是 builtinSkillsRoot 的 Deps-aware 版本：Deps 注入 BuiltinSkillsRootFn 时优先用之。
// (s *Service).BuiltinSkillsRoot is the Deps-aware variant. Production
// callers (Server.buildCopSvc) inject BuiltinSkillsRootFn on Deps; nil
// means "use the package-private builtinSkillsRoot fallback". This
// keeps the copilot package free of any internal/server/ import.
func (s *Service) BuiltinSkillsRoot() string {
	if s != nil && s.Deps.BuiltinSkillsRootFn != nil {
		return s.Deps.BuiltinSkillsRootFn()
	}
	return builtinSkillsRoot()
}

// decodeStringSlice 把异构 JSON 形状（字符串数组 / any 数组 / RawMessage）归一化为 []string。
// decodeStringSlice normalizes heterogeneous JSON shapes (string array,
// any array, RawMessage) into []string. Non-string entries are coerced
// via str(); empty entries are dropped.
func decodeStringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s := str(x); s != "" {
				out = append(out, s)
			}
		}
		return out
	case json.RawMessage:
		var arr []string
		_ = json.Unmarshal(t, &arr)
		return arr
	default:
		return nil
	}
}

// truncateRunes 把 s 截断到至多 n rune；发生截断时追加省略号。
// truncateRunes truncates s to at most n runes and appends an ellipsis
// when truncation occurred.
func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if n <= 0 || len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

// knowledgeSliceMaps 把异构的 knowledge hits 形状规范化为 []map[string]any。
// knowledgeSliceMaps normalizes knowledge hits into []map[string]any.
func knowledgeSliceMaps(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, x := range t {
			if m, ok := x.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

// runeLen 返回字符串的 rune 计数。
// runeLen returns the rune count of s.
func runeLen(s string) int {
	return utf8.RuneCountInString(s)
}

// trimLower 先 trim 再 lowercase 字符串。
// trimLower trims s then lower-cases it.
func trimLower(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// toFloat 把任意 v 转 float64；不支持的类型返回 0。
// toFloat converts v to float64. Returns 0 for unsupported types.
// Mirrors server.toFloat.
func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return 0
	}
}

// memoryCanRead 检查身份 id 是否能读 item（admin/auditor 全可见；否则仅本人）。
// memoryCanRead mirrors server.memoryCanRead: admin / auditor see all;
// non-admin can read restricted/confidential only if they own the record.
func memoryCanRead(id *auth.Identity, item map[string]any) bool {
	if id == nil || id.Role == "admin" || id.Role == "auditor" {
		return true
	}
	class := str(item["classification"])
	if class == "restricted" || class == "confidential" {
		return str(item["ownerId"]) == id.ID || str(item["createdBy"]) == id.ID
	}
	return true
}

// stringSlice 把异构 JSON 形状归一化为 []string。
// stringSlice normalizes heterogeneous JSON shapes into []string.
// Mirrors server.stringSlice.
func stringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

// ragSnippetsForPrompt 从 RAG hits 抽取 snippet/title 的扁平 []string。
// ragSnippetsForPrompt extracts a flat []string of snippet/title text from
// a RAG hits envelope. Mirrors server.ragSnippetsForPrompt.
func ragSnippetsForPrompt(ragHits any) []string {
	m, ok := ragHits.(map[string]any)
	if !ok {
		return nil
	}
	raw, ok := m["results"].([]map[string]any)
	if !ok {
		arr, ok := m["results"].([]any)
		if !ok {
			return nil
		}
		var out []string
		for _, item := range arr {
			im, _ := item.(map[string]any)
			if im == nil {
				continue
			}
			sn := coalesce(str(im["snippet"]), str(im["title"]))
			if sn != "" {
				out = append(out, sn)
			}
		}
		return out
	}
	var out []string
	for _, im := range raw {
		sn := coalesce(str(im["snippet"]), str(im["title"]))
		if sn != "" {
			out = append(out, sn)
		}
	}
	return out
}

// itoa 是 audit 行格式化用的 strconv.Itoa 轻量替代。
// itoa is a tiny strconv alternative used in audit-row formatting.
func itoa(n int) string { return fmt.Sprintf("%d", n) }

// decodeMap 把 Request body 解析成 map；空 body/畸形 body 返回空 map（不报错）。
// decodeMap decodes the request body into a map. An empty / malformed body
// yields an empty map (not an error) so callers can probe optional fields
// without a separate empty-check.
func decodeMap(r *http.Request) (map[string]any, error) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return map[string]any{}, nil
	}
	return body, nil
}

// identityFrom 从 Request context 里取出 auth.Identity。
// identityFrom pulls the auth.Identity off the request context. Mirrors
// the server.identityFrom helper.
func identityFrom(ctx context.Context) *auth.Identity {
	return auth.IdentityFrom(ctx)
}