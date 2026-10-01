package server

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// buildSkillZip assembles a minimal .skill zip with the given files (rootDir
// prefix required for SKILL.md) and returns the raw bytes. Extra files may
// be passed in via extras (already prefixed with rootDir).
func buildSkillZip(t *testing.T, rootDir, skillMD string, extras map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, content string) {
		t.Helper()
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if rootDir != "" {
		add(rootDir+"/SKILL.md", skillMD)
	} else {
		add("SKILL.md", skillMD)
	}
	for name, content := range extras {
		add(name, content)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestShouldSkipSkillPackagePathAllowsSignatureSidecar(t *testing.T) {
	// W2-D1 · signature sidecar must NOT be filtered out by the dotfile guard.
	if shouldSkipSkillPackagePath("hello-skill/.skillpkg.signature.json") {
		t.Fatalf("sidecar at root must not be skipped")
	}
	if shouldSkipSkillPackagePath(".skillpkg.signature.json") {
		t.Fatalf("sidecar at zip root must not be skipped")
	}
	// ...but ordinary dotfiles still skip.
	if !shouldSkipSkillPackagePath("hello-skill/.env") {
		t.Fatalf(".env must still be skipped")
	}
	if !shouldSkipSkillPackagePath("hello-skill/.git/HEAD") {
		t.Fatalf(".git/HEAD must still be skipped")
	}
}

func TestParseSkillPackageReadsSignatureSidecar(t *testing.T) {
	// W2-D1 · a .skill package carrying a .skillpkg.signature.json sidecar
	// must populate meta.Signature/KeyID/SignedAt/SignerName.
	raw := buildSkillZip(t, "hello-skill",
		"---\nname: hello-skill\ndescription: sidecar readback\nversion: 0.1.0\n---\n\nbody\n",
		map[string]string{
			"hello-skill/.skillpkg.signature.json": `{
  "keyId": "ed25519:9a5c62d02dc4a7f1",
  "signature": "AAAA",
  "signedAt": "2026-09-07T12:34:56Z",
  "signerName": "Test Publisher"
}`,
		},
	)
	meta, _, err := parseSkillPackage("hello.skill", raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if meta.Signature != "AAAA" {
		t.Fatalf("meta.Signature=%q", meta.Signature)
	}
	if meta.KeyID != "ed25519:9a5c62d02dc4a7f1" {
		t.Fatalf("meta.KeyID=%q", meta.KeyID)
	}
	if meta.SignerName != "Test Publisher" {
		t.Fatalf("meta.SignerName=%q", meta.SignerName)
	}
	if meta.SignedAt.IsZero() {
		t.Fatalf("meta.SignedAt should be set, got zero")
	}
}

func TestParseSkillPackageAcceptsMissingSidecar(t *testing.T) {
	// W2-D1 · unsigned packages (no sidecar) parse cleanly with empty
	// signature fields — verifyImportSignature is what gates the actual
	// signature check, not parseSkillPackage.
	raw := buildSkillZip(t, "hello-skill",
		"---\nname: hello-skill\ndescription: no sidecar\nversion: 0.1.0\n---\n\nbody\n",
		nil,
	)
	meta, _, err := parseSkillPackage("hello.skill", raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if meta.Signature != "" || meta.KeyID != "" {
		t.Fatalf("expected empty sig fields, got sig=%q key=%q", meta.Signature, meta.KeyID)
	}
}

func TestParseSkillPackageIgnoresMalformedSidecar(t *testing.T) {
	// W2-D1 · malformed sidecar JSON must NOT block parse — the package
	// parses, signature fields stay empty, verifyImportSignature returns
	// SkillSignatureMissing. Backward compatible with legacy packages that
	// ship a stray `.skillpkg.signature.json` from a CI artifact.
	raw := buildSkillZip(t, "hello-skill",
		"---\nname: hello-skill\ndescription: bad sidecar\nversion: 0.1.0\n---\n\nbody\n",
		map[string]string{
			"hello-skill/.skillpkg.signature.json": `{ this is not json`,
		},
	)
	meta, _, err := parseSkillPackage("hello.skill", raw)
	if err != nil {
		t.Fatalf("parse should succeed, got: %v", err)
	}
	if meta.Signature != "" || meta.KeyID != "" {
		t.Fatalf("malformed sidecar must not populate sig fields, got sig=%q key=%q",
			meta.Signature, meta.KeyID)
	}
}

// TestMaterializeSkillPackageSkipsSignatureSidecar exercises the on-disk
// skip path: even though shouldSkipSkillPackagePath returns false for
// .skillpkg.signature.json (so the file is present in the files map), it
// must not be written to the materialized package directory.
func TestMaterializeSkillPackageSkipsSignatureSidecar(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("DE_SANDBOX_PACKAGE_DIR", tmp)

	files := map[string][]byte{
		"hello-skill/SKILL.md":            []byte("---\nname: hello-skill\ndescription: x\n---\n"),
		"hello-skill/.skillpkg.signature.json": []byte(`{"keyId":"k","signature":"s"}`),
	}
	srv := &Server{}
	dest, err := srv.materializeSkillPackage("w1", "sk-test", "hello-skill", files)
	if err != nil {
		t.Fatalf("materialize: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "SKILL.md")); err != nil {
		t.Fatalf("SKILL.md missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, skillpkgSignatureFile)); !os.IsNotExist(err) {
		t.Fatalf("sidecar must not be materialized (got err=%v)", err)
	}
	// And it must not appear under any subdir either.
	entries, _ := os.ReadDir(dest)
	for _, e := range entries {
		if strings.Contains(e.Name(), ".skillpkg") {
			t.Fatalf("unexpected file in materialize dir: %s", e.Name())
		}
	}
}
