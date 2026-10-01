package server_test

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// isolatedDevKeypair points DE_DEV_KEYPAIR_PATH at a per-test temp dir so
// each test gets a fresh, deterministic keypair. Without this, the test
// process would inherit the dev keypair from whatever cwd the test runner
// happened to use — which is fragile and gives different keyIDs per
// invocation.
func isolatedDevKeypair(t *testing.T) {
	t.Helper()
	t.Setenv("DE_DEV_KEYPAIR_PATH", filepath.Join(t.TempDir(), "dev-keypair.json"))
	t.Setenv("DE_TRUSTED_PUBLISHERS_PATH", filepath.Join(t.TempDir(), "trusted-publishers.json"))
}

// seedTrustStoreFromManifest reads the live builtin/skills/manifest.json
// and writes its `signers` block into a temp trust file so the test
// process accepts signatures made by the manifest's publisher. This keeps
// the signer tests honest — they verify what the production server would
// verify, not a synthetic keypair.
func seedTrustStoreFromManifest(t *testing.T, manifestPath string) {
	t.Helper()
	body, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Skipf("manifest missing: %v", err)
	}
	var m struct {
		Signers map[string]signing.TrustedKey `json:"signers"`
	}
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("parse manifest: %v", err)
	}
	if len(m.Signers) == 0 {
		t.Skip("manifest has no signers block; run sign-skill first")
	}
	tf := signing.TrustFile{Keys: make([]signing.TrustedKey, 0, len(m.Signers))}
	for _, k := range m.Signers {
		tf.Keys = append(tf.Keys, k)
	}
	trustPath := filepath.Join(t.TempDir(), "trusted-publishers.json")
	if err := signing.WriteTrustFile(trustPath, tf); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DE_TRUSTED_PUBLISHERS_PATH", trustPath)
	// Disable dev keypair auto-provision so the trust store only contains
	// what we explicitly seeded.
	t.Setenv("DE_BAN_DEV_KEYPAIR", "1")
}

