package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestRAGPublishedOnly(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/knowledge/retrieve", bytes.NewBufferString(`{"query":"发布"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("retrieve %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if strings.Contains(body, "发布检查清单") {
		t.Fatalf("unpublished doc leaked into retrieve: %s", body)
	}
}

func TestConnectRagRetrieve(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/connect/qzda.rag.v1.RagService/Retrieve",
		bytes.NewBufferString(`{"query":"缓存","correlationId":"corr-test-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("connect rag %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		OK   bool `json:"ok"`
		Data struct {
			CorrelationID string `json:"correlationId"`
			Results       []any  `json:"results"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil || !env.OK {
		t.Fatalf("envelope %s", rr.Body.String())
	}
	if env.Data.CorrelationID != "corr-test-1" {
		t.Fatalf("missing correlationId: %s", rr.Body.String())
	}
}

func TestModelRouteRestrictedEgressDenied(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/model-routing/policies",
		bytes.NewBufferString(`{"name":"bad","dataScope":"restricted","egressAllowed":true,"budgetLimitUsd":10}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("expected 403 egress blocked, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestCopilotStreamStages(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"hello","correlationId":"corr-stream-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, stage := range []string{"policy", "employee", "memory", "runtime", "meter", "route"} {
		if !strings.Contains(body, stage) {
			t.Fatalf("missing stage/event %s in SSE: %s", stage, body)
		}
	}
	if !strings.Contains(body, "corr-stream-1") {
		t.Fatalf("missing correlationId in SSE")
	}
	if !strings.Contains(body, `"ok":true`) {
		t.Fatalf("missing done ok in SSE: %s", body)
	}
	if !strings.Contains(body, `"snapshotId"`) {
		t.Fatalf("missing snapshotId in SSE: %s", body)
	}
}

func TestCopilotStreamPersistsUnderConversationID(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"persist-me","digitalPartnerId":"de-1","correlationId":"corr-persist-1","modelId":"sonnet-4"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	st.RLock()
	msgs := st.Messages["conv-1"]
	bad := st.Messages["conversations"]
	st.RUnlock()
	if len(bad) > 0 {
		t.Fatalf("messages incorrectly stored under key conversations: %d", len(bad))
	}
	if len(msgs) < 2 {
		t.Fatalf("expected persisted user+assistant under conv-1, got %d", len(msgs))
	}

	rr2 := httptest.NewRecorder()
	get := httptest.NewRequest(http.MethodGet, "/api/conversations/conv-1", nil)
	get.Header.Set("Authorization", "Bearer mock-admin-token")
	get.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr2, get)
	if rr2.Code != 200 {
		t.Fatalf("get conversation %d %s", rr2.Code, rr2.Body.String())
	}
	if !strings.Contains(rr2.Body.String(), "persist-me") {
		t.Fatalf("GET conversation missing user message: %s", rr2.Body.String())
	}
}

func TestDeleteSessionRemovesPersistedRecord(t *testing.T) {
	st := store.New()
	var deleted []string
	st.SetDeleteHook(func(_ context.Context, collection string, ids []string) error {
		if collection == "sessions" {
			deleted = append(deleted, ids...)
		}
		return nil
	})
	srv := server.New(st).Handler()

	create := httptest.NewRecorder()
	creq := httptest.NewRequest(http.MethodPost, "/api/sessions",
		strings.NewReader(`{"title":"to-delete","modelId":"mdl-local"}`))
	creq.Header.Set("Authorization", "Bearer mock-admin-token")
	creq.Header.Set("Content-Type", "application/json")
	creq.Header.Set("X-Workspace-Id", "w1")
	srv.ServeHTTP(create, creq)
	if create.Code != 200 {
		t.Fatalf("create %d %s", create.Code, create.Body.String())
	}
	var created struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(create.Body.Bytes(), &created)
	sessID, _ := created.Data["id"].(string)
	if sessID == "" {
		t.Fatalf("missing session id: %s", create.Body.String())
	}

	del := httptest.NewRecorder()
	dreq := httptest.NewRequest(http.MethodDelete, "/api/sessions/"+sessID, nil)
	dreq.Header.Set("Authorization", "Bearer mock-admin-token")
	dreq.Header.Set("X-Workspace-Id", "w1")
	srv.ServeHTTP(del, dreq)
	if del.Code != 200 {
		t.Fatalf("delete %d %s", del.Code, del.Body.String())
	}

	st.RLock()
	for _, sess := range st.Sessions {
		if id, _ := sess["id"].(string); id == sessID {
			st.RUnlock()
			t.Fatalf("session still present after delete")
		}
	}
	st.RUnlock()

	found := false
	for _, id := range deleted {
		if id == sessID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected PersistDeleteSync sessions id=%s got %v", sessID, deleted)
	}

	list := httptest.NewRecorder()
	lreq := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	lreq.Header.Set("Authorization", "Bearer mock-admin-token")
	lreq.Header.Set("X-Workspace-Id", "w1")
	srv.ServeHTTP(list, lreq)
	if strings.Contains(list.Body.String(), sessID) {
		t.Fatalf("list still contains deleted session: %s", list.Body.String())
	}
}

func TestCreateSessionAndApproveAction(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/sessions",
		bytes.NewBufferString(`{"title":"审批联调","digitalPartnerId":"de-1","digitalPartnerName":"故障自愈助手"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create session %d %s", rr.Code, rr.Body.String())
	}

	// approve seeded s1 message as admin (signer index 1)
	rr2 := httptest.NewRecorder()
	apr := httptest.NewRequest(http.MethodPost, "/api/actions/msg-s1-2/approve",
		bytes.NewBufferString(`{"signerIndex":1,"conversationId":"s1"}`))
	apr.Header.Set("Authorization", "Bearer mock-admin-token")
	apr.Header.Set("X-Workspace-Id", "w1")
	apr.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr2, apr)
	if rr2.Code != 200 {
		t.Fatalf("approve %d %s", rr2.Code, rr2.Body.String())
	}
	if !strings.Contains(rr2.Body.String(), `"completed":true`) {
		t.Fatalf("expected completed approve: %s", rr2.Body.String())
	}
}

func TestDeleteSessionRemovesAcrossMemberWorkspaceHeader(t *testing.T) {
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "1")
	st := store.New()
	now := "2026-08-19T12:00:00Z"
	st.Sessions = []map[string]any{
		{"id": "sess-del", "workspaceId": "w1", "ownerId": "u1", "conversationId": "conv-del", "title": "t", "updatedAt": now},
	}
	st.Conversations = []map[string]any{
		{"id": "conv-del", "workspaceId": "w1", "title": "t", "updatedAt": now},
	}
	st.Messages = map[string][]map[string]any{"conv-del": {{"id": "m1", "role": "user", "content": "hi"}}}
	h := server.New(st).Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/sessions/sess-del", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w2")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("cross-workspace delete %d %s", rr.Code, rr.Body.String())
	}
	st.RLock()
	defer st.RUnlock()
	if len(st.Sessions) != 0 || len(st.Conversations) != 0 {
		t.Fatalf("records remain sessions=%d conversations=%d", len(st.Sessions), len(st.Conversations))
	}
	if _, ok := st.Messages["conv-del"]; ok {
		t.Fatal("messages bucket still present")
	}
}

