package skills

// Signer is the public interface the M09 技能中心 module uses to talk
// to the skill signing layer (services/qzda-sandbox/signing — an
// independent micro-service code that lives outside internal/).
//
// The concrete implementation (*signing.SignerResolver) is constructed
// in server.go's bootstrapSkillSigning + bootstrapVaultSkillSigning
// boot path (which loads trusted-publishers.json, auto-provisions the
// dev keypair, or wires the vault keystore). That same path passes the
// resolved signer into Service via Deps.Signer or the Service.Signer
// field, and the M09 handlers cast it back to the concrete type when
// they need to verify a manifest.
//
// We deliberately keep the Signer interface narrow and typed as `any`
// inside the Service struct (rather than importing the signing package
// directly) so the M09 package boundary stays independent of the
// micro-service code. Tests inject a mock via Service.Signer without
// pulling in any ed25519 implementation.
//
// Methods mirror the public surface of services/qzda-sandbox/signing:
//   - LoadTrustStore: called once at boot to hydrate the trust store
//     from trusted-publishers.json (delegates to signing.LoadTrustFile).
//   - Sign: signs a manifest blob with the named key.
//   - Verify: verifies a signature against a public key.
//   - KeyID: returns the active key identifier (for audit row detail).
//
// The implementation of these methods in
// services/qzda-sandbox/signing/{signer,keystore}.go is the canonical
// reference — keep the interface in lock-step with that file.
//
// Failure modes:
//   - LoadTrustStore returns an error when the trust file is missing or
//     malformed; the boot path is fail-closed (logged + blocked).
//   - Sign / Verify return errors on bad input or signature mismatch.
//   - KeyID returns "" when no signer is active.
type Signer interface {
	LoadTrustStore(path string) error
	Sign(keyID string, payload []byte) ([]byte, error)
	Verify(pub any, sig, payload []byte) error
	KeyID() string
}
