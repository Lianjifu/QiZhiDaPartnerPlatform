package server

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestCMDBLookupPlatformCatalog(t *testing.T) {
	st := store.New()
	s := New(st)
	tool := &registeredTool{Name: "CMDB 查询", Key: "tool:cmdb-查询", Kind: "tool"}
	ctx := toolRunContext{WorkspaceID: "w1", UserMessage: "prod-redis"}
	res := s.runCMDBLookup(ctx, tool, toolCallRequest{Name: tool.Name, Args: map[string]any{"query": "prod-redis"}}, time.Now())
	if res.Status != "success" {
		t.Fatalf("status=%s err=%s out=%s", res.Status, res.Error, res.Output)
	}
	if !strings.Contains(res.Output, "prod-redis") {
		t.Fatalf("expected redis hit, got %s", res.Output)
	}
}

func TestCMDBLookupRequireExternalUnavailable(t *testing.T) {
	t.Setenv("DE_CMDB_REQUIRE_EXTERNAL", "1")
	_ = os.Unsetenv("DE_CMDB_URL")
	s := New(store.New())
	tool := &registeredTool{Name: "CMDB", Key: "tool:cmdb", Kind: "tool"}
	res := s.runCMDBLookup(toolRunContext{WorkspaceID: "w1"}, tool, toolCallRequest{Args: map[string]any{"query": "x"}}, time.Now())
	if res.Status != "unavailable" {
		t.Fatalf("want unavailable, got %s %s", res.Status, res.Error)
	}
}

func TestIsCMDBTool(t *testing.T) {
	if !isCMDBTool("CMDB 查询") || !isCMDBTool("cmdb-tool") {
		t.Fatal("expected CMDB match")
	}
	if isCMDBTool("kubectl") {
		t.Fatal("kubectl must not match")
	}
}