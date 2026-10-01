package server

// firstNonEmpty returns the first non-empty string in `vals`. Duplicated
// from internal/operations (where it backs the M01 aggregate). Kept in
// server/ because it's used by pilotdeck_tools.go and other call sites
// that pre-date the operations extraction. If a third copy ever sprouts,
// move this to pkg/strings or similar shared location.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