func TestGetConversationForbiddenForOtherOwner(t *testing.T) {
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "1")
	st := store.New()
	now := "2026-08-19T12:00:00Z"
	st.Conversations = []map[string]any{
		{"id": "conv-private", "workspaceId": "w1", "title": "私有", "updatedAt": now},
	}
	st.Sessions = []map[string]any{
		{"id": "sess-private", "workspaceId": "w1", "ownerId": "u9", "conversationId": "conv-private", "title": "私有", "updatedAt": now},
	}
	h := server.New(st).Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/conversations/conv-private", nil)
	req.Header.Set("Authorization", "Bearer mock-user-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("expected 403 got %d %s", rr.Code, rr.Body.String())
	}
}

func TestGetConversationRejectsCrossWorkspaceHeader(t *testing.T) {
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "1")
	st := store.New()
	now := "2026-08-19T12:00:00Z"
	st.Conversations = append(st.Conversations, map[string]any{
		"id": "conv-cross", "workspaceId": "w1", "title": "跨区可读", "updatedAt": now,
	})
	st.Sessions = append(st.Sessions, map[string]any{
		"id": "conv-cross", "workspaceId": "w1", "ownerId": "u1", "conversationId": "conv-cross",
		"title": "跨区可读", "updatedAt": now, "lastMessageAt": now, "status": "active",
	})
	st.Messages["conv-cross"] = []map[string]any{
		{"id": "msg-1", "role": "user", "content": "hello", "createdAt": now},
	}
	h := server.New(st).Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/conversations/conv-cross", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w2")
	h.ServeHTTP(rr, req)
	if rr.Code != 404 {
		t.Fatalf("cross-workspace get should 404, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestListSessionsFiltersByWorkspaceHeader(t *testing.T) {
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "1")
	st := store.New()
	now := "2026-08-19T12:00:00Z"
	st.Sessions = []map[string]any{
		{"id": "sess-w1", "workspaceId": "w1", "ownerId": "u1", "title": "w1", "updatedAt": now},
		{"id": "sess-w2", "workspaceId": "w2", "ownerId": "u1", "title": "w2", "updatedAt": now},
	}
	h := server.New(st).Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w2")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("list sessions %d %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "sess-w1") {
		t.Fatalf("w2 list must not include w1 session: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "sess-w2") {
		t.Fatalf("w2 list missing w2 session: %s", rr.Body.String())
	}
}

