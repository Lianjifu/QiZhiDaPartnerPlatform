// sign-skill-pack is the W2-D1 archive-mode CLI. It extracts a .skill
// (zip/tgz) archive, fetches the workspace's publisher public key from
// the server, signs the canonical manifest bytes with a caller-supplied
// Ed25519 private key, writes <root>/.skillpkg.signature.json, then
// repacks the archive atomically to <archive>.signed.skill.
//
// Usage:
//
//	DE_SIGNER_PRIVATE_KEY=$(cat /tmp/wp.priv.b64) \
//	go run ./cmd/sign-skill-pack \
//	    --archive /tmp/foo.skill \
//	    --workspace w1 \
//	    --server http://127.0.0.1:8089 \
//	    --auth-token "Bearer $TOKEN"
//
// The CLI refuses to overwrite existing outputs without --force. Private
// keys are read from DE_SIGNER_PRIVATE_KEY (base64) to avoid leaking via
// process-listing.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
)

func main() {
	var (
		archive   string
		workspace string
		server    string
		authToken string
		signerKey string
		force     bool
	)
	flag.StringVar(&archive, "archive", "", "path to the .skill archive (zip)")
	flag.StringVar(&workspace, "workspace", "", "workspace id (e.g. w1)")
	flag.StringVar(&server, "server", "http://127.0.0.1:8089", "base URL of the running backend")
	flag.StringVar(&authToken, "auth-token", "", "Bearer token for /publisher-key (or env DE_AUTH_TOKEN)")
	flag.StringVar(&signerKey, "signer-key-env", "DE_SIGNER_PRIVATE_KEY", "env var holding base64 Ed25519 private key")
	flag.BoolVar(&force, "force", false, "overwrite output if it exists")
	flag.Parse()

	if archive == "" || workspace == "" {
		fmt.Fprintln(os.Stderr, "usage: sign-skill-pack --archive <path> --workspace <id> [--server URL]")
		os.Exit(2)
	}

	if authToken == "" {
		authToken = os.Getenv("DE_AUTH_TOKEN")
	}
	if authToken == "" {
		fmt.Fprintln(os.Stderr, "auth token missing: pass --auth-token or set DE_AUTH_TOKEN")
		os.Exit(1)
	}
	privB64 := os.Getenv(signerKey)
	if privB64 == "" {
		fmt.Fprintf(os.Stderr, "private key missing: set %s env to base64 Ed25519 private key\n", signerKey)
		os.Exit(1)
	}
	privBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(privB64))
	if err != nil || len(privBytes) != ed25519.PrivateKeySize {
		fmt.Fprintf(os.Stderr, "invalid DE_SIGNER_PRIVATE_KEY (must be base64 of %d-byte Ed25519 private key)\n", ed25519.PrivateKeySize)
		os.Exit(1)
	}
	priv := ed25519.PrivateKey(privBytes)

	if err := signArchiveAndWrite(archive, priv, server, workspace, authToken, force); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// signArchiveAndWrite is the side-effecting core flow (extracted from main
// so tests in package main can drive it without spawning a subprocess).
// It writes <archive>.signed.skill atomically and prints a one-line summary.
func signArchiveAndWrite(archive string, priv ed25519.PrivateKey, server, workspace, token string, force bool) error {
	keyID, outPath, err := signArchive(archive, priv, server, workspace, token, force)
	if err != nil {
		return err
	}
	fmt.Printf("signed: %s\n  keyId=%s\n  output=%s\n", archive, keyID, outPath)
	return nil
}

// signArchive is the pure signing pipeline. It does the HTTP workspace
// lookup (best-effort; warnings only), parses the archive, computes the
// canonical manifest digest, signs it, writes the sidecar, and atomically
// repacks the archive to <archive>.signed.skill.
//
// Returns keyID written into the sidecar and the final output path.
func signArchive(archive string, priv ed25519.PrivateKey, server, workspace, token string, force bool) (string, string, error) {
	pub := priv.Public().(ed25519.PublicKey)

	rawZip, err := os.ReadFile(archive)
	if err != nil {
		return "", "", fmt.Errorf("read archive: %w", err)
	}

	// Best-effort workspace pubkey sanity check. Failure here only warns.
	if pubFromServer, errFromServer := fetchPublisherKey(server, workspace, token); errFromServer == nil {
		if pubFromServer != base64.StdEncoding.EncodeToString(pub) {
			fmt.Fprintf(os.Stderr, "warning: provided private key does not match workspace %s active publisher key\n", workspace)
		}
	} else {
		fmt.Fprintf(os.Stderr, "warning: could not verify against server (%v); continuing with local key\n", errFromServer)
	}

	extracted, root, skillRel, body, err := extractZipRaw(rawZip)
	if err != nil {
		return "", "", fmt.Errorf("extract: %w", err)
	}

	name, version, risk, err := parseFrontmatterMeta(body)
	if err != nil {
		return "", "", fmt.Errorf("parse SKILL.md: %w", err)
	}

	// Strip the sidecar if it was already present — re-signing must not
	// include the previous signature in the digest.
	delete(extracted, filepath.Join(root, ".skillpkg.signature.json"))

	canon, err := signing.ManifestDigestBytes(signing.DigestInputs{
		Meta: &skillMetaShim{name: name, version: version, rel: skillRel, risk: risk},
		Files: extracted,
	})
	if err != nil {
		return "", "", fmt.Errorf("compute digest: %w", err)
	}

	sig := ed25519.Sign(priv, canon)
	sidecar := map[string]any{
		"keyId":      signing.KeyIDFor(pub),
		"signature":  base64.StdEncoding.EncodeToString(sig),
		"signedAt":   time.Now().UTC().Format(time.RFC3339),
		"signerName": "sign-skill-pack CLI",
	}
	sidecarBytes, _ := json.MarshalIndent(sidecar, "", "  ")
	extracted[filepath.Join(root, ".skillpkg.signature.json")] = sidecarBytes

	out := archive + ".signed.skill"
	if !force {
		if _, err := os.Stat(out); err == nil {
			return "", "", fmt.Errorf("output %s exists; pass --force to overwrite", out)
		}
	}
	if err := writeZipAtomic(out, root, extracted); err != nil {
		return "", "", fmt.Errorf("write output: %w", err)
	}
	return signing.KeyIDFor(pub), out, nil
}

