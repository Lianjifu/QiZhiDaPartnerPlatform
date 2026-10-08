package infra

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AuthAccount struct {
	Email        string
	UserID       string
	Name         string
	Role         string
	PasswordHash string
	Disabled     bool
}

func FindAuthAccount(ctx context.Context, pool *pgxpool.Pool, email string) (*AuthAccount, error) {
	var a AuthAccount
	err := pool.QueryRow(ctx,
		`SELECT email, user_id, name, role, password_hash, disabled FROM platform.auth_accounts WHERE email = $1`,
		email,
	).Scan(&a.Email, &a.UserID, &a.Name, &a.Role, &a.PasswordHash, &a.Disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func UpsertAuthAccount(ctx context.Context, pool *pgxpool.Pool, a AuthAccount) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO platform.auth_accounts (email, user_id, name, role, password_hash, disabled, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (email) DO UPDATE SET
			user_id = EXCLUDED.user_id, name = EXCLUDED.name, role = EXCLUDED.role,
			password_hash = EXCLUDED.password_hash, disabled = EXCLUDED.disabled, updated_at = now()`,
		a.Email, a.UserID, a.Name, a.Role, a.PasswordHash, a.Disabled,
	)
	return err
}

func SetAuthAccountDisabled(ctx context.Context, pool *pgxpool.Pool, email string, disabled bool) (bool, error) {
	tag, err := pool.Exec(ctx,
		`UPDATE platform.auth_accounts SET disabled = $2, updated_at = now() WHERE email = $1`,
		email, disabled,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func SetAuthAccountPassword(ctx context.Context, pool *pgxpool.Pool, email, passwordHash string) (bool, error) {
	tag, err := pool.Exec(ctx,
		`UPDATE platform.auth_accounts SET password_hash = $2, updated_at = now() WHERE email = $1`,
		email, passwordHash,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
