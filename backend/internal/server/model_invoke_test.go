package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
)

func TestJoinChatURL(t *testing.T) {
	u := modelprov.JoinChatURL("azure_openai", "https://x.openai.azure.com", "2024-10-21", "gpt-4o", "gpt-4o")
	if !strings.Contains(u, "/openai/deployments/gpt-4o/chat/completions") {
		t.Fatalf("azure url: %s", u)
	}
	u = modelprov.JoinChatURL("openai_compatible", "https://api.openai.com/v1", "", "", "gpt-4o-mini")
	if u != "https://api.openai.com/v1/chat/completions" {
		t.Fatalf("openai url: %s", u)
	}
}

func TestStreamChatOpenAICompatible(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	client := modelprov.NewClient()
	ch, err := client.StreamChat(context.Background(), modelprov.ChatRequest{
		Protocol: "openai_compatible",
		BaseURL:  ts.URL + "/v1",
		APIKey:   "sk-test",
		Model:    "gpt-test",
		Messages: []modelprov.ChatMessage{{Role: "user", Content: "hi"}},
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	for c := range ch {
		if c.Err != nil {
			t.Fatal(c.Err)
		}
		b.WriteString(c.Text)
	}
	if b.String() != "Hello world" {
		t.Fatalf("got %q", b.String())
	}
}

func TestResolveCopilotModelIDPrefersEmployeeBinding(t *testing.T) {
	emp := map[string]any{
		"active":       true,
		"capabilities": map[string]any{"model": "企业通用路由 v2"},
	}
	if got := resolveCopilotModelID("sonnet-4", emp); got != "企业通用路由 v2" {
		t.Fatalf("want employee route, got %s", got)
	}
	if got := resolveCopilotModelID("mdl-6", emp); got != "mdl-6" {
		t.Fatalf("explicit run config should win, got %s", got)
	}
}

func TestListResolvedTurnsByRouteName(t *testing.T) {
	st := store.New()
	srv := New(st)
	turns := srv.listResolvedTurns(context.Background(), "w1", "企业通用路由 v2")
	if len(turns) == 0 {
		t.Fatal("expected route name to resolve to primary model")
	}
	if turns[0].ModelID != "mdl-gpt4" && turns[0].ModelName != "gpt-4o" {
		t.Fatalf("want gpt-4o/mdl-gpt4, got id=%s name=%s", turns[0].ModelID, turns[0].ModelName)
	}
}

func TestResolveModelAliasToPublishedRoute(t *testing.T) {
	st := store.New()
	srv := New(st)
	srv.Vault = vault.NewFromEnv()
	_ = srv.Vault.Put(context.Background(), "vault://model-providers/mp-1/credential", "sk-live-test")

	// Ensure published P0 points at mdl-gpt4
	st.Lock()
	for i, p := range st.RoutingPolicies {
		if str(p["id"]) == "rp-p0" {
			p["status"] = "published"
			p["primaryModelId"] = "mdl-gpt4"
			st.RoutingPolicies[i] = p
		}
	}
	st.Unlock()

	rt, err := srv.resolveModelForTurn(context.Background(), "w1", "sonnet-4")
	if err != nil {
		t.Fatal(err)
	}
	if rt.ModelID != "mdl-gpt4" {
		t.Fatalf("want mdl-gpt4 got %s source=%s", rt.ModelID, rt.Source)
	}
	if rt.Request.APIKey != "sk-live-test" {
		t.Fatalf("vault key not resolved")
	}
}

func seedLocalChatProvider(st *store.Store, baseURL string) {
	st.Lock()
	st.ModelProviders = []map[string]any{
		{
			"id": "mp-local", "workspaceId": "w1", "name": "Local", "protocol": "openai_compatible",
			"baseUrl": baseURL + "/v1", "status": "active",
			"credentialRef": "vault://model-providers/mp-local/credential",
			"models": []map[string]any{
				{"id": "mdl-local", "providerId": "mp-local", "name": "local-chat", "status": "available", "capabilities": []string{"chat"}},
			},
		},
	}
	st.RoutingPolicies = []map[string]any{
		{"id": "rp-local", "workspaceId": "w1", "level": "P0", "primaryModelId": "mdl-local", "status": "published", "fallbackModelIds": []string{}},
	}
	st.Unlock()
}

func TestModelInvokeStreamHandler(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	muxProvider := http.NewServeMux()
	muxProvider.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "pong-from-llm"}}},
		})
	})
	ts := httptest.NewServer(muxProvider)
	defer ts.Close()

	st := store.New()
	seedLocalChatProvider(st, ts.URL)

	srv := New(st)
	srv.Vault = vault.NewFromEnv()
	_ = srv.Vault.Put(context.Background(), "vault://model-providers/mp-local/credential", "sk-x")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/model-invoke/stream",
		strings.NewReader(`{"content":"ping","modelId":"mdl-local","workspaceId":"w1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Workspace-Id", "w1")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "pong-from-llm") {
		t.Fatalf("missing llm text: %s", rr.Body.String())
	}
}

func TestCopilotStreamUsesModelInvoke(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	muxProvider := http.NewServeMux()
	muxProvider.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"真实回复\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	})
	ts := httptest.NewServer(muxProvider)
	defer ts.Close()

	st := store.New()
	seedLocalChatProvider(st, ts.URL)

	srv := New(st)
	srv.Mode = ModeAll // local resolve, no Cap hop
	srv.Vault = vault.NewFromEnv()
	_ = srv.Vault.Put(context.Background(), "vault://model-providers/mp-local/credential", "sk-x")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		strings.NewReader(`{"content":"hello","modelId":"mdl-local","digitalPartnerId":"de-1","correlationId":"corr-llm"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Workspace-Id", "w1")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "真实回复") {
		t.Fatalf("missing real llm delta: %s", body)
	}
	if strings.Contains(body, "runtime stub") {
		t.Fatalf("still using stub: %s", body)
	}
	if strings.Contains(body, `"status":"degraded"`) {
		t.Fatalf("runtime degraded: %s", body)
	}
}

