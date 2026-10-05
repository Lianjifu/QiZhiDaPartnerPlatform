package modelprov

import (
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

// ProbeResult is the outcome of a provider connectivity check.
type ProbeResult struct {
	Healthy    bool
	LatencyMS  int64
	StatusCode int
	Detail     string
}

// DiscoverResult matches FE/Mock discover-models response.
type DiscoverResult struct {
	Protocol      string              `json:"protocol"`
	BaseURL       string              `json:"baseUrl"`
	Models        []map[string]string `json:"models"`
	FetchedAt     string              `json:"fetchedAt"`
	Source        string              `json:"source"` // remote | catalog
	ResolvedURL   string              `json:"resolvedUrl,omitempty"`
	SuggestedProt string              `json:"suggestedProtocol,omitempty"`
}

// Client performs outbound probe/discover against model provider endpoints.
type Client struct {
	HTTP    *http.Client
	Timeout time.Duration
}

func NewClient() *Client {
	sec := 8
	if v := strings.TrimSpace(os.Getenv("QZDA_MODEL_PROBE_TIMEOUT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			sec = n
		}
	}
	to := time.Duration(sec) * time.Second
	return &Client{
		Timeout: to,
		HTTP:    &http.Client{Timeout: to},
	}
}

func (c *Client) httpClient() *http.Client {
	if c != nil && c.HTTP != nil {
		return c.HTTP
	}
	return NewClient().HTTP
}

func (c *Client) timeout() time.Duration {
	if c != nil && c.Timeout > 0 {
		return c.Timeout
	}
	return 8 * time.Second
}

// Probe verifies credential + endpoint reachability for a protocol.
func (c *Client) Probe(ctx context.Context, protocol, baseURL, apiKey, apiVersion, deployment string) (ProbeResult, error) {
	_ = deployment
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return ProbeResult{}, fmt.Errorf("missing baseUrl")
	}
	if err := ValidateBaseURL(baseURL); err != nil {
		return ProbeResult{}, fmt.Errorf("ssrf: %w", err)
	}
	protocol = normalizeProtocol(protocol)
	start := time.Now()
	var last ProbeResult
	var lastErr error
	for _, path := range DiscoverCandidates(protocol, baseURL, apiVersion) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, path, nil)
		if err != nil {
			lastErr = err
			continue
		}
		applyAuthHeaders(req, protocol, apiKey)
		res, err := c.httpClient().Do(req)
		latency := time.Since(start).Milliseconds()
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded || strings.Contains(err.Error(), "Timeout") {
				return ProbeResult{LatencyMS: latency, Detail: "timeout"}, fmt.Errorf("timeout: %w", err)
			}
			last = ProbeResult{LatencyMS: latency, Detail: err.Error()}
			lastErr = fmt.Errorf("unreachable: %w", err)
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
		res.Body.Close()
		out := ProbeResult{LatencyMS: latency, StatusCode: res.StatusCode}
		switch {
		case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
			out.Detail = "auth failed"
			return out, fmt.Errorf("auth: status %d", res.StatusCode)
		case res.StatusCode >= 200 && res.StatusCode < 300:
			out.Healthy = true
			out.Detail = "ok"
			return out, nil
		case res.StatusCode == http.StatusNotFound:
			last = out
			last.Detail = "not found"
			lastErr = fmt.Errorf("bad status %d", res.StatusCode)
			continue
		default:
			out.Detail = fmt.Sprintf("status %d", res.StatusCode)
			last = out
			lastErr = fmt.Errorf("bad status %d", res.StatusCode)
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("unreachable")
	}
	return last, lastErr
}

func urlQueryEscape(s string) string {
	return strings.ReplaceAll(s, " ", "%20")
}

func applyAuthHeaders(req *http.Request, protocol, apiKey string) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return
	}
	switch protocol {
	case "azure_openai":
		req.Header.Set("api-key", apiKey)
	case "anthropic":
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

// Discover lists models from the remote endpoint.
// Catalog fallback only when QZDA_MODEL_DISCOVER_FALLBACK=1 (default: off — real providers only).
func (c *Client) Discover(ctx context.Context, protocol, baseURL, apiKey, apiVersion string) (DiscoverResult, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return DiscoverResult{}, fmt.Errorf("missing baseUrl")
	}
	if err := ValidateBaseURL(baseURL); err != nil {
		return DiscoverResult{}, fmt.Errorf("ssrf: %w", err)
	}
	protocol = normalizeProtocol(protocol)
	fetched := time.Now().UTC().Format(time.RFC3339)
	suggested := InferProtocolFromURL(baseURL)
	models, resolved, err := c.discoverRemote(ctx, protocol, baseURL, apiKey, apiVersion)
	if err != nil || len(models) == 0 {
		if discoverFallbackEnabled() {
			return DiscoverResult{
				Protocol: protocol, BaseURL: baseURL, Models: Catalog(protocol),
				FetchedAt: fetched, Source: "catalog", SuggestedProt: suggested,
			}, nil
		}
		if err != nil {
			return DiscoverResult{}, err
		}
		return DiscoverResult{}, fmt.Errorf("empty model list from provider")
	}
	return DiscoverResult{
		Protocol: protocol, BaseURL: baseURL, Models: models,
		FetchedAt: fetched, Source: "remote", ResolvedURL: resolved, SuggestedProt: suggested,
	}, nil
}

