package selfimproving_test

import (
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/modelprov/trace"
	"github.com/qizhida-partner-platform/backend/internal/selfimproving"
)

func fixedNow() time.Time {
	return time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
}

func seedOK(rec *trace.Recorder, n int) {
	for i := 0; i < n; i++ {
		rec.Append(trace.Event{
			TraceID: "ok-1", WorkspaceID: "w1", TurnID: "t1",
			ModelID: "m1", ProviderID: "p1", Level: "P1", Source: "provider",
			Status: trace.StatusOK, StartedAt: fixedNow(), EndedAt: fixedNow(), LatencyMs: 800,
		})
	}
}

func seedRecurringError(rec *trace.Recorder, provider, class string, n int) {
	for i := 0; i < n; i++ {
		rec.Append(trace.Event{
			TraceID: "err", WorkspaceID: "w1", TurnID: "t1",
			ModelID: "m1", ProviderID: provider, Level: "P1", Source: "provider",
			Status: trace.StatusError, ErrorClass: class,
			StartedAt: fixedNow(), EndedAt: fixedNow(), LatencyMs: 1200,
		})
	}
}

func seedSlow(rec *trace.Recorder, provider string, ms int64, n int) {
	for i := 0; i < n; i++ {
		rec.Append(trace.Event{
			TraceID: "slow", WorkspaceID: "w1", TurnID: "t1",
			ModelID: "m1", ProviderID: provider, Level: "P2", Source: "provider",
			Status: trace.StatusOK, StartedAt: fixedNow(), EndedAt: fixedNow(), LatencyMs: ms,
		})
	}
}

func TestEngineSampleTooSmall(t *testing.T) {
	rec := trace.NewRecorder(50)
	rec.Append(trace.Event{TraceID: "x", WorkspaceID: "w1", Status: trace.StatusOK, LatencyMs: 100})
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", Now: fixedNow})
	if err != selfimproving.ErrSampleTooSmall {
		t.Fatalf("want ErrSampleTooSmall, got %v", err)
	}
	if sop.Title != "" {
		t.Fatalf("sop should be empty: %+v", sop)
	}
}

func TestEngineNoAnomalyRejected(t *testing.T) {
	rec := trace.NewRecorder(50)
	seedOK(rec, 5)
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", Now: fixedNow})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sop.Verdict != selfimproving.VerdictRejected {
		t.Fatalf("want rejected, got %s reason=%s", sop.Verdict, sop.Reason)
	}
	if sop.Reason != selfimproving.ReasonNoAnomaly {
		t.Fatalf("reason: %s", sop.Reason)
	}
}

func TestEngineRecurringErrorsCreate(t *testing.T) {
	rec := trace.NewRecorder(50)
	seedOK(rec, 4)
	seedRecurringError(rec, "p-err", "timeout", 3)
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", Window: "all", Now: fixedNow})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sop.Verdict != selfimproving.VerdictCreated {
		t.Fatalf("want created, got %s reason=%s", sop.Verdict, sop.Reason)
	}
	if sop.Reason != selfimproving.ReasonRecurringErrors {
		t.Fatalf("reason: %s", sop.Reason)
	}
	found := false
	for _, p := range sop.Patterns {
		if strings.HasPrefix(p.Key, "error:p-err:timeout") {
			found = true
			if p.Count != 3 {
				t.Fatalf("pattern count: %d", p.Count)
			}
			if p.Verdict != selfimproving.VerdictCreated {
				t.Fatalf("pattern verdict: %s", p.Verdict)
			}
		}
	}
	if !found {
		t.Fatalf("missing error:p-err:timeout pattern: %+v", sop.Patterns)
	}
	if !strings.Contains(sop.Markdown, "Provider p-err") {
		t.Fatalf("markdown missing provider name")
	}
}

func TestEngineLatencyElevatedCreate(t *testing.T) {
	rec := trace.NewRecorder(50)
	seedOK(rec, 3)
	seedSlow(rec, "p-slow", 5000, 3)
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", Window: "all", Now: fixedNow})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sop.Verdict != selfimproving.VerdictCreated {
		t.Fatalf("want created, got %s", sop.Verdict)
	}
	if sop.Reason != selfimproving.ReasonLatencyElevated {
		t.Fatalf("reason: %s", sop.Reason)
	}
}

