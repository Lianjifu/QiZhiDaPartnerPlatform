package hotreload_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/hotreload"
)

// intParser parses a config file containing a single integer.
func intParser(path string, data []byte) (int, error) {
	s := strings.TrimSpace(string(data))
	if s == "" {
		return 0, nil
	}
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, os.ErrInvalid
		}
		n = n*10 + int(c-'0')
	}
	if n < 0 {
		return 0, os.ErrInvalid
	}
	return n, nil
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestWatcherAppliesOnMtimeChange(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "policy.cfg")
	writeFile(t, cfg, "42")

	var applied atomic.Int32
	var lastValue atomic.Int64
	w := hotreload.New([]hotreload.Resource[int]{
		{
			Name: "test",
			Path: cfg,
			Parse: intParser,
			Apply: func(_ string, v int) error {
				applied.Add(1)
				lastValue.Store(int64(v))
				return nil
			},
		},
	}, hotreload.WithInterval(20*time.Millisecond))

	// Run for 300ms; write the file at 100ms.
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()

	done := make(chan struct{})
	go func() {
		_ = w.Run(ctx)
		close(done)
	}()

	time.Sleep(100 * time.Millisecond)
	writeFile(t, cfg, "99")

	<-done

	if got := applied.Load(); got < 1 {
		t.Fatalf("apply called %d times, want >=1", got)
	}
	if got := int(lastValue.Load()); got != 99 {
		t.Fatalf("last value: want 99, got %d", got)
	}
}

func TestWatcherKeepsPreviousValueOnParseError(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "policy.cfg")
	writeFile(t, cfg, "10")

	var applied atomic.Int32
	var lastValue atomic.Int64
	w := hotreload.New([]hotreload.Resource[int]{
		{
			Name: "test",
			Path: cfg,
			Parse: intParser,
			Apply: func(_ string, v int) error {
				applied.Add(1)
				lastValue.Store(int64(v))
				return nil
			},
		},
	}, hotreload.WithInterval(15*time.Millisecond))

	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	done := make(chan struct{})
	go func() { _ = w.Run(ctx); close(done) }()

	time.Sleep(80 * time.Millisecond)
	writeFile(t, cfg, "garbage")

	<-done

	// Apply was called for the initial "10", but the parse-failure on
	// "garbage" must NOT call Apply. LastValue stays at 10.
	if got := int(lastValue.Load()); got != 10 {
		t.Fatalf("lastValue should stay at 10 after parse failure, got %d", got)
	}
	if err := w.LastError("test"); err == nil {
		t.Fatalf("LastError should be set after parse failure")
	}
	if applied.Load() != 1 {
		t.Fatalf("Apply called %d times, want exactly 1 (only initial)", applied.Load())
	}
}

func TestWatcherKeepsPreviousValueOnApplyError(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "policy.cfg")
	writeFile(t, cfg, "5")

	var applyCalls atomic.Int32
	w := hotreload.New([]hotreload.Resource[int]{
		{
			Name: "test",
			Path: cfg,
			Parse: intParser,
			Apply: func(_ string, v int) error {
				applyCalls.Add(1)
				if v == 99 {
					return os.ErrPermission
				}
				return nil
			},
		},
	}, hotreload.WithInterval(15*time.Millisecond))

	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	done := make(chan struct{})
	go func() { _ = w.Run(ctx); close(done) }()

	time.Sleep(80 * time.Millisecond)
	writeFile(t, cfg, "99")

	<-done

	// Watcher-level LastValue must NOT have advanced to 99, because the
	// apply errored and the previous-good-value contract was broken.
	v, ok := w.LastValue("test")
	if !ok {
		t.Fatalf("LastValue should reflect the initial 5, got ok=false")
	}
	if v == 99 {
		t.Fatalf("LastValue must not advance to 99 after apply error")
	}
	if v != 5 {
		t.Fatalf("LastValue: want 5 (previous good), got %d", v)
	}
	if err := w.LastError("test"); err == nil {
		t.Fatalf("LastError should be set after apply error")
	}
	// Apply was called twice (once for "5", once for "99") — both
	// reached the Apply function. The error caused the watcher to roll
	// back its LastValue tracking.
	if applyCalls.Load() != 2 {
		t.Fatalf("Apply called %d times, want 2", applyCalls.Load())
	}
}

