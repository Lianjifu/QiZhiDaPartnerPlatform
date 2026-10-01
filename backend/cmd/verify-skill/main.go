// verify-skill is the operator/CI side of W1-D2. Loads the pack-level
// manifest, walks every builtin skill directory, recomputes the canonical
// manifest bytes, and verifies the per-skill signature against the listed
// publisher. Exits 0 on full success, non-zero on the first mismatch.
//
// Usage:
//
//	go run ./cmd/verify-skill <skill-dir>...     # one or more skill dirs
//	go run ./cmd/verify-skill --manifest builtin/skills/manifest.json builtin/skills
//
// When invoked with a parent directory (e.g. builtin/skills), all
// immediate subdirectories that contain SKILL.md are verified.
package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
	"github.com/qizhida-partner-platform/backend/internal/skills/vetter"
)

func main() {
	var (
		manifestPath string
		strict       bool
		vetMode      string
	)
	flag.StringVar(&manifestPath, "manifest", "builtin/skills/manifest.json", "pack-level manifest JSON")
	flag.BoolVar(&strict, "strict", true, "fail if a builtin is missing from the manifest signature block")
	flag.StringVar(&vetMode, "vet", "off", "vetter mode: off | info | strict (runs vetter after signature verify)")
	flag.Parse()

	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "usage: verify-skill [--manifest path] <skill-dir>...")
		os.Exit(2)
	}

	pack, err := loadPackManifest(manifestPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load manifest: %v\n", err)
		os.Exit(1)
	}

	failed := 0
	total := 0
	for _, arg := range flag.Args() {
		abs, _ := filepath.Abs(arg)
		st, err := os.Stat(abs)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: stat: %v\n", abs, err)
			failed++
			continue
		}
		var dirs []string
		if st.IsDir() {
			if hasSKILLMD(abs) {
				dirs = append(dirs, abs)
			} else {
				entries, _ := os.ReadDir(abs)
				for _, e := range entries {
					if !e.IsDir() {
						continue
					}
					sub := filepath.Join(abs, e.Name())
					if hasSKILLMD(sub) {
						dirs = append(dirs, sub)
					}
				}
			}
		}
		for _, d := range dirs {
			total++
			name := filepath.Base(d)
			ok, why := verifyOne(pack, d, vetMode)
			if !ok {
				fmt.Fprintf(os.Stderr, "FAIL %s: %s\n", name, why)
				failed++
				continue
			}
			fmt.Printf("OK   %s\n", name)
		}
	}
	if strict {
		// Sanity: every signature in the manifest refers to a builtin on
		// disk; missing builtins get reported as warnings (not failures)
		// unless they also lack a corresponding skill directory.
		for name := range pack.SkillSignatures {
			if _, err := os.Stat(filepath.Join(filepath.Dir(manifestPath), name, "SKILL.md")); err != nil {
				fmt.Fprintf(os.Stderr, "WARN manifest references missing builtin: %s\n", name)
			}
		}
	}
	fmt.Printf("\nverified=%d failed=%d\n", total, failed)
	if failed > 0 {
		os.Exit(1)
	}
}

func hasSKILLMD(dir string) bool {
	if _, err := os.Stat(filepath.Join(dir, "SKILL.md")); err == nil {
		return true
	}
	return false
}

func verifyOne(pack *packManifest, skillDir, vetMode string) (bool, string) {
	skillName := filepath.Base(skillDir)
	rawSig, ok := pack.SkillSignatures[skillName]
	if !ok {
		return false, "no signature entry in manifest"
	}
	var sigEntry struct {
		KeyID      string `json:"keyId"`
		Signature  string `json:"signature"`
		SignerName string `json:"signerName"`
	}
	if err := json.Unmarshal(rawSig, &sigEntry); err != nil {
		return false, "malformed signature entry: " + err.Error()
	}
	signerRec, ok := pack.Signers[sigEntry.KeyID]
	if !ok {
		return false, "unknown publisher keyId " + sigEntry.KeyID
	}
	pub, err := base64.StdEncoding.DecodeString(signerRec.PublicKey)
	if err != nil {
		return false, "decode publisher publicKey: " + err.Error()
	}
	if len(pub) != ed25519.PublicKeySize {
		return false, "invalid publisher public key size"
	}
	sigBytes, err := base64.StdEncoding.DecodeString(sigEntry.Signature)
	if err != nil {
		return false, "decode signature: " + err.Error()
	}
	files, meta, err := loadSkillPackage(skillDir)
	if err != nil {
		return false, "load skill: " + err.Error()
	}
	if err := signing.VerifyManifest(pub, sigBytes, signing.DigestInputs{
		Meta: meta, Files: files,
	}); err != nil {
		return false, "ed25519 verify: " + err.Error()
	}
	if msg := vetSkill(skillDir, vetMode); msg != "" {
		return false, msg
	}
	return true, ""
}

