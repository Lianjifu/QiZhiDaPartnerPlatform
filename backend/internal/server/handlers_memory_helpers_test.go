package server_test

// Test-only helpers shared by *_test.go files in the server_test
// package. These used to live next to handlers_memory_test.go (deleted
// in M07 P2 when memory handlers moved to internal/memory/) but
// handlers_channels_* + handlers_skills_* + kernel_phase* tests still
// depend on them, so the helpers are re-homed here as a tiny
// package-private utility module. Keep this file _test.go-scoped so
// production binaries never pull these symbols in.

// strAny returns the underlying string of v, or "" if v isn't one.
// Mirrors the legacy (deleted) handlers_memory_test.go#strAny shim.
func strAny(v any) string {
	s, _ := v.(string)
	return s
}

// asFloat coerces a JSON-decoded numeric (float64 / int / int64 /
// float32) to float64; returns 0 for any other type so tests can
// compare totals / counts without panicking on missing keys. Note
// this differs from production handlers_e.go#asFloat which returns
// (float64, bool) — the test helper is the loose form used by the
// deleted handlers_memory_test.go so handlers_channels_test.go and
// the kernel_phase* tests keep compiling.
func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case float32:
		return float64(t)
	}
	return 0
}