package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestRuntimeModeLocalDoesNotCallSidecar(t *testing.T) {
	var hits atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(503)
	}))
	t.Cleanup(ts.Close)

	t.Setenv("QZDA_RUNTIME_MODE", "local")
	st := store.New()
	srv := server.New(st)
	srv.RuntimeURL = ts.URL
	srv.RuntimeHTTP = ts.Client()
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"hello runtime local","correlationId":"corr-rt-local-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"ok":true`) {
		t.Fatalf("missing done: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"runtimeMode":"local"`) {
		t.Fatalf("missing runtimeMode local: %s", rr.Body.String())
	}
	if hits.Load() != 0 {
		t.Fatalf("local mode must not call sidecar, hits=%d", hits.Load())
	}
}

func TestRuntimeModeRemoteStreamsLoopEvents(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/run" {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: stage\ndata: {\"type\":\"stage\",\"stage\":\"runtime\",\"status\":\"running\"}\n\n"))
		_, _ = w.Write([]byte("event: delta\ndata: {\"type\":\"delta\",\"text\":\"remote-\"}\n\n"))
		_, _ = w.Write([]byte("event: delta\ndata: {\"type\":\"delta\",\"text\":\"loop\"}\n\n"))
		_, _ = w.Write([]byte("event: done\ndata: {\"type\":\"done\",\"text\":\"remote-loop\",\"mode\":\"direct\"}\n\n"))
	}))
	t.Cleanup(ts.Close)

	t.Setenv("QZDA_RUNTIME_MODE", "remote")
	st := store.New()
	srv := server.New(st)
	srv.RuntimeURL = ts.URL
	srv.RuntimeHTTP = ts.Client()
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"hello runtime remote","correlationId":"corr-rt-remote-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "remote-loop") && !strings.Contains(body, "remote-") {
		t.Fatalf("missing remote text: %s", body)
	}
	if !strings.Contains(body, `"runtimeMode":"remote"`) {
		t.Fatalf("missing runtimeMode remote: %s", body)
	}
	if !strings.Contains(body, `"ok":true`) {
		t.Fatalf("missing collab done: %s", body)
	}
}

func TestRuntimeModeRemoteUnavailable(t *testing.T) {
	t.Setenv("QZDA_RUNTIME_MODE", "remote")
	t.Setenv("QZDA_RUNTIME_FAILOVER_LOCAL", "0")
	st := store.New()
	srv := server.New(st)
	srv.RuntimeURL = "http://127.0.0.1:1"
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"runtime down","correlationId":"corr-rt-down-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("SSE still 200, got %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_RUNTIME_UNAVAILABLE") && !strings.Contains(rr.Body.String(), "不可达") {
		t.Fatalf("want runtime unavailable: %s", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), `"ok":true`) {
		t.Fatalf("must not succeed when remote is down: %s", rr.Body.String())
	}
}

func TestReplayDoesNotInvokeRuntime(t *testing.T) {
	var hits atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		http.Error(w, "should not be called", 500)
	}))
	t.Cleanup(ts.Close)

	t.Setenv("QZDA_RUNTIME_MODE", "local")
	st := store.New()
	srv := server.New(st)
	srv.RuntimeURL = ts.URL
	srv.RuntimeHTTP = ts.Client()
	h := srv.Handler()

	corr := "corr-rt-replay-1"
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"snapshot then replay","correlationId":"`+corr+`"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	before := hits.Load()

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/copilot/conversations/conv-1/turns/"+corr+"/replay", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("replay %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil || !env.OK {
		t.Fatalf("envelope %s", rr.Body.String())
	}
	if env.Data["replay"] != true {
		t.Fatalf("want replay true: %s", rr.Body.String())
	}
	if hits.Load() != before {
		t.Fatalf("replay invoked runtime: before=%d after=%d", before, hits.Load())
	}
}

