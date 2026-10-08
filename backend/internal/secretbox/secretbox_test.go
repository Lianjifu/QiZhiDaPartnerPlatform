package secretbox

import (
	"bytes"
	"strings"
	"testing"
)

func testKey(t *testing.T) []byte {
	t.Helper()
	key := bytes.Repeat([]byte{7}, 32)
	return key
}

func TestSealOpenRoundTrip(t *testing.T) {
	key := testKey(t)
	sealed, err := Seal(key, "sk-live-123456")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if !IsSealed(sealed) || strings.Contains(sealed, "sk-live") {
		t.Fatalf("sealed value must be prefixed and must not contain plaintext: %q", sealed)
	}
	got, err := Open(key, sealed)
	if err != nil || got != "sk-live-123456" {
		t.Fatalf("Open = %q, %v", got, err)
	}
}

func TestOpenRejectsWrongKeyAndTampering(t *testing.T) {
	key := testKey(t)
	sealed, _ := Seal(key, "secret")
	other := bytes.Repeat([]byte{9}, 32)
	if _, err := Open(other, sealed); err == nil {
		t.Fatal("wrong key accepted")
	}
	tampered := sealed[:len(sealed)-2] + "AA"
	if _, err := Open(key, tampered); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}

func TestSealUsesFreshNonce(t *testing.T) {
	key := testKey(t)
	a, _ := Seal(key, "same")
	b, _ := Seal(key, "same")
	if a == b {
		t.Fatal("identical ciphertexts for the same plaintext")
	}
}

func TestKeyFromEnvValidation(t *testing.T) {
	t.Setenv("QZDA_CREDENTIAL_KEY", "")
	if _, err := KeyFromEnv(); err == nil {
		t.Fatal("missing key accepted")
	}
	t.Setenv("QZDA_CREDENTIAL_KEY", "c2hvcnQ=")
	if _, err := KeyFromEnv(); err == nil {
		t.Fatal("short key accepted")
	}
	t.Setenv("QZDA_CREDENTIAL_KEY", "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	if k, err := KeyFromEnv(); err != nil || len(k) != 32 {
		t.Fatalf("valid key rejected: %v", err)
	}
}
