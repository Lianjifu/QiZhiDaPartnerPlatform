package modelprov

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// ToolSchema 描述一个可调用工具的调用契约(P2 能力契约的下发形态)。
//
// InputSchema 是 JSON Schema 子集:type / properties / required。
type ToolSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema,omitempty"`
}

// ToolCall 是模型发起的一次工具调用。
//
// Arguments 是 JSON 对象文本;modelprov 层已把各协议的差异归一,
// 调用方(copilot)只认这一种形状。
type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
}

// ToolResult 是工具执行结果,回填给模型。
type ToolResult struct {
	ToolCallID string `json:"tool_call_id"`
	Name       string `json:"name,omitempty"`
	Content    string `json:"content"`
	IsError    bool   `json:"is_error,omitempty"`
}

// ChatMessage is a single turn for chat completions.
//
// ToolCalls / ToolResults 是 P3 引入的结构化工具往返:
//   - assistant 消息带 ToolCalls 表示模型发起了工具调用
//   - user 消息带 ToolResults 表示工具执行结果回灌
//
// 各协议的具体形状(anthropic 的 content block、openai 的 role:"tool")
// 由 modelprov 在 buildChatBody 里归一,调用方不需要感知。
type ChatMessage struct {
	Role        string       `json:"role"`
	Content     string       `json:"content"`
	ToolCalls   []ToolCall   `json:"tool_calls,omitempty"`
	ToolResults []ToolResult `json:"tool_results,omitempty"`
}

// ChatRequest is a protocol-aware chat completion request.
type ChatRequest struct {
	Protocol   string
	BaseURL    string
	APIKey     string
	APIVersion string
	Deployment string
	Model      string
	Messages   []ChatMessage
	System     string
	Timeout    time.Duration
	// Tools 是下发给模型的工具契约。为空表示纯对话(旧行为不变)。
	Tools []ToolSchema
	// ParallelToolCalls 允许模型一轮内发起多个工具调用。
	ParallelToolCalls bool
	// ToolChoice: auto(默认) | none | required。
	ToolChoice string
	// CachePoints 标记需要做提示缓存的消息下标(P4 提示缓存)。
	CachePoints []int
}

// ChatChunk is one streamed text fragment.
//
// ToolCalls 承载流式过程中还原出的工具调用;文本与工具调用可以同批到达。
type ChatChunk struct {
	Text      string
	ToolCalls []ToolCall
	Done      bool
	Err       error
}

func chatTimeout(req ChatRequest) time.Duration {
	if req.Timeout > 0 {
		return req.Timeout
	}
	sec := 60
	if v := strings.TrimSpace(os.Getenv("QZDA_MODEL_CHAT_TIMEOUT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			sec = n
		}
	}
	return time.Duration(sec) * time.Second
}

func (c *Client) chatHTTP() *http.Client {
	// Streaming needs no overall Client.Timeout (or a long one); rely on context.
	return &http.Client{Timeout: 0}
}

// CompleteChat performs a non-streaming chat completion.
func (c *Client) CompleteChat(ctx context.Context, req ChatRequest) (string, error) {
	ch, err := c.StreamChat(ctx, req)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for chunk := range ch {
		if chunk.Err != nil {
			return b.String(), chunk.Err
		}
		b.WriteString(chunk.Text)
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		return "", fmt.Errorf("empty model response")
	}
	return out, nil
}

