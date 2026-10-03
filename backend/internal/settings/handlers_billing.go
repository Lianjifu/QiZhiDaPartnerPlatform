package settings

import (
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// getBilling returns the workspace's billing snapshot. Requires the
// billing.read scope. Returns the in-memory Billing map verbatim —
// live cost detail is sourced from UsageMeters by the home/ops
// aggregate (see internal/server/ops_aggregate.go).
func (s *Service) getBilling(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if !auth.Has(id, "billing.read") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "缺少 billing.read")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.Billing, nil
}

// getBillingQuota returns the billing usage/quota pair with progress
// ratios for tokens and USD. Used by the Frontend quota meter; the
// ratios are pre-computed here so the UI can render without doing
// float math itself.
func (s *Service) getBillingQuota(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if !auth.Has(id, "billing.read") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "缺少 billing.read")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	b := s.Store.Billing
	usage, _ := b["usage"].(map[string]any)
	quota, _ := b["quota"].(map[string]any)
	return map[string]any{
		"usage": usage, "quota": quota,
		"progress": map[string]any{
			"tokens": ratio(usage["tokens"], quota["tokens"]),
			"usd":    ratio(usage["usd"], quota["usd"]),
		},
	}, nil
}

// ratio returns used/limit as a float64, or 0 if either side is
// missing/non-numeric or the limit is zero (avoid divide-by-zero).
func ratio(used, limit any) float64 {
	u, ok1 := asFloat(used)
	l, ok2 := asFloat(limit)
	if !ok1 || !ok2 || l == 0 {
		return 0
	}
	return u / l
}

// asFloat coerces a map[string]any value to float64. Numeric values
// (float64 / int / int64) round-trip; everything else (nil, strings,
// JSON-decoded numbers as float64 already) returns false.
func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	default:
		return 0, false
	}
}