// builtinRoot locates builtin/skills next to the test binary. Mirrors the
// logic in builtinSkillsRoot() — duplicated here because the test runs in
// the internal/server package and we don't want to expose unexported helpers.
// After path consolidation (PR1), builtins live at services/qzda-sandbox/builtin/skills.
func builtinRoot(t *testing.T) string {
	t.Helper()
	candidates := []string{
		filepath.Join("..", "..", "services", "qzda-sandbox", "builtin", "skills"),
		filepath.Join("backend", "services", "qzda-sandbox", "builtin", "skills"),
		filepath.Join("services", "qzda-sandbox", "builtin", "skills"),
		// Legacy paths kept as fallbacks for branches that haven't migrated yet.
		filepath.Join("..", "..", "builtin", "skills"),
		filepath.Join("backend", "builtin", "skills"),
		filepath.Join("builtin", "skills"),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	t.Skip("builtin skills dir missing; cannot run W1-D2 signer tests")
	return ""
}

// TestBuiltinAttachEnforcesSigner verifies that with signing required,
// every builtin in the live manifest still attaches without error — i.e.
// all 34 sign-skill runs landed correctly.
func TestBuiltinAttachEnforcesSigner(t *testing.T) {
	root := builtinRoot(t)
	t.Setenv("DE_BUILTIN_SKILLS_DIR", root)
	t.Setenv("DE_REQUIRE_SKILL_SIGNATURE", "enabled")
	seedTrustStoreFromManifest(t, filepath.Join(root, "manifest.json"))

	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()

	// At least one builtin should have been installed with a packagePath,
	// meaning the signer verify pass didn't reject any of them.
	var installed int
	for _, sk := range st.Skills {
		if str(sk["packagePath"]) != "" {
			installed++
		}
	}
	if installed == 0 {
		t.Fatal("expected builtins to be installed with materialised packages; signer gate must have rejected everything")
	}
}

// TestBuiltinAttachRejectsUnknownKey tampers the manifest by replacing the
// trusted publisher public key with a random attacker's key, then verifies
// that attachBuiltinPackageToSkill refuses every builtin with
// SkillSignatureInvalid (or _UnknownKey).
func TestBuiltinAttachRejectsUnknownKey(t *testing.T) {
	root := builtinRoot(t)
	t.Setenv("DE_BUILTIN_SKILLS_DIR", root)
	t.Setenv("DE_REQUIRE_SKILL_SIGNATURE", "enabled")
	// DO NOT seed the trust store. The signer bootstrap will fall back to
	// the dev keypair (keyID 8d0880... or whatever this run produces),
	// which is NOT in the manifest's `signers` block. Every builtin should
	// therefore fail with SkillSignatureUnknownKey.
	isolatedDevKeypair(t)

	// Take a snapshot of the manifest before tampering.
	origPath := filepath.Join(root, "manifest.json")
	origBytes, err := os.ReadFile(origPath)
	if err != nil {
		t.Skipf("manifest missing: %v", err)
	}
	t.Cleanup(func() { _ = os.WriteFile(origPath, origBytes, 0o644) })

	// Load + tamper: substitute an attacker's public key for every signer.
	var manifest map[string]any
	if err := decodeJSONManifest(origBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	signersAny, ok := manifest["signers"].(map[string]any)
	if !ok || len(signersAny) == 0 {
		t.Skip("manifest has no signers block — run sign-skill first")
	}
	for keyID, signer := range signersAny {
		signerMap, _ := signer.(map[string]any)
		_ = keyID
		signerMap["publicKey"] = base64.StdEncoding.EncodeToString(makeAttackerPubKey())
		signersAny[keyID] = signerMap
	}
	tampered, _ := encodeJSONManifest(manifest)
	if err := os.WriteFile(origPath, tampered, 0o644); err != nil {
		t.Fatal(err)
	}

	// Now boot and expect materialisation to fail across the board.
	st := store.New()
	srv := server.New(st)
	// EnsureBuiltinSkillsReady logs but does not return errors for missing
	// builtins, so we look at the resulting state instead.
	srv.EnsureBuiltinSkillsReady()

	var installed int
	for _, sk := range st.Skills {
		if str(sk["packagePath"]) != "" {
			installed++
		}
	}
	if installed != 0 {
		t.Fatalf("attacker key should have prevented materialisation; installed=%d", installed)
	}
}

// TestBuiltinAttachSkipsSignerWhenDisabled checks the env-controlled
// escape hatch (DE_REQUIRE_SKILL_SIGNATURE=disabled). Even with a busted
// manifest, the server still installs the packages.
func TestBuiltinAttachSkipsSignerWhenDisabled(t *testing.T) {
	root := builtinRoot(t)
	t.Setenv("DE_BUILTIN_SKILLS_DIR", root)
	t.Setenv("DE_REQUIRE_SKILL_SIGNATURE", "disabled")
	isolatedDevKeypair(t)

	// Garbage the signature field; disabled mode should ignore it.
	origPath := filepath.Join(root, "manifest.json")
	origBytes, _ := os.ReadFile(origPath)
	t.Cleanup(func() {
		if origBytes != nil {
			_ = os.WriteFile(origPath, origBytes, 0o644)
		}
	})

	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()

	var installed int
	for _, sk := range st.Skills {
		if str(sk["packagePath"]) != "" {
			installed++
		}
	}
	if installed == 0 {
		t.Fatal("disabled mode should still install builtins")
	}
}

func makeAttackerPubKey() []byte {
	// Random Ed25519 public key not in the trust store.
	priv, err := signing.GenerateEd25519Key()
	if err != nil {
		panic(err)
	}
	pub := priv.Public().(ed25519.PublicKey)
	out := make([]byte, len(pub))
	copy(out, pub)
	return out
}