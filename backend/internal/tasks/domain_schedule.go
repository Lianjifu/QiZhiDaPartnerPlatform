package tasks

import (
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func loadScheduleLocation(name string) *time.Location {
	if name == "" {
		name = "Asia/Shanghai"
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}

// NextScheduleRun computes the next fire time in UTC.
func NextScheduleRun(item map[string]any, from time.Time) time.Time {
	if item == nil {
		return time.Time{}
	}
	loc := loadScheduleLocation(str(item["timezone"]))
	local := from.In(loc)
	hour := ToInt(item["hour"])
	minute := ToInt(item["minute"])
	if hour < 0 || hour > 23 {
		hour = 9
	}
	if minute < 0 || minute > 59 {
		minute = 0
	}
	switch str(item["cadence"]) {
	case "hourly":
		next := local.Truncate(time.Hour).Add(time.Hour)
		return next.UTC()
	case "weekly":
		want := time.Weekday(ToInt(item["weekday"]))
		if want < time.Sunday || want > time.Saturday {
			want = time.Monday
		}
		candidate := time.Date(local.Year(), local.Month(), local.Day(), hour, minute, 0, 0, loc)
		for i := 0; i < 8; i++ {
			if candidate.Weekday() == want && candidate.After(from) {
				return candidate.UTC()
			}
			candidate = candidate.Add(24 * time.Hour)
		}
		return time.Time{}
	case "once":
		at, err := time.Parse(time.RFC3339, str(item["runAt"]))
		if err != nil || !at.After(from) {
			return time.Time{}
		}
		return at.UTC()
	default:
		candidate := time.Date(local.Year(), local.Month(), local.Day(), hour, minute, 0, 0, loc)
		if !candidate.After(from) {
			candidate = candidate.Add(24 * time.Hour)
		}
		return candidate.UTC()
	}
}

func BuildScheduledTask(idGen func(string) string, ws string, body map[string]any, actor *auth.Identity) (map[string]any, error) {
	title := strings.TrimSpace(str(body["title"]))
	if title == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "定时任务标题必填")
	}
	cadence := coalesce(str(body["cadence"]), "daily")
	switch cadence {
	case "once", "hourly", "daily", "weekly":
	default:
		return nil, apperr.BadReq(apperr.BadRequest, "调度周期不支持")
	}
	now := time.Now().UTC()
	item := map[string]any{
		"id":                 idGen("sch"),
		"workspaceId":        ws,
		"code":               "",
		"title":              title,
		"description":        str(body["description"]),
		"cadence":            cadence,
		"hour":               ToInt(body["hour"]),
		"minute":             ToInt(body["minute"]),
		"weekday":            ToInt(body["weekday"]),
		"runAt":              str(body["runAt"]),
		"timezone":           coalesce(str(body["timezone"]), "Asia/Shanghai"),
		"enabled":            true,
		"status":             "active",
		"digitalPartnerId":   body["digitalPartnerId"],
		"digitalPartnerName": body["digitalPartnerName"],
		"workflowId":         body["workflowId"],
		"workflowName":       body["workflowName"],
		"owner":              coalesce(str(body["owner"]), actor.Name),
		"createdBy":          actor.ID,
		"runCount":           0,
		"failCount":          0,
		"createdAt":          now.Format(time.RFC3339),
		"updatedAt":          now.Format(time.RFC3339),
	}
	if body["hour"] == nil {
		item["hour"] = 9
	}
	if enabled, ok := body["enabled"].(bool); ok {
		item["enabled"] = enabled
		if !enabled {
			item["status"] = "paused"
		}
	}
	next := NextScheduleRun(item, now)
	if !next.IsZero() {
		item["nextRunAt"] = next.Format(time.RFC3339)
	} else if cadence == "once" {
		item["status"] = "expired"
		item["enabled"] = false
	}
	return item, nil
}

func NextScheduleCode(existing []map[string]any) string {
	max := 1000
	for _, item := range existing {
		code := str(item["code"])
		if !strings.HasPrefix(code, "SCH-") {
			continue
		}
		n := ToInt(strings.TrimPrefix(code, "SCH-"))
		if n > max {
			max = n
		}
	}
	return "SCH-" + itoa(max+1)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func PatchScheduledTask(item, body map[string]any) {
	for _, key := range []string{"title", "description", "cadence", "runAt", "timezone", "digitalPartnerId", "digitalPartnerName", "workflowId", "workflowName", "owner"} {
		if body[key] != nil {
			item[key] = body[key]
		}
	}
	for _, key := range []string{"hour", "minute", "weekday"} {
		if body[key] != nil {
			item[key] = ToInt(body[key])
		}
	}
	if body["enabled"] != nil {
		on := boolFrom(body["enabled"])
		item["enabled"] = on
		if on {
			item["status"] = "active"
		} else if str(item["status"]) != "expired" {
			item["status"] = "paused"
		}
	}
	item["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	if str(item["status"]) == "expired" {
		delete(item, "nextRunAt")
		return
	}
	next := NextScheduleRun(item, time.Now().UTC())
	if next.IsZero() {
		item["status"] = "expired"
		item["enabled"] = false
		delete(item, "nextRunAt")
		return
	}
	item["nextRunAt"] = next.Format(time.RFC3339)
}

func TaskComments(task map[string]any) []map[string]any {
	EnsureTaskShape(task)
	if evs, ok := task["comments"].([]map[string]any); ok {
		out := make([]map[string]any, len(evs))
		copy(out, evs)
		return out
	}
	return []map[string]any{}
}
