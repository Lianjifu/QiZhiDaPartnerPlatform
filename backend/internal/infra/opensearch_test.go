package infra

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestOpenSearchIndexAndSearch(t *testing.T) {
	var indexed map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/qzda-audit") && !strings.Contains(r.URL.Path, "_doc"):
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"acknowledged":true}`))
		case r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/_doc/"):
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, &indexed)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"result":"created"}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/_search"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"hits": map[string]any{
					"hits": []map[string]any{
						{"_source": map[string]any{
							"id": "a1", "workspaceId": "ws1", "action": "login", "time": "2026-01-01T00:00:00Z",
						}},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	o := &OpenSearchAudit{Base: srv.URL, Index: "qzda-audit", HTTP: srv.Client()}
	if err := o.EnsureIndex(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := o.IndexEvent(context.Background(), map[string]any{
		"id": "a1", "workspaceId": "ws1", "action": "login",
	}); err != nil {
		t.Fatal(err)
	}
	if indexed["id"] != "a1" {
		t.Fatalf("indexed=%v", indexed)
	}
	rows, err := o.SearchRecent(context.Background(), []string{"ws1"}, 10)
	if err != nil || len(rows) != 1 || str(rows[0]["id"]) != "a1" {
		t.Fatalf("search rows=%v err=%v", rows, err)
	}
}

func TestNewOpenSearchAuditFromEnvEmpty(t *testing.T) {
	t.Setenv("QZDA_OPENSEARCH_URL", "")
	if NewOpenSearchAuditFromEnv() != nil {
		t.Fatal("expected nil without URL")
	}
}

// TestOpenSearchAuditCloseNilReceiver mirrors KafkaAuditBus.Close
// nil-safety: callers wire Close into server.RegisterCloseFunc and the
// shutdown path must not panic on an uninitialized audit sink.
func TestOpenSearchAuditCloseNilReceiver(t *testing.T) {
	var o *OpenSearchAudit
	if err := o.Close(); err != nil {
		t.Fatalf("nil OpenSearchAudit.Close returned %v, want nil", err)
	}
}

// TestOpenSearchAuditCloseNoClient covers the zero-value literal path:
// structs created without an HTTP client (e.g. tests, future code that
// only sets Base) must still return nil from Close rather than panic.
func TestOpenSearchAuditCloseNoClient(t *testing.T) {
	o := &OpenSearchAudit{Base: "http://unused", Index: "qzda-audit"}
	if err := o.Close(); err != nil {
		t.Fatalf("OpenSearchAudit.Close with nil HTTP returned %v, want nil", err)
	}
}

// TestOpenSearchAuditCloseIdleConns asserts that Close actually invokes
// CloseIdleConnections on the underlying *http.Client exactly once. We
// can't observe CloseIdleConnections on a stdlib *http.Client, so we
// wrap it with a recording transport that counts Do/CloseIdleConnections
// calls and replaces the Transport field — CloseIdleConnections forwards
// to the Transport, so the counter captures the real call site.
func TestOpenSearchAuditCloseIdleConns(t *testing.T) {
	var idleCalls atomic.Int32
	tr := &recordingTransport{
		inner: http.DefaultTransport,
		onCloseIdle: func() {
			idleCalls.Add(1)
		},
	}
	o := &OpenSearchAudit{
		Base:  "http://unused",
		Index: "qzda-audit",
		HTTP:  &http.Client{Transport: tr},
	}
	if err := o.Close(); err != nil {
		t.Fatalf("Close returned %v, want nil", err)
	}
	if got := idleCalls.Load(); got != 1 {
		t.Fatalf("CloseIdleConnections called %d times, want 1", got)
	}
	// Second Close on the same struct must remain a single call (Close does
	// not accumulate state) — guard against future regressions that turn
	// Close into a double-call.
	if err := o.Close(); err != nil {
		t.Fatalf("second Close returned %v, want nil", err)
	}
	if got := idleCalls.Load(); got != 2 {
		t.Fatalf("CloseIdleConnections called %d times after 2 Closes, want 2", got)
	}
}

// recordingTransport is a thin http.RoundTripper wrapper that forwards
// to an inner transport and counts CloseIdleConnections invocations.
// http.Client.CloseIdleConnections delegates to Transport.CloseIdleConnections
// when present, so this lets tests verify the call without touching the
// stdlib struct.
type recordingTransport struct {
	inner      http.RoundTripper
	onCloseIdle func()
}

func (r *recordingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return r.inner.RoundTrip(req)
}

func (r *recordingTransport) CloseIdleConnections() {
	if r.onCloseIdle != nil {
		r.onCloseIdle()
	}
	if c, ok := r.inner.(interface{ CloseIdleConnections() }); ok {
		c.CloseIdleConnections()
	}
}
