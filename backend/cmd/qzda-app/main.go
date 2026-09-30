package main

import (
	"log"
	"os"

	"github.com/qizhida-partner-platform/backend/internal/apprun"
	"github.com/qizhida-partner-platform/backend/internal/server"
)

// Service: qzda-app
// Architecture: monolith — sys + collab + cap in one Go process (方案 A)
// Port: 8100
// Owns: platform, sessions/copilot, models/knowledge/memory/skills/channels
// Sidecars: qzda-skill-runtime (8093) for sandbox execution; qzda-workflow optional
// Forbidden: in-process skill script execution (→ qzda-skill-runtime)
func main() {
	addr := env("DE_APP_ADDR", env("DE_LISTEN_ADDR", ":8100"))
	if err := apprun.Run(apprun.Options{Addr: addr, Mode: server.ModeApp}); err != nil {
		log.Fatal(err)
	}
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
