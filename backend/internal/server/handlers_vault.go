package server

import (
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listVaultKeys handles GET /api/vault/keys. Admin-only diagnostic surface
// that returns the in-process stub credentialRef list. Never returns secret
// material — only ref strings + whether Vault is enabled.
func (s *Server) listVaultKeys(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "vault.read") && id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "需要 vault.read 权限")
	}
	enabled := false
	refs := []string{}
	if s.Vault != nil {
		enabled = s.Vault.Enabled()
		refs = s.Vault.Refs()
	}
	return map[string]any{
		"enabled":   enabled,
		"backend":   "stub",
		"refsCount": len(refs),
		"refs":      refs,
	}, nil
}
