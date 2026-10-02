package tasks

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// str returns the string form of `v` if it is a string, otherwise "".
// Mirrors the legacy str() helper from internal/server/server.go.
// Local copy kept here so the tasks package is self-contained for the
// pure-domain helpers + unit tests (no internal/server/ import).
func str(v any) string {
	s, _ := v.(string)
	return s
}

// ToInt coerces a value to int. Accepts int / int64 / float64 (Go's
// default JSON number decoding produces float64) / json.Number.
// Mirrors the legacy toInt() helper.
func ToInt(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	case float32:
		return int(t)
	case string:
		n, _ := strconv.Atoi(t)
		return n
	}
	return 0
}

// boolFrom reports whether `v` represents a truthy value. Accepts
// bool / string ("true"/"1"/"yes") / numeric (non-zero).
func boolFrom(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "true", "1", "yes":
			return true
		}
	case float64:
		return t != 0
	case int:
		return t != 0
	case int64:
		return t != 0
	}
	return false
}

// coalesce returns `v` if non-empty, otherwise `def`. Mirrors the
// legacy coalesce() helper.
func coalesce(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// nilIfEmpty returns nil when s is the empty string, otherwise s as
// `any`. Used to drop empty-string optional fields from task rows so
// the JSON shape stays clean (omitempty semantics).
func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// MapStatusToStage is the inverse of StatusForLifecycle: legacy status
// strings ("pending" / "in_progress" / "review" / "completed" /
// "archived") are mapped back to the new stage vocabulary. Unknown
// inputs default to StagePending.
func MapStatusToStage(status string) string {
	switch strings.TrimSpace(status) {
	case "pending":
		return StagePending
	case "in_progress", "running":
		return StageRunning
	case "review", "human_action":
		return StageHumanAction
	case "risk":
		return StageRisk
	case "completed":
		return StageCompleted
	case "archived":
		return StageArchived
	default:
		return StagePending
	}
}

// EnsureTaskShape fills in missing nested maps / audit / version /
// progress / governance defaults so downstream code can treat the task
// as a fully-formed ControlledTask. Mirrors the legacy ensureTaskShape
// from internal/server/task_domain.go.
func EnsureTaskShape(task map[string]any) {
	if task == nil {
		return
	}
	if _, ok := task["links"].(map[string]any); !ok {
		task["links"] = map[string]any{}
	}
	if _, ok := task["auditEvents"].([]map[string]any); !ok {
		if raw, ok := task["auditEvents"].([]any); ok {
			evs := make([]map[string]any, 0, len(raw))
			for _, item := range raw {
				if m, ok := item.(map[string]any); ok {
					evs = append(evs, m)
				}
			}
			task["auditEvents"] = evs
		} else {
			task["auditEvents"] = []map[string]any{}
		}
	}
	if task["version"] == nil {
		task["version"] = 0
	}
	if _, ok := task["sla"].(map[string]any); !ok {
		task["sla"] = map[string]any{"remainingMin": 120, "risk": "none", "escalated": false}
	}
	if _, ok := task["execution"].(map[string]any); !ok {
		task["execution"] = map[string]any{"retryCount": 0, "paused": false}
	}
	if _, ok := task["governance"].(map[string]any); !ok {
		task["governance"] = map[string]any{"approvalRequired": false, "approvalStatus": "not_required"}
	}
	if _, ok := task["progress"].(map[string]any); !ok {
		task["progress"] = map[string]any{"done": 0, "total": 1}
	}
	if str(task["lifecycleStage"]) == "" {
		task["lifecycleStage"] = MapStatusToStage(str(task["status"]))
	}
	if str(task["status"]) == "" {
		task["status"] = StatusForLifecycle(str(task["lifecycleStage"]))
	}
}

// CheckTaskVersion returns an apperr.Conflict iff the body's version
// field is set and disagrees with the stored task's version. Returns
// nil when the body has no version (unconditional update path).
// Mirrors the legacy checkTaskVersion from internal/server/task_domain.go.
func CheckTaskVersion(task map[string]any, body map[string]any) error {
	if body == nil || body["version"] == nil {
		return nil
	}
	want := ToInt(body["version"])
	have := ToInt(task["version"])
	if want != have {
		return apperr.Conflict(apperr.TaskVersion, fmt.Sprintf("任务版本冲突：期望 %d，当前 %d", want, have))
	}
	return nil
}

// TaskVisibleToUser reports whether `id` may see `task` in list
// responses. Admin / auditor always see everything; regular users see
// tasks they own, created, are assigned to, or are listed as a
// collaborator on (by id or name). Mirrors the legacy taskVisibleToUser.
func TaskVisibleToUser(task map[string]any, id *auth.Identity) bool {
	if id == nil {
		return false
	}
	if id.Role == "admin" || id.Role == "auditor" {
		return true
	}
	if str(task["ownerId"]) == id.ID || str(task["createdBy"]) == id.ID {
		return true
	}
	if str(task["assignee"]) == id.ID || str(task["assignee"]) == id.Name {
		return true
	}
	if cols, ok := task["collaboratorIds"].([]any); ok {
		for _, c := range cols {
			if str(c) == id.ID {
				return true
			}
		}
	}
	if names, ok := task["collaboratorNames"].([]any); ok {
		for _, n := range names {
			if str(n) == id.Name {
				return true
			}
		}
	}
	return false
}

// NextTaskCode returns the next sequential "TSK-YYYYMMDD-NNN" code for
// the workspace, scanning existing tasks for the highest counter today.
// Mirrors the legacy nextTaskCode from internal/server/task_domain.go.
func NextTaskCode(existing []map[string]any) string {
	day := time.Now().UTC().Format("20060102")
	prefix := "TSK-" + day + "-"
	maxN := 0
	for _, t := range existing {
		code := str(t["code"])
		if !strings.HasPrefix(code, prefix) {
			continue
		}
		n, _ := strconv.Atoi(strings.TrimPrefix(code, prefix))
		if n > maxN {
			maxN = n
		}
	}
	return fmt.Sprintf("%s%03d", prefix, maxN+1)
}

// FilterTasksQuery applies the GET /api/tasks query-string filters to
// a workspace-scoped task slice and returns the survivors in original
// order. Supported keys: stage, risk, assignee, q/search, approval,
// source, priority, agent, archived, blocked. Mirrors the legacy
// filterTasksQuery from internal/server/task_domain.go.
func FilterTasksQuery(tasks []map[string]any, q map[string]string) []map[string]any {
	stage := q["stage"]
	risk := q["risk"]
	assignee := q["assignee"]
	search := strings.ToLower(strings.TrimSpace(q["q"]))
	approval := q["approval"]
	source := q["source"]
	priority := q["priority"]
	agent := q["agent"]
	archived := q["archived"]
	blocked := q["blocked"]
	out := make([]map[string]any, 0, len(tasks))
	for _, t := range tasks {
		EnsureTaskShape(t)
		ls := str(t["lifecycleStage"])
		if archived != "1" && archived != "true" {
			if ls == StageArchived {
				continue
			}
		} else if archived == "only" && ls != StageArchived {
			continue
		}
		if stage != "" && stage != "all" && ls != stage {
			continue
		}
		if assignee != "" && assignee != "all" && str(t["assignee"]) != assignee {
			continue
		}
		if source != "" && source != "all" && str(t["source"]) != source {
			continue
		}
		if priority != "" && priority != "all" && str(t["priority"]) != priority {
			continue
		}
		if agent != "" && agent != "all" {
			if str(t["digitalPartnerId"]) != agent && str(t["digitalPartnerName"]) != agent {
				continue
			}
		}
		sla, _ := t["sla"].(map[string]any)
		taskRisk := "none"
		if sla != nil {
			taskRisk = coalesce(str(sla["risk"]), "none")
		}
		if risk == "attention" {
			hit := ls == StageRisk || taskRisk != "none"
			gov, _ := t["governance"].(map[string]any)
			approvalHit := gov != nil && str(gov["approvalStatus"]) == "pending"
			if !hit && !approvalHit && ls != StageHumanAction {
				continue
			}
		} else if risk != "" && risk != "all" && taskRisk != risk {
			continue
		}
		if approval != "" && approval != "all" {
			gov, _ := t["governance"].(map[string]any)
			st := "not_required"
			if gov != nil {
				st = coalesce(str(gov["approvalStatus"]), "not_required")
			}
			if st != approval {
				continue
			}
		}
		if blocked == "1" || blocked == "true" {
			links, _ := t["links"].(map[string]any)
			blockedBy := ""
			if links != nil {
				blockedBy = str(links["blockedBy"])
			}
			if blockedBy == "" && taskRisk != "blocked" {
				continue
			}
		}
		if search != "" {
			blob := strings.ToLower(str(t["title"]) + " " + str(t["code"]) + " " + str(t["assignee"]) + " " + str(t["digitalPartnerName"]) + " " + str(t["source"]))
			if !strings.Contains(blob, search) {
				continue
			}
		}
		out = append(out, t)
	}
	return out
}

// PaginateTasks slices `tasks` by offset/limit and returns the page
// plus the total count. limit defaults to 100, max 200; negative
// offset clamps to 0; offset >= total returns an empty slice with the
// total. Mirrors the legacy paginateTasks from internal/server/task_domain.go.
func PaginateTasks(tasks []map[string]any, limit, offset int) (items []map[string]any, total int) {
	total = len(tasks)
	if limit <= 0 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		return []map[string]any{}, total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return tasks[offset:end], total
}