// StreamChat streams assistant text deltas. Channel is closed when finished.
//
// 当 req.Tools 非空但服务端不支持原生 tool_use 时,会自动降级为不带 tools
// 的普通请求(协议层透明回退),调用方无需感知 provider 差异。
func (c *Client) StreamChat(ctx context.Context, req ChatRequest) (<-chan ChatChunk, error) {
	req.Protocol = normalizeProtocol(req.Protocol)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	if req.Model == "" {
		return nil, fmt.Errorf("missing model")
	}
	msgs := req.Messages
	if req.System != "" {
		msgs = append([]ChatMessage{{Role: "system", Content: req.System}}, msgs...)
	}
	if len(msgs) == 0 {
		return nil, fmt.Errorf("missing messages")
	}
	req.Messages = msgs

	if req.Protocol == "embedded" {
		out := make(chan ChatChunk, 32)
		go func() {
			defer close(out)
			streamEmbedded(ctx, req, out)
		}()
		return out, nil
	}

	if req.BaseURL == "" {
		return nil, fmt.Errorf("missing baseUrl")
	}
	if err := ValidateBaseURL(req.BaseURL); err != nil {
		return nil, fmt.Errorf("ssrf: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, chatTimeout(req))
	url := JoinChatURL(req.Protocol, req.BaseURL, req.APIVersion, req.Deployment, req.Model)
	body, headers, err := buildChatBody(req.Protocol, req.Model, msgs, true, req)
	if err != nil {
		cancel()
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		cancel()
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream, application/json")
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}
	applyAuthHeaders(httpReq, req.Protocol, req.APIKey)

	res, err := c.chatHTTP().Do(httpReq)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("unreachable: %w", err)
	}

	// 原生 tool_use 不被支持时降级:去掉 tools 重发一次。
	if len(req.Tools) > 0 && res.StatusCode >= 400 && res.StatusCode < 500 {
		peek, _ := io.ReadAll(io.LimitReader(res.Body, 8<<10))
		res.Body.Close()
		if !errorsMentionTools(peek) {
			cancel()
			return nil, fmt.Errorf("bad status %d: %s", res.StatusCode, strings.TrimSpace(string(peek)))
		}
		noTools := req
		noTools.Tools = nil
		body2, headers2, err2 := buildChatBody(noTools.Protocol, noTools.Model, msgs, true, noTools)
		if err2 != nil {
			cancel()
			return nil, err2
		}
		httpReq2, err2 := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body2))
		if err2 != nil {
			cancel()
			return nil, err2
		}
		httpReq2.Header.Set("Content-Type", "application/json")
		httpReq2.Header.Set("Accept", "text/event-stream, application/json")
		for k, v := range headers2 {
			httpReq2.Header.Set(k, v)
		}
		applyAuthHeaders(httpReq2, noTools.Protocol, noTools.APIKey)
		res, err = c.chatHTTP().Do(httpReq2)
		if err != nil {
			cancel()
			return nil, fmt.Errorf("unreachable: %w", err)
		}
	}

	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		res.Body.Close()
		cancel()
		return nil, fmt.Errorf("auth: status %d: %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		res.Body.Close()
		cancel()
		return nil, fmt.Errorf("bad status %d: %s", res.StatusCode, strings.TrimSpace(string(b)))
	}

	out := make(chan ChatChunk, 32)
	go func() {
		defer close(out)
		defer cancel()
		defer res.Body.Close()
		ct := strings.ToLower(res.Header.Get("Content-Type"))
		var parseErr error
		switch {
		case req.Protocol == "anthropic":
			parseErr = parseAnthropicStream(res.Body, out)
		case req.Protocol == "ollama" && !strings.Contains(ct, "event-stream") && !strings.HasSuffix(url, "/chat/completions"):
			parseErr = parseOllamaStream(res.Body, out)
		case strings.Contains(ct, "event-stream") || strings.Contains(ct, "text/plain"):
			parseErr = parseOpenAIStream(res.Body, out)
		default:
			// Non-stream JSON fallback
			raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
			if err != nil {
				out <- ChatChunk{Err: err, Done: true}
				return
			}
			text, err := extractOpenAIContent(raw)
			if err != nil {
				// try anthropic non-stream
				if t2, e2 := extractAnthropicContent(raw); e2 == nil {
					out <- ChatChunk{Text: t2}
					out <- ChatChunk{Done: true}
					return
				}
				out <- ChatChunk{Err: err, Done: true}
				return
			}
			out <- ChatChunk{Text: text}
			if calls := extractOpenAIToolCalls(raw); len(calls) > 0 {
				out <- ChatChunk{ToolCalls: calls}
			}
			out <- ChatChunk{Done: true}
			return
		}
		if parseErr != nil {
			out <- ChatChunk{Err: parseErr, Done: true}
			return
		}
		out <- ChatChunk{Done: true}
	}()
	return out, nil
}

// errorsMentionTools 判断 4xx 响应体是否在抱怨 tools 字段。
// 只在这种情况下做无 tools 的降级重试,避免掩盖真实的鉴权/配额错误。
func errorsMentionTools(raw []byte) bool {
	s := strings.ToLower(string(raw))
	for _, k := range []string{"tool", "tools", "tool_choice", "function calling"} {
		if strings.Contains(s, k) {
			return true
		}
	}
	return false
}

