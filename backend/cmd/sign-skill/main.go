// sign-skill is the author-side CLI for W1-D2. Walks a skill directory,
// reads SKILL.md frontmatter, hashes every file, builds the canonical
// manifest bytes, signs with Ed25519, and writes back into
// builtin/skills/manifest.json (the per-skill signature block + the
// publisher key record).
//
// Usage:
//
//	go run ./cmd/sign-skill <skill-dir> [--key <dev-keypair.json>] [--manifest <pack-manifest.json>]
//
// When --manifest is omitted the CLI defaults to builtin/skills/manifest.json
// relative to the current working directory. When --key is omitted the CLI
// auto-uses data/skill-keys/dev-keypair.json (creates it on first run).
package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
	"github.com/qizhida-partner-platform/backend/internal/skills/vetter"
)

func main() {
	var (
		keyPath     string
		manifestIn  string
		manifestOut string
	)
	flag.StringVar(&keyPath, "key", "data/skill-keys/dev-keypair.json", "path to dev keypair JSON")
	flag.StringVar(&manifestIn, "manifest", "builtin/skills/manifest.json", "pack-level manifest to update")
	flag.StringVar(&manifestOut, "manifest-out", "", "where to write the updated manifest (default: in-place)")
	flag.Parse()

	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "usage: sign-skill <skill-dir> [--key ...] [--manifest ...]")
		os.Exit(2)
	}
	skillDir := flag.Arg(0)
	abs, _ := filepath.Abs(skillDir)

	// 1. Load skill package files + manifest meta.
	files, meta, err := loadSkillPackage(abs)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load skill %s: %v\n", skillDir, err)
		os.Exit(1)
	}

	// 2. Run vetter (informational). sign-skill does NOT block on vet
	// failures — that gate belongs to the server. We surface them so
	// authors catch obvious issues locally.
	if r := vetter.RunBytes(files); r.Decision != vetter.Allow {
		fmt.Fprintf(os.Stderr, "vetter warning: %s findings=%d\n", r.Verdict, len(r.Findings))
		for _, f := range r.Findings {
			fmt.Fprintf(os.Stderr, "  %s %s @%s:%d\n", f.Category, f.Pattern, f.File, f.Line)
		}
	}

	// 3. Load (or auto-provision) the signing key.
	keyPath, _ = filepath.Abs(keyPath)
	dev, err := signing.NewDevKeyStore(keyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load keypair: %v\n", err)
		os.Exit(1)
	}

	// 4. Sign the manifest canonical bytes.
	signer, err := dev.Signer("")
	if err != nil {
		fmt.Fprintf(os.Stderr, "load signer: %v\n", err)
		os.Exit(1)
	}
	sigBytes, err := signing.SignManifest(signer, signing.DigestInputs{
		Meta: meta, Files: files,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "sign: %v\n", err)
		os.Exit(1)
	}

	// 5. Update the pack-level manifest. Load existing JSON, merge in the
	// new skill signature, write atomically. If the manifest file is
	// missing we create a fresh one.
	sigB64 := base64.StdEncoding.EncodeToString(sigBytes)
	pubB64 := base64.StdEncoding.EncodeToString(signer.PublicKey())
	signedAt := time.Now().UTC().Format(time.RFC3339)

	packPath, _ := filepath.Abs(manifestIn)
	pack, err := loadPackManifest(packPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load pack manifest: %v\n", err)
		os.Exit(1)
	}
	if pack.Signers == nil {
		pack.Signers = map[string]signing.TrustedKey{}
	}
	pack.Signers[signer.KeyID()] = signing.TrustedKey{
		KeyID:     signer.KeyID(),
		PublicKey: pubB64,
		Name:      signer.Name(),
		AddedAt:   time.Now().UTC(),
		AddedBy:   "sign-skill",
	}
	if pack.SkillSignatures == nil {
		pack.SkillSignatures = map[string]json.RawMessage{}
	}
	entry := map[string]any{
		"keyId":      signer.KeyID(),
		"signature":  sigB64,
		"signedAt":   signedAt,
		"signerName": signer.Name(),
	}
	entryJSON, err := json.Marshal(entry)
	if err != nil {
		fmt.Fprintf(os.Stderr, "marshal signature entry: %v\n", err)
		os.Exit(1)
	}
	pack.SkillSignatures[meta.Name] = entryJSON

	// 6. Write back.
	outPath := manifestOut
	if outPath == "" {
		outPath = packPath
	}
	if err := writePackManifest(outPath, pack); err != nil {
		fmt.Fprintf(os.Stderr, "write pack manifest: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("signed skill=%s keyId=%s bytes=%d\n", meta.Name, signer.KeyID(), len(sigBytes))
}

// loadSkillPackage walks skillDir, collects every non-skipped file under
// <skillName>/, and parses the SKILL.md frontmatter into a metadata stub
// that satisfies signing.SkillMeta.
func loadSkillPackage(root string) (map[string][]byte, *skillMeta, error) {
	skillName := filepath.Base(root)
	st, err := os.Stat(root)
	if err != nil || !st.IsDir() {
		return nil, nil, fmt.Errorf("skill directory missing: %s", root)
	}
	files := map[string][]byte{}
	prefix := skillName + "/"
	err = filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
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
	// Find SKILL.md under prefix.
	var mdPath string
	for p := range files {
		if strings.EqualFold(filepath.Base(p), "SKILL.md") {
			mdPath = p
			break
		}
	}
	if mdPath == "" {
		return nil, nil, fmt.Errorf("no SKILL.md under %s", root)
	}
	meta := parseFrontmatter(string(files[mdPath]))
	if meta.Name == "" {
		meta.Name = skillName
	}
	if meta.Version == "" {
		meta.Version = "1.0.0"
	}
	// Mirror the server's builtinSkillRiskLevel default — without this the
	// canonical manifest bytes diverge between sign-skill and the running
	// server (server defaults to "low" for most names; sign-skill left it
	// blank, producing a different SHA256 → signature mismatch).
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

// builtinDefaultRisk mirrors internal/server.builtinSkillRiskLevel. Kept
// here verbatim so sign-skill produces the same canonical manifest bytes
// the server will compute on verify. If you change one, change both.
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

// packManifest is a trimmed mirror of the server-side struct. We don't
// import internal/server to avoid a cycle.
type packManifest struct {
	PackID            string                       `json:"packId"`
	PackName          string                       `json:"packName"`
	Version           string                       `json:"version"`
	GeneralPackSkills []string                     `json:"generalPackSkills"`
	TierDOptIn        []string                     `json:"tierDOptIn"`
	Packs             map[string]json.RawMessage   `json:"packs"`
	SkillMeta         map[string]json.RawMessage   `json:"skillMeta"`
	PlatformTools     []json.RawMessage            `json:"platformTools"`
	RuntimeTools      []json.RawMessage            `json:"runtimeTools"`
	Signers           map[string]signing.TrustedKey `json:"signers"`
	SkillSignatures   map[string]json.RawMessage   `json:"skillSignatures"`
}

func loadPackManifest(path string) (*packManifest, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &packManifest{PackID: "general", PackName: "通用", Version: "1.0.0"}, nil
		}
		return nil, err
	}
	var p packManifest
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func writePackManifest(path string, p *packManifest) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}