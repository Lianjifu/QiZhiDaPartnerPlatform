package artifacts

import (
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// --- local helpers (mirrors of internal/server/* helpers — duplicated
// here so the artifacts sub-package stays free of internal/server/
// imports. Same pattern the parent skills package uses). ---

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

func coalesce(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func intFrom(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(t))
		if err != nil {
			return 0
		}
		return n
	default:
		return 0
	}
}

func boolFrom(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		s := strings.ToLower(strings.TrimSpace(t))
		return s == "1" || s == "true" || s == "yes"
	default:
		return false
	}
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// truncateRunes mirrors vetter.TruncateRunes — duplicated here so the
// artifacts sub-package stays free of vetter imports. Used to bound
// subprocess stderr/stdout previews embedded in error messages.
func truncateRunes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	// Naive rune-bound truncation: keep first n runes.
	count := 0
	for i := range s {
		if count == n {
			return s[:i] + "…"
		}
		count++
	}
	return s
}

// looksLikeSkillScriptCommand mirrors skills.harness.looksLikeSkillScriptCommand.
func looksLikeSkillScriptCommand(cmd string) bool {
	re := regexp.MustCompile(`(?i)^(?:(?:python3?|node|bash|sh)\s+)?(?:\./)?((?:scripts|\.copilot-ws)/[A-Za-z0-9._/-]+\.(?:py|sh|js|mjs|ts))(?:\s+.*)?$`)
	return re.MatchString(strings.TrimSpace(cmd))
}

// skillTurnSteps mirrors skills.turn.skillTurnSteps — used to scan plan
// steps for embedded script commands.
func skillTurnSteps(plan map[string]any) []map[string]any {
	if plan == nil {
		return nil
	}
	steps, _ := plan["steps"].([]any)
	out := make([]map[string]any, 0, len(steps))
	for _, s := range steps {
		if m, ok := s.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

// previewSandboxHeaders returns the headers that every artifact
// endpoint should set (mirrors server.previewSandboxHeaders).
func previewSandboxHeaders(extraCSP ...string) http.Header {
	h := http.Header{}
	h.Set("X-Frame-Options", "SAMEORIGIN")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	csp := "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'"
	for _, extra := range extraCSP {
		csp = strings.TrimSpace(extra)
		if csp == "" {
			continue
		}
		h.Set("Content-Security-Policy", csp)
		return h
	}
	h.Set("Content-Security-Policy", csp)
	return h
}

// writePreviewSandboxHeaders writes the standard sandbox headers.
func writePreviewSandboxHeaders(w http.ResponseWriter) {
	for k, vs := range previewSandboxHeaders() {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
}

// wantInline reports ?inline=1 (render in-place rather than download).
func wantInline(r *http.Request) bool {
	if r == nil {
		return false
	}
	v := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("inline")))
	return v == "1" || v == "true" || v == "yes"
}

// inlineContentDisposition mirrors server.inlineContentDisposition.
func inlineContentDisposition(name string) string {
	display := name
	if strings.HasSuffix(strings.ToLower(name), ".pptx") || strings.HasSuffix(strings.ToLower(name), ".pdf") {
		if i := strings.Index(name, "-"); i > 0 && i < len(name)-1 {
			display = name[i+1:]
		}
	}
	return "inline; filename=\"" + asciiFallbackFilename(display) + "\"; filename*=UTF-8''" + name
}

