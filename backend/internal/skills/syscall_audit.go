package skills

import (
	"fmt"
	"strings"
)

// appendSyscallSegment 把 Phase 3 Python /v1/execute 响应里的 syscalls 摘要
// (open/execve/connect/blocked_open) 拼成 "open:N,execve:M,connect:K,blocked_open:X"
// 追加到现有 reason 末尾,便于运维侧 `grep syscalls=open:` 检索。
//
// syscalls 缺失或为空时,reason 原样返回(向后兼容老 runtime 返回值)。
func appendSyscallSegment(reason string, syscalls map[string]any) string {
	if len(syscalls) == 0 {
		return reason
	}
	parts := []string{}
	for _, k := range []string{"open", "execve", "connect", "blocked_open"} {
		v, ok := syscalls[k]
		if !ok {
			continue
		}
		switch n := v.(type) {
		case float64:
			parts = append(parts, fmt.Sprintf("%s:%.0f", k, n))
		case int:
			parts = append(parts, fmt.Sprintf("%s:%d", k, n))
		}
	}
	if len(parts) == 0 {
		return reason
	}
	return reason + ";syscalls=" + strings.Join(parts, ",")
}