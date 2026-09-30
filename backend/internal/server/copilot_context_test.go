package server

import (
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestAssembleCopilotChatMessages_IncludesPriorTurns(t *testing.T) {
	stored := []map[string]any{
		{"role": "user", "content": "入职需要哪些材料？"},
		{"role": "assistant", "content": "身份证、学历证、离职证明。", "toolCalls": []map[string]any{
			{"name": "knowledge.retrieve", "status": "success"},
		}},
		{"role": "user", "content": "按刚才的清单帮我写催办话术"},
	}
	msgs := assembleCopilotChatMessages(stored)
	if len(msgs) != 3 {
		t.Fatalf("want 3 messages, got %d %#v", len(msgs), msgs)
	}
	if msgs[0].Role != "user" || !strings.Contains(msgs[0].Content, "入职") {
		t.Fatalf("first user: %#v", msgs[0])
	}
	if msgs[1].Role != "assistant" || !strings.Contains(msgs[1].Content, "身份证") {
		t.Fatalf("assistant: %#v", msgs[1])
	}
	if !strings.Contains(msgs[1].Content, "knowledge.retrieve") {
		t.Fatalf("assistant should carry tool summary: %#v", msgs[1])
	}
	if msgs[2].Content != "按刚才的清单帮我写催办话术" {
		t.Fatalf("current user: %#v", msgs[2])
	}
}

func TestAssembleCopilotChatMessages_WindowsLongHistory(t *testing.T) {
	stored := make([]map[string]any, 0, 20)
	for i := 0; i < 20; i++ {
		stored = append(stored, map[string]any{"role": "user", "content": "u" + string(rune('a'+i%26))})
		stored = append(stored, map[string]any{"role": "assistant", "content": "a" + string(rune('a'+i%26))})
	}
	// 20 pairs = 40 messages; window keeps last copilotHistoryMaxMessages
	msgs := assembleCopilotChatMessages(stored)
	if len(msgs) != copilotHistoryMaxMessages {
		t.Fatalf("want window %d, got %d", copilotHistoryMaxMessages, len(msgs))
	}
}

func TestAssembleCopilotChatMessages_ToolResultInSummary(t *testing.T) {
	stored := []map[string]any{
		{"role": "assistant", "content": "已查询资产", "toolCalls": []map[string]any{
			{"name": "cmdb-tool", "status": "success", "result": "prod-redis-01 · PRD-CACHE-019"},
		}},
		{"role": "user", "content": "刚才那个资产负责人是谁"},
	}
	msgs := assembleCopilotChatMessages(stored)
	if len(msgs) != 2 {
		t.Fatalf("got %d msgs", len(msgs))
	}
	if !strings.Contains(msgs[0].Content, "prod-redis-01") {
		t.Fatalf("tool result missing from history: %#v", msgs[0])
	}
}

func TestFilterRegistrySkipMemoryRecall(t *testing.T) {
	reg := []registeredTool{
		{Key: "builtin:memory.recall", Name: "memory.recall", Enabled: true},
		{Key: "builtin:knowledge.retrieve", Name: "knowledge.retrieve", Enabled: true},
	}
	out := filterRegistrySkipMemoryRecall(reg, true)
	if out[0].Enabled {
		t.Fatal("memory.recall should be disabled when prefetched")
	}
	if !out[1].Enabled {
		t.Fatal("knowledge.retrieve should stay enabled")
	}
}

func TestShouldIngestTurnMemory(t *testing.T) {
	if !shouldIngestTurnMemory(nil, "hi", "ok", nil) {
		t.Fatal("first turn should ingest")
	}
	stored := make([]map[string]any, 7)
	if shouldIngestTurnMemory(stored, "短", "短", nil) {
		t.Fatal("short chitchat mid-session should skip")
	}
	if !shouldIngestTurnMemory(stored, "x", "y", []map[string]any{{"name": "tool"}}) {
		t.Fatal("tool turn should ingest")
	}
}

func TestBuildCopilotSystemPrompt_SeparatesMemoryAndKnowledge(t *testing.T) {
	emp := map[string]any{"name": "听风", "role": "人事专员", "department": "人事部", "active": true}
	rag := map[string]any{"results": []map[string]any{
		{"title": "入职手册", "snippet": "需携带身份证"},
	}}
	mem := []memoryHit{{Title: "偏好", Content: "用户偏好邮件催办", Layer: "working", Score: 0.9}}
	prompt := buildCopilotSystemPrompt(emp, rag, mem)
	if !strings.Contains(prompt, "跨会话记忆") {
		t.Fatalf("missing memory section: %s", prompt)
	}
	if !strings.Contains(prompt, "已发布知识") {
		t.Fatalf("missing knowledge section: %s", prompt)
	}
	if !strings.Contains(prompt, "用户偏好邮件催办") || !strings.Contains(prompt, "需携带身份证") {
		t.Fatalf("content missing: %s", prompt)
	}
	idxMem := strings.Index(prompt, "跨会话记忆")
	idxRag := strings.Index(prompt, "已发布知识")
	if idxMem < 0 || idxRag < 0 || idxMem > idxRag {
		t.Fatalf("memory should appear before knowledge: %s", prompt)
	}
}

func TestRetrieveMemoryForTurn_SkipsCurrentConversationShortTerm(t *testing.T) {
	st := store.New()
	s := New(st)
	now := time.Now().UTC().Format(time.RFC3339)
	st.Lock()
	st.MemoryRecords = []map[string]any{
		{
			"id": "m1", "workspaceId": "w1", "ownerId": "u1", "digitalPartnerId": "de-5",
			"layer": "short_term", "scope": "user", "status": "active",
			"title": "本会话", "content": "用户：本会话内容\n助手：回复",
			"sourceId": "conv-current", "createdAt": now, "updatedAt": now,
			"expiresAt": time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339),
		},
		{
			"id": "m2", "workspaceId": "w1", "ownerId": "u1", "digitalPartnerId": "de-5",
			"layer": "working", "scope": "team", "status": "active",
			"title": "催办偏好", "content": "用户喜欢邮件催办入职材料",
			"sourceId": "conv-old", "createdAt": now, "updatedAt": now,
			"expiresAt": time.Now().UTC().Add(30 * 24 * time.Hour).Format(time.RFC3339),
		},
	}
	hits := s.retrieveMemoryForTurnLocked("w1", "u1", "de-5", "conv-current", "入职材料催办", &auth.Identity{ID: "u1", Role: "user"})
	st.Unlock()
	if len(hits) != 1 {
		t.Fatalf("want 1 working hit, got %#v", hits)
	}
	if hits[0].Title != "催办偏好" {
		t.Fatalf("unexpected hit %#v", hits[0])
	}
}

func TestCitationsFromRagHits(t *testing.T) {
	cites := citationsFromRagHits(map[string]any{
		"results": []map[string]any{
			{"docId": "kd-1", "title": "手册", "snippet": "身份证", "score": 0.9},
		},
	})
	if len(cites) != 1 || str(cites[0]["docId"]) != "kd-1" {
		t.Fatalf("%#v", cites)
	}
}
