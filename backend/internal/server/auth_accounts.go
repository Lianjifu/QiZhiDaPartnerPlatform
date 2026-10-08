package server

import (
	"context"
	"errors"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/infra"
)

// pgAccounts resolves login accounts from platform.auth_accounts. PG is wired
// after the auth handler is built, so the pool is read at call time.
type pgAccounts struct{ s *Server }

func (p pgAccounts) FindAccount(ctx context.Context, email string) (*auth.Account, error) {
	if p.s.PG == nil {
		return nil, errors.New("postgres not configured")
	}
	row, err := infra.FindAuthAccount(ctx, p.s.PG, email)
	if err != nil || row == nil {
		return nil, err
	}
	return &auth.Account{
		Email: row.Email, UserID: row.UserID, Name: row.Name, Role: row.Role,
		PasswordHash: row.PasswordHash, Disabled: row.Disabled,
	}, nil
}