// TestWatcherScanNow forces a reload without waiting for the tick —
// the public API ops tools use.
func TestWatcherScanNow(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "policy.cfg")
	writeFile(t, cfg, "1")

	var mu sync.Mutex
	values := []int{}
	w := hotreload.New([]hotreload.Resource[int]{
		{
			Name: "test",
			Path: cfg,
			Parse: intParser,
			Apply: func(_ string, v int) error {
				mu.Lock()
				values = append(values, v)
				mu.Unlock()
				return nil
			},
		},
	}, hotreload.WithInterval(time.Hour)) // tick won't fire in test window

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	done := make(chan struct{})
	go func() { _ = w.Run(ctx); close(done) }()

	time.Sleep(50 * time.Millisecond)
	writeFile(t, cfg, "7")
	time.Sleep(20 * time.Millisecond) // let mtime tick over

	w.ScanNow()
	time.Sleep(20 * time.Millisecond)

	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	if len(values) == 0 || values[len(values)-1] != 7 {
		t.Fatalf("ScanNow should pick up 7, got values=%v", values)
	}
}

func TestWatcherSurvivesMissingFile(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "missing.cfg")

	w := hotreload.New([]hotreload.Resource[int]{
		{
			Name: "test",
			Path: cfg,
			Parse: intParser,
			Apply: func(_ string, _ int) error { return nil },
		},
	}, hotreload.WithInterval(15*time.Millisecond))

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := w.Run(ctx)
	if err != context.DeadlineExceeded {
		t.Fatalf("Run should return DeadlineExceeded, got %v", err)
	}
	// And LastError should remain nil — missing file isn't an error,
	// it's a "wait for it to appear" state.
	if err := w.LastError("test"); err != nil {
		t.Fatalf("missing file must not surface as error: %v", err)
	}
}

func TestWatcherNoResourcesRejected(t *testing.T) {
	w := hotreload.New([]hotreload.Resource[int]{})
	err := w.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "no resources") {
		t.Fatalf("Run with no resources should error, got %v", err)
	}
}

func TestWatcherLastValueInitialZero(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "policy.cfg")
	writeFile(t, cfg, "11")

	var applied atomic.Int32
	w := hotreload.New([]hotreload.Resource[int]{
		{
			Name: "test",
			Path: cfg,
			Parse: intParser,
			Apply: func(_ string, v int) error {
				applied.Add(1)
				return nil
			},
		},
	}, hotreload.WithInterval(time.Hour))

	// LastValue before Run is the zero value.
	v, ok := w.LastValue("test")
	if ok || v != 0 {
		t.Fatalf("LastValue before Run: want (0, false), got (%d, %v)", v, ok)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done := make(chan struct{})
	go func() { _ = w.Run(ctx); close(done) }()

	<-done

	v, ok = w.LastValue("test")
	if !ok || v != 11 {
		t.Fatalf("LastValue after Run: want (11, true), got (%d, %v)", v, ok)
	}
}

func TestWatcherUnknownResource(t *testing.T) {
	w := hotreload.New([]hotreload.Resource[int]{
		{
			Name: "real",
			Path: "/nonexistent",
			Parse: intParser,
			Apply: func(_ string, _ int) error { return nil },
		},
	})
	if err := w.LastError("ghost"); err == nil {
		t.Fatal("LastError on unknown resource should error")
	}
	if _, ok := w.LastValue("ghost"); ok {
		t.Fatal("LastValue on unknown resource should not be ok")
	}
}

// TestWatcherHotreloadMultipleResources confirms each registered
// resource has its own state and metric.
func TestWatcherHotreloadMultipleResources(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.cfg")
	b := filepath.Join(dir, "b.cfg")
	writeFile(t, a, "1")
	writeFile(t, b, "2")

	var aCount, bCount atomic.Int32
	w := hotreload.New([]hotreload.Resource[int]{
		{Name: "alpha", Path: a, Parse: intParser, Apply: func(_ string, _ int) error { aCount.Add(1); return nil }},
		{Name: "beta", Path: b, Parse: intParser, Apply: func(_ string, _ int) error { bCount.Add(1); return nil }},
	}, hotreload.WithInterval(15*time.Millisecond))

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	done := make(chan struct{})
	go func() { _ = w.Run(ctx); close(done) }()

	time.Sleep(60 * time.Millisecond)
	writeFile(t, a, "11")
	writeFile(t, b, "22")

	<-done

	if aCount.Load() < 1 {
		t.Fatalf("alpha Apply count: want >=1, got %d", aCount.Load())
	}
	if bCount.Load() < 1 {
		t.Fatalf("beta Apply count: want >=1, got %d", bCount.Load())
	}

	av, _ := w.LastValue("alpha")
	bv, _ := w.LastValue("beta")
	if av != 11 || bv != 22 {
		t.Fatalf("values: alpha=%d beta=%d, want 11/22", av, bv)
	}
}
