package workflows

// Tiny utility helpers used by the M06 handlers. They mirror the same
// helpers that exist in internal/server/ but we cannot import server.go
// (the package boundary is one-way). Mirroring keeps the M06 code path
// self-contained.

import "strconv"

func str(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case []byte:
		return string(t)
	default:
		return ""
	}
}

func coalesce(v, def string) string {
	if s := str(v); s != "" {
		return s
	}
	return def
}

func intFrom(v any) int {
	switch t := v.(type) {
	case nil:
		return 0
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
		if i, err := strconv.Atoi(t); err == nil {
			return i
		}
	}
	return 0
}

func boolFrom(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t == "true" || t == "1" || t == "yes"
	}
	return false
}

// strOr returns the string value of v when non-empty, otherwise fallback.
// Mirrors builtin_workflows.strOr.
func strOr(v any, fallback string) string {
	if s, ok := v.(string); ok && str(v) != "" {
		return s
	}
	return fallback
}

func cloneMap(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}