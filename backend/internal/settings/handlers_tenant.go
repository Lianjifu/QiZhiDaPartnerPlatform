package settings

import (
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// getTenantProfile returns the current tenant profile (organization
// metadata: name / region / status / brand). If the store has never
// been initialized for this tenant, returns a sensible default
// (ACME Corp / cn-east-1) — the home UI shows this on first login.
func (s *Service) getTenantProfile(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	if s.Store.TenantProfile == nil {
		return map[string]any{"name": "ACME Corp", "tenantId": "tenant-acme", "region": "cn-east-1"}, nil
	}
	out := map[string]any{}
	for k, v := range s.Store.TenantProfile {
		out[k] = v
	}
	return out, nil
}

// patchTenantProfile updates tenant profile metadata. Admin-only.
// Only name / region / status are accepted (whitelisted keys to keep
// the persistence surface tight — adding new keys requires both code
// and migration). Returns the updated profile verbatim.
func (s *Service) patchTenantProfile(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅管理员可更新组织资料")
	}
	body, _ := s.decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	if s.Store.TenantProfile == nil {
		s.Store.TenantProfile = map[string]any{}
	}
	for _, k := range []string{"name", "region", "status"} {
		if v := strings.TrimSpace(str(body[k])); v != "" {
			s.Store.TenantProfile[k] = v
		}
	}
	s.Store.TenantProfile["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	s.Store.TenantProfile["updatedBy"] = id.Name
	s.appendAudit("tenant", id.Name, "更新组织资料", str(s.Store.TenantProfile["name"]), "success", "")
	out := map[string]any{}
	for k, v := range s.Store.TenantProfile {
		out[k] = v
	}
	return out, nil
}
