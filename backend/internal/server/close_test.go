package server_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestRegisterCloseFuncSkipsNil ensures RegisterCloseFunc(nil) is a no-op
// and doesn't panic. This matters because runDurable guards every
// RegisterCloseFunc call with `if pg != nil` but a defensive nil check
// here protects future callers from forgetting.
func TestRegisterCloseFuncSkipsNil(t *testing.T) {
	s := server.New(store.New())
	s.RegisterCloseFunc(nil)
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown returned %v after nil RegisterCloseFunc", err)
	}
}

// TestShutdownRunsRegisteredCloseFuncs proves all registered funcs run
// during Shutdown, regardless of registration order.
func TestShutdownRunsRegisteredCloseFuncs(t *testing.T) {
	s := server.New(store.New())
	var hits [3]atomic.Bool
	for i := 0; i < 3; i++ {
		i := i
		s.RegisterCloseFunc(func() error {
			hits[i].Store(true)
			return nil
		})
	}
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown returned %v", err)
	}
	for i := range hits {
		if !hits[i].Load() {
			t.Fatalf("close func %d was not invoked", i)
		}
	}
}

// TestShutdownRunsCloseFuncsInParallel proves the 100ms × 3 sleeps
// overlap. Sequential execution would take ≥ 300ms; parallel with
// goroutine fan-out finishes well under 250ms.
func TestShutdownRunsCloseFuncsInParallel(t *testing.T) {
	s := server.New(store.New())
	const n = 3
	for i := 0; i < n; i++ {
		s.RegisterCloseFunc(func() error {
			time.Sleep(100 * time.Millisecond)
			return nil
		})
	}
	start := time.Now()
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown returned %v", err)
	}
	elapsed := time.Since(start)
	if elapsed > 250*time.Millisecond {
		t.Fatalf("Shutdown took %v; expected parallel ≤ 250ms", elapsed)
	}
}

// TestShutdownReturnsFirstError asserts that an error from any registered
// closer propagates to the caller. We register a successful fn first
// then an erroring one; the returned error should match the erroring
// one (not nil).
func TestShutdownReturnsFirstError(t *testing.T) {
	s := server.New(store.New())
	wantErr := errors.New("close failed")
	s.RegisterCloseFunc(func() error { return nil })
	s.RegisterCloseFunc(func() error { return wantErr })
	err := s.Shutdown(context.Background())
	if err == nil {
		t.Fatal("Shutdown returned nil; expected error")
	}
	if err.Error() != wantErr.Error() {
		t.Fatalf("Shutdown err = %v; want %v", err, wantErr)
	}
}

// TestShutdownRespectsContextDeadline proves Shutdown returns ctx.Err()
// promptly when a closer blocks past the deadline. Critical for K8s
// pod terminationGracePeriodSeconds.
func TestShutdownRespectsContextDeadline(t *testing.T) {
	s := server.New(store.New())
	s.RegisterCloseFunc(func() error {
		time.Sleep(5 * time.Second)
		return nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := s.Shutdown(ctx)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("Shutdown returned nil; expected timeout error")
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("Shutdown took %v despite 100ms deadline", elapsed)
	}
}

// TestShutdownIsIdempotent proves calling Shutdown twice is safe and
// returns nil the second time (no close funcs registered between calls,
// so the second pass has an empty fan-out).
func TestShutdownIsIdempotent(t *testing.T) {
	s := server.New(store.New())
	called := atomic.Int32{}
	s.RegisterCloseFunc(func() error {
		called.Add(1)
		return nil
	})
	ctx := context.Background()
	if err := s.Shutdown(ctx); err != nil {
		t.Fatalf("first Shutdown: %v", err)
	}
	if err := s.Shutdown(ctx); err != nil {
		t.Fatalf("second Shutdown: %v", err)
	}
	if called.Load() != 1 {
		t.Fatalf("close func ran %d times; want exactly 1", called.Load())
	}
}
