package main

import (
	"log"
	"os"

	"github.com/qizhida-partner-platform/backend/internal/apprun"
	"github.com/qizhida-partner-platform/backend/internal/server"
)

// Service: de-collab
// Architecture: Hexagonal — modules collab/employee
// Layer: L02
// Port: 8101
// Owns: sessions, conversations, copilot SSE, tasks, digital-employees
func main() {
	addr := env("DE_COLLAB_ADDR", env("DE_LISTEN_ADDR", ":8101"))
	if err := apprun.Run(apprun.Options{Addr: addr, Mode: server.ModeCollab}); err != nil {
		log.Fatal(err)
	}
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
