package models

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
)

// modelRL is the in-process sliding-window rate limiter used as a fallback
// when s.AllowRate is nil (e.g. unit tests / mono-dev). Mirrors the legacy
// `modelRL` map from internal/server/model_helpers.go; kept package-private.
var (
	modelRLMu sync.Mutex
	modelRL   = map[string][]time.Time{}
)

// modelProbe returns the lazily-initialized modelprov.Client. Mirrors the
// legacy `*Server.modelProbe` — the first call constructs the client; later
// calls reuse it. Nil-safe (returns a fresh client if s.ModelProbe is nil).
func (s *Service) modelProbe() *modelprov.Client {
	if s.ModelProbe == nil {
		s.ModelProbe = modelprov.NewClient()
	}
	return s.ModelProbe
}

// vaultRequiredForCredentials reports whether Vault is mandatory for provider
// credentials in the current runtime. Centralized so dev (LaunchAgent) and
// production agree on the policy.
func vaultRequiredForCredentials() bool {
	return runtimeenv.FromEnv().RequiresVault()
}

// budgetEnforceEnabled reports whether the published-budget gate must be enforced
// on /api/model-invoke. Controlled by QZDA_MODEL_BUDGET_ENFORCE; defaults to
// "required-vault OR dual-approval env" when unset.
func budgetEnforceEnabled() bool {
	if envFlagFalse("QZDA_MODEL_BUDGET_ENFORCE") {
		return false
	}
	if envFlagTrue("QZDA_MODEL_BUDGET_ENFORCE") {
		return true
	}
	return runtimeenv.FromEnv().RequiresVault() || runtimeenv.FromEnv().DualApproval()
}

// envFlagTrue returns true when the named env var is one of 1/true/yes/on
// (case-insensitive). Used for boolean feature flags.
func envFlagTrue(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// envFlagFalse returns true when the named env var is one of 0/false/no/off
// (case-insensitive). Used for opt-out feature flags.
func envFlagFalse(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "0", "false", "no", "off":
		return true
	}
	return false
}

// allowModelRate is the M08 rate-limit helper. Tries the configured cache
// (Redis) first; falls back to the in-process sliding-window map. The cache
// path is bounded by the AllowRate Deps field; nil-safe.
func (s *Service) allowModelRate(key string, limit int, window time.Duration) bool {
	if s.AllowRate != nil {
		ok, err := s.AllowRate(context.Background(), "model:"+key, int64(limit), window)
		if err == nil {
			return ok
		}
	}
	now := time.Now()
	modelRLMu.Lock()
	defer modelRLMu.Unlock()
	cut := now.Add(-window)
	arr := modelRL[key]
	alive := arr[:0]
	for _, t := range arr {
		if t.After(cut) {
			alive = append(alive, t)
		}
	}
	if len(alive) >= limit {
		modelRL[key] = alive
		return false
	}
	modelRL[key] = append(alive, now)
	return true
}

// providerModels reads the `models` slice from a provider map, normalising
// the two shapes the store accepts ([]map[string]any and []any). Returns
// nil when the value is missing or of an unsupported type.
func providerModels(p map[string]any) []map[string]any {
	if p == nil {
		return nil
	}
	switch m := p["models"].(type) {
	case []map[string]any:
		return m
	case []any:
		out := make([]map[string]any, 0, len(m))
		for _, x := range m {
			if mm, ok := x.(map[string]any); ok {
				out = append(out, mm)
			}
		}
		return out
	default:
		return nil
	}
}

// setProviderModels writes the `models` slice back onto the provider map.
func setProviderModels(p map[string]any, models []map[string]any) {
	p["models"] = models
}

// stringSlice normalises string fields from interface / []string / []any shapes.
func stringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

// normalizeTier maps a free-form tier label onto the canonical set
// (official / self_hosted / connectable). Used when accepting a provider
// create or patch body.
func normalizeTier(t string) string {
	switch strings.TrimSpace(t) {
	case "official", "self_hosted", "connectable":
		return t
	case "enterprise":
		return "official"
	case "standard":
		return "self_hosted"
	default:
		if t == "" {
			return "connectable"
		}
		return "connectable"
	}
}

// --- Small typed coercions (mirrored from internal/server/handlers_*.go) ---
// Each M08 module copies these locally to avoid importing internal/server
// (one-way package boundary).

func str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		return fmt.Sprint(t)
	}
}

func coalesce(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func intFrom(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float32:
		return int(n)
	case float64:
		return int(n)
	case string:
		if i, err := strconv.Atoi(n); err == nil {
			return i
		}
	}
	return 0
}

func toFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case string:
		if f, err := strconv.ParseFloat(n, 64); err == nil {
			return f
		}
	}
	return 0
}

func itoa(n int) string { return strconv.Itoa(n) }