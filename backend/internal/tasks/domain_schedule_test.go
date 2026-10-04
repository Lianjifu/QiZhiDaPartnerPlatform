package tasks

import "testing"
import "time"

func TestNextScheduleRunDaily(t *testing.T) {
	from := time.Date(2026, 7, 22, 1, 0, 0, 0, time.UTC)
	item := map[string]any{"cadence": "daily", "hour": 9, "minute": 0, "timezone": "UTC"}
	next := NextScheduleRun(item, from)
	if next.Hour() != 9 || next.Minute() != 0 {
		t.Fatalf("next=%s", next)
	}
	if !next.After(from) {
		t.Fatalf("expected future %s", next)
	}
}

func TestNextScheduleCodeIncrements(t *testing.T) {
	got := NextScheduleCode([]map[string]any{{"code": "SCH-1002"}})
	if got != "SCH-1003" {
		t.Fatalf("got %s", got)
	}
}
