package server

import (
	"strings"
	"testing"
)

func TestAppendAuditSyscallSegment(t *testing.T) {
	// 正常路径:float64(来自 JSON 解码)的四个字段全部出现 → 按固定顺序追加
	got := appendSyscallSegment("egress=wttr.in", map[string]any{
		"open":        float64(3),
		"execve":      float64(1),
		"connect":     float64(1),
		"blocked_open": float64(0),
	})
	if !strings.Contains(got, ";syscalls=open:3,execve:1,connect:1,blocked_open:0") {
		t.Fatalf("expected syscalls segment appended in fixed order, got %q", got)
	}
	if !strings.HasPrefix(got, "egress=wttr.in") {
		t.Fatalf("original reason prefix lost, got %q", got)
	}

	// 向后兼容:syscalls 缺失(nil)→ 原样返回
	unchanged := appendSyscallSegment("egress=wttr.in", nil)
	if unchanged != "egress=wttr.in" {
		t.Fatalf("expected unchanged on nil, got %q", unchanged)
	}

	// 向后兼容:syscalls 为空 map → 原样返回
	empty := appendSyscallSegment("egress=wttr.in", map[string]any{})
	if empty != "egress=wttr.in" {
		t.Fatalf("expected unchanged on empty map, got %q", empty)
	}

	// 字段类型混合:int + float64 都能被格式化
	mixed := appendSyscallSegment("base", map[string]any{
		"open":    int(2),
		"execve":  float64(0),
		"connect": float64(1),
	})
	if !strings.Contains(mixed, "open:2") || !strings.Contains(mixed, "execve:0") || !strings.Contains(mixed, "connect:1") {
		t.Fatalf("expected mixed-type segment, got %q", mixed)
	}

	// 非数值类型被忽略(不 panic,不输出)
	bad := appendSyscallSegment("base", map[string]any{
		"open":    "string-not-allowed",
		"execve":  float64(1),
	})
	if strings.Contains(bad, "string-not-allowed") {
		t.Fatalf("non-numeric value should be skipped, got %q", bad)
	}
	if !strings.Contains(bad, "execve:1") {
		t.Fatalf("expected execve:1 in %q", bad)
	}
}