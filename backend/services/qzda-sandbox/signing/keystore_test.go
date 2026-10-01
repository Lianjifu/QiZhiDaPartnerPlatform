package signing

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTrustStoreAddLookupRemove(t *testing.T) {
	priv, _ := GenerateEd25519Key()
	s := NewEd25519Signer(priv, "alice")
	pub := s.PublicKey()
	b64 := base64.StdEncoding.EncodeToString(pub)

	ts := NewTrustStore(TrustFile{})
	ts.Add(TrustedKey{KeyID: s.KeyID(), PublicKey: b64, Name: "alice"})

	got, ok := ts.Lookup(s.KeyID())
	if !ok {
		t.Fatalf("missing after Add")
	}
	if got.Name != "alice" {
		t.Fatalf("name mismatch: %s", got.Name)
	}
	decoded, err := ts.LookupPublic(s.KeyID())
	if err != nil {
		t.Fatalf("LookupPublic: %v", err)
	}
	if !decoded.Equal(pub) {
		t.Fatalf("decoded pubkey mismatch")
	}

	// Bad keyID → error.
	if _, err := ts.LookupPublic("ed25519:deadbeef"); err == nil {
		t.Fatalf("expected error for unknown keyID")
	}

	if !ts.Remove(s.KeyID()) {
		t.Fatalf("Remove should report true")
	}
	if _, ok := ts.Lookup(s.KeyID()); ok {
		t.Fatalf("still present after Remove")
	}
}

func TestTrustFileRoundtrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "trust.json")

	priv, _ := GenerateEd25519Key()
	s := NewEd25519Signer(priv, "bob")
	tf := TrustFile{Keys: []TrustedKey{{
		KeyID: s.KeyID(), PublicKey: base64.StdEncoding.EncodeToString(s.PublicKey()),
		Name: "bob", AddedAt: s.signerClock(),
	}}}
	if err := WriteTrustFile(path, tf); err != nil {
		t.Fatalf("write: %v", err)
	}
	loaded, err := LoadTrustFile(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Keys) != 1 {
		t.Fatalf("want 1 key got %d", len(loaded.Keys))
	}
	if loaded.Keys[0].KeyID != s.KeyID() {
		t.Fatalf("keyID mismatch")
	}
}

func TestLoadTrustFileMissingReturnsEmpty(t *testing.T) {
	tf, err := LoadTrustFile(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil {
		t.Fatalf("missing file should not error: %v", err)
	}
	if len(tf.Keys) != 0 {
		t.Fatalf("want empty, got %d", len(tf.Keys))
	}
}

func TestDevKeyStoreAutoProvisions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "dev-keypair.json")
	d, err := NewDevKeyStore(path)
	if err != nil {
		t.Fatalf("NewDevKeyStore: %v", err)
	}
	s, err := d.Signer("")
	if err != nil {
		t.Fatalf("Signer(): %v", err)
	}
	if s == nil {
		t.Fatalf("nil signer after provisioning")
	}
	// File on disk.
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("file missing: %v", err)
	}
	if len(body) == 0 {
		t.Fatalf("empty file")
	}
	// TrustedKey record is consistent with signer.
	tk, err := d.TrustedKey("")
	if err != nil {
		t.Fatalf("TrustedKey: %v", err)
	}
	if tk.KeyID != s.KeyID() {
		t.Fatalf("keyID drift: %s vs %s", tk.KeyID, s.KeyID())
	}
	// Sign → verify roundtrip through TrustStore.
	ts := NewTrustStore(TrustFile{})
	ts.Add(tk)
	sig, err := SignManifest(s, DigestInputs{
		Meta:  &fakeMeta{name: "x", ver: "1"},
		Files: map[string][]byte{"a": []byte("x")},
	})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	pub, err := ts.LookupPublic(s.KeyID())
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if err := VerifyManifest(pub, sig, DigestInputs{
		Meta:  &fakeMeta{name: "x", ver: "1"},
		Files: map[string][]byte{"a": []byte("x")},
	}); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestDevKeyStoreReusesExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "dev-keypair.json")
	d1, err := NewDevKeyStore(path)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	firstSigner, err := d1.Signer("")
	if err != nil {
		t.Fatalf("first signer: %v", err)
	}
	firstKeyID := firstSigner.KeyID()
	d2, err := NewDevKeyStore(path)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	secondSigner, err := d2.Signer("")
	if err != nil {
		t.Fatalf("second signer: %v", err)
	}
	if secondSigner.KeyID() != firstKeyID {
		t.Fatalf("keypair changed between calls: %s vs %s", firstKeyID, secondSigner.KeyID())
	}
}

func TestDevKeyStoreCorruptFileErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "dev-keypair.json")
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := NewDevKeyStore(path); err == nil {
		t.Fatalf("expected error on corrupt file")
	}
}

func TestEncodePublicHex(t *testing.T) {
	pub := make(ed25519.PublicKey, 32)
	for i := range pub {
		pub[i] = byte(i)
	}
	got := EncodePublicHex(pub)
	if len(got) != 64 {
		t.Fatalf("want 64 chars got %d", len(got))
	}
}

// signerClock is a tiny helper to satisfy the TrustedKey.AddedAt field in
// the roundtrip test. Keeps the test focused on persistence without
// importing time at the call site.
func (s *Ed25519Signer) signerClock() time.Time { return time.Unix(0, 0).UTC() }