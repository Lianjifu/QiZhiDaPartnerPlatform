package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// OpenSearchAudit indexes and searches audit events (optional QZDA_OPENSEARCH_URL).
type OpenSearchAudit struct {
	Base  string
	Index string
	HTTP  *http.Client
}

func NewOpenSearchAuditFromEnv() *OpenSearchAudit {
	base := strings.TrimSpace(os.Getenv("QZDA_OPENSEARCH_URL"))
	if base == "" {
		return nil
	}
	idx := envOr("QZDA_OPENSEARCH_AUDIT_INDEX", "qzda-audit")
	return &OpenSearchAudit{
		Base:  strings.TrimRight(base, "/"),
		Index: idx,
		HTTP:  &http.Client{Timeout: 5 * time.Second},
	}
}

func (o *OpenSearchAudit) Available() bool { return o != nil && o.Base != "" }

// Close releases the underlying *http.Client's idle connections so the
// graceful-shutdown path doesn't leak goroutines / sockets back to the
// pool after the audit sink goes idle. Nil-safe on a nil receiver
// (consistent with infra.KafkaAuditBus.Close) and on a struct that has
// no HTTP client (e.g. zero-value literal used in tests).
func (o *OpenSearchAudit) Close() error {
	if o == nil || o.HTTP == nil {
		return nil
	}
	o.HTTP.CloseIdleConnections()
	return nil
}

func (o *OpenSearchAudit) EnsureIndex(ctx context.Context) error {
	if !o.Available() {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, o.Base+"/"+o.Index, strings.NewReader(`{
	  "settings": {"number_of_shards": 1, "number_of_replicas": 0},
	  "mappings": {"properties": {
	    "id": {"type": "keyword"},
	    "workspaceId": {"type": "keyword"},
	    "actor": {"type": "keyword"},
	    "action": {"type": "text", "fields": {"raw": {"type": "keyword"}}},
	    "target": {"type": "text"},
	    "result": {"type": "keyword"},
	    "correlationId": {"type": "keyword"},
	    "time": {"type": "date", "format": "strict_date_optional_time||epoch_millis"}
	  }}
	}`))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := o.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	// 200 created or 400 already exists are fine
	if res.StatusCode >= 500 {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("opensearch ensure index %d: %s", res.StatusCode, string(b))
	}
	return nil
}

func (o *OpenSearchAudit) IndexEvent(ctx context.Context, ev map[string]any) error {
	if !o.Available() {
		return nil
	}
	id := str(ev["id"])
	if id == "" {
		id = fmt.Sprintf("audit-%d", time.Now().UnixNano())
	}
	doc := map[string]any{
		"id": id, "workspaceId": str(ev["workspaceId"]), "actor": str(ev["actor"]),
		"action": str(ev["action"]), "target": str(ev["target"]),
		"result": str(ev["result"]), "reason": str(ev["reason"]),
		"correlationId": str(ev["correlationId"]),
		"time":          coalesceTime(ev["time"]),
	}
	raw, _ := json.Marshal(doc)
	url := fmt.Sprintf("%s/%s/_doc/%s", o.Base, o.Index, id)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := o.HTTP.Do(req)
	if err != nil {
		log.Printf("opensearch index failed: %v", err)
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
		log.Printf("opensearch index %d: %s", res.StatusCode, string(b))
	}
	return nil
}

func (o *OpenSearchAudit) SearchRecent(ctx context.Context, workspaceIDs []string, limit int) ([]map[string]any, error) {
	if !o.Available() || len(workspaceIDs) == 0 {
		return nil, nil
	}
	if limit <= 0 {
		limit = 200
	}
	q := map[string]any{
		"size": limit,
		"sort": []map[string]any{{"time": map[string]any{"order": "desc"}}},
		"query": map[string]any{
			"bool": map[string]any{
				"filter": []map[string]any{
					{"terms": map[string]any{"workspaceId": workspaceIDs}},
				},
			},
		},
	}
	raw, _ := json.Marshal(q)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.Base+"/"+o.Index+"/_search", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := o.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("opensearch search %d: %s", res.StatusCode, string(body))
	}
	var parsed struct {
		Hits struct {
			Hits []struct {
				Source map[string]any `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(parsed.Hits.Hits))
	for _, h := range parsed.Hits.Hits {
		if h.Source != nil {
			out = append(out, h.Source)
		}
	}
	return out, nil
}

func coalesceTime(v any) string {
	if s := str(v); s != "" {
		return s
	}
	return time.Now().UTC().Format(time.RFC3339)
}
