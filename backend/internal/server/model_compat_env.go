package server

import "os"

// capBaseURLFromEnv returns the Cap sidecar base URL, reading
// QZDA_CAP_URL (falling back to http://127.0.0.1:8102). Split out from
// capBaseURL() so the wiring code can call it without indirection and so
// tests can stub it cleanly. Matches the pre-M08 P2 behaviour consumed by
// streamLLMViaCap in the M08 models package.
func capBaseURLFromEnv() string {
	if v := os.Getenv("QZDA_CAP_URL"); v != "" {
		return v
	}
	return "http://127.0.0.1:8102"
}