// buildChatBody 组装各协议的请求体。
//
// 工具形状:
//   - anthropic: tools:[{name,description,input_schema}];assistant 用 tool_use
//     内容块,user 用 tool_result 内容块
//   - openai 兼容 / ollama: tools:[{type:"function",function:{name,description,parameters}}];
//     assistant 用 tool_calls,结果拆成 role:"tool" 的独立消息
func buildChatBody(protocol, model string, msgs []ChatMessage, stream bool, req ChatRequest) ([]byte, map[string]string, error) {
	headers := map[string]string{}
	switch normalizeProtocol(protocol) {
	case "anthropic":
		system := ""
		cacheIdx := map[int]bool{}
		for _, idx := range req.CachePoints {
			cacheIdx[idx] = true
		}
		var filtered []map[string]any
		for i, m := range msgs {
			if m.Role == "system" {
				if system == "" {
					system = m.Content
				} else {
					system += "\n" + m.Content
				}
				continue
			}
			if len(m.ToolResults) > 0 {
				blocks := make([]map[string]any, 0, len(m.ToolResults))
				for _, tr := range m.ToolResults {
					block := map[string]any{
						"type":        "tool_result",
						"tool_use_id": tr.ToolCallID,
						"content":     tr.Content,
					}
					if tr.IsError {
						block["is_error"] = true
					}
					blocks = append(blocks, block)
				}
				filtered = append(filtered, map[string]any{"role": "user", "content": blocks})
				continue
			}
			role := m.Role
			if role != "assistant" {
				role = "user"
			}
			if len(m.ToolCalls) > 0 {
				blocks := make([]map[string]any, 0, len(m.ToolCalls)+1)
				if m.Content != "" {
					blocks = append(blocks, map[string]any{"type": "text", "text": m.Content})
				}
				for _, tc := range m.ToolCalls {
					blocks = append(blocks, map[string]any{
						"type": "tool_use", "id": tc.ID, "name": tc.Name,
						"input": decodeArguments(tc.Arguments),
					})
				}
				filtered = append(filtered, map[string]any{"role": "assistant", "content": blocks})
				continue
			}
			if cacheIdx[i] {
				// 标记为缓存断点:该轮往后的内容可复用前缀缓存。
				filtered = append(filtered, map[string]any{"role": role, "content": []map[string]any{{
					"type": "text", "text": m.Content,
					"cache_control": map[string]any{"type": "ephemeral"},
				}}})
				continue
			}
			filtered = append(filtered, map[string]any{"role": role, "content": m.Content})
		}
		payload := map[string]any{
			"model": model, "messages": filtered, "max_tokens": 4096, "stream": stream,
		}
		if system != "" {
			// P4 提示缓存:system 是跨回合稳定前缀,标成 ephemeral 缓存块。
			if cacheIdx[0] {
				payload["system"] = []map[string]any{{
					"type": "text", "text": system,
					"cache_control": map[string]any{"type": "ephemeral"},
				}}
			} else {
				payload["system"] = system
			}
		}
		if tools := anthropicTools(req.Tools); len(tools) > 0 {
			payload["tools"] = tools
			if tc := strings.TrimSpace(req.ToolChoice); tc != "" && tc != "auto" {
				payload["tool_choice"] = map[string]any{"type": tc}
			}
		}
		b, err := json.Marshal(payload)
		return b, headers, err
	case "ollama":
		payload := map[string]any{
			"model": model, "messages": openAIMessages(msgs), "stream": stream,
		}
		if tools := openAITools(req.Tools); len(tools) > 0 {
			payload["tools"] = tools
		}
		b, err := json.Marshal(payload)
		return b, headers, err
	default:
		payload := map[string]any{
			"model": model, "messages": openAIMessages(msgs), "stream": stream, "temperature": 0.2,
		}
		if tools := openAITools(req.Tools); len(tools) > 0 {
			payload["tools"] = tools
			if req.ParallelToolCalls {
				payload["parallel_tool_calls"] = true
			}
			if tc := strings.TrimSpace(req.ToolChoice); tc != "" {
				payload["tool_choice"] = tc
			}
		}
		b, err := json.Marshal(payload)
		return b, headers, err
	}
}

// decodeArguments 把工具调用的参数 JSON 文本解成对象(失败则给空对象)。
func decodeArguments(raw json.RawMessage) map[string]any {
	out := map[string]any{}
	if len(raw) == 0 {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	return out
}

// anthropicTools 把能力契约转成 anthropic 的 tools 形状。
func anthropicTools(tools []ToolSchema) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		if strings.TrimSpace(t.Name) == "" {
			continue
		}
		schema := t.InputSchema
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		out = append(out, map[string]any{
			"name": t.Name, "description": t.Description, "input_schema": schema,
		})
	}
	return out
}

