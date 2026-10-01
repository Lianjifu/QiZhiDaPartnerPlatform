// Package signing implements Ed25519 signing/verification for skill
// packages. W1-D2 introduces this as the second gate on top of W1-D1 vetter:
// a malicious skill that passes the vetter (e.g. an innocuous "curl" call
// that wouldn't be flagged) cannot impersonate a builtin publisher without
// holding the matching private key.
//
// The contract is intentionally narrow:
//
//   - Signer holds a private key, exposes its public key + KeyID, signs
//     canonical-form bytes.
//   - Verify takes a public key, canonical bytes, signature — returns
//     nil on success, an error otherwise.
//   - TrustStore (keystore.go) holds the public keys of trusted publishers
//     and is consulted by the server at attach/import time.
//
// Canonical JSON (canonical.go) is what gets signed. It is deterministic:
// same map → same bytes regardless of insertion order or formatting.
package signing

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

// Signer is the producer-side facade. Implementations may keep the private
// key in memory, in a file, or behind a Vault; the interface is fixed.
type Signer interface {
	// Sign returns the signature over canonical bytes.
	Sign(canonical []byte) ([]byte, error)
	// PublicKey returns the raw 32-byte Ed25519 public key.
	PublicKey() ed25519.PublicKey
	// KeyID returns the stable identifier for the key — fingerprint of the
	// public key, used as the lookup key in TrustStore.
	KeyID() string
	// Name is the human-readable label for the publisher.
	Name() string
}

// Ed25519Signer is the default implementation. Private key is held in memory;
// for long-lived server use, callers should serialize it via PEM / JSON once
// and reload on restart (see DevKeyStore in keystore.go).
type Ed25519Signer struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
	id   string
	name string
}

// GenerateEd25519Key generates a fresh Ed25519 keypair. The returned
// []byte is the 64-byte private seed.
func GenerateEd25519Key() (ed25519.PrivateKey, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return priv, nil
}

// NewEd25519Signer wraps an existing private key. The KeyID is derived from
// the public key (SHA256, first 8 bytes hex-prefixed with "ed25519:").
func NewEd25519Signer(priv ed25519.PrivateKey, name string) *Ed25519Signer {
	pub := priv.Public().(ed25519.PublicKey)
	h := sha256.Sum256(pub)
	return &Ed25519Signer{
		priv: priv,
		pub:  pub,
		id:   "ed25519:" + hex.EncodeToString(h[:8]),
		name: name,
	}
}

func (s *Ed25519Signer) Sign(canonical []byte) ([]byte, error) {
	return ed25519.Sign(s.priv, canonical), nil
}

func (s *Ed25519Signer) PublicKey() ed25519.PublicKey { return s.pub }
func (s *Ed25519Signer) KeyID() string                { return s.id }
func (s *Ed25519Signer) Name() string                 { return s.name }

// Verify checks an Ed25519 signature over canonical bytes with the given
// public key. Returns nil on success, an error on any failure (wrong key,
// tampered message, malformed signature). Callers should treat any non-nil
// return as "do not trust this artifact".
func Verify(pub ed25519.PublicKey, canonical, sig []byte) error {
	if len(pub) != ed25519.PublicKeySize {
		return errors.New("signing: invalid public key length")
	}
	if len(sig) != ed25519.SignatureSize {
		return errors.New("signing: invalid signature length")
	}
	if !ed25519.Verify(pub, canonical, sig) {
		return errors.New("signing: signature mismatch")
	}
	return nil
}

// KeyIDFor returns the KeyID for an arbitrary public key — used by callers
// that load a public key from disk and need to look it up in the TrustStore.
func KeyIDFor(pub ed25519.PublicKey) string {
	h := sha256.Sum256(pub)
	return "ed25519:" + hex.EncodeToString(h[:8])
}