package auth

import "context"

// Account is a credential-backed login principal used in pro mode.
type Account struct {
	Email        string
	UserID       string
	Name         string
	Role         string
	PasswordHash string
	Disabled     bool
}

// CredentialStore resolves login accounts by normalized email. Unknown emails
// return (nil, nil); errors are reported as failed logins without detail.
type CredentialStore interface {
	FindAccount(ctx context.Context, email string) (*Account, error)
}
