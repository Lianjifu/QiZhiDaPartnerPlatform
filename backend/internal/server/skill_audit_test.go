package server_test

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// ed25519PublicKey is an alias for the ed25519.PublicKey byte slice type so
// the test doesn't have to import crypto/ed25519 directly (and avoids
// future import-cycle concerns if signing moves to a different base).
type ed25519PublicKey = []byte

// TestAuditWrittenOnBuiltinSignatureFailure verifies that when
// attachBuiltinPackageToSkill rejects a builtin because of a signature
// mismatch (simulated by tampering the manifest's recorded public key),
// an audit row is appended with actor=系统, action=skill 签名验证,
// result=denied.
func TestAuditWrittenOnBuiltinSignatureFailure(t *testing.T) {
	root := builtinRoot(t)
	t.Setenv("QZDA_BUILTIN_SKILLS_DIR", root)
	t.Setenv("QZDA_REQUIRE_SKILL_SIGNATURE", "enabled")
	isolatedDevKeypair(t)

	// Swap the manifest's recorded public key for an attacker's. The
	// signer will still pass internal verification via the dev keypair,
	// but verifyBuiltinSignature reads the manifest's `signers` block
	// first — so every builtin should now be rejected.
	origPath := filepath.Join(root, "manifest.json")
	origBytes, err := os.ReadFile(origPath)
	if err != nil {
		t.Skipf("manifest missing: %v", err)
	}
	t.Cleanup(func() { _ = os.WriteFile(origPath, origBytes, 0o644) })

	var m map[string]any
	if err := json.Unmarshal(origBytes, &m); err != nil {
		t.Fatal(err)
	}
	signersAny, _ := m["signers"].(map[string]any)
	if len(signersAny) == 0 {
		t.Skip("manifest has no signers block; run sign-skill first")
	}
	attacker, _ := signing.GenerateEd25519Key()
	attackerPub, _ := attacker.Public().(ed25519PublicKey)
	attackerPubCopy := append([]byte(nil), []byte(attackerPub)...)
	for _, signer := range signersAny {
		signerMap := signer.(map[string]any)
		signerMap["publicKey"] = base64.StdEncoding.EncodeToString(attackerPubCopy)
	}
	tampered, _ := json.MarshalIndent(m, "", "  ")
	if err := os.WriteFile(origPath, tampered, 0o644); err != nil {
		t.Fatal(err)
	}

	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()

	// Audit must contain at least one denied skill-签名验证 row.
	var denied int
	for _, ev := range st.Audits {
		if strings.Contains(str(ev["action"]), "签名验证") && str(ev["result"]) == "denied" {
			denied++
		}
	}
	if denied == 0 {
		t.Fatalf("expected audit row for signature failure, got 0 (have %d audits total)", len(st.Audits))
	}
}

// TestAuditWrittenOnImportSignatureFailure builds an unsigned skill zip
// and uploads it through /api/skills/import-package. The endpoint must
// reject with SkillSignatureMissing and emit an audit row carrying the
// caller's identity.
func TestAuditWrittenOnImportSignatureFailure(t *testing.T) {
	root := builtinRoot(t)
	t.Setenv("QZDA_BUILTIN_SKILLS_DIR", root)
	t.Setenv("QZDA_REQUIRE_SKILL_SIGNATURE", "enabled")
	isolatedDevKeypair(t)

	tmp := t.TempDir()
	t.Setenv("QZDA_SANDBOX_PACKAGE_DIR", tmp)
	t.Setenv("QZDA_SANDBOX_TEST_SIM", "1")
	t.Setenv("QZDA_SANDBOX_RUNTIME_URL", "http://127.0.0.1:1")

	h := server.New(store.New()).Handler()

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("unsigned-skill/SKILL.md")
	_, _ = w.Write([]byte("---\nname: unsigned-skill\ndescription: x\n---\n"))
	_ = zw.Close()

	body, _ := json.Marshal(map[string]any{
		"fileName":       "unsigned.skill",
		"contentBase64":  base64.StdEncoding.EncodeToString(buf.Bytes()),
	})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/skills/import-package", "mock-admin-token", string(body))
	if rr.Code != 400 {
		t.Fatalf("expected 400 on unsigned import, got %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_SKILL_SIGNATURE_MISSING") {
		t.Fatalf("expected E_SKILL_SIGNATURE_MISSING, got %s", rr.Body.String())
	}

	// Audit must show a denied row for this upload.
	st := store.New()
	// Re-run so we can observe the audit trail attached to the store the
	// import actually wrote to. (knowledgeDo uses its own server; we
	// rebuild and re-run.)
	_ = st
	srv := server.New(store.New())
	h2 := srv.Handler()
	rr2 := knowledgeDo(t, h2, http.MethodPost, "/api/skills/import-package", "mock-admin-token", string(body))
	if rr2.Code != 400 {
		t.Fatalf("second run: expected 400, got %d", rr2.Code)
	}
	var denied int
	for _, ev := range srv.Store.Audits {
		if strings.Contains(str(ev["action"]), "签名验证") && str(ev["result"]) == "denied" {
			denied++
		}
	}
	if denied == 0 {
		t.Fatalf("expected audit row for import signature failure, got 0")
	}
}

// TestLoadTrustedPublishersPlaceholder verifies the empty placeholder
// ships in the repo and parses to a usable empty TrustStore.
func TestLoadTrustedPublishersPlaceholder(t *testing.T) {
	path, err := filepath.Abs("data/skill-keys/trusted-publishers.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Skipf("placeholder missing: %v", err)
	}
	tf, err := signing.LoadTrustFile(path)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(tf.Keys) != 0 {
		t.Fatalf("expected empty, got %d keys", len(tf.Keys))
	}
	ts := signing.NewTrustStore(tf)
	if _, ok := ts.Lookup("anything"); ok {
		t.Fatalf("empty store should have no keys")
	}
}