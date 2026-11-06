package server_test

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
)

// Skill import in dev mode runs under PolicyAny: the package must carry a
// signature made by SOME trusted key — the auto-provisioned dev keypair
// qualifies. The helper below signs an existing skill zip with that key.
//
// The digest inputs mirror what the server's parseSkillPackage derives from
// the same archive: archive-rooted file paths, SkillMDRel as the bare
// basename (so the SKILL.md hash stays empty — the server computes it the
// same way), and the front-matter name / version / risk level.
func signSkillZip(t *testing.T, srv *server.Server, raw []byte) []byte {
	t.Helper()
	if srv.SkillDevKey == nil {
		t.Fatal("dev keypair not provisioned; the import would be unsigned")
	}
	files := readZipEntries(t, raw)
	mdPath, ok := findSkillMarkdown(files)
	if !ok {
		t.Fatal("SKILL.md not found in package")
	}
	root := filepath.Dir(mdPath)
	meta := parseSkillFrontmatterForTest(string(files[mdPath]))

	name := strings.ToLower(meta["name"])
	if name == "" {
		name = filepath.Base(root)
	}
	version := meta["version"]
	if version == "" {
		version = "0.1.0"
	}
	risk := meta["risk"]
	if risk == "" {
		risk = "low"
		if hasScriptUnderRoot(files, root) {
			risk = "mid"
		}
	}
	risk = normalizeRiskLevelForTest(risk)

	var entrypoints []string
	for _, part := range strings.Split(meta["entrypoints"], ",") {
		if part = strings.TrimSpace(part); part != "" {
			entrypoints = append(entrypoints, part)
		}
	}

	// The sidecar never takes part in the digest it signs.
	digestFiles := map[string][]byte{}
	for p, b := range files {
		if filepath.Base(p) == skillpkgSignatureFile {
			continue
		}
		digestFiles[p] = b
	}
	canon, err := signing.ManifestDigestBytes(signing.DigestInputs{
		Meta: &testSkillMeta{
			name: name, version: version, rel: filepath.Base(mdPath),
			risk: risk, entrypoints: entrypoints,
		},
		Files: digestFiles,
	})
	if err != nil {
		t.Fatal(err)
	}
	signer, err := srv.SkillDevKey.Signer("")
	if err != nil {
		t.Fatal(err)
	}
	tk, err := srv.SkillDevKey.TrustedKey("")
	if err != nil {
		t.Fatal(err)
	}
	sig, err := signer.Sign(canon)
	if err != nil {
		t.Fatal(err)
	}
	sidecar, _ := json.Marshal(map[string]string{
		"keyId": tk.KeyID, "signature": base64.StdEncoding.EncodeToString(sig), "signerName": tk.Name,
	})
	return writeZipWithSidecar(t, files, filepath.Join(root, skillpkgSignatureFile), sidecar)
}

func readZipEntries(t *testing.T, raw []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, "/") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[f.Name] = b
	}
	return files
}

func findSkillMarkdown(files map[string][]byte) (string, bool) {
	best := ""
	for p := range files {
		if strings.EqualFold(filepath.Base(p), "SKILL.md") {
			if best == "" || strings.Count(p, "/") < strings.Count(best, "/") {
				best = p
			}
		}
	}
	return best, best != ""
}

var reFrontmatterKVForTest = regexp.MustCompile(`(?m)^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$`)

func parseSkillFrontmatterForTest(raw string) map[string]string {
	out := map[string]string{}
	text := strings.TrimSpace(raw)
	if !strings.HasPrefix(text, "---") {
		return out
	}
	rest := strings.TrimPrefix(text, "---")
	rest = strings.TrimLeft(rest, "\r\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return out
	}
	for _, m := range reFrontmatterKVForTest.FindAllStringSubmatch(rest[:end], -1) {
		key := strings.ToLower(strings.TrimSpace(m[1]))
		val := strings.Trim(strings.TrimSpace(m[2]), `"'`)
		switch key {
		case "name", "version":
			out[key] = val
		case "risk", "risklevel", "risk_level":
			out["risk"] = val
		case "entrypoints", "entrypoint":
			out["entrypoints"] = val
		}
	}
	return out
}

func normalizeRiskLevelForTest(v string) string {
	switch strings.ToLower(v) {
	case "low":
		return "low"
	case "high":
		return "high"
	case "medium", "mid":
		return "mid"
	default:
		return "mid"
	}
}

func hasScriptUnderRoot(files map[string][]byte, root string) bool {
	for p := range files {
		rel := strings.TrimPrefix(p, root+"/")
		if !strings.HasPrefix(rel, "scripts/") {
			continue
		}
		lower := strings.ToLower(rel)
		if strings.HasSuffix(lower, ".py") || strings.HasSuffix(lower, ".sh") ||
			strings.HasSuffix(lower, ".js") || strings.HasSuffix(lower, ".mjs") ||
			strings.HasSuffix(lower, ".ts") {
			return true
		}
	}
	return false
}

func writeZipWithSidecar(t *testing.T, files map[string][]byte, sidecarPath string, sidecar []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name string, content []byte) {
		t.Helper()
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	for p, b := range files {
		if filepath.Base(p) == skillpkgSignatureFile {
			continue
		}
		add(p, b)
	}
	add(sidecarPath, sidecar)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
