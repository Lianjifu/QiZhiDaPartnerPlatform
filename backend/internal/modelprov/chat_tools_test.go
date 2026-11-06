package modelprov

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testTools() []ToolSchema {
	return []ToolSchema{{
		Name:        "knowledge.retrieve",
		Description: "检索已发布知识库",
		InputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{"query": map[string]any{"type": "string"}},
			"required":   []any{"query"},
		},
	}}
}

// TestBuildChatBodySendsToolsForOpenAICompatible covers the P3 request shape
// for OpenAI-compatible providers: tools are declared as function specs.
func TestBuildChatBodySendsToolsForOpenAICompatible(t *testing.T) {
	msgs := []ChatMessage{{Role: "user", Content: "查制度"}}
	body, _, err := buildChatBody("openai_compatible", "m", msgs, true, ChatRequest{Tools: testTools()})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		t.Fatal(err)
	}
	tools, _ := obj["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("tools missing: %s", body)
	}
	fn, _ := tools[0].(map[string]any)["function"].(map[string]any)
	if fn["name"] != "knowledge.retrieve" {
		t.Fatalf("tool name: %#v", fn)
	}
	if fn["parameters"] == nil {
		t.Fatalf("tool parameters missing: %#v", fn)
	}
}

// TestBuildChatBodySendsToolsForAnthropic covers the anthropic tool shape and
// the content-block round trip (assistant tool_use + user tool_result).
func TestBuildChatBodySendsToolsForAnthropic(t *testing.T) {
	msgs := []ChatMessage{
		{Role: "user", Content: "查制度"},
		{Role: "assistant", Content: "", ToolCalls: []ToolCall{{ID: "toolu_1", Name: "knowledge.retrieve", Arguments: json.RawMessage(`{"query":"制度"}`)}}},
		{Role: "user", ToolResults: []ToolResult{{ToolCallID: "toolu_1", Content: "片段 A"}}},
	}
	body, _, err := buildChatBody("anthropic", "m", msgs, true, ChatRequest{Tools: testTools()})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		t.Fatal(err)
	}
	tools, _ := obj["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("tools missing: %s", body)
	}
	if _, ok := tools[0].(map[string]any)["input_schema"]; !ok {
		t.Fatalf("anthropic tool must carry input_schema: %s", body)
	}
	msgsOut, _ := obj["messages"].([]any)
	if len(msgsOut) != 3 {
		t.Fatalf("want 3 messages, got %d: %s", len(msgsOut), body)
	}
	assistant, _ := msgsOut[1].(map[string]any)
	blocks, _ := assistant["content"].([]any)
	if len(blocks) != 1 {
		t.Fatalf("assistant blocks: %#v", assistant)
	}
	use, _ := blocks[0].(map[string]any)
	if use["type"] != "tool_use" || use["name"] != "knowledge.retrieve" {
		t.Fatalf("tool_use block: %#v", use)
	}
	input, _ := use["input"].(map[string]any)
	if input["query"] != "制度" {
		t.Fatalf("tool_use input: %#v", input)
	}
	user, _ := msgsOut[2].(map[string]any)
	userBlocks, _ := user["content"].([]any)
	if len(userBlocks) != 1 {
		t.Fatalf("user blocks: %#v", user)
	}
	res, _ := userBlocks[0].(map[string]any)
	if res["type"] != "tool_result" || res["tool_use_id"] != "toolu_1" {
		t.Fatalf("tool_result block: %#v", res)
	}
}

// TestBuildChatBodySplitsToolResultsForOpenAI covers the OpenAI shape:
// tool results become their own role:"tool" messages.
func TestBuildChatBodySplitsToolResultsForOpenAI(t *testing.T) {
	msgs := []ChatMessage{
		{Role: "user", Content: "查制度"},
		{Role: "assistant", ToolCalls: []ToolCall{{ID: "call_1", Name: "knowledge.retrieve", Arguments: json.RawMessage(`{"query":"x"}`)}}},
		{Role: "user", ToolResults: []ToolResult{{ToolCallID: "call_1", Content: "片段 A"}}},
	}
	body, _, err := buildChatBody("openai_compatible", "m", msgs, true, ChatRequest{Tools: testTools()})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		t.Fatal(err)
	}
	msgsOut, _ := obj["messages"].([]any)
	if len(msgsOut) != 3 {
		t.Fatalf("want 3 messages, got %d: %s", len(msgsOut), body)
	}
	toolMsg, _ := msgsOut[2].(map[string]any)
	if toolMsg["role"] != "tool" || toolMsg["tool_call_id"] != "call_1" {
		t.Fatalf("tool message: %#v", toolMsg)
	}
	assistant, _ := msgsOut[1].(map[string]any)
	calls, _ := assistant["tool_calls"].([]any)
	if len(calls) != 1 {
		t.Fatalf("assistant tool_calls missing: %s", body)
	}
}