func discoverFallbackEnabled() bool {
	v := strings.TrimSpace(os.Getenv("QZDA_MODEL_DISCOVER_FALLBACK"))
	return v == "1" || strings.EqualFold(v, "true")
}

func (c *Client) discoverRemote(ctx context.Context, protocol, baseURL, apiKey, apiVersion string) ([]map[string]string, string, error) {
	var lastErr error
	candidates := DiscoverCandidates(protocol, baseURL, apiVersion)
	// Also try inferred protocol paths when URL hints differ (e.g. DeepSeek + Claude preset).
	if inferred := InferProtocolFromURL(baseURL); inferred != "" && inferred != protocol {
		for _, u := range DiscoverCandidates(inferred, baseURL, apiVersion) {
			dup := false
			for _, x := range candidates {
				if x == u {
					dup = true
					break
				}
			}
			if !dup {
				candidates = append(candidates, u)
			}
		}
	}
	for _, path := range candidates {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, path, nil)
		if err != nil {
			lastErr = err
			continue
		}
		// Prefer auth matching selected protocol; for openai listing on anthropic-compat hosts Bearer also works.
		applyAuthHeaders(req, protocol, apiKey)
		if protocol == "anthropic" && (strings.Contains(path, "/v1/models") || strings.HasSuffix(path, "/models")) {
			// Dual-auth: many gateways accept Bearer even on anthropic-shaped URLs.
			if req.Header.Get("Authorization") == "" && apiKey != "" {
				req.Header.Set("Authorization", "Bearer "+apiKey)
			}
		}
		res, err := c.httpClient().Do(req)
		if err != nil {
			lastErr = fmt.Errorf("unreachable: %w", err)
			continue
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
		res.Body.Close()
		if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
			lastErr = fmt.Errorf("auth: status %d", res.StatusCode)
			continue
		}
		if res.StatusCode >= 300 {
			lastErr = fmt.Errorf("status %d", res.StatusCode)
			continue
		}
		models := parseModelList(protocol, raw)
		if len(models) == 0 {
			models = parseModelList("openai_compatible", raw)
		}
		if len(models) == 0 {
			lastErr = fmt.Errorf("empty model list")
			continue
		}
		return models, path, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no candidate endpoint succeeded")
	}
	return nil, "", lastErr
}

func parseModelList(protocol string, raw []byte) []map[string]string {
	var out []map[string]string
	switch protocol {
	case "ollama":
		var wrap struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
		}
		if json.Unmarshal(raw, &wrap) == nil {
			for _, m := range wrap.Models {
				if m.Name != "" {
					out = append(out, map[string]string{"id": m.Name, "name": m.Name})
				}
			}
		}
	default:
		var wrap struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &wrap) == nil {
			for _, m := range wrap.Data {
				if m.ID != "" {
					out = append(out, map[string]string{"id": m.ID, "name": m.ID})
				}
			}
		}
	}
	return out
}

func normalizeProtocol(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return "openai_compatible"
	}
	return p
}

// Catalog returns static discover catalogs aligned with Mock (fallback / offline).
func Catalog(protocol string) []map[string]string {
	catalogs := map[string][]map[string]string{
		"openai_compatible": {
			{"id": "gpt-4o", "name": "gpt-4o"}, {"id": "gpt-4o-mini", "name": "gpt-4o-mini"},
			{"id": "gpt-4.1", "name": "gpt-4.1"}, {"id": "o3-mini", "name": "o3-mini"},
			{"id": "deepseek-chat", "name": "deepseek-chat"}, {"id": "deepseek-reasoner", "name": "deepseek-reasoner"},
		},
		"azure_openai": {
			{"id": "gpt-4o", "name": "gpt-4o"}, {"id": "gpt-4o-mini", "name": "gpt-4o-mini"},
			{"id": "gpt-35-turbo", "name": "gpt-35-turbo"}, {"id": "text-embedding-3-large", "name": "text-embedding-3-large"},
		},
		"anthropic": {
			{"id": "claude-sonnet-4-20250514", "name": "claude-sonnet-4-20250514"},
			{"id": "claude-opus-4-20250514", "name": "claude-opus-4-20250514"},
			{"id": "claude-haiku-4-20250514", "name": "claude-haiku-4-20250514"},
		},
		"dashscope": {
			{"id": "qwen-max", "name": "qwen-max"}, {"id": "qwen-plus", "name": "qwen-plus"},
			{"id": "qwen-turbo", "name": "qwen-turbo"}, {"id": "qwen2.5-72b-instruct", "name": "qwen2.5-72b-instruct"},
		},
		"ollama": {
			{"id": "qwen2.5:72b", "name": "qwen2.5:72b"}, {"id": "llama3.1:70b", "name": "llama3.1:70b"},
			{"id": "deepseek-r1:32b", "name": "deepseek-r1:32b"},
		},
		"custom": {
			{"id": "default", "name": "default"}, {"id": "chat", "name": "chat"}, {"id": "embeddings", "name": "embeddings"},
		},
	}
	if m, ok := catalogs[normalizeProtocol(protocol)]; ok {
		return m
	}
	return catalogs["openai_compatible"]
}
