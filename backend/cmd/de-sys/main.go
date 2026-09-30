package main

import (
	"log"
	"os"

	"github.com/qizhida-partner-platform/backend/internal/apprun"
	"github.com/qizhida-partner-platform/backend/internal/server"
)

// Service: de-sys
// Architecture: Hexagonal (Ports & Adapters) — modules platform/policy/audit/ops
// Layer: L10·L11·L12·L13
// Port: 8100
// Owns: workspaces, auth, ops/home, billing, backups；默认仍吸收 policy evaluate 与 audit-center
// Forbidden: skill execution; model/knowledge authoritative writes (→ de-cap)
// Split: DE_CROSSCUTTING_SPLIT=1 时 policy/audit 改由 de-policy :8104 / de-audit :8105
func main() {
	addr := env("DE_SYS_ADDR", env("DE_LISTEN_ADDR", ":8100"))
	if err := apprun.Run(apprun.Options{Addr: addr, Mode: server.ModeSys}); err != nil {
		log.Fatal(err)
	}
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
