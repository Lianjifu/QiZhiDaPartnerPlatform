package signing_test

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/skills/signing"
)

// TestTrustStoreRoundTripViaJSON exercises the full TrustStore →
// WriteTrustFile → LoadTrustFile cycle that production uses to persist
// the trusted-publishers.json file. Mirrors what cmd/sign-skill does.
func TestTrustStoreRoundTripViaJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "trusted-publishers.json")

	priv, err := signing.GenerateEd25519Key()
	if err != nil {
		t.Fatalf("gen: %v", err)
	}
	s := signing.NewEd25519Signer(priv, "fixture-team")
	tf := signing.TrustFile{Keys: []signing.TrustedKey{{
		KeyID:     s.KeyID(),
		PublicKey: base64.StdEncoding.EncodeToString(s.PublicKey()),
		Name:      "fixture-team",
	}}}
	if err := signing.WriteTrustFile(path, tf); err != nil {
		t.Fatalf("write: %v", err)
	}
	loaded, err := signing.LoadTrustFile(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Keys) != 1 {
		t.Fatalf("want 1 got %d", len(loaded.Keys))
	}
	ts := signing.NewTrustStore(loaded)
	pub, err := ts.LookupPublic(s.KeyID())
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if len(pub) != ed25519.PublicKeySize {
		t.Fatalf("size mismatch: %d", len(pub))
	}
}

// TestVerifyRejectsOffByOneFileChange emulates an attacker tampering with a
// single byte in a published package: signing still succeeds over the
// original, but verification with the tampered bytes must fail.
func TestVerifyRejectsOffByOneFileChange(t *testing.T) {
	dir := t.TempDir()
	skill := filepath.Join(dir, "fixture")
	if err := os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "SKILL.md"),
		[]byte("---\nname: fixture\ndescription: x\n---\n\n# fixture\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "data.txt"),
		[]byte("good"), 0o644); err != nil {
		t.Fatal(err)
	}

	priv, _ := signing.GenerateEd25519Key()
	s := signing.NewEd25519Signer(priv, "fixture")
	files := walkSkill(t, skill, "fixture")
	meta := readSkillMeta(t, skill, "fixture")
	sig, err := signing.SignManifest(s, signing.DigestInputs{Meta: meta, Files: files})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	pub := s.PublicKey()

	// 1. Verify against unmodified files → success.
	if err := signing.VerifyManifest(pub, sig, signing.DigestInputs{Meta: meta, Files: files}); err != nil {
		t.Fatalf("baseline verify: %v", err)
	}

	// 2. Tamper with a file: append a single byte.
	files["fixture/data.txt"] = []byte("good!")
	if err := signing.VerifyManifest(pub, sig, signing.DigestInputs{Meta: meta, Files: files}); err == nil {
		t.Fatal("expected mismatch on tampered file")
	}

	// 3. Tamper with SKILL.md: prepend a space.
	files["fixture/data.txt"] = []byte("good")
	files["fixture/SKILL.md"] = []byte(" ---\nname: fixture\n")
	if err := signing.VerifyManifest(pub, sig, signing.DigestInputs{Meta: meta, Files: files}); err == nil {
		t.Fatal("expected mismatch on tampered SKILL.md")
	}
}

// walkSkill + readSkillMeta are minimal helpers used by this test only;
// kept here (vs sharing with cmd/sign-skill) so the signing package tests
// have no transitive dependency on cmd/*.
func walkSkill(t *testing.T, root, name string) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return walkErr
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		body, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[name+"/"+rel] = body
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

type localMeta struct{ name, ver, md string }

func (m *localMeta) GetName() string         { return m.name }
func (m *localMeta) GetVersion() string      { return m.ver }
func (m *localMeta) GetSkillMDRel() string   { return m.md }
func (m *localMeta) GetEntrypoints() []string { return nil }
func (m *localMeta) GetRiskLevel() string    { return "low" }

func readSkillMeta(t *testing.T, root, name string) *localMeta {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(root, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	ver := "1.0.0"
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "version:") {
			ver = strings.TrimSpace(strings.TrimPrefix(line, "version:"))
			break
		}
	}
	return &localMeta{name: name, ver: ver, md: "SKILL.md"}
}