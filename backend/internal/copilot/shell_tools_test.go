package copilot

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

// newShellTestService 构造一个最小 Service 用于 shell 工具测试。
// shell 工具不依赖 Store 真实数据,只需 audit 写入不 panic。
func newShellTestService(t *testing.T) *Service {
	t.Helper()
	st := store.NewEmpty()
	return &Service{Store: st, Deps: Deps{}}
}

// TestShellReadFile 验证白名单 + read 校验 + 大小限制。
func TestShellReadFile(t *testing.T) {
	svc := newShellTestService(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "hello.txt")
	if err := os.WriteFile(target, []byte("hello world\n"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	t.Setenv("QZDA_SHELL_ROOTS", dir)
	r := svc.shellReadFile(target)
	if r.Status != "success" {
		t.Fatalf("expected success, got %s: %s", r.Status, r.Error)
	}
	if r.Output != "hello world\n" {
		t.Errorf("output mismatch: %q", r.Output)
	}

	// 越界:白名单外路径应拒绝
	r = svc.shellReadFile("/etc/passwd")
	if r.Status != "denied" {
		t.Errorf("expected denied for /etc/passwd, got %s", r.Status)
	}

	// 相对路径(落在第一个白名单根)
	if err := os.WriteFile(filepath.Join(dir, "rel.txt"), []byte("ok"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	r = svc.shellReadFile("rel.txt")
	if r.Status != "success" {
		t.Errorf("expected success for relative path, got %s: %s", r.Status, r.Error)
	}
}

// TestShellEditFile 验证 search-replace 唯一匹配 + 多匹配拒绝。
func TestShellEditFile(t *testing.T) {
	svc := newShellTestService(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "edit.txt")
	if err := os.WriteFile(target, []byte("alpha beta alpha\n"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	t.Setenv("QZDA_SHELL_ROOTS", dir)

	// 唯一匹配应成功
	r := svc.shellEditFile(target, "beta", "BETA")
	if r.Status != "success" {
		t.Fatalf("expected success, got %s: %s", r.Status, r.Error)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "alpha BETA alpha\n" {
		t.Errorf("edit failed: %q", got)
	}

	// 多匹配 → 拒绝
	r = svc.shellEditFile(target, "alpha", "X")
	if r.Status != "failed" {
		t.Errorf("expected failed for ambiguous edit, got %s", r.Status)
	}

	// search 不存在
	r = svc.shellEditFile(target, "not-present", "X")
	if r.Status != "failed" {
		t.Errorf("expected failed for missing search, got %s", r.Status)
	}
}

// TestShellExecWhitelist 验证命令白名单 + 黑名单短语 + docker mutating 拦截。
func TestShellExecWhitelist(t *testing.T) {
	svc := newShellTestService(t)
	dir := t.TempDir()
	t.Setenv("QZDA_SHELL_ROOTS", dir)

	// 允许:ls 当前工作区
	r := svc.shellExec("w1", "actor", "ls", []string{"."})
	if r.Status != "success" {
		t.Errorf("expected success for ls, got %s: %s", r.Status, r.Error)
	}

	// 拒绝:rm 不在白名单
	r = svc.shellExec("w1", "actor", "rm", []string{"-rf", "x"})
	if r.Status != "denied" {
		t.Errorf("expected denied for rm")
	}

	// 拒绝:黑名单短语
	r = svc.shellExec("w1", "actor", "sh", []string{"-c", "rm -rf /"})
	if r.Status != "denied" {
		t.Errorf("expected denied for blacklisted phrase, got %s", r.Status)
	}

	// 拒绝:docker rm(mutating)
	r = svc.shellExec("w1", "actor", "docker", []string{"rm", "container"})
	if r.Status != "denied" {
		t.Errorf("expected denied for docker rm, got %s", r.Status)
	}

	// 允许:docker ps(query)
	r = svc.shellExec("w1", "actor", "docker", []string{"ps"})
	if r.Status != "success" {
		t.Errorf("expected success for docker ps, got %s: %s", r.Status, r.Error)
	}
}

// TestShellRegistryTools 验证 6 个 shell 工具 + chart + 2 mcp 都进了 toolRegistry。
func TestShellRegistryTools(t *testing.T) {
	reg := buildToolRegistry(map[string]any{}, nil)
	names := map[string]bool{}
	for _, t := range reg {
		names[t.Name] = true
	}
	for _, want := range []string{
		"shell.read_file", "shell.write_file", "shell.edit_file",
		"shell.search_files", "shell.list_dir", "shell.exec",
		"chart.generate",
		"mcp.list_servers", "mcp.call_tool",
	} {
		if !names[want] {
			t.Errorf("missing tool: %s", want)
		}
	}
}

// TestRenderChartBar 验证 SVG 输出包含 rect + text 元素。
func TestRenderChartBar(t *testing.T) {
	in := chartInput{
		Type:  "bar",
		Title: "test",
		Series: []chartSeries{
			{Label: "A", Value: 10},
			{Label: "B", Value: 20},
		},
	}
	svg := renderBarChart(in)
	for _, marker := range []string{
		`<svg`, `viewBox=`, `<rect`, `>A<`, `>B<`, `font-family=`,
	} {
		if !strings.Contains(svg, marker) {
			t.Errorf("bar SVG missing %q\n%s", marker, svg[:min(200, len(svg))])
		}
	}
}

// TestRenderChartLine / Pie / Table 健全性检查。
func TestRenderChartLine(t *testing.T) {
	svg := renderLineChart(chartInput{
		Series: []chartSeries{{Label: "x", Value: 1}, {Label: "y", Value: 2}},
	})
	if !strings.Contains(svg, "<polyline") {
		t.Errorf("line SVG missing polyline")
	}
}

func TestRenderChartPie(t *testing.T) {
	svg := renderPieChart(chartInput{
		Series: []chartSeries{
			{Label: "a", Value: 30},
			{Label: "b", Value: 70},
		},
	})
	if !strings.Contains(svg, "<path") {
		t.Errorf("pie SVG missing path")
	}
}

func TestRenderChartTable(t *testing.T) {
	svg := renderMarkdownTable(chartInput{
		Title: "fallback",
		Series: []chartSeries{{Label: "x", Value: 1}},
	})
	if !strings.HasPrefix(svg, "## fallback") {
		t.Errorf("table SVG unexpected: %q", svg)
	}
}

// TestRenderChartEmpty 空 series 应返回 failed,不能返回空数组。
func TestRenderChartEmpty(t *testing.T) {
	for _, typ := range []string{"bar", "line", "pie", "table"} {
		r := renderChartSVG(fmt.Sprintf(`{"type":%q,"series":[]}`, typ))
		if r.Status != "failed" {
			t.Errorf("%s: expected failed on empty, got %s", typ, r.Status)
		}
	}
}

// TestMCPListServersEmpty 没配 MCP server 应返回清晰降级。
func TestMCPListServersEmpty(t *testing.T) {
	t.Setenv("QZDA_MCP_SERVERS", "")
	r := mcpListServers()
	if r.Status != "success" {
		t.Errorf("expected success, got %s: %s", r.Status, r.Error)
	}
	if !strings.Contains(r.Output, "未配置") {
		t.Errorf("expected hint about empty config, got %q", r.Output)
	}
}

// TestMCPConfigParse 解析 stdio + http 配置,不实际启动子进程。
func TestMCPConfigParse(t *testing.T) {
	cases := []struct {
		in   string
		want mcpTransportKind
		err  bool
	}{
		{"stdio:/bin/echo hello", mcpKindStdio, false},
		{"http://127.0.0.1:3001/mcp", mcpKindHTTP, false},
		{"unknown://x", "", true},
	}
	for _, c := range cases {
		s, err := parseAndStartMCPServer(c.in)
		if c.err {
			if err == nil {
				t.Errorf("expected error for %q", c.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("unexpected error for %q: %v", c.in, err)
			continue
		}
		if s.Kind != c.want {
			t.Errorf("kind mismatch for %q: got %s want %s", c.in, s.Kind, c.want)
		}
	}
}

// helper for the unused `fmt` import in the chart tests.
var _ = json.Marshal