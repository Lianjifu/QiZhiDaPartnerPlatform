package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/metrics"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// newRecoverHarness builds a small chain that exercises the withRecover
// middleware. We don't use s.Handler() because the production mux routes
// every request through requireAuth → store lookups we don't want to
// populate for a recover-focused test.
func newRecoverHarness(t *testing.T, inner http.HandlerFunc) (*server.Server, http.Handler) {
	t.Helper()
	s := server.New(store.New())
	h := s.WithRecoverForTest(inner) // exposed for test only
	return s, h
}

// TestRecoverReturns500OnPanic asserts that a panicking handler produces
// HTTP 500 with the canonical INTERNAL body. This is the contract callers
// rely on: a panic in any downstream handler must NOT hang the connection.
func TestRecoverReturns500OnPanic(t *testing.T) {
	_, h := newRecoverHarness(t, func(w http.ResponseWriter, r *http.Request) {
		panic("kaboom")
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/panic", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "INTERNAL") {
		t.Fatalf("body = %q, want contains INTERNAL", rr.Body.String())
	}
}

// TestRecoverCountsPanics proves the metrics counter is bumped. The
// counter is global so we snapshot before/after and assert delta ≥ 1.
func TestRecoverCountsPanics(t *testing.T) {
	before := metrics.Global.HandlerPanics.Value()
	_, h := newRecoverHarness(t, func(w http.ResponseWriter, r *http.Request) {
		panic("kaboom")
	})

	for i := 0; i < 3; i++ {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/panic", nil)
		h.ServeHTTP(rr, req)
	}
	after := metrics.Global.HandlerPanics.Value()
	if after-before < 3 {
		t.Fatalf("HandlerPanics delta = %d, want >= 3", after-before)
	}
}

// TestRecoverEmitsAuditRow asserts a panic writes an audit row so
// operators can trace which path caused it.
func TestRecoverEmitsAuditRow(t *testing.T) {
	s, h := newRecoverHarness(t, func(w http.ResponseWriter, r *http.Request) {
		panic("kaboom for audit")
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/test/panic/audit", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}

	s.Store.RLock()
	defer s.Store.RUnlock()

	var panicRow map[string]any
	for i := len(s.Store.Audits) - 1; i >= 0; i-- {
		if s.Store.Audits[i]["action"] == "handler panic" {
			panicRow = s.Store.Audits[i]
			break
		}
	}
	if panicRow == nil {
		t.Fatalf("no handler panic audit row found; have %d rows", len(s.Store.Audits))
	}
	if panicRow["result"] != "failed" {
		t.Fatalf("audit result = %v, want failed", panicRow["result"])
	}
	if panicRow["target"] != "/test/panic/audit" {
		t.Fatalf("audit target = %v, want /test/panic/audit", panicRow["target"])
	}
	if !strings.Contains(panicRow["reason"].(string), "kaboom for audit") {
		t.Fatalf("audit reason = %v, want contains panic message", panicRow["reason"])
	}
}

// TestRecoverDoesNotMaskLocalRecover proves the layering is correct:
// when a handler uses a local recover() to swallow its own panic and
// return 200 normally, the outer withRecover must NOT see the panic
// and must NOT write a second 500.
func TestRecoverDoesNotMaskLocalRecover(t *testing.T) {
	_, h := newRecoverHarness(t, func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			_ = recover()
			w.WriteHeader(http.StatusOK)
		}()
		panic("locally swallowed")
	})

	before := metrics.Global.HandlerPanics.Value()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/local", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (local recover should win)", rr.Code)
	}
	after := metrics.Global.HandlerPanics.Value()
	if after != before {
		t.Fatalf("outer counter moved %d→%d, local recover should have hidden it",
			before, after)
	}
}
