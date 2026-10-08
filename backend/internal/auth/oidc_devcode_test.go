package auth

import (
	"context"
	"testing"
)

func TestExchangeCodeRejectsDevCodesOutsideDev(t *testing.T) {
	for _, code := range []string{"admin", "audit", "user"} {
		cfg := OIDCConfig{Enabled: false, AllowDevCodes: false}
		if id, err := cfg.ExchangeCode(context.Background(), code); err == nil {
			t.Fatalf("code %q accepted with OIDC disabled and dev codes off: %+v", code, id)
		}
	}
}