// TestParseOpenAIStreamRestoresToolCalls covers the streaming reconstruction
// of tool calls from delta fragments.
func TestParseOpenAIStreamRestoresToolCalls(t *testing.T) {
	sse := strings.Join([]string{
		`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"knowledge.retrieve","arguments":""}}]}}]}`,
		`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\":"}}]}}]}`,
		`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"制度\"}"}}]}}]}`,
		`data: [DONE]`,
	}, "\n\n")
	out := make(chan ChatChunk, 8)
	if err := parseOpenAIStream(strings.NewReader(sse), out); err != nil {
		t.Fatal(err)
	}
	close(out)
	var calls []ToolCall
	for chunk := range out {
		calls = append(calls, chunk.ToolCalls...)
	}
	if len(calls) != 1 {
		t.Fatalf("want 1 tool call, got %#v", calls)
	}
	if calls[0].Name != "knowledge.retrieve" || calls[0].ID != "call_1" {
		t.Fatalf("tool call: %#v", calls[0])
	}
	var args map[string]any
	if err := json.Unmarshal(calls[0].Arguments, &args); err != nil {
		t.Fatalf("arguments: %v (%s)", err, calls[0].Arguments)
	}
	if args["query"] != "制度" {
		t.Fatalf("arguments: %#v", args)
	}
}

// TestParseAnthropicStreamRestoresToolCalls covers anthropic's
// content_block_start / input_json_delta / content_block_stop trio.
func TestParseAnthropicStreamRestoresToolCalls(t *testing.T) {
	sse := strings.Join([]string{
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"knowledge.retrieve","input":{}}}`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"制度\"}"}}`,
		`data: {"type":"content_block_stop","index":0}`,
	}, "\n\n")
	out := make(chan ChatChunk, 8)
	if err := parseAnthropicStream(strings.NewReader(sse), out); err != nil {
		t.Fatal(err)
	}
	close(out)
	var calls []ToolCall
	for chunk := range out {
		calls = append(calls, chunk.ToolCalls...)
	}
	if len(calls) != 1 {
		t.Fatalf("want 1 tool call, got %#v", calls)
	}
	if calls[0].ID != "toolu_1" || calls[0].Name != "knowledge.retrieve" {
		t.Fatalf("tool call: %#v", calls[0])
	}
	var args map[string]any
	if err := json.Unmarshal(calls[0].Arguments, &args); err != nil {
		t.Fatalf("arguments: %v (%s)", err, calls[0].Arguments)
	}
	if args["query"] != "制度" {
		t.Fatalf("arguments: %#v", args)
	}
}

// TestStreamChatFallsBackWhenProviderRejectsTools covers the transparent
// degradation: a provider that rejects the tools field must not break the
// conversation — the request is retried without tools.
func TestStreamChatFallsBackWhenProviderRejectsTools(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	var sawTools []bool
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var obj map[string]any
		_ = json.Unmarshal(raw, &obj)
		_, hasTools := obj["tools"]
		sawTools = append(sawTools, hasTools)
		if hasTools {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"tools is not supported"}}`))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"content":"你好"}}]}` + "\n\n" + `data: [DONE]` + "\n\n"))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	c := NewClient()
	c.HTTP = ts.Client()
	ch, err := c.StreamChat(context.Background(), ChatRequest{
		Protocol: "openai_compatible", BaseURL: ts.URL + "/v1", Model: "m",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
		Tools:    testTools(),
	})
	if err != nil {
		t.Fatalf("stream chat: %v", err)
	}
	var text string
	for chunk := range ch {
		if chunk.Err != nil {
			t.Fatalf("chunk error: %v", chunk.Err)
		}
		text += chunk.Text
	}
	if text != "你好" {
		t.Fatalf("text=%q", text)
	}
	if len(sawTools) != 2 || !sawTools[0] || sawTools[1] {
		t.Fatalf("expected one tools attempt then a retry without tools, got %#v", sawTools)
	}
}

// TestBuildChatBodyMarksPromptCachePoints covers the P4 prompt caching: the
// stable system prefix is marked as an ephemeral cache block for anthropic.
func TestBuildChatBodyMarksPromptCachePoints(t *testing.T) {
	msgs := []ChatMessage{
		{Role: "system", Content: "你是数字伙伴"},
		{Role: "user", Content: "查制度"},
	}
	body, _, err := buildChatBody("anthropic", "m", msgs, true, ChatRequest{CachePoints: []int{0}})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		t.Fatal(err)
	}
	sys, ok := obj["system"].([]any)
	if !ok || len(sys) != 1 {
		t.Fatalf("system must be a cacheable block list: %s", body)
	}
	block, _ := sys[0].(map[string]any)
	cc, _ := block["cache_control"].(map[string]any)
	if cc["type"] != "ephemeral" {
		t.Fatalf("cache_control missing: %s", body)
	}
}

// TestBuildChatBodyWithoutCachePointsKeepsPlainSystem makes sure caching is
// opt-in: without CachePoints the request shape is unchanged.
func TestBuildChatBodyWithoutCachePointsKeepsPlainSystem(t *testing.T) {
	msgs := []ChatMessage{
		{Role: "system", Content: "你是数字伙伴"},
		{Role: "user", Content: "查制度"},
	}
	body, _, err := buildChatBody("anthropic", "m", msgs, true, ChatRequest{})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		t.Fatal(err)
	}
	if _, ok := obj["system"].(string); !ok {
		t.Fatalf("system must stay a plain string: %s", body)
	}
}
