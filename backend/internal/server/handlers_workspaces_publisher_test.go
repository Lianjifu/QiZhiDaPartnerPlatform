package server_test

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/skills/signing"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// testSkillMeta adapts signing.SkillMeta for tests so buildSignedSkillZip
// can call signing.ManifestDigestBytes directly without re-implementing the
// canonicalization rules.
type testSkillMeta struct {
	name, version, rel, risk string
	entrypoints              []string
}

func (m *testSkillMeta) GetName() string         { return m.name }
func (m *testSkillMeta) GetVersion() string      { return m.version }
func (m *testSkillMeta) GetSkillMDRel() string   { return m.rel }
func (m *testSkillMeta) GetEntrypoints() []string {
	out := make([]string, len(m.entrypoints))
	copy(out, m.entrypoints)
	return out
}
func (m *testSkillMeta) GetRiskLevel() string { return m.risk }

// buildSignedSkillZip returns a zip whose <root>/.skillpkg.signature.json
// sidecar carries an ed25519 signature over signing.ManifestDigestBytes.
func buildSignedSkillZip(t *testing.T, name, description string, priv ed25519.PrivateKey) []byte {
	t.Helper()
	pub := priv.Public().(ed25519.PublicKey)
	keyID := signing.KeyIDFor(pub)

	body := "---\nname: " + name + "\ndescription: " + description + "\nversion: 0.1.0\nrisk: low\n---\n\nbody\n"
	// Match server's parseSkillPackage shape: files keyed by full archive
	// path, SkillMDRel is the RELATIVE basename ("SKILL.md"), which causes
	// the digest's files[SkillMDRel] lookup to miss → skillMDHash="" (matches
	// what the server computes on the same input).
	files := map[string][]byte{name + "/SKILL.md": []byte(body)}
	meta := &testSkillMeta{name: name, version: "0.1.0", rel: "SKILL.md", risk: "low"}
	canon, err := signing.ManifestDigestBytes(signing.DigestInputs{Meta: meta, Files: files})
	if err != nil {
		t.Fatal(err)
	}
	sig := ed25519.Sign(priv, canon)
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create(name + "/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
	w2, err := zw.Create(name + "/" + skillpkgSignatureFile)
	if err != nil {
		t.Fatal(err)
	}
	sidecar := `{"keyId":"` + keyID + `","signature":"` + sigB64 + `","signerName":"Test"}`
	if _, err := w2.Write([]byte(sidecar)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

const skillpkgSignatureFile = ".skillpkg.signature.json"

// ──── endpoint CRUD tests ────

func TestCreatePublisherKeyGenerateMode(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()

	body, _ := json.Marshal(map[string]any{"mode": "generate", "name": "W1 publisher"})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatalf("expected 200, got %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data struct {
			KeyID      string `json:"keyId"`
			PublicKey  string `json:"publicKey"`
			PrivateKey string `json:"privateKey"`
			Status     string `json:"status"`
			Name       string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env.Data.PrivateKey == "" {
		t.Fatalf("generate mode must return privateKey, body=%s", rr.Body.String())
	}
	if env.Data.PublicKey == "" || env.Data.KeyID == "" {
		t.Fatalf("missing keyId/publicKey, body=%s", rr.Body.String())
	}
	if env.Data.Status != "active" {
		t.Fatalf("status=%q", env.Data.Status)
	}
	pubBytes, err := base64.StdEncoding.DecodeString(env.Data.PublicKey)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		t.Fatalf("publicKey invalid: %v len=%d", err, len(pubBytes))
	}
	if signing.KeyIDFor(pubBytes) != env.Data.KeyID {
		t.Fatalf("keyId mismatch")
	}
	if st.ActivePublisherKey("w1") == nil {
		t.Fatal("store missing active key for w1")
	}
}

func TestCreatePublisherKeyRegisterMode(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	_, priv, _ := ed25519.GenerateKey(nil)
	pub := priv.Public().(ed25519.PublicKey)
	pubB64 := base64.StdEncoding.EncodeToString(pub)
	h := srv.Handler()

	body, _ := json.Marshal(map[string]any{
		"mode": "register", "name": "W1 ext", "publicKey": pubB64,
	})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatalf("expected 200, got %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data struct {
			KeyID      string `json:"keyId"`
			PublicKey  string `json:"publicKey"`
			PrivateKey string `json:"privateKey"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if env.Data.PrivateKey != "" {
		t.Fatalf("register mode must NOT return privateKey, got %s", rr.Body.String())
	}
	if env.Data.PublicKey != pubB64 {
		t.Fatalf("publicKey roundtrip mismatch")
	}
}

func TestCreatePublisherKeyRejectsDuplicateActive(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()

	body, _ := json.Marshal(map[string]any{"mode": "generate"})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatalf("first create: %d %s", rr.Code, rr.Body.String())
	}
	rr = knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token", string(body))
	if rr.Code != 409 {
		t.Fatalf("expected 409 on duplicate active, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestRotatePublisherKeyPreservesOldKeyInGrace(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()

	body, _ := json.Marshal(map[string]any{"mode": "generate"})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var first struct {
		Data struct {
			KeyID      string `json:"keyId"`
			PrivateKey string `json:"privateKey"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &first)

	rr = knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key/rotate", "mock-admin-token",
		`{"mode":"generate","name":"rotated"}`)
	if rr.Code != 200 {
		t.Fatalf("rotate: %d %s", rr.Code, rr.Body.String())
	}

	pub, trust, err := srv.ResolvePublisherKeyForTest("w1", first.Data.KeyID)
	if err != nil {
		t.Fatalf("grace resolve failed: %v", err)
	}
	if trust != "workspace-rotated" {
		t.Fatalf("expected workspace-rotated, got %q", trust)
	}
	privBytes, _ := base64.StdEncoding.DecodeString(first.Data.PrivateKey)
	oldPriv := ed25519.PrivateKey(privBytes)
	if !ed25519.Verify(pub, []byte("any"), ed25519.Sign(oldPriv, []byte("any"))) {
		t.Fatal("returned pubkey doesn't match old priv")
	}

	active := st.ActivePublisherKey("w1")
	if active == nil {
		t.Fatal("no active after rotate")
	}
	if str(active["keyId"]) == first.Data.KeyID {
		t.Fatal("rotated new keyId matches old — rotation failed")
	}
}

func TestRevokePublisherKeyRejectsOldKey(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()

	body, _ := json.Marshal(map[string]any{"mode": "generate"})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var first struct {
		Data struct {
			KeyID string `json:"keyId"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &first)

	rr = knowledgeDo(t, h, http.MethodDelete, "/api/workspaces/w1/publisher-key", "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatalf("revoke: %d %s", rr.Code, rr.Body.String())
	}
	if _, _, err := srv.ResolvePublisherKeyForTest("w1", first.Data.KeyID); err == nil {
		t.Fatal("revoked key should NOT resolve")
	}
	if st.ActivePublisherKey("w1") != nil {
		t.Fatal("active key should be gone after revoke")
	}
}

func TestGetPublisherKeyOmitsPrivateKey(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()

	body, _ := json.Marshal(map[string]any{"mode": "generate"})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	rr = knowledgeDo(t, h, http.MethodGet, "/api/workspaces/w1/publisher-key", "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatalf("get: %d %s", rr.Code, rr.Body.String())
	}
	body2 := rr.Body.String()
	if strings.Contains(body2, "\"privateKey\"") {
		t.Fatalf("privateKey field leaked in GET response: %s", body2)
	}
}

func TestCrossWorkspacePublisherKeyAccessDenied(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()

	// mock-user-token belongs to w1/w2 only. Hitting w3 must be denied
	// by requireWorkspaceAccess (skill.write perm alone isn't enough).
	body, _ := json.Marshal(map[string]any{"mode": "generate"})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w3/publisher-key", "mock-user-token", string(body))
	if rr.Code != 403 && rr.Code != 404 {
		t.Fatalf("expected 403/404 for cross-workspace, got %d %s", rr.Code, rr.Body.String())
	}
}

// ──── audit emission ────

func TestAuditWrittenOnPublisherKeyMutation(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()

	body, _ := json.Marshal(map[string]any{"mode": "generate"})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	rr = knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key/rotate", "mock-admin-token",
		`{"mode":"generate"}`)
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	rr = knowledgeDo(t, h, http.MethodDelete, "/api/workspaces/w1/publisher-key", "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}

	audits := srv.AuditsForTest()
	var rotateSeen, revokeSeen bool
	for _, a := range audits {
		switch str(a["action"]) {
		case "轮换发布者密钥":
			rotateSeen = true
		case "撤销发布者密钥":
			revokeSeen = true
		}
	}
	if !rotateSeen {
		t.Fatalf("rotate audit missing; audits=%v", audits)
	}
	if !revokeSeen {
		t.Fatalf("revoke audit missing; audits=%v", audits)
	}
}

// ──── signature verification: workspace trust tiers ────

func TestImportRevokedWorkspaceKeyDenied(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()
	t.Setenv("DE_REQUIRE_SKILL_SIGNATURE", "any")

	_, priv, _ := ed25519.GenerateKey(nil)
	pub := priv.Public().(ed25519.PublicKey)
	pubB64 := base64.StdEncoding.EncodeToString(pub)

	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token",
		`{"mode":"register","publicKey":"`+pubB64+`"}`)
	if rr.Code != 200 {
		t.Fatalf("register: %d %s", rr.Code, rr.Body.String())
	}
	rr = knowledgeDo(t, h, http.MethodDelete, "/api/workspaces/w1/publisher-key", "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatalf("revoke: %d %s", rr.Code, rr.Body.String())
	}

	signedZip := buildSignedSkillZip(t, "ws-skill", "after revoke", priv)
	body, _ := json.Marshal(map[string]any{
		"fileName":      "ws.skill",
		"contentBase64": base64.StdEncoding.EncodeToString(signedZip),
	})
	rr = knowledgeDo(t, h, http.MethodPost, "/api/skills/import-package", "mock-admin-token", string(body))
	if rr.Code == 200 {
		t.Fatalf("expected denied after revoke, got 200: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_SKILL_SIGNATURE_UNKNOWN_KEY") {
		t.Fatalf("expected SkillSignatureUnknownKey, got %s", rr.Body.String())
	}
}

func TestImportUnsignedDeniedUnderWorkspacePolicy(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()
	t.Setenv("DE_REQUIRE_SKILL_SIGNATURE", "workspace")

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("unsigned-skill/SKILL.md")
	_, _ = w.Write([]byte("---\nname: unsigned-skill\ndescription: x\nversion: 0.1.0\n---\n"))
	_ = zw.Close()

	body, _ := json.Marshal(map[string]any{
		"fileName":      "u.skill",
		"contentBase64": base64.StdEncoding.EncodeToString(buf.Bytes()),
	})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/skills/import-package", "mock-admin-token", string(body))
	if rr.Code == 200 {
		t.Fatalf("expected denied, got 200: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_SKILL_SIGNATURE_MISSING") {
		t.Fatalf("expected SkillSignatureMissing, got %s", rr.Body.String())
	}
}

func TestImportActiveWorkspaceKeySucceeds(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()
	t.Setenv("DE_REQUIRE_SKILL_SIGNATURE", "any")

	_, priv, _ := ed25519.GenerateKey(nil)
	pub := priv.Public().(ed25519.PublicKey)
	pubB64 := base64.StdEncoding.EncodeToString(pub)

	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token",
		`{"mode":"register","publicKey":"`+pubB64+`"}`)
	if rr.Code != 200 {
		t.Fatalf("register: %d %s", rr.Code, rr.Body.String())
	}

	signedZip := buildSignedSkillZip(t, "ws-skill", "Workspace-keyed import", priv)
	body, _ := json.Marshal(map[string]any{
		"fileName":      "ws.skill",
		"contentBase64": base64.StdEncoding.EncodeToString(signedZip),
	})
	rr = knowledgeDo(t, h, http.MethodPost, "/api/skills/import-package", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatalf("import: %d %s", rr.Code, rr.Body.String())
	}
}

func TestImportRotatedWorkspaceKeySucceedsInGrace(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	h := srv.Handler()
	t.Setenv("DE_REQUIRE_SKILL_SIGNATURE", "any")

	_, priv, _ := ed25519.GenerateKey(nil)
	pub := priv.Public().(ed25519.PublicKey)
	pubB64 := base64.StdEncoding.EncodeToString(pub)

	rr := knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key", "mock-admin-token",
		`{"mode":"register","publicKey":"`+pubB64+`"}`)
	if rr.Code != 200 {
		t.Fatalf("register: %d %s", rr.Code, rr.Body.String())
	}
	// Rotate — the registered key becomes status=rotated but grace-valid.
	rr = knowledgeDo(t, h, http.MethodPost, "/api/workspaces/w1/publisher-key/rotate", "mock-admin-token",
		`{"mode":"generate"}`)
	if rr.Code != 200 {
		t.Fatalf("rotate: %d %s", rr.Code, rr.Body.String())
	}

	signedZip := buildSignedSkillZip(t, "ws-grace", "still in grace window", priv)
	body, _ := json.Marshal(map[string]any{
		"fileName":      "g.skill",
		"contentBase64": base64.StdEncoding.EncodeToString(signedZip),
	})
	rr = knowledgeDo(t, h, http.MethodPost, "/api/skills/import-package", "mock-admin-token", string(body))
	if rr.Code != 200 {
		t.Fatalf("grace import: %d %s", rr.Code, rr.Body.String())
	}
}
