// Package skills is the M09 技能中心 (Skills Center) module — the HTTP-route
// façade that owns the 20 + skill REST endpoints (/api/skills/*, the
// catch-all per-resource sub-action /api/skills/{id}/*, the
// /api/skill-artifacts/* media paths, the /api/skill-integrations/*
// connector test / discover endpoints, the MCP/Tool connectors
// (/api/mcp-connections, /api/tools), and the cross-module bind entry
// /api/agents/{id}/skills).
//
// Phase 2 of the M09 技能中心整合方案
// (docs/整合方案/技能中心模块整合方案.md §3.2 + §四 D1-D13 + §五 G1-G13)
// extracts the M09 code out of internal/server/ with the same
// function-value façade pattern that M02 copilot, M03 tasks, M05
// partners, M06 workflows, M07 knowledge, and M08 models use:
//
//   - Service struct holds Store + AuditSink + Signer + Sandboxes + Signer.
//   - Deps holds the cross-package server-only helpers the M09 handlers
//     need (workspace resolution, identity, audit sink, store ops,
//     cap-runtime delegate, zero-trust + write-policy evaluators,
//     knowledgeSliceMaps-style coercion helpers, peer-fetch, skill
//     trend / health projection).
//   - NewService(store, deps) constructs the façade.
//   - Route dispatch goes through `s.skillsSvc.<Method>(r)` in server.go.
//
// The Signer interface (signingiface.go) abstracts the
// services/qzda-sandbox/signing micro-service (independent code that
// lives outside internal/); the boot path in server.go continues to
// construct the concrete signing.SignerResolver and pass it via
// Deps.Signer.
//
// The package boundary stays one-way: internal/skills/ never imports
// internal/server/ (it MAY import internal/copilot, internal/auth,
// internal/policy, internal/store, internal/skills/{registry,manifest,
// policy,vetter}, services/qzda-sandbox/signing, pkg/errors).
package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
)

// --- local helpers (mirrors of internal/server/* helpers used across
// the M09 handlers — duplicated instead of imported so the skills
// package stays free of internal/server/ imports). Same pattern that
// internal/copilot/helpers.go uses. ---

// str is a defensive string conversion. nil-safe, falls back to
// fmt.Sprint for non-string values. Mirrors server.str.
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

// coalesce returns v if non-empty (after TrimSpace), else def.
func coalesce(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

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

// floatFrom converts v to float64. Returns 0 for unsupported types.
// (Mirrors server.floatFrom — kept in handlers.go alongside the skill
// trend math; do not duplicate here.)

// boolFrom converts v to bool. String "true"/"1" → true.
// (Mirrors server.boolFrom — kept in handlers.go.)

// ternary returns a if cond else b. Tiny helper used by the M09 audit
// rows + governance copy.
// (Mirrors server.ternary — kept in handlers.go.)

// cloneMap returns a shallow copy of m.
// (Mirrors server.cloneMap — kept in handlers.go.)

// decodeMap decodes the request body into a map. An empty / malformed
// body yields an empty map (not an error). Mirrors server.decodeMap.
func decodeMap(r *http.Request) (map[string]any, error) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return map[string]any{}, nil
	}
	return body, nil
}

// identityFrom pulls the auth.Identity off the request context.
func identityFrom(ctx context.Context) *auth.Identity {
	return auth.IdentityFrom(ctx)
}

// knowledgeSliceMaps coerces a `any` (which may round-trip as
// []map[string]any or []any) into a uniform []map[string]any slice.
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

// round2 rounds v to 2 decimal places. Used by skill governance
// successRate/errorRate math.
// (Mirrors server.round2 — kept in handlers.go.)

// itoa is a tiny strconv alternative used in audit-row formatting.
func itoa(n int) string { return strconv.Itoa(n) }

// decodeStringSlice normalizes heterogeneous JSON shapes into []string.
// (Mirrors server.decodeStringSlice — kept in handlers_package.go.)

// envFlagTrue reports whether the named env var is set to "1" or "true".
func envFlagTrue(key string) bool {
	v := strings.TrimSpace(os.Getenv(key))
	return v == "1" || strings.EqualFold(v, "true")
}

// envOr returns os.Getenv(key) or def when unset.
func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// productionLikeEnv reports whether the runtime env is staging/production
// (used by the sandbox-test sim gate). Mirrors server.productionLikeEnv.
func productionLikeEnv() bool {
	return lookupEnv("DE_ENV") == "production" || lookupEnv("DE_ENV") == "staging"
}

// timeNow is a tiny seam so tests can stub clock.
// (Mirrors server.timeNow — kept in handlers_package.go.)

// lookupEnv reads os.Getenv and returns "" when unset.
func lookupEnv(key string) string {
	return os.Getenv(key)
}

// actorIsAdmin mirrors server.actorIsAdmin.
func actorIsAdmin(id *auth.Identity) bool {
	return id != nil && id.Role == "admin"
}

// requireSkillRead is the M09 RBAC gate used by every read handler.
// (Kept in handlers.go for locality with the audit-row helpers.)

// requireSkillWrite is the M09 RBAC gate used by every write handler.
// (Kept in handlers.go for locality with the audit-row helpers.)

// asciiFallbackFilename strips non-ASCII chars for legacy browsers
// (Content-Disposition filename= attribute).
func asciiFallbackFilename(name string) string {
	var b strings.Builder
	for _, r := range name {
		if r < 0x80 {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	return b.String()
}

// truncateRunes truncates s to at most n runes, appending an ellipsis
// when truncated. Mirrors vetter.truncateRunes / internal/server.truncateRunes.
func truncateRunes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	count := 0
	for i := range s {
		if count == n {
			return s[:i] + "…"
		}
		count++
	}
	return s
}

// isRuntimeTool reports whether a registeredTool entry is a runtime
// (sandbox-callable) tool — used by the pilotdeck registry fallback.
// Mirrors internal/server.isRuntimeTool.
func isRuntimeTool(t *copilot.RegisteredTool) bool {
	if t == nil {
		return false
	}
	return t.Kind == "skill" || t.Kind == "tool" || t.Kind == "runtime"
}

// asMapSlice normalizes a generic slice into []map[string]any.
func asMapSlice(v any) []map[string]any {
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