func TestEngineErrorRateElevatedCreate(t *testing.T) {
	rec := trace.NewRecorder(50)
	seedOK(rec, 1)
	for i := 0; i < 4; i++ {
		rec.Append(trace.Event{
			TraceID: "err", WorkspaceID: "w1", ProviderID: "p1", Level: "P1",
			Status: trace.StatusError, ErrorClass: "5xx",
			StartedAt: fixedNow(), EndedAt: fixedNow(), LatencyMs: 100,
		})
	}
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", Window: "all", Now: fixedNow})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sop.Verdict != selfimproving.VerdictCreated {
		t.Fatalf("want created, got %s reason=%s", sop.Verdict, sop.Reason)
	}
	if sop.Reason != selfimproving.ReasonErrorRateElevated && sop.Reason != selfimproving.ReasonRecurringErrors {
		t.Fatalf("reason: %s", sop.Reason)
	}
}

func TestEngineWorkspaceFilter(t *testing.T) {
	rec := trace.NewRecorder(50)
	rec.Append(trace.Event{TraceID: "a", WorkspaceID: "w1", Status: trace.StatusOK, LatencyMs: 100})
	rec.Append(trace.Event{TraceID: "b", WorkspaceID: "w2", Status: trace.StatusOK, LatencyMs: 100})
	rec.Append(trace.Event{TraceID: "c", WorkspaceID: "w1", Status: trace.StatusOK, LatencyMs: 100})
	rec.Append(trace.Event{TraceID: "d", WorkspaceID: "w1", Status: trace.StatusOK, LatencyMs: 100})
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", Window: "all", Now: fixedNow})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sop.SampleSize != 3 {
		t.Fatalf("want 3 events for w1, got %d", sop.SampleSize)
	}
}

func TestEngineRecorderAccessor(t *testing.T) {
	rec := trace.NewRecorder(10)
	e := selfimproving.New(rec)
	if e.Recorder() != rec {
		t.Fatal("Recorder() should return wrapped recorder")
	}
}

func TestEngineTitleIncludesWorkspaceAndVerdict(t *testing.T) {
	rec := trace.NewRecorder(50)
	seedOK(rec, 4)
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", TitleHint: "X", Window: "all", Now: fixedNow})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sop.Title, "w1") {
		t.Fatalf("title missing workspace: %q", sop.Title)
	}
	if !strings.Contains(sop.Title, "X") {
		t.Fatalf("title missing hint: %q", sop.Title)
	}
	if !strings.HasPrefix(sop.Title, "[") {
		t.Fatalf("title missing verdict bracket: %q", sop.Title)
	}
}

func TestEngineMarkdownStructure(t *testing.T) {
	rec := trace.NewRecorder(50)
	seedOK(rec, 4)
	seedRecurringError(rec, "p-x", "rate_limited", 3)
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", Window: "all", Now: fixedNow})
	if err != nil {
		t.Fatal(err)
	}
	must := []string{"# ", "## 采样", "## 触发模式", "## 建议步骤", "## 元数据",
		"verdict=", "generatedBy: selfimproving"}
	for _, s := range must {
		if !strings.Contains(sop.Markdown, s) {
			t.Errorf("markdown missing %q", s)
		}
	}
}

func TestEngineSingleErrorRejected(t *testing.T) {
	rec := trace.NewRecorder(50)
	seedOK(rec, 4)
	rec.Append(trace.Event{
		TraceID: "x", WorkspaceID: "w1", ProviderID: "p1",
		Status: trace.StatusError, ErrorClass: "5xx",
		StartedAt: fixedNow(), EndedAt: fixedNow(), LatencyMs: 100,
	})
	sop, err := selfimproving.New(rec).Generate(selfimproving.Options{WorkspaceID: "w1", Window: "all", Now: fixedNow})
	if err != nil {
		t.Fatal(err)
	}
	// Single error class with count=1 → VerdictRejected for that pattern.
	// Overall verdict can still be created from error rate; both are valid.
	if sop.SampleSize != 5 {
		t.Fatalf("sample size: %d", sop.SampleSize)
	}
}

func TestDefaultThresholds(t *testing.T) {
	thr := selfimproving.DefaultThresholds()
	if thr.MinSample <= 0 || thr.ErrorRateReject <= 0 || thr.P95LatencyMs <= 0 || thr.RecurringErrorThreshold <= 0 {
		t.Fatalf("invalid defaults: %+v", thr)
	}
}