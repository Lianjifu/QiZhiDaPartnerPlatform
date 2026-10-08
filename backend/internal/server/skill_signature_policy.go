package server

// SkillSignaturePolicy controls how user-imported skill packages are signed.
type SkillSignaturePolicy int

const (
	// PolicyAny accepts any key in the trust store (builtin publisher +
	// dev keypair). Dev default.
	PolicyAny SkillSignaturePolicy = iota
	// PolicyWorkspace requires the import be signed by THIS workspace's
	// publisher key. Pro default. Builtin attaches still work via the pack-level
	// signature (which is checked in verifyBuiltinSignature, separate path).
	PolicyWorkspace
)

// skillSignaturePolicy derives the import policy from QZDA_MODE: pro requires
// the workspace publisher key, dev accepts any trusted key.
func skillSignaturePolicy() SkillSignaturePolicy {
	if productionLikeEnv() {
		return PolicyWorkspace
	}
	return PolicyAny
}