func TestCopilotStreamDefaultSegmented(t *testing.T) {
	h := server.New(store.New()).Handler()
	body := `{"content":"第一段足够长的内容用于分段测试，超过四十个字。\n---\n第二段同样足够长，用于验证默认分段。","correlationId":"corr-seg-default","firstMessageId":"msg-seg-def-0","modelId":"sonnet-4","digitalPartnerId":"de-1"}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-seg-default/stream", bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	sse := rr.Body.String()
	if !strings.Contains(sse, "message_start") {
		t.Fatalf("missing message_start in default segmented SSE: %s", sse)
	}
}

func TestCopilotStreamSegmentedMode(t *testing.T) {
	h := server.New(store.New()).Handler()
	body := `{"content":"第一段足够长的内容用于分段测试，超过四十个字。\n---\n第二段同样足够长，用于验证多气泡落库与 SSE。","correlationId":"corr-seg-1","replyMode":"segmented","firstMessageId":"msg-seg-0","modelId":"sonnet-4"}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-seg/stream", bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	sse := rr.Body.String()
	if !strings.Contains(sse, "message_start") {
		t.Fatalf("missing message_start in segmented SSE: %s", sse)
	}
	if !strings.Contains(sse, `"segmentCount"`) && !strings.Contains(sse, `"messageIds"`) {
		t.Fatalf("missing segment metadata in done: %s", sse)
	}
}

func TestCopilotStreamIdempotentMultiMessage(t *testing.T) {
	st := store.New()
	h := server.New(st).Handler()
	payload := `{"content":"hello","correlationId":"corr-idem-1","clientMsgId":"c-idem-1","replyMode":"segmented","firstMessageId":"msg-idem-0","modelId":"sonnet-4"}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-idem/stream", bytes.NewBufferString(payload))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("first stream %d %s", rr.Code, rr.Body.String())
	}

	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-idem/stream", bytes.NewBufferString(payload))
	req2.Header.Set("Authorization", "Bearer mock-admin-token")
	req2.Header.Set("X-Workspace-Id", "w1")
	req2.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr2, req2)
	if rr2.Code != 200 {
		t.Fatalf("idempotent stream %d %s", rr2.Code, rr2.Body.String())
	}
	if !strings.Contains(rr2.Body.String(), `"stage":"idempotent"`) {
		t.Fatalf("expected idempotent replay: %s", rr2.Body.String())
	}
	if !strings.Contains(rr2.Body.String(), "message_start") {
		t.Fatalf("idempotent replay should re-emit segments: %s", rr2.Body.String())
	}
}
