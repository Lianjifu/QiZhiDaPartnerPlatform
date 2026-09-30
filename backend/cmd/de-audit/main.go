package main

import (
	"log"
	"os"

	"github.com/qizhida-partner-platform/backend/internal/apprun"
	"github.com/qizhida-partner-platform/backend/internal/server"
)

// Service: de-audit
// Architecture: Hexagonal — audit-center / evidence export
// Port: 8105
// Owns: /api/audit-center, /api/audit, /v1/events
// Default 4-process compose still serves these from de-sys; set DE_CROSSCUTTING_SPLIT=1 on sys to split.
func main() {
	addr := env("DE_AUDIT_ADDR", env("DE_LISTEN_ADDR", ":8105"))
	if err := apprun.Run(apprun.Options{Addr: addr, Mode: server.ModeAudit}); err != nil {
		log.Fatal(err)
	}
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
