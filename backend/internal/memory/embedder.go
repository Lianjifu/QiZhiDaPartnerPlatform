// Package memory — RAG embedder client.
//
// 调 qzda-rag /v1/embed 拿 64-dim dense 向量(qzda-rag 内部 dense_embed
// 与 pgvector backend 同口径)。后续若启用真实 LLM embedder,这里
// 只需替换 HTTP target,接口不变。
package memory

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Embedder is the function-value Deps contract — Server wires it to
// (*memory.EmbedClient).Embed so this package stays HTTP-agnostic and
// testable with a stub.
type Embedder func(ctx context.Context, text string) ([]float32, error)

// EmbedClient is the qzda-rag HTTP client. Server builds it once in
// New() and binds (*EmbedClient).Embed into memory.Deps.
type EmbedClient struct {
	BaseURL string
	HTTP    *http.Client
}

// NewEmbedClient returns a client with sensible timeouts. baseURL
// defaults to QZDA_RAG_URL (typically http://127.0.0.1:8092) and
// falls back to loopback.
func NewEmbedClient(baseURL string) *EmbedClient {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "http://127.0.0.1:8092"
	}
	return &EmbedClient{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP:    &http.Client{Timeout: 5 * time.Second},
	}
}

// Embed returns the 64-dim dense vector for text. Empty text returns
// (nil, nil) so callers can skip the round-trip for no-op cases.
func (c *EmbedClient) Embed(ctx context.Context, text string) ([]float32, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	payload, _ := json.Marshal(map[string]string{"text": text})
	url := c.BaseURL + "/v1/embed"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("embed: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embed: call %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("embed: %s returned %d: %s", url, resp.StatusCode, string(body))
	}
	var out struct {
		Dim    int       `json:"dim"`
		Vector []float32 `json:"vector"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("embed: decode response: %w", err)
	}
	if out.Dim != 0 && out.Dim != 64 {
		return nil, fmt.Errorf("embed: dim mismatch (got %d, want 64)", out.Dim)
	}
	return out.Vector, nil
}