func TestCopilotStreamEmbeddedFallback(t *testing.T) {
	t.Setenv("QZDA_EMBEDDED_CHAT", "1")
	t.Setenv("QZDA_MODEL_CANDIDATE_TIMEOUT", "1")
	st := store.New()
	st.Lock()
	st.ModelProviders = nil // force embedded path
	st.RoutingPolicies = nil
	st.Unlock()
	srv := New(st)
	srv.Mode = ModeAll

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-emb/stream",
		strings.NewReader(`{"content":"你是使用什么大模型？","modelId":"sonnet-4","digitalPartnerId":"de-1","correlationId":"corr-emb"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Workspace-Id", "w1")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if strings.Contains(body, "runtime stub") {
		t.Fatalf("still stub: %s", body)
	}
	if strings.Contains(body, `"type":"error"`) && strings.Contains(body, `"stage":"runtime"`) {
		t.Fatalf("runtime error: %s", body)
	}
	if !strings.Contains(body, "local-chat") && !strings.Contains(body, "embedded") && !strings.Contains(body, "内置对话") && !strings.Contains(body, "可以协助") {
		t.Fatalf("expected local conversational reply: %s", body)
	}
}

func TestCopilotStreamAllowsMissingEmployee(t *testing.T) {
	t.Setenv("QZDA_EMBEDDED_CHAT", "1")
	t.Setenv("QZDA_MODEL_CANDIDATE_TIMEOUT", "1")
	st := store.New()
	st.Lock()
	st.ModelProviders = nil
	st.RoutingPolicies = nil
	st.Unlock()
	srv := New(st)
	srv.Mode = ModeAll

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-no-de/stream",
		strings.NewReader(`{"content":"hello-no-de","modelId":"sonnet-4","correlationId":"corr-no-de"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Workspace-Id", "w1")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if strings.Contains(body, "未找到数字伙伴") {
		t.Fatalf("should not fail on missing employee: %s", body)
	}
	if strings.Contains(body, `"type":"error"`) && strings.Contains(body, `"stage":"employee"`) {
		t.Fatalf("employee stage should not error: %s", body)
	}
	if strings.Contains(body, "runtime stub") {
		t.Fatalf("still stub: %s", body)
	}
}

func TestResolveActiveEmployeeEmptySkipped(t *testing.T) {
	st := store.New()
	srv := New(st)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Workspace-Id", "w1")
	out, err := srv.resolveActiveEmployee(req, "")
	if err != nil {
		t.Fatal(err)
	}
	m := out.(map[string]any)
	if m["skipped"] != true {
		t.Fatalf("want skipped, got %#v", m)
	}
}

