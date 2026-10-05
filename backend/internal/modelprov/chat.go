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

// ChatMessage is a single turn for chat completions.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
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
}

// ChatChunk is one streamed text fragment.
type ChatChunk struct {
	Text string
	Done bool
	Err  error
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
	body, headers, err := buildChatBody(req.Protocol, req.Model, msgs, true)
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

func buildChatBody(protocol, model string, msgs []ChatMessage, stream bool) ([]byte, map[string]string, error) {
	headers := map[string]string{}
	switch normalizeProtocol(protocol) {
	case "anthropic":
		system := ""
		var filtered []map[string]string
		for _, m := range msgs {
			if m.Role == "system" {
				if system == "" {
					system = m.Content
				} else {
					system += "\n" + m.Content
				}
				continue
			}
			role := m.Role
			if role != "assistant" {
				role = "user"
			}
			filtered = append(filtered, map[string]string{"role": role, "content": m.Content})
		}
		payload := map[string]any{
			"model": model, "messages": filtered, "max_tokens": 4096, "stream": stream,
		}
		if system != "" {
			payload["system"] = system
		}
		b, err := json.Marshal(payload)
		return b, headers, err
	case "ollama":
		// Prefer OpenAI-compatible if caller used /v1 base; native otherwise uses same JSON shape for /api/chat
		payload := map[string]any{
			"model": model, "messages": msgs, "stream": stream,
		}
		b, err := json.Marshal(payload)
		return b, headers, err
	default:
		payload := map[string]any{
			"model": model, "messages": msgs, "stream": stream, "temperature": 0.2,
		}
		b, err := json.Marshal(payload)
		return b, headers, err
	}
}

func parseOpenAIStream(r io.Reader, out chan<- ChatChunk) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
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
			return nil
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
			// non-stream chunk in stream wrapper
			if msg, ok := cm["message"].(map[string]any); ok {
				if t, ok := msg["content"].(string); ok && t != "" {
					out <- ChatChunk{Text: t}
				}
			}
		}
	}
	return sc.Err()
}

func parseAnthropicStream(r io.Reader, out chan<- ChatChunk) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
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
		if str, _ := obj["type"].(string); str == "content_block_delta" {
			delta, _ := obj["delta"].(map[string]any)
			if t, ok := delta["text"].(string); ok && t != "" {
				out <- ChatChunk{Text: t}
			}
		}
	}
	return sc.Err()
}

func parseOllamaStream(r io.Reader, out chan<- ChatChunk) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
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
		}
		if obj["done"] == true {
			return nil
		}
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
