package vault

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/metrics"
)

// Client resolves credentialRef → secret material. Never logs plaintext.
type Client struct {
	addr   string
	token  string
	mount  string
	http   *http.Client
	mu     sync.RWMutex
	stub   map[string]string
}

func NewFromEnv() *Client {
	return &Client{
		addr:  strings.TrimSpace(os.Getenv("QZDA_VAULT_ADDR")),
		token: strings.TrimSpace(os.Getenv("QZDA_VAULT_TOKEN")),
		mount: envOr("QZDA_VAULT_KV_MOUNT", "secret"),
		http:  &http.Client{Timeout: 10 * time.Second},
		stub:  map[string]string{},
	}
}

func envOr(k, d string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return d
}

func (c *Client) Enabled() bool {
	return c != nil && c.addr != ""
}

// PutStub stores a secret under ref for local Compose without real Vault.
func (c *Client) PutStub(ref, value string) {
	_ = c.Put(context.Background(), ref, value)
}

// Refs returns the list of credentialRef keys known to the local stub store.
// When real Vault is enabled, this only returns the in-process stub refs that
// have been mirrored; it does not enumerate Vault directly. Always redacted.
func (c *Client) Refs() []string {
	if c == nil {
		return nil
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]string, 0, len(c.stub))
	for k := range c.stub {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Put writes secret to Vault KV v2 when configured; always mirrors into local stub for Resolve fallback.
func (c *Client) Put(ctx context.Context, ref, value string) error {
	if c == nil {
		return errors.New("vault client nil")
	}
	if ref == "" || value == "" {
		return errors.New("empty credentialRef or value")
	}
	path, err := c.kvPath(ref)
	if err != nil {
		return err
	}
	c.mu.Lock()
	if c.stub == nil {
		c.stub = map[string]string{}
	}
	c.stub[ref] = value
	c.mu.Unlock()

	if !c.Enabled() || c.token == "" {
		return nil
	}
	body, _ := json.Marshal(map[string]any{"data": map[string]any{"value": value}})
	url := strings.TrimRight(c.addr, "/") + "/v1/" + c.mount + "/data/" + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("X-Vault-Token", c.token)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("vault put: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("vault put %d: %s", res.StatusCode, string(raw))
	}
	return nil
}

// Resolve returns secret for credentialRef (stub first, then Vault KV v2).
func (c *Client) Resolve(ctx context.Context, ref string) (string, error) {
	started := time.Now()
	defer func() {
		metrics.Global.Vault.Observe(classifyRef(ref), time.Since(started))
	}()
	if c == nil {
		return "", errors.New("vault client nil")
	}
	if ref == "" {
		return "", errors.New("empty credentialRef")
	}
	path, err := c.kvPath(ref)
	if err != nil {
		return "", err
	}

	c.mu.RLock()
	if v, ok := c.stub[ref]; ok {
		c.mu.RUnlock()
		return v, nil
	}
	c.mu.RUnlock()

	if !c.Enabled() {
		return "", errors.New("凭据未找到: " + ref)
	}
	if c.token == "" {
		return "", errors.New("QZDA_VAULT_TOKEN 未配置")
	}
	url := strings.TrimRight(c.addr, "/") + "/v1/" + c.mount + "/data/" + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Vault-Token", c.token)
	res, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("vault get: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusNotFound {
		return "", errors.New("凭据未找到: " + ref)
	}
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("vault get %d: %s", res.StatusCode, string(raw))
	}
	var wrap struct {
		Data struct {
			Data map[string]any `json:"data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return "", err
	}
	if v, ok := wrap.Data.Data["value"].(string); ok && v != "" {
		c.mu.Lock()
		c.stub[ref] = v
		c.mu.Unlock()
		return v, nil
	}
	return "", errors.New("vault 密钥缺少 data.value: " + ref)
}

func (c *Client) kvPath(ref string) (string, error) {
	r := strings.TrimSpace(ref)
	switch {
	case strings.HasPrefix(r, "vault:secret/data/"):
		return strings.TrimPrefix(r, "vault:secret/data/"), nil
	case strings.HasPrefix(r, "vault:"):
		p := strings.TrimPrefix(r, "vault:")
		p = strings.TrimPrefix(p, "/")
		if strings.HasPrefix(p, "secret/data/") {
			return strings.TrimPrefix(p, "secret/data/"), nil
		}
		if strings.HasPrefix(p, "secret/") {
			return strings.TrimPrefix(p, "secret/"), nil
		}
		return p, nil
	case strings.HasPrefix(r, "secret/data/"):
		return strings.TrimPrefix(r, "secret/data/"), nil
	case strings.HasPrefix(r, "secret/"):
		return strings.TrimPrefix(r, "secret/"), nil
	case strings.HasPrefix(r, "vault://"):
		return strings.TrimPrefix(r, "vault://"), nil
	default:
		return "", errors.New("invalid credentialRef：必须以 vault: 或 secret/ 开头")
	}
}

// PutMap writes many secrets in one batch. Use when rotating a set of
// model-provider credentials together so partial failures are visible.
// Each entry's ref must already pass kvPath (i.e. start with vault:
// or secret/). Returns the first error encountered and continues with
// remaining entries so one bad ref doesn't block the rest.
func (c *Client) PutMap(ctx context.Context, entries map[string]string) error {
	if c == nil {
		return errors.New("vault client nil")
	}
	if len(entries) == 0 {
		return nil
	}
	var firstErr error
	for ref, value := range entries {
		if err := c.Put(ctx, ref, value); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// ResolveMap fetches many secrets in one batch. Entries that miss are
// returned in the second return value so the caller can decide whether
// to retry, prompt for re-entry, or fall back to defaults. Resolved
// entries are returned in the same map shape for direct swap-in.
func (c *Client) ResolveMap(ctx context.Context, refs []string) (map[string]string, []string, error) {
	if c == nil {
		return nil, nil, errors.New("vault client nil")
	}
	if len(refs) == 0 {
		return map[string]string{}, nil, nil
	}
	out := make(map[string]string, len(refs))
	var missing []string
	for _, ref := range refs {
		v, err := c.Resolve(ctx, ref)
		if err != nil {
			missing = append(missing, ref)
			continue
		}
		out[ref] = v
	}
	return out, missing, nil
}

// Delete removes a secret from the local stub and best-effort from Vault KV v2.
func (c *Client) Delete(ctx context.Context, ref string) error {
	if c == nil {
		return errors.New("vault client nil")
	}
	if ref == "" {
		return nil
	}
	path, err := c.kvPath(ref)
	if err != nil {
		return err
	}
	c.mu.Lock()
	delete(c.stub, ref)
	c.mu.Unlock()
	if !c.Enabled() || c.token == "" {
		return nil
	}
	url := strings.TrimRight(c.addr, "/") + "/v1/" + c.mount + "/data/" + path
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Vault-Token", c.token)
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("vault delete: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != http.StatusNotFound {
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		return fmt.Errorf("vault delete %d: %s", res.StatusCode, string(raw))
	}
	return nil
}

// Redact ensures logs never contain secret values.
func Redact(s string) string {
	if s == "" {
		return ""
	}
	if len(s) <= 4 {
		return "****"
	}
	return s[:2] + "****" + s[len(s)-2:]
}

// classifyRef maps a vault ref to one of three metric buckets.
// skill-key / model-credential / other. Heuristic on path prefix; the
// ref canonicalization happens via kvPath before this so we look at the
// user-facing ref shape.
func classifyRef(ref string) string {
	r := strings.ToLower(ref)
	switch {
	case strings.Contains(r, "skill-keys"):
		return "skill-key"
	case strings.Contains(r, "model-providers"), strings.Contains(r, "model-providers/") || strings.Contains(r, "model-provider"):
		return "model-credential"
	default:
		return "other"
	}
}