// fetchPublisherKey GETs /api/workspaces/<ws>/publisher-key and returns
// the base64-encoded 32-byte Ed25519 public key. Empty result + non-nil
// error means the server was unreachable or the workspace has no key.
func fetchPublisherKey(server, ws, token string) (pubB64 string, err error) {
	url := strings.TrimRight(server, "/") + "/api/workspaces/" + ws + "/publisher-key"
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if !strings.HasPrefix(token, "Bearer ") {
		token = "Bearer " + token
	}
	req.Header.Set("Authorization", token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("server returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var env struct {
		Data struct {
			PublicKey string `json:"publicKey"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return "", err
	}
	return env.Data.PublicKey, nil
}

// extractZipRaw reads a zip into a path → bytes map. The root is the
// directory containing SKILL.md; skillRel is the basename.
func extractZipRaw(raw []byte) (map[string][]byte, string, string, []byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, "", "", nil, err
	}
	files := make(map[string][]byte)
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, "/") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, "", "", nil, err
		}
		data, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return nil, "", "", nil, err
		}
		files[f.Name] = data
	}
	for path, data := range files {
		if strings.EqualFold(filepath.Base(path), "SKILL.md") {
			root := "."
			if strings.Contains(path, "/") {
				root = filepath.Dir(path)
			}
			return files, root, filepath.Base(path), data, nil
		}
	}
	return nil, "", "", nil, fmt.Errorf("no SKILL.md found in archive")
}

// skillMetaShim adapts the signing.SkillMeta interface for archive-mode
// signing. Entrypoints is empty; that's correct for our default.
type skillMetaShim struct {
	name, version, rel, risk string
}

func (m *skillMetaShim) GetName() string         { return m.name }
func (m *skillMetaShim) GetVersion() string      { return m.version }
func (m *skillMetaShim) GetSkillMDRel() string   { return m.rel }
func (m *skillMetaShim) GetEntrypoints() []string { return nil }
func (m *skillMetaShim) GetRiskLevel() string    { return m.risk }

// parseFrontmatterMeta is the minimum frontmatter extraction we need
// for the manifest. Real format parsing happens server-side; this only
// pulls name/version/risk so we can compute a digest.
func parseFrontmatterMeta(md []byte) (name, version, risk string, err error) {
	body := string(md)
	if !strings.HasPrefix(body, "---") {
		return "", "", "", fmt.Errorf("missing YAML frontmatter")
	}
	end := strings.Index(body[3:], "\n---")
	if end < 0 {
		return "", "", "", fmt.Errorf("unterminated frontmatter")
	}
	front := body[3 : 3+end]
	for _, line := range strings.Split(front, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		switch k {
		case "name":
			name = v
		case "version":
			version = v
		case "risk":
			risk = v
		}
	}
	if name == "" {
		return "", "", "", fmt.Errorf("frontmatter missing name")
	}
	if version == "" {
		version = "0.1.0"
	}
	if risk == "" {
		risk = "low"
	}
	return name, version, risk, nil
}

// writeZipAtomic writes a fresh zip to a tmpfile then renames it onto
// the target path. Crash-safe: a partial output never replaces the target.
func writeZipAtomic(out, root string, files map[string][]byte) error {
	tmp := out + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(f)
	for path, data := range files {
		w, err := zw.Create(path)
		if err != nil {
			_ = f.Close()
			_ = os.Remove(tmp)
			return err
		}
		if _, err := w.Write(data); err != nil {
			_ = f.Close()
			_ = os.Remove(tmp)
			return err
		}
	}
	if err := zw.Close(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, out)
}