// openAITools 把能力契约转成 OpenAI 兼容的 tools 形状。
func openAITools(tools []ToolSchema) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		if strings.TrimSpace(t.Name) == "" {
			continue
		}
		params := t.InputSchema
		if params == nil {
			params = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		out = append(out, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name": t.Name, "description": t.Description, "parameters": params,
			},
		})
	}
	return out
}

// openAIMessages 把统一的消息结构转成 OpenAI 兼容的消息数组。
// 工具结果会拆成独立的 role:"tool" 消息(每个 tool_call_id 一条)。
func openAIMessages(msgs []ChatMessage) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		if len(m.ToolResults) > 0 {
			for _, tr := range m.ToolResults {
				out = append(out, map[string]any{
					"role": "tool", "tool_call_id": tr.ToolCallID, "content": tr.Content,
				})
			}
			continue
		}
		if len(m.ToolCalls) > 0 {
			calls := make([]map[string]any, 0, len(m.ToolCalls))
			for _, tc := range m.ToolCalls {
				calls = append(calls, map[string]any{
					"id": tc.ID, "type": "function",
					"function": map[string]any{
						"name": tc.Name, "arguments": string(tc.Arguments),
					},
				})
			}
			out = append(out, map[string]any{
				"role": m.Role, "content": m.Content, "tool_calls": calls,
			})
			continue
		}
		out = append(out, map[string]any{"role": m.Role, "content": m.Content})
	}
	return out
}

// toolCallAccumulator 聚合流式分片里的工具调用(按 index 归并)。
type toolCallAccumulator struct {
	order []int
	calls map[int]*ToolCall
	args  map[int][]byte
}

func newToolCallAccumulator() *toolCallAccumulator {
	return &toolCallAccumulator{calls: map[int]*ToolCall{}, args: map[int][]byte{}}
}

// add 吸收一个分片。index <0 表示没有 index(单次调用)。
func (a *toolCallAccumulator) add(index int, id, name string, argsFragment string) {
	if _, ok := a.calls[index]; !ok {
		a.order = append(a.order, index)
		a.calls[index] = &ToolCall{ID: id, Name: name}
	}
	if id != "" {
		a.calls[index].ID = id
	}
	if name != "" {
		a.calls[index].Name = name
	}
	if argsFragment != "" {
		a.args[index] = append(a.args[index], argsFragment...)
	}
}

// flush 归并出最终的工具调用列表。
func (a *toolCallAccumulator) flush() []ToolCall {
	if len(a.order) == 0 {
		return nil
	}
	out := make([]ToolCall, 0, len(a.order))
	for _, idx := range a.order {
		call := *a.calls[idx]
		if frag := a.args[idx]; len(frag) > 0 {
			call.Arguments = json.RawMessage(append([]byte(nil), frag...))
		}
		if call.ID == "" {
			call.ID = fmt.Sprintf("call_%d", idx)
		}
		out = append(out, call)
	}
	return out
}

func parseOpenAIStream(r io.Reader, out chan<- ChatChunk) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	acc := newToolCallAccumulator()
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			break
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(payload), &obj); err != nil {
			continue
		}
		choices, _ := obj["choices"].([]any)
		for _, c := range choices {
			cm, _ := c.(map[string]any)
			delta, _ := cm["delta"].(map[string]any)
			if t, ok := delta["content"].(string); ok && t != "" {
				out <- ChatChunk{Text: t}
			}
			collectOpenAIToolCalls(acc, delta["tool_calls"])
			// non-stream chunk in stream wrapper
			if msg, ok := cm["message"].(map[string]any); ok {
				if t, ok := msg["content"].(string); ok && t != "" {
					out <- ChatChunk{Text: t}
				}
				collectOpenAIToolCalls(acc, msg["tool_calls"])
			}
		}
	}
	if calls := acc.flush(); len(calls) > 0 {
		out <- ChatChunk{ToolCalls: calls}
	}
	return sc.Err()
}

// collectOpenAIToolCalls 吸收 OpenAI 的 tool_calls 分片。
func collectOpenAIToolCalls(acc *toolCallAccumulator, raw any) {
	items, _ := raw.([]any)
	for i, item := range items {
		m, _ := item.(map[string]any)
		if m == nil {
			continue
		}
		index := i
		if v, ok := m["index"].(float64); ok {
			index = int(v)
		}
		id, _ := m["id"].(string)
		fn, _ := m["function"].(map[string]any)
		name, _ := fn["name"].(string)
		args, _ := fn["arguments"].(string)
		acc.add(index, id, name, args)
	}
}

