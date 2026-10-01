package signing

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"testing"
)

// stubFetcher is an in-memory VaultSecretFetcher for tests. It records
// resolves so tests can assert caching behavior.
type stubFetcher struct {
	mu        sync.Mutex
	store     map[string]string
	resolves  int
	resolveBy map[string]int
}

func newStubFetcher() *stubFetcher {
	return &stubFetcher{store: map[string]string{}, resolveBy: map[string]int{}}
}

func (s *stubFetcher) Resolve(ctx context.Context, ref string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resolves++
	s.resolveBy[ref]++
	v, ok := s.store[ref]
	if !ok {
		return "", errors.New("vault stub: not found")
	}
	return v, nil
}

func (s *stubFetcher) Put(ctx context.Context, ref, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.store[ref] = value
	return nil
}

func (s *stubFetcher) count(ref string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.resolveBy[ref]
}

func TestVaultKeyStoreNilFetcherRejected(t *testing.T) {
	if _, err := NewVaultKeyStore(nil); err == nil {
		t.Fatal("expected error for nil fetcher")
	}
}

func TestVaultKeyStoreSignerResolvesAndCaches(t *testing.T) {
	priv, err := GenerateEd25519Key()
	if err != nil {
		t.Fatal(err)
	}
	expected := base64.StdEncoding.EncodeToString(priv)
	fetcher := newStubFetcher()
	fetcher.store["vault:skill-keys/ed25519:abc"] = expected

	ks, err := NewVaultKeyStore(fetcher)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ks.Signer("ed25519:abc")
	if err != nil {
		t.Fatalf("first resolve: %v", err)
	}
	if signer == nil {
		t.Fatal("nil signer")
	}
	if fetcher.count("vault:skill-keys/ed25519:abc") != 1 {
		t.Fatalf("expected 1 resolve, got %d", fetcher.count("vault:skill-keys/ed25519:abc"))
	}
	// Second call should hit cache, not fetcher.
	signer2, err := ks.Signer("ed25519:abc")
	if err != nil {
		t.Fatalf("second resolve: %v", err)
	}
	if signer2 != signer {
		t.Fatal("expected same cached signer instance")
	}
	if fetcher.count("vault:skill-keys/ed25519:abc") != 1 {
		t.Fatalf("expected still 1 resolve after cache hit, got %d", fetcher.count("vault:skill-keys/ed25519:abc"))
	}
}

func TestVaultKeyStoreSignerMissingReturnsError(t *testing.T) {
	fetcher := newStubFetcher()
	ks, _ := NewVaultKeyStore(fetcher)
	_, err := ks.Signer("ed25519:missing")
	if err == nil {
		t.Fatal("expected error for missing key")
	}
	if !strings.Contains(err.Error(), "vault keystore") {
		t.Fatalf("expected vault keystore prefix, got %v", err)
	}
}

func TestVaultKeyStoreSignerEmptyKeyID(t *testing.T) {
	fetcher := newStubFetcher()
	ks, _ := NewVaultKeyStore(fetcher)
	_, err := ks.Signer("")
	if err == nil {
		t.Fatal("expected error for empty keyID")
	}
}

func TestVaultKeyStoreSignerMalformedBase64(t *testing.T) {
	fetcher := newStubFetcher()
	fetcher.store["vault:skill-keys/ed25519:bad"] = "not-base64!!"
	ks, _ := NewVaultKeyStore(fetcher)
	_, err := ks.Signer("ed25519:bad")
	if err == nil {
		t.Fatal("expected error for malformed base64")
	}
}

func TestVaultKeyStoreSignerWrongKeyLength(t *testing.T) {
	fetcher := newStubFetcher()
	fetcher.store["vault:skill-keys/ed25519:short"] = base64.StdEncoding.EncodeToString([]byte{1, 2, 3})
	ks, _ := NewVaultKeyStore(fetcher)
	_, err := ks.Signer("ed25519:short")
	if err == nil {
		t.Fatal("expected error for wrong private key length")
	}
}

func TestVaultKeyStoreSignerAcceptsFullVaultRef(t *testing.T) {
	priv, _ := GenerateEd25519Key()
	fetcher := newStubFetcher()
	fetcher.store["vault:custom/path/key"] = base64.StdEncoding.EncodeToString(priv)
	ks, _ := NewVaultKeyStore(fetcher)
	if _, err := ks.Signer("vault:custom/path/key"); err != nil {
		t.Fatalf("expected full ref accepted, got %v", err)
	}
	if fetcher.count("vault:custom/path/key") != 1 {
		t.Fatalf("expected 1 resolve at full ref, got %d", fetcher.count("vault:custom/path/key"))
	}
}

func TestVaultKeyStoreTrustedKeyReturnsPublicHalf(t *testing.T) {
	priv, _ := GenerateEd25519Key()
	fetcher := newStubFetcher()
	fetcher.store["vault:skill-keys/ed25519:abc"] = base64.StdEncoding.EncodeToString(priv)
	ks, _ := NewVaultKeyStore(fetcher)
	tk, err := ks.TrustedKey("ed25519:abc")
	if err != nil {
		t.Fatal(err)
	}
	if tk.KeyID == "" {
		t.Fatal("empty KeyID")
	}
	pub, err := base64.StdEncoding.DecodeString(tk.PublicKey)
	if err != nil {
		t.Fatalf("public key decode: %v", err)
	}
	if len(pub) != ed25519.PublicKeySize {
		t.Fatalf("expected %d-byte public key, got %d", ed25519.PublicKeySize, len(pub))
	}
}

func TestVaultKeyStorePutKeyRoundtrip(t *testing.T) {
	fetcher := newStubFetcher()
	ks, _ := NewVaultKeyStore(fetcher)
	priv, _ := GenerateEd25519Key()
	if err := ks.PutKey(context.Background(), "ed25519:put", priv); err != nil {
		t.Fatal(err)
	}
	got, err := fetcher.Resolve(context.Background(), "vault:skill-keys/ed25519:put")
	if err != nil {
		t.Fatal(err)
	}
	if got != base64.StdEncoding.EncodeToString(priv) {
		t.Fatal("put/resolve mismatch")
	}
}

func TestVaultKeyStoreBackedByVaultTrue(t *testing.T) {
	ks, _ := NewVaultKeyStore(newStubFetcher())
	if !ks.BackedByVault() {
		t.Fatal("expected BackedByVault=true")
	}
	if ks.BackedByVault() == (&DevKeyStore{}).BackedByVault() {
		t.Fatal("expected BackedByVault to differ between VaultKeyStore and DevKeyStore")
	}
}