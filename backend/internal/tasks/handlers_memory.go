package tasks

import (
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
)

// writeTaskWorkingMemoryLocked writes a working-memory entry capturing
// the task's stage transition so the human owner can pick up the
// context on review. Caller MUST hold s.Store.Lock() — the
// Deps.IngestRuntimeMemoryLocked adapter closes on
// server.ingestRuntimeMemoryLocked which assumes the same lock
// contract. PersistMemory fires in a goroutine after the helper
// returns (matches the legacy ordering in handlers_contract.go).
//
// Mirrors the legacy handlers_contract.go writeTaskWorkingMemoryLocked
// implementation byte-for-byte.
func (s *Service) writeTaskWorkingMemoryLocked(task map[string]any, id *auth.Identity, status string) {
	title := coalesce(str(task["code"]), str(task["id"])) + " · " + coalesce(str(task["title"]), "任务")
	content := "任务状态更新为 " + status + "；保留执行上下文以便人工接手与复盘。"
	if note := strings.TrimSpace(str(task["summary"])); note != "" {
		content = note + "\n" + content
	}
	if s.Deps.IngestRuntimeMemoryLocked != nil {
		_, _ = s.Deps.IngestRuntimeMemoryLocked(RuntimeMemoryInput{
			WorkspaceID:      str(task["workspaceId"]),
			OwnerID:          coalesce(str(task["ownerId"]), id.ID),
			OwnerName:        id.Name,
			DigitalPartnerID: str(task["digitalPartnerId"]),
			Title:            title,
			Content:          content,
			SourceType:       "task",
			SourceID:         str(task["id"]),
			CorrelationID:    "corr_task_" + str(task["id"]),
			Layer:            "working",
			Scope:            "team",
			Confidence:       0.9,
		})
	}
	if s.Deps.PersistMemory != nil {
		go s.Deps.PersistMemory()
	}
}