func parseAnthropicStream(r io.Reader, out chan<- ChatChunk) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	acc := newToolCallAccumulator()
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(payload), &obj); err != nil {
			continue
		}
		typ, _ := obj["type"].(string)
		switch typ {
		case "content_block_delta":
			delta, _ := obj["delta"].(map[string]any)
			if t, ok := delta["text"].(string); ok && t != "" {
				out <- ChatChunk{Text: t}
			}
			if dtyp, _ := delta["type"].(string); dtyp == "input_json_delta" {
				partial, _ := delta["partial_json"].(string)
				index := 0
				if v, ok := obj["index"].(float64); ok {
					index = int(v)
				}
				acc.add(index, "", "", partial)
			}
		case "content_block_start":
			block, _ := obj["content_block"].(map[string]any)
			if btyp, _ := block["type"].(string); btyp == "tool_use" {
				index := 0
				if v, ok := obj["index"].(float64); ok {
					index = int(v)
				}
				id, _ := block["id"].(string)
				name, _ := block["name"].(string)
				acc.add(index, id, name, "")
				if input, ok := block["input"].(map[string]any); ok && len(input) > 0 {
					if b, err := json.Marshal(input); err == nil {
						acc.add(index, "", "", string(b))
					}
				}
			}
		}
	}
	if calls := acc.flush(); len(calls) > 0 {
		out <- ChatChunk{ToolCalls: calls}
	}
	return sc.Err()
}

func parseOllamaStream(r io.Reader, out chan<- ChatChunk) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	acc := newToolCallAccumulator()
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(line), &obj); err != nil {
			continue
		}
		if msg, ok := obj["message"].(map[string]any); ok {
			if t, ok := msg["content"].(string); ok && t != "" {
				out <- ChatChunk{Text: t}
			}
			collectOpenAIToolCalls(acc, msg["tool_calls"])
		}
		if obj["done"] == true {
			break
		}
	}
	if calls := acc.flush(); len(calls) > 0 {
		out <- ChatChunk{ToolCalls: calls}
	}
	return sc.Err()
}

func extractOpenAIContent(raw []byte) (string, error) {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return "", err
	}
	choices, _ := obj["choices"].([]any)
	if len(choices) == 0 {
		return "", fmt.Errorf("no choices")
	}
	cm, _ := choices[0].(map[string]any)
	msg, _ := cm["message"].(map[string]any)
	if t, ok := msg["content"].(string); ok && t != "" {
		return t, nil
	}
	if t, ok := cm["text"].(string); ok && t != "" {
		return t, nil
	}
	return "", fmt.Errorf("empty content")
}

// extractOpenAIToolCalls 从非流式响应里取出工具调用。
func extractOpenAIToolCalls(raw []byte) []ToolCall {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	choices, _ := obj["choices"].([]any)
	if len(choices) == 0 {
		return nil
	}
	cm, _ := choices[0].(map[string]any)
	msg, _ := cm["message"].(map[string]any)
	acc := newToolCallAccumulator()
	collectOpenAIToolCalls(acc, msg["tool_calls"])
	return acc.flush()
}

func extractAnthropicContent(raw []byte) (string, error) {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return "", err
	}
	blocks, _ := obj["content"].([]any)
	var b strings.Builder
	for _, block := range blocks {
		m, _ := block.(map[string]any)
		if str, _ := m["type"].(string); str == "text" {
			if t, ok := m["text"].(string); ok {
				b.WriteString(t)
			}
		}
	}
	if b.Len() == 0 {
		return "", fmt.Errorf("empty anthropic content")
	}
	return b.String(), nil
}

// EnvFallbackRequest builds a ChatRequest from QZDA_LLM_* when providers are unavailable.
func EnvFallbackRequest(prompt string) (ChatRequest, bool) {
	base := strings.TrimSpace(os.Getenv("QZDA_LLM_BASE_URL"))
	if base == "" {
		return ChatRequest{}, false
	}
	model := strings.TrimSpace(os.Getenv("QZDA_LLM_MODEL"))
	if model == "" {
		model = "gpt-4o-mini"
	}
	return ChatRequest{
		Protocol: "openai_compatible",
		BaseURL:  base,
		APIKey:   strings.TrimSpace(os.Getenv("QZDA_LLM_API_KEY")),
		Model:    model,
		System:   "You are a digital-employee runtime assistant for enterprise SRE/collaboration.",
		Messages: []ChatMessage{{Role: "user", Content: prompt}},
	}, true
}