// vetSkill runs the vetter against skillDir (which honors .vetter-allow.json)
// per the --vet flag. Returns "" on pass / disabled, or a non-empty failure
// reason when --vet=strict rejects the package.
func vetSkill(skillDir, mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", "off", "false", "0":
		return ""
	}
	r, err := vetter.Run(skillDir)
	if err != nil {
		return "vetter run: " + err.Error()
	}
	if r.Decision == vetter.Allow {
		return ""
	}
	// Non-Allow findings — print first three for human-readable context.
	summary := fmt.Sprintf("verdict=%s findings=%d", r.Verdict, len(r.Findings))
	for i, f := range r.Findings {
		if i >= 3 {
			summary += " …"
			break
		}
		summary += fmt.Sprintf(" %s:%s@%s:%d", f.Category, f.Pattern, f.File, f.Line)
	}
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "strict":
		return "vetter deny: " + summary
	case "info":
		fmt.Printf("INFO vetter %s: %s\n", filepath.Base(skillDir), summary)
		return ""
	default:
		return "unknown --vet mode: " + mode
	}
}

// packManifest mirrors the server-side struct (kept trimmed here to avoid
// the import cycle and to keep the CLI standalone-buildable).
type packManifest struct {
	Signers         map[string]signing.TrustedKey `json:"signers"`
	SkillSignatures map[string]json.RawMessage    `json:"skillSignatures"`
}

func loadPackManifest(path string) (*packManifest, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p packManifest
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// loadSkillPackage walks skillDir and produces the same (files, meta)
// shape that sign-skill uses, so verify reproduces the canonical bytes
// bit-for-bit.
func loadSkillPackage(root string) (map[string][]byte, *skillMeta, error) {
	skillName := filepath.Base(root)
	files := map[string][]byte{}
	prefix := skillName + "/"
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files[prefix+rel] = body
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	var mdPath string
	for p := range files {
		if strings.EqualFold(filepath.Base(p), "SKILL.md") {
			mdPath = p
			break
		}
	}
	if mdPath == "" {
		return nil, nil, fmt.Errorf("no SKILL.md")
	}
	meta := parseFrontmatter(string(files[mdPath]))
	if meta.Name == "" {
		meta.Name = skillName
	}
	if meta.Version == "" {
		meta.Version = "1.0.0"
	}
	// Mirror sign-skill + server's default RiskLevel so the canonical
	// manifest bytes round-trip identically.
	if meta.RiskLevel == "" {
		meta.RiskLevel = builtinDefaultRisk(skillName)
	}
	meta.SkillMDRel = filepath.Base(mdPath)
	return files, meta, nil
}

type skillMeta struct {
	Name        string
	Version     string
	SkillMDRel  string
	Entrypoints []string
	RiskLevel   string
}

// builtinDefaultRisk matches internal/server.builtinSkillRiskLevel. Kept
// here so verify-skill produces identical canonical bytes to the running
// server. If you change one, change both.
func builtinDefaultRisk(name string) string {
	switch name {
	case "browser-use", "1password":
		return "high"
	}
	return "low"
}

func (m *skillMeta) GetName() string         { return m.Name }
func (m *skillMeta) GetVersion() string      { return m.Version }
func (m *skillMeta) GetSkillMDRel() string   { return m.SkillMDRel }
func (m *skillMeta) GetEntrypoints() []string {
	out := make([]string, len(m.Entrypoints))
	copy(out, m.Entrypoints)
	return out
}
func (m *skillMeta) GetRiskLevel() string { return m.RiskLevel }

func parseFrontmatter(raw string) *skillMeta {
	m := &skillMeta{}
	text := strings.TrimSpace(raw)
	if !strings.HasPrefix(text, "---") {
		return m
	}
	rest := strings.TrimPrefix(text, "---")
	rest = strings.TrimLeft(rest, "\r\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return m
	}
	fm := rest[:end]
	for _, line := range strings.Split(fm, "\n") {
		idx := strings.Index(line, ":")
		if idx < 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:idx]))
		val := strings.TrimSpace(line[idx+1:])
		val = strings.Trim(val, `"'`)
		switch key {
		case "name":
			m.Name = strings.ToLower(val)
		case "version":
			m.Version = val
		case "risk", "risklevel", "risk_level":
			m.RiskLevel = val
		case "entrypoints", "entrypoint":
			for _, p := range strings.Split(val, ",") {
				p = strings.TrimSpace(strings.Trim(p, `"'[]`))
				if p != "" {
					m.Entrypoints = append(m.Entrypoints, p)
				}
			}
		}
	}
	return m
}