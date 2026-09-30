package main

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/skills/signing"
)

const sampleSKILLMD = `---
name: roundtrip-skill
description: end-to-end test
version: 0.2.3
risk: low
---
this is the body
`

// writeTestZip builds a zip at path containing files (path → bytes). Used
// by all archive-roundtrip tests so they can stage input without relying
// on disk fixtures.
func writeTestZip(t *testing.T, path string, files map[string][]byte) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write(body); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
}

// readTestZip reads a zip from path into a path → bytes map. Asserts on
// every entry so test failures point at a specific file.
func readTestZip(t *testing.T, path string) map[string][]byte {
	t.Helper()
	r, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer r.Close()
	out := make(map[string][]byte, len(r.File))
	for _, f := range r.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open entry %s: %v", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read entry %s: %v", f.Name, err)
		}
		out[f.Name] = data
	}
	return out
}

// freshKey generates an Ed25519 keypair for the test. Returns (priv, pubB64).
func freshKey(t *testing.T) (ed25519.PrivateKey, ed25519.PublicKey, string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	return priv, pub, base64.StdEncoding.EncodeToString(pub)
}

func TestSignSkillPackArchiveRoundtrip(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "foo.skill")
	writeTestZip(t, src, map[string][]byte{
		"ws-skill/SKILL.md": []byte(sampleSKILLMD),
	})

	priv, pub, _ := freshKey(t)

	keyID, out, err := signArchive(src, priv, "http://127.0.0.1:1", "w1", "ignored", true)
	if err != nil {
		t.Fatalf("signArchive: %v", err)
	}
	if !strings.HasPrefix(keyID, "ed25519:") {
		t.Fatalf("unexpected keyID prefix: %q", keyID)
	}
	if filepath.Base(out) != "foo.skill.signed.skill" {
		t.Fatalf("unexpected output path: %s", out)
	}

	// Re-open the signed archive, recompute the canonical manifest from
	// the same SKILL.md the CLI extracted (skillRel == "SKILL.md" — the
	// basename, matching server behaviour), and verify the sidecar
	// signature against the test pubkey.
	files := readTestZip(t, out)
	sidecar, ok := files["ws-skill/.skillpkg.signature.json"]
	if !ok {
		t.Fatalf("sidecar missing from signed archive; got entries: %v", mapKeys(files))
	}
	var sc struct {
		KeyID     string `json:"keyId"`
		Signature string `json:"signature"`
		SignedAt  string `json:"signedAt"`
	}
	if err := json.Unmarshal(sidecar, &sc); err != nil {
		t.Fatalf("parse sidecar: %v\n%s", err, string(sidecar))
	}
	if sc.KeyID != keyID {
		t.Fatalf("sidecar keyID %q != returned keyID %q", sc.KeyID, keyID)
	}
	if sc.SignedAt == "" {
		t.Fatalf("sidecar signedAt is empty")
	}

	// Strip the sidecar before re-computing the digest — the server does
	// the same when verifying.
	delete(files, "ws-skill/.skillpkg.signature.json")

	meta := &skillMetaShim{
		name:    "roundtrip-skill",
		version: "0.2.3",
		rel:     "SKILL.md",
		risk:    "low",
	}
	if err := signing.VerifyManifest(pub, mustDecodeB64(t, sc.Signature), signing.DigestInputs{
		Meta:  meta,
		Files: files,
	}); err != nil {
		t.Fatalf("verify signed manifest: %v", err)
	}
}

func TestSignSkillPackPreservesFiles(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "preserve.skill")
	original := map[string][]byte{
		"ws-skill/SKILL.md":  []byte(sampleSKILLMD),
		"ws-skill/main.go":   []byte("package main\n"),
		"ws-skill/util/util.go": []byte("package util\n"),
		"ws-skill/README.md": []byte("# README\n"),
	}
	writeTestZip(t, src, original)

	priv, _, _ := freshKey(t)
	_, out, err := signArchive(src, priv, "http://127.0.0.1:1", "w1", "ignored", true)
	if err != nil {
		t.Fatalf("signArchive: %v", err)
	}

	got := readTestZip(t, out)
	for name, body := range original {
		if !bytes.Equal(got[name], body) {
			t.Errorf("file %s differs after signing\n  got:  %q\n  want: %q", name, got[name], body)
		}
	}
	if _, ok := got["ws-skill/.skillpkg.signature.json"]; !ok {
		t.Fatalf("sidecar missing; entries: %v", mapKeys(got))
	}
	// Exact count: N originals + 1 sidecar, no duplicates.
	if len(got) != len(original)+1 {
		t.Errorf("unexpected entry count: got %d, want %d (%v)", len(got), len(original)+1, mapKeys(got))
	}
}

func TestSignSkillPackRefusesOverwriteWithoutForce(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "ow.skill")
	writeTestZip(t, src, map[string][]byte{
		"ws-skill/SKILL.md": []byte(sampleSKILLMD),
	})

	priv, _, _ := freshKey(t)
	if _, _, err := signArchive(src, priv, "http://127.0.0.1:1", "w1", "ignored", true); err != nil {
		t.Fatalf("first sign: %v", err)
	}
	_, _, err := signArchive(src, priv, "http://127.0.0.1:1", "w1", "ignored", false)
	if err == nil {
		t.Fatalf("expected overwrite error, got nil")
	}
	if !strings.Contains(err.Error(), "exists") {
		t.Fatalf("error did not mention 'exists': %v", err)
	}
}

func TestSignSkillPackForceOverwrites(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "force.skill")
	writeTestZip(t, src, map[string][]byte{
		"ws-skill/SKILL.md": []byte(sampleSKILLMD),
	})

	priv, _, _ := freshKey(t)
	if _, _, err := signArchive(src, priv, "http://127.0.0.1:1", "w1", "ignored", true); err != nil {
		t.Fatalf("first sign: %v", err)
	}
	if _, _, err := signArchive(src, priv, "http://127.0.0.1:1", "w1", "ignored", true); err != nil {
		t.Fatalf("force overwrite: %v", err)
	}
}

func TestSignSkillPackStripsPreviousSidecarBeforeSigning(t *testing.T) {
	// Re-signing an already-signed package must not include the prior
	// sidecar in the new digest; otherwise the digest would self-reference
	// the sidecar and the server-side verify would fail. We prove this by
	// confirming the post-sign digest matches the digest of the original
	// (no-sidecar) archive.
	dir := t.TempDir()
	src := filepath.Join(dir, "re.skill")
	writeTestZip(t, src, map[string][]byte{
		"ws-skill/SKILL.md": []byte(sampleSKILLMD),
	})

	priv, _, _ := freshKey(t)
	if _, _, err := signArchive(src, priv, "http://127.0.0.1:1", "w1", "ignored", true); err != nil {
		t.Fatalf("first sign: %v", err)
	}
	out := src + ".signed.skill"
	// Sign the signed archive again, with a different key — the second
	// signature must verify using ONLY the original files (the first
	// sidecar must not have leaked into the digest).
	priv2, pub2, _ := freshKey(t)
	if _, _, err := signArchive(out, priv2, "http://127.0.0.1:1", "w1", "ignored", true); err != nil {
		t.Fatalf("second sign: %v", err)
	}
	out2 := out + ".signed.skill"

	files := readTestZip(t, out2)
	sidecarBytes := files["ws-skill/.skillpkg.signature.json"]
	var sc struct {
		KeyID     string `json:"keyId"`
		Signature string `json:"signature"`
	}
	if err := json.Unmarshal(sidecarBytes, &sc); err != nil {
		t.Fatalf("parse second sidecar: %v", err)
	}
	delete(files, "ws-skill/.skillpkg.signature.json")
	meta := &skillMetaShim{name: "roundtrip-skill", version: "0.2.3", rel: "SKILL.md", risk: "low"}
	if err := signing.VerifyManifest(pub2, mustDecodeB64(t, sc.Signature), signing.DigestInputs{
		Meta: meta, Files: files,
	}); err != nil {
		t.Fatalf("second sidecar fails verify (prior sidecar leaked?): %v", err)
	}
	if sc.KeyID != signing.KeyIDFor(pub2) {
		t.Fatalf("second sidecar keyID %q != pub2 keyID %q", sc.KeyID, signing.KeyIDFor(pub2))
	}
}

func TestSignSkillPackRejectsArchiveWithoutSkillMD(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "noskillmd.skill")
	writeTestZip(t, src, map[string][]byte{
		"ws-skill/main.go": []byte("package main\n"),
	})
	priv, _, _ := freshKey(t)
	_, _, err := signArchive(src, priv, "http://127.0.0.1:1", "w1", "ignored", true)
	if err == nil {
		t.Fatalf("expected error for archive missing SKILL.md")
	}
	if !strings.Contains(err.Error(), "SKILL.md") {
		t.Fatalf("error did not mention SKILL.md: %v", err)
	}
}

func TestParseFrontmatterMetaExtractsFields(t *testing.T) {
	name, version, risk, err := parseFrontmatterMeta([]byte(sampleSKILLMD))
	if err != nil {
		t.Fatalf("parseFrontmatterMeta: %v", err)
	}
	if name != "roundtrip-skill" {
		t.Errorf("name: got %q", name)
	}
	if version != "0.2.3" {
		t.Errorf("version: got %q", version)
	}
	if risk != "low" {
		t.Errorf("risk: got %q", risk)
	}
}

func TestParseFrontmatterMetaDefaults(t *testing.T) {
	_, version, risk, err := parseFrontmatterMeta([]byte("---\nname: only-name\n---\n"))
	if err != nil {
		t.Fatalf("parseFrontmatterMeta: %v", err)
	}
	if version != "0.1.0" || risk != "low" {
		t.Errorf("defaults not applied: version=%q risk=%q", version, risk)
	}
}

func TestParseFrontmatterMetaRejectsMissingFrontmatter(t *testing.T) {
	if _, _, _, err := parseFrontmatterMeta([]byte("no frontmatter here")); err == nil {
		t.Fatalf("expected error")
	}
}

func TestExtractZipRawSkipsDirectoriesAndLocatesSkillMD(t *testing.T) {
	files, root, rel, body, err := extractZipRaw(mustBuildZip(t, map[string][]byte{
		"ws-skill/":            nil,
		"ws-skill/SKILL.md":    []byte(sampleSKILLMD),
		"ws-skill/main.go":     []byte("x"),
		"ws-skill/sub/dir/":    nil,
		"ws-skill/sub/keep.go": []byte("y"),
	}))
	if err != nil {
		t.Fatalf("extractZipRaw: %v", err)
	}
	if root != "ws-skill" {
		t.Errorf("root: got %q", root)
	}
	if rel != "SKILL.md" {
		t.Errorf("rel: got %q", rel)
	}
	if string(body) != sampleSKILLMD {
		t.Errorf("body mismatch")
	}
	if len(files) != 3 {
		t.Errorf("expected 3 files (SKILL.md, main.go, keep.go), got %d: %v", len(files), mapKeys(files))
	}
}

// mustBuildZip returns the raw bytes of a zip built from files. Used by
// tests that need to feed bytes directly (not via filesystem).
func mustBuildZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if body == nil {
			continue // directory entry, no body
		}
		if _, err := w.Write(body); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func mustDecodeB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("decode b64: %v", err)
	}
	return b
}

func mapKeys(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
