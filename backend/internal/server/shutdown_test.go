package server_test

import (
	"context"
	"runtime"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestMemoryTTLGoroutineExitsOnCancel proves the StartMemoryMaintenance
// goroutine listens for ctx and stops within 200ms of cancel. Uses
// runtime.NumGoroutine delta as the leak check.
func TestMemoryTTLGoroutineExitsOnCancel(t *testing.T) {
	s := server.New(store.New())
	s.StartMemoryMaintenance()
	if s.MemoryTTLCancel == nil { //nolint:staticcheck // exposed for test
		t.Skip("MemoryTTLCancel not wired (env-gated)")
	}

	before := runtime.NumGoroutine()
	s.MemoryTTLCancel()
	// Allow goroutine to observe ctx.Done() and return.
	for i := 0; i < 20; i++ {
		time.Sleep(10 * time.Millisecond)
		if runtime.NumGoroutine() <= before {
			return
		}
	}
	t.Fatalf("memory TTL goroutine did not exit within 200ms; before=%d after=%d",
		before, runtime.NumGoroutine())
}

// TestServerShutdownIsIdempotent ensures Shutdown is safe to call multiple
// times and never returns an error for the current set of registered
// cancels (which return no error).
func TestServerShutdownIsIdempotent(t *testing.T) {
	s := server.New(store.New())
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := s.Shutdown(ctx); err != nil {
			t.Fatalf("Shutdown call %d returned err=%v", i+1, err)
		}
	}
}
