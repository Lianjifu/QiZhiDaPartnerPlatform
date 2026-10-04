package knowledge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// RAGClient is the single HTTP boundary for the qzda-rag sidecar
// (FastAPI :8092). Centralized here so knowledge / server / workflow
// (future) don't each reimplement the wire format or re-mint the
// http.Client.
//
// Wire contract (mirrors services/qzda-rag/app/main.py):
//   POST /v1/retrieve  {query, workspaceId, correlationId, publishedOnly, docs}
//                     → {query, results[], backend, correlationId, publishedOnly}
//   POST /v1/ingest    {docs, workspaceId}
//                     → {indexed, backend}
//   POST /v1/sync      {docs, workspaceId}  (legacy fallback for older sidecars)
//                     → {indexed, backend}
//   GET  /healthz      → {status, service, mode, backend, indexed}
type RAGClient struct {
	URL  string
	HTTP *http.Client
}

// NewRAGClient builds a client with the project default 2-second
// timeout. url="" makes every method a no-op (returns nil/0), which
// preserves the pre-sidecar behaviour for unit tests and dev runs
// that haven't started qzda-rag.
func NewRAGClient(url string) *RAGClient {
	return &RAGClient{
		URL:  url,
		HTTP: &http.Client{Timeout: 2 * time.Second},
	}
}

// Retrieve posts a published-only retrieval request. Returns nil, nil
// when the sidecar is absent (no URL configured) or unreachable — the
// caller is expected to fall back to its in-memory keyword path.
func (c *RAGClient) Retrieve(ctx context.Context, query, ws, corr string, docs []map[string]any) (map[string]any, error) {
	if c == nil || c.URL == "" {
		return nil, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	payload, err := json.Marshal(map[string]any{
		"query": query, "workspaceId": ws, "correlationId": corr,
		"publishedOnly": true, "docs": docs,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+"/v1/retrieve", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, errors.New("rag retrieve non-2xx: " + resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Ingest upserts docs into the sidecar's vector index. Tries /v1/ingest
// first; older sidecars only expose /v1/sync (full reindex) and we
// silently fall back. Returns the indexed count the sidecar reported
// (or len(docs) when no body parsed).
func (c *RAGClient) Ingest(ctx context.Context, ws string, docs []map[string]any) (int, error) {
	if c == nil || c.URL == "" {
		return 0, errors.New("rag url not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	payload, err := json.Marshal(map[string]any{"docs": docs, "workspaceId": ws})
	if err != nil {
		return 0, err
	}
	endpoints := []string{"/v1/ingest", "/v1/sync"}
	for _, ep := range endpoints {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+ep, bytes.NewReader(payload))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.HTTP.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			continue
		}
		var out struct {
			Indexed int `json:"indexed"`
		}
		_ = json.Unmarshal(body, &out)
		if out.Indexed > 0 {
			return out.Indexed, nil
		}
		return len(docs), nil
	}
	return len(docs), nil
}

// Health pings /healthz. Useful for the knowledge-center "检索服务
// 可用" badge so it can reflect the live sidecar state instead of a
// hard-coded label.
func (c *RAGClient) Health(ctx context.Context) (map[string]any, error) {
	if c == nil || c.URL == "" {
		return nil, errors.New("rag url not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.URL+"/healthz", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, errors.New("rag health non-2xx: " + resp.Status)
	}
	out := map[string]any{}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// ragClient lazily mints a Service-local RAGClient bound to the
// configured Deps.RAGURL(). Kept private so callers go through the
// Service wrappers (RAGRetrieveForConnect / SyncRAGIndex) that layer
// in the published-only filter + audit row.
func (s *Service) ragClient() *RAGClient {
	url := ""
	if s.Deps.RAGURL != nil {
		url = s.Deps.RAGURL()
	}
	return NewRAGClient(url)
}
