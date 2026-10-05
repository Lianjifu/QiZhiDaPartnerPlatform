package skills

import (
	"os"
	"strings"
)

// SkillSignaturePolicy controls how user-imported skill packages are signed.
// W2-D1 extended W1-D2's two-state gate with a third "workspace" mode that
// requires the per-workspace publisher key.
type SkillSignaturePolicy int

const (
	// PolicyOff disables signature verification entirely. Dev mode only.
	PolicyOff SkillSignaturePolicy = iota
	// PolicyAny accepts any key in the trust store (builtin publisher +
	// dev keypair). This is the W1-D2 default.
	PolicyAny
	// PolicyWorkspace requires the import be signed by THIS workspace's
	// publisher key. Builtin attaches still work via the pack-level
	// signature (which is checked in verifyBuiltinSignature, separate path).
	PolicyWorkspace
)

// skillSignaturePolicy reads QZDA_REQUIRE_SKILL_SIGNATURE and returns the
// policy the server enforces at skill import time.
//
// Recognized values:
//
//	off / disabled / false  → PolicyOff (only honored in non-prod)
//	any  / enabled / true   → PolicyAny
//	workspace / strict     → PolicyWorkspace
//	(empty)                → PolicyAny (W1-D2 back-compat default)
//
// In a production-like environment (QZDA_ENV=staging|production), PolicyOff
// is auto-promoted to PolicyWorkspace — operators cannot accidentally run
// an unsigned-import server in prod.
//
// Back-compat note: skillSignatureRequired (defined in builtin_skills.go)
// delegates to this function — keep that single source of truth.
func skillSignaturePolicy() SkillSignaturePolicy {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_REQUIRE_SKILL_SIGNATURE")))
	switch raw {
	case "", "any", "enabled", "true", "on":
		return PolicyAny
	case "workspace", "strict":
		return PolicyWorkspace
	case "off", "disabled", "false", "0":
		if productionLikeEnv() {
			return PolicyWorkspace
		}
		return PolicyOff
	case "warn_only", "warn":
		// W1-D2 legacy alias — treat as PolicyAny to avoid breaking the
		// vetter warn_only mode that historically piggybacked on this var.
		return PolicyAny
	}
	return PolicyAny
}
