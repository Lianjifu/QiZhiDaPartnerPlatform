package server

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestAdoptTemplatePersistsWhenEnabled(t *testing.T) {
	t.Setenv("QZDA_ENV", "development")

	st := store.NewDemo()
	var mu sync.Mutex
	persisted := map[string]bool{}
	st.SetPersistHook(func(_ context.Context, collection string, _ []map[string]any) error {
		mu.Lock()
		persisted[collection] = true
		mu.Unlock()
		return nil
	})
	h := New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partner-templates/tpl-sre/adopt",
		bytes.NewBufferString(`{"name":"采纳测试岗"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-workspace-id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("adopt %d %s", rr.Code, rr.Body.String())
	}
	_ = st.PersistSync("employees")
	_ = st.PersistSync("template_adoptions")
	mu.Lock()
	defer mu.Unlock()
	if !persisted["employees"] {
		t.Fatal("expected employees persist after adopt")
	}
	if !persisted["template_adoptions"] {
		t.Fatal("expected template_adoptions persist after adopt")
	}
}

func TestAfterWriteSkippedInDemo(t *testing.T) {
	t.Setenv("QZDA_ENV", "demo")

	st := store.NewDemo()
	called := false
	st.SetPersistHook(func(_ context.Context, _ string, _ []map[string]any) error {
		called = true
		return nil
	})
	srv := New(st)
	srv.afterWrite("employees")
	if called {
		t.Fatal("demo mode must not persist via afterWrite")
	}
}
