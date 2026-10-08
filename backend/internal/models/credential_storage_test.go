package models

import (
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/secretbox"
)

func TestProCredentialIsSealedAndRoundTrips(t *testing.T) {
	t.Setenv("QZDA_MODE", "pro")
	t.Setenv("QZDA_CREDENTIAL_KEY", "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	stored, err := sealLocalCredential("sk-prod-987654")
	if err != nil {
		t.Fatalf("sealLocalCredential: %v", err)
	}
	if strings.Contains(stored, "sk-prod") || !secretbox.IsSealed(stored) {
		t.Fatalf("pro stored value must be ciphertext, got %q", stored)
	}
	if got := openLocalCredential(stored); got != "sk-prod-987654" {
		t.Fatalf("openLocalCredential = %q", got)
	}
}

func TestProRequiresCredentialKey(t *testing.T) {
	t.Setenv("QZDA_MODE", "pro")
	t.Setenv("QZDA_CREDENTIAL_KEY", "")
	if _, err := sealLocalCredential("sk-x"); err == nil {
		t.Fatal("pro stored a credential without an encryption key")
	}
}

func TestProRefusesPlaintextEntries(t *testing.T) {
	t.Setenv("QZDA_MODE", "pro")
	t.Setenv("QZDA_CREDENTIAL_KEY", "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	if got := openLocalCredential("sk-legacy-plain"); got != "" {
		t.Fatalf("pro returned a plaintext credential: %q", got)
	}
}

func TestDevKeepsPlaintextLocalMirror(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	stored, err := sealLocalCredential("sk-dev")
	if err != nil || stored != "sk-dev" {
		t.Fatalf("dev local mirror changed: %q, %v", stored, err)
	}
	if got := openLocalCredential("sk-dev"); got != "sk-dev" {
		t.Fatalf("dev read = %q", got)
	}
}
