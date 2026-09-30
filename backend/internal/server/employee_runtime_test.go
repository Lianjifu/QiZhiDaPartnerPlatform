package server

import (
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestComputeEmployeeRuntimeFromMemory(t *testing.T) {
	st := store.New()
	st.Employees = []map[string]any{
		{
			"id": "de-5", "workspaceId": "w4", "name": "听风", "role": "人事专员",
			"capabilities": map[string]any{"skills": []string{"docx"}},
			"runtime":      map[string]any{"calls24h": 0, "successRate": 0, "p95Ms": 0, "costToday": 0, "handoffs24h": 0, "anomalies": 0},
		},
	}
	now := time.Now().UTC()
	st.MemoryRecords = []map[string]any{
		{
			"id": "memory-1", "workspaceId": "w4", "digitalPartnerId": "de-5",
			"layer": "short_term", "status": "active", "title": "会话上下文 · @skill:docx 输出招聘模版",
			"content": "用户：输出文档\n助手：已生成", "sourceId": "conv-8",
			"createdAt": now.Add(-2 * time.Hour).Format(time.RFC3339),
		},
		{
			"id": "memory-2", "workspaceId": "w4", "digitalPartnerId": "de-5",
			"layer": "short_term", "status": "active", "title": "会话上下文 · 入职需要准备哪些材料？",
			"content": "用户：材料\n助手：清单", "sourceId": "conv-9",
			"createdAt": now.Add(-1 * time.Hour).Format(time.RFC3339),
		},
		{
			"id": "memory-dream", "workspaceId": "w4", "digitalPartnerId": "de-5",
			"layer": "working", "status": "active", "title": "Dream 压缩 · conv-8",
			"createdAt": now.Format(time.RFC3339),
		},
	}
	st.Skills = []map[string]any{
		{"id": "sk-docx", "workspaceId": "w4", "name": "docx", "lifecycleStatus": "enabled"},
	}
	st.SkillHealth = []map[string]any{
		{"id": "sh-sk-docx", "skillId": "sk-docx", "name": "docx", "status": "healthy", "calls24h": 2, "successRate": 100, "p95Ms": 40},
	}

	srv := New(st)
	st.RLock()
	rt := srv.computeEmployeeRuntimeLocked(st.Employees[0])
	ev := srv.realEmployeeEvidenceLocked(st.Employees[0], 10)
	st.RUnlock()

	if intFrom(rt["calls24h"]) < 2 {
		t.Fatalf("calls24h=%v want >=2 from memory", rt["calls24h"])
	}
	if floatFrom(rt["successRate"]) <= 0 {
		t.Fatalf("successRate=%v", rt["successRate"])
	}
	if intFrom(rt["p95Ms"]) < 40 {
		t.Fatalf("p95Ms=%v want skill health latency", rt["p95Ms"])
	}
	if len(ev) == 0 {
		t.Fatal("expected evidence from memory")
	}
}

func TestRecordEmployeeRuntime(t *testing.T) {
	st := store.New()
	st.Employees = []map[string]any{
		{
			"id": "de-5", "workspaceId": "w4", "name": "听风",
			"runtime": map[string]any{"calls24h": 0, "successRate": 0, "p95Ms": 0, "costToday": 0, "handoffs24h": 0, "anomalies": 0},
		},
	}
	srv := New(st)
	srv.recordEmployeeRuntime("de-5", 120, true)
	srv.recordEmployeeRuntime("de-5", 80, true)

	st.RLock()
	rt := asRuntimeMap(st.Employees[0]["runtime"])
	st.RUnlock()
	if intFrom(rt["recordedCalls24h"]) != 2 {
		t.Fatalf("recordedCalls24h=%v", rt["recordedCalls24h"])
	}
	if floatFrom(rt["successRate"]) != 1 {
		t.Fatalf("successRate=%v", rt["successRate"])
	}
}
