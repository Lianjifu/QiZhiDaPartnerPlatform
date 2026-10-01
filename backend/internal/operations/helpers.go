package operations

import (
	"fmt"
	"time"
)

// hourSlot maps a timestamp into a 0..buckets-1 bucket index relative
// to `now`, where slot 0 is the oldest bucket and slot buckets-1 is
// the most recent hour. Returns -1 when the timestamp is empty, the
// buckets argument is non-positive, or the timestamp is older than
// `buckets` hours (out of range).
//
// Used to build the 12-point `operationalMetrics.trend24h` series in
// HomeExtraLive — same bucketing rule as the legacy in-server helper,
// behavior preserved byte-for-byte.
func hourSlot(raw string, now time.Time, buckets int) int {
	if raw == "" || buckets <= 0 {
		return -1
	}
	t, ok := parseFlexibleTime(raw)
	if !ok {
		return -1
	}
	delta := now.Sub(t)
	if delta < 0 || delta > time.Duration(buckets)*time.Hour {
		return -1
	}
	slot := buckets - 1 - int(delta/time.Hour)
	if slot < 0 {
		slot = 0
	}
	if slot >= buckets {
		slot = buckets - 1
	}
	return slot
}

// isSameLocalDay reports whether `raw` falls on the same calendar day
// as `now` in `now`'s location. Used to count "today" sessions /
// conversations for the homeExtraLive.collabToday aggregate.
func isSameLocalDay(raw string, now time.Time) bool {
	t, ok := parseFlexibleTime(raw)
	if !ok {
		return false
	}
	y1, m1, d1 := t.In(now.Location()).Date()
	y2, m2, d2 := now.Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}

// parseFlexibleTime accepts the timestamp flavors emitted by the store
// seeds and runtime callers:
//   - RFC3339 / RFC3339Nano (full timestamp with TZ)
//   - "2006-01-02T15:04:05Z" (legacy Mongo-style)
//   - "2006-01-02 15:04:05" (store seed)
//   - "15:04" / "15:04:05" (today-anchored time-of-day)
//
// Bare HH:MM[:SS] values are anchored to today's date so a 12:30 entry
// at 09:00 still falls into a same-day bucket. Returns ok=false on
// any unrecognized layout.
func parseFlexibleTime(raw string) (time.Time, bool) {
	layouts := []string{
		time.RFC3339, time.RFC3339Nano,
		"2006-01-02T15:04:05Z", "2006-01-02 15:04:05",
		"15:04", "15:04:05",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, raw); err == nil {
			if layout == "15:04" || layout == "15:04:05" {
				now := time.Now()
				t = time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), t.Second(), 0, now.Location())
			}
			return t, true
		}
	}
	return time.Time{}, false
}

// firstNonEmpty returns the first non-empty string in `vals`. Used to
// pick a human-readable assignee / title with a deterministic fallback
// chain (e.g. title → code → "" for task alerts).
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// round1 rounds `v` to one decimal place using half-up rounding. Used
// for the `taskSuccessRate` KPI display (e.g. 87.5%).
func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

// toInt coerces an `any` (commonly map[string]any values) into an int.
// Floats truncate toward zero — matches the legacy server/toInt helper
// so existing seed data continues to project the same counts.
func toInt(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	default:
		return 0
	}
}

// toFloat coerces an `any` into a float64. Same coercion rules as
// toInt but used for the billing USD math where float precision matters.
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

// str is the same `any → string` coercion used by server/handlers_e.go
// (handles nil, string, and fmt.Sprint fallback). Duplicated here so
// the operations package stays free of server/ imports.
func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// knowledgeSliceMaps normalizes KnowledgeExtra["packages"] — which can
// be either []map[string]any (in-memory) or []any (after JSON round-
// trip from disk persistence) — into a flat []map[string]any. Returns
// nil for unrecognized shapes. Mirrors server/handlers_knowledge.go's
// helper so the aggregate doesn't need to fork that logic.
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
