package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func sessionDo(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	r.Header.Set("Authorization", "Bearer mock-admin-token")
	r.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr
}

func TestTouchSessionMaterializesOrphan(t *testing.T) {
	st := store.New()
	st.Sessions = nil
	st.Conversations = nil
	st.Messages = map[string][]map[string]any{}
	st.Employees = []map[string]any{
		{"id": "de-5", "workspaceId": "w1", "name": "听风", "role": "人事专员"},
	}
	srv := New(st)
	now := time.Now().UTC().Format(time.RFC3339)

	st.Lock()
	srv.touchSessionLocked("w1", "conv-orphan", "conv-orphan", "输出招聘模版 docx", now, "mdl-1", "de-5", "u1")
	st.Unlock()

	if len(st.Sessions) != 1 {
		t.Fatalf("sessions=%d", len(st.Sessions))
	}
	sess := st.Sessions[0]
	if str(sess["id"]) != "conv-orphan" || str(sess["digitalPartnerId"]) != "de-5" {
		t.Fatalf("session=%v", sess)
	}
	if str(sess["title"]) == "" || str(sess["title"]) == "新会话" {
		t.Fatalf("expected auto title, got %q", str(sess["title"]))
	}
	if len(st.Conversations) != 1 {
		t.Fatalf("conversations=%d", len(st.Conversations))
	}
}

func TestPatchSession(t *testing.T) {
	st := store.New()
	st.Sessions = []map[string]any{
		{
			"id": "sess-a", "workspaceId": "w1", "ownerId": "u1", "title": "我的",
			"conversationId": "conv-a", "status": "active", "pinned": false,
		},
	}
	srv := New(st)
	h := srv.Handler()
	rr := sessionDo(t, h, http.MethodPatch, "/api/sessions/sess-a", `{"pinned":true,"title":"已置顶"}`)
	if rr.Code != 200 {
		t.Fatalf("patch status=%d body=%s", rr.Code, rr.Body.String())
	}
	st.RLock()
	defer st.RUnlock()
	for _, s := range st.Sessions {
		if str(s["id"]) != "sess-a" {
			continue
		}
		if !boolFrom(s["pinned"]) || str(s["title"]) != "已置顶" {
			t.Fatalf("session=%v", s)
		}
		return
	}
	t.Fatal("sess-a missing")
}

func TestDeleteSessionRemovesMemory(t *testing.T) {
	st := store.New()
	st.Sessions = []map[string]any{
		{"id": "sess-x", "workspaceId": "w1", "ownerId": "u1", "conversationId": "conv-x", "title": "t"},
	}
	st.Conversations = []map[string]any{
		{"id": "conv-x", "workspaceId": "w1"},
	}
	st.Messages = map[string][]map[string]any{"conv-x": {{"id": "m1", "role": "user", "content": "hi"}}}
	st.MemoryRecords = []map[string]any{
		{"id": "mem-1", "workspaceId": "w1", "sourceId": "conv-x", "layer": "short_term", "title": "会话上下文"},
		{"id": "mem-2", "workspaceId": "w1", "sourceId": "other", "layer": "short_term", "title": "其他"},
	}
	srv := New(st)
	h := srv.Handler()
	rr := sessionDo(t, h, http.MethodDelete, "/api/sessions/sess-x", "")
	if rr.Code != 200 {
		t.Fatalf("delete status=%d body=%s", rr.Code, rr.Body.String())
	}
	if len(st.Sessions) != 0 {
		t.Fatalf("sessions left=%d", len(st.Sessions))
	}
	if len(st.MemoryRecords) != 1 || str(st.MemoryRecords[0]["id"]) != "mem-2" {
		t.Fatalf("memory=%v", st.MemoryRecords)
	}
}
