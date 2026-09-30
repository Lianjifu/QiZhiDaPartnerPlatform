package server

import (
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// Legacy status-edge table retained for compatibility helpers.
// Prefer assertLifecycleTransition / applyLifecycleTransition for new paths.
var taskTransitions = map[string][]string{
	"pending":     {"in_progress", "review", "archived"},
	"in_progress": {"review", "completed", "pending"},
	"review":      {"in_progress", "completed", "pending"},
	"completed":   {"archived", "pending"},
	"archived":    {"pending"},
}

func assertTaskTransition(from, to string) error {
	if from == to {
		return nil
	}
	allowed := taskTransitions[from]
	for _, a := range allowed {
		if a == to {
			return nil
		}
	}
	return apperr.BadReq(apperr.BadRequest, "非法任务状态流转: "+from+" → "+to)
}
