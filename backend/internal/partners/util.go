package partners

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// Package-private helpers shared by the M05 handler implementations.
//
// These mirror the package-level helpers in `internal/tasks/` and the
// legacy `internal/server/` — duplicated here so internal/partners/
// stays free of any internal/server/ import. Keep them small and
// side-effect free; cross-package dependencies (workspace / identity /
// policy / persistence) live on Service.Deps.

// str returns the value as a string, formatting non-strings with
// fmt.Sprint-style coercion. nil → "". Used by every read of a
// map[string]any payload.
func str(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return t.String()
	default:
		// Avoid importing fmt in the hot path; strconv.Format* covers
		// the numeric / bool cases we actually receive.
		switch x := v.(type) {
		case int:
			return strconv.Itoa(x)
		case int32:
			return strconv.FormatInt(int64(x), 10)
		case int64:
			return strconv.FormatInt(x, 10)
		case float32:
			return strconv.FormatFloat(float64(x), 'f', -1, 32)
		case float64:
			return strconv.FormatFloat(x, 'f', -1, 64)
		case bool:
			return strconv.FormatBool(x)
		}
		return ""
	}
}

// coalesce returns the first non-empty value. Mirrors the legacy
// server.coalesce — preserved so the move is byte-faithful.
func coalesce(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// intFrom converts arbitrary JSON-shape values to int. Default 0 on any
// unrecognized shape. Mirrors the legacy server.intFrom used by
// adoptTemplate + applyEmployeeConfig.
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

// boolFrom coerces JSON-shape values to bool. Truthy strings ("true",
// "1") and any non-zero numeric return true; nil / false-equivalents
// return false. Used by employeeAction mutation paths.
func boolFrom(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		s := strings.TrimSpace(t)
		return s == "true" || s == "1" || strings.EqualFold(s, "yes")
	case float64:
		return t != 0
	case int:
		return t != 0
	case int64:
		return t != 0
	default:
		return false
	}
}

// itoa renders an int as a decimal string. Mirrors server.itoa used by
// digitalEmployeeRoute when generating version labels.
func itoa(n int) string { return strconv.Itoa(n) }

// decodeMap parses a JSON body into a map[string]any. Returns an empty
// map on any error so callers can blindly read fields without nil
// checks. Mirrors server.decodeMap.
func decodeMap(r *http.Request) (map[string]any, error) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return map[string]any{}, nil
	}
	return body, nil
}

// asFloat extracts a float64 from arbitrary JSON values. Used by
// employeeOverviewAligned when summing runtime counters.
func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case int32:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

// cloneMap returns a shallow copy of the employee map. Used by
// digitalEmployeeRoute / listEmployees / employeeWithRuntimeLocked
// to avoid leaking the in-store reference out of a lock.
func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// stringSlice converts an any (typically a JSON []any or []string) to
// []string. Used by mergeImmutableCapabilityTools + capability catalog
// builder.
func stringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		out := make([]string, len(t))
		copy(out, t)
		return out
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s := str(x); s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

// firstNonEmpty returns the first non-empty string after trimming.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
