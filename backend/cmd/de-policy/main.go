package main

import (
	"log"
	"os"

	"github.com/qizhida-partner-platform/backend/internal/apprun"
	"github.com/qizhida-partner-platform/backend/internal/server"
)

// Service: de-policy
// Architecture: Hexagonal — policy / zero-trust / release-approvals
// Port: 8104
// Owns: /v1/evaluate, /api/access, /api/zero-trust, /api/governance, /api/release-approvals
// Default 4-process compose still serves these from de-sys; set DE_CROSSCUTTING_SPLIT=1 on sys to split.
func main() {
	addr := env("DE_POLICY_ADDR", env("DE_LISTEN_ADDR", ":8104"))
	if err := apprun.Run(apprun.Options{Addr: addr, Mode: server.ModePolicy}); err != nil {
		log.Fatal(err)
	}
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
