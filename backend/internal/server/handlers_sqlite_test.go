package server_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestServerStoreBackendSQLiteHook(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("QZDA_ENV", "test")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("QZDA_STORE_BACKEND", "sqlite")
	t.Setenv("QZDA_SQLITE_PATH", filepath.Join(dir, "kv.db"))

	s := server.New(store.New())
	if s.SQLite == nil {
		t.Fatal("SQLite hooks not initialized despite QZDA_STORE_BACKEND=sqlite")
	}

	s.Store.Lock()
	s.Store.Conversations = []map[string]any{
		{"id": "c1", "workspaceId": "w1", "topic": "hello"},
	}
	s.Store.Unlock()
	if err := s.Store.PersistSync("conversations"); err != nil {
		t.Fatalf("persist: %v", err)
	}

	got, err := s.SQLite.List(context.Background(), "conversations")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0]["topic"] != "hello" {
		t.Fatalf("round-trip failed: %+v", got)
	}
}

func TestServerStoreBackendDefaultIsMemory(t *testing.T) {
	t.Setenv("QZDA_ENV", "test")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("QZDA_STORE_BACKEND", "")
	s := server.New(store.New())
	if s.SQLite != nil {
		t.Fatal("SQLite should be nil when QZDA_STORE_BACKEND is unset")
	}
}

func TestServerStoreBackendBadPathFallsBack(t *testing.T) {
	t.Setenv("QZDA_ENV", "test")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("QZDA_STORE_BACKEND", "sqlite")
	// /dev/null is a valid file but not a directory; providing a directory
	// path that cannot host a database should make open fail and the
	// server should fall back to in-memory rather than panic.
	t.Setenv("QZDA_SQLITE_PATH", "/dev/null/impossible.db")
	s := server.New(store.New())
	if s.SQLite != nil {
		t.Fatalf("SQLite should be nil after open failure, got %+v", s.SQLite)
	}
}