package main

import (
	"log"
	"os"

	"github.com/qizhida-partner-platform/backend/internal/apprun"
	"github.com/qizhida-partner-platform/backend/internal/server"
)

// Service: de-cap
// Architecture: Hexagonal — modules model/knowledge/memory/skill/channel
// Layer: L04–L07·L09
// Port: 8102
// Owns: model providers/routes, knowledge packages, memory, skills catalog, channels
// Forbidden: sandbox execution (→ de-skill-runtime)
func main() {
	addr := env("DE_CAP_ADDR", env("DE_LISTEN_ADDR", ":8102"))
	if err := apprun.Run(apprun.Options{Addr: addr, Mode: server.ModeCap}); err != nil {
		log.Fatal(err)
	}
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
