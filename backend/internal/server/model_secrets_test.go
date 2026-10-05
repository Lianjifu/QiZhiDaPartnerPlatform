package server

import (
	"context"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestResolveProviderCredentialSurvivesRestartWithBanMockToken(t *testing.T) {
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "1")
	t.Setenv("QZDA_ENV", "development")
	t.Setenv("QZDA_VAULT_ADDR", "")
	t.Setenv("QZDA_VAULT_TOKEN", "")

	ref := "vault://model-providers/mp-restart/credential"
	secret := "sk-live-after-restart"

	st := store.New()
	st.Lock()
	st.ModelSecrets[ref] = secret
	st.Unlock()
	srv := New(st)
	if got := srv.resolveProviderCredential(context.Background(), ref); got != secret {
		t.Fatalf("same process got %q", got)
	}

	st2 := store.New()
	st2.HydrateFrom("model_secrets", []map[string]any{
		{"id": ref, "workspaceId": "*", "value": secret},
	})
	srv2 := New(st2)
	if got := srv2.resolveProviderCredential(context.Background(), ref); got != secret {
		t.Fatalf("after restart got %q want %q", got, secret)
	}
}

func TestResolveProviderCredentialSkipsLocalSecretsInProduction(t *testing.T) {
	t.Setenv("QZDA_ENV", "production")
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "1")
	t.Setenv("QZDA_VAULT_ADDR", "")
	t.Setenv("QZDA_VAULT_TOKEN", "")

	ref := "vault://model-providers/mp-prod/credential"
	st := store.New()
	st.HydrateFrom("model_secrets", []map[string]any{
		{"id": ref, "workspaceId": "*", "value": "sk-should-not-leak"},
	})
	srv := New(st)
	if got := srv.resolveProviderCredential(context.Background(), ref); got != "" {
		t.Fatalf("production must not fall back to plaintext kv, got %q", got)
	}
}
