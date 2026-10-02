package tasks

import (
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// LegacyStatusTransitions is the pre-lifecycle status-edge table, kept
// for compatibility helpers (legacy "start" / "review" / "complete" /
// "archive" / "reopen" actions on the taskRoute catch-all path).
// Prefer AssertLifecycleTransition / ApplyLifecycleTransition for new
// paths — they operate on the new stage vocabulary.
var LegacyStatusTransitions = map[string][]string{
	"pending":     {"in_progress", "review", "archived"},
	"in_progress": {"review", "completed", "pending"},
	"review":      {"in_progress", "completed", "pending"},
	"completed":   {"archived", "pending"},
	"archived":    {"pending"},
}

// AssertTaskTransition mirrors the legacy assertTaskTransition helper
// from internal/server/task_fsm.go — validates a legacy-status
// transition. Returns apperr.BadReq on illegal edges. Prefer
// AssertLifecycleTransition for the new stage vocabulary.
func AssertTaskTransition(from, to string) error {
	if from == to {
		return nil
	}
	allowed := LegacyStatusTransitions[from]
	for _, a := range allowed {
		if a == to {
			return nil
		}
	}
	return apperr.BadReq(apperr.BadRequest, "非法任务状态流转: "+from+" → "+to)
}