func TestSkillSimDisabledInProduction(t *testing.T) {
	t.Setenv("QZDA_ENV", "production")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("QZDA_SANDBOX_TEST_SIM", "1")
	t.Setenv("QZDA_SANDBOX_RUNTIME_URL", "http://127.0.0.1:1")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/skills/sk-docx/test",
		bytes.NewBufferString(`{"command":"echo ok"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	body := rr.Body.String()
	if strings.Contains(body, "policy-sim") || strings.Contains(body, "+SIM") {
		t.Fatalf("production must not use skill sim: %s", body)
	}
	if rr.Code == 200 && !strings.Contains(body, `"status":"blocked"`) {
		t.Fatalf("production must fail closed when sandbox is down: %s", body)
	}
	if rr.Code != 200 && !strings.Contains(body, "E_RUNTIME_UNAVAILABLE") && !strings.Contains(body, "技能运行时不可用") {
		t.Fatalf("want runtime unavailable: %s", body)
	}
}

func TestRuntimeRemoteFailoverLocalDev(t *testing.T) {
	t.Setenv("QZDA_RUNTIME_MODE", "remote")
	t.Setenv("QZDA_RUNTIME_FAILOVER_LOCAL", "true")
	st := store.New()
	srv := server.New(st)
	srv.RuntimeURL = "http://127.0.0.1:1"
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"failover local","correlationId":"corr-rt-failover-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"ok":true`) {
		t.Fatalf("dev failover should succeed locally: %s", body)
	}
	if !strings.Contains(body, "failover") && !strings.Contains(body, `"runtimeMode":"local"`) {
		t.Fatalf("want failover/local marker: %s", body)
	}
}

func TestRuntimeRemoteNoFailoverInProduction(t *testing.T) {
	t.Setenv("QZDA_ENV", "production")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("QZDA_RUNTIME_MODE", "remote")
	t.Setenv("QZDA_RUNTIME_FAILOVER_LOCAL", "true")
	st := store.New()
	srv := server.New(st)
	srv.RuntimeURL = "http://127.0.0.1:1"
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"no prod failover","correlationId":"corr-rt-nofailover-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("SSE still 200, got %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "E_RUNTIME_UNAVAILABLE") && !strings.Contains(body, "不可达") {
		t.Fatalf("production must not failover: %s", body)
	}
	if strings.Contains(body, `"ok":true`) {
		t.Fatalf("must not succeed when remote is down in production: %s", body)
	}
}

func TestRagDegradesWhenSidecarDownInProduction(t *testing.T) {
	t.Setenv("QZDA_ENV", "production")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	st.Lock()
	st.KnowledgeDocs = append(st.KnowledgeDocs, map[string]any{
		"id": "kd-pub-rt-1", "workspaceId": "w1", "title": "缓存手册",
		"status": "published", "snippet": "Redis 缓存热点 key 处置",
	})
	st.Unlock()
	srv := server.New(st)
	srv.RAGURL = "http://127.0.0.1:1"
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/knowledge/retrieve",
		bytes.NewBufferString(`{"query":"缓存"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("degraded retrieve should still 200, got %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"degraded":true`) && !strings.Contains(body, "已降级") {
		t.Fatalf("want degraded rag: %s", body)
	}
	if !strings.Contains(body, "E_RUNTIME_UNAVAILABLE") && !strings.Contains(body, `"ok":true`) {
		t.Fatalf("want usable hits with code: %s", body)
	}
}

func TestRemoteRuntimeForwardsToolLoopEvents(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/run" {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: stage\ndata: {\"type\":\"stage\",\"stage\":\"runtime\",\"status\":\"running\"}\n\n"))
		_, _ = w.Write([]byte("event: tool\ndata: {\"type\":\"tool\",\"stage\":\"react\",\"name\":\"knowledge.retrieve\",\"status\":\"ok\"}\n\n"))
		_, _ = w.Write([]byte("event: delta\ndata: {\"type\":\"delta\",\"text\":\"parity-\"}\n\n"))
		_, _ = w.Write([]byte("event: delta\ndata: {\"type\":\"delta\",\"text\":\"ok\"}\n\n"))
		_, _ = w.Write([]byte("event: done\ndata: {\"type\":\"done\",\"text\":\"parity-ok\",\"mode\":\"direct\"}\n\n"))
	}))
	t.Cleanup(ts.Close)

	t.Setenv("QZDA_RUNTIME_MODE", "remote")
	st := store.New()
	srv := server.New(st)
	srv.RuntimeURL = ts.URL
	srv.RuntimeHTTP = ts.Client()
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"parity tool loop","correlationId":"corr-rt-parity-1","enabledTools":["knowledge.retrieve"]}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("stream %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"type":"tool"`) {
		t.Fatalf("remote must forward tool LoopEvent: %s", body)
	}
	if !strings.Contains(body, "parity-ok") {
		t.Fatalf("missing remote reply text: %s", body)
	}
	if !strings.Contains(body, `"snapshotId"`) {
		t.Fatalf("missing snapshotId: %s", body)
	}
	if !strings.Contains(body, `"ok":true`) {
		t.Fatalf("missing done: %s", body)
	}
}
