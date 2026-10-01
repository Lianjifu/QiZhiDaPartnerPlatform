package signing

import (
	"crypto/ed25519"
	"testing"
)

type fakeMeta struct {
	name, ver, skillMD string
	entry              []string
	risk               string
}

func (f *fakeMeta) GetName() string        { return f.name }
func (f *fakeMeta) GetVersion() string     { return f.ver }
func (f *fakeMeta) GetSkillMDRel() string  { return f.skillMD }
func (f *fakeMeta) GetEntrypoints() []string { return f.entry }
func (f *fakeMeta) GetRiskLevel() string   { return f.risk }

func TestSignVerifyRoundtrip(t *testing.T) {
	priv, err := GenerateEd25519Key()
	if err != nil {
		t.Fatalf("gen: %v", err)
	}
	s := NewEd25519Signer(priv, "test")

	in := DigestInputs{
		Meta: &fakeMeta{name: "docx", ver: "1.0.0", skillMD: "SKILL.md", entry: []string{"a", "b"}, risk: "B"},
		Files: map[string][]byte{
			"SKILL.md":          []byte("# docx"),
			"scripts/extract.sh": []byte("echo hi\n"),
		},
	}
	sig, err := SignManifest(s, in)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if err := VerifyManifest(s.PublicKey(), sig, in); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestVerifyRejectsTamperMessage(t *testing.T) {
	priv, _ := GenerateEd25519Key()
	s := NewEd25519Signer(priv, "test")
	in := DigestInputs{
		Meta: &fakeMeta{name: "docx", ver: "1.0.0", skillMD: "SKILL.md"},
		Files: map[string][]byte{"SKILL.md": []byte("# docx")},
	}
	sig, _ := SignManifest(s, in)
	in.Files["SKILL.md"] = []byte("# evil")
	if err := VerifyManifest(s.PublicKey(), sig, in); err == nil {
		t.Fatalf("expected verify failure after tamper")
	}
}

func TestVerifyRejectsWrongKey(t *testing.T) {
	priv1, _ := GenerateEd25519Key()
	priv2, _ := GenerateEd25519Key()
	s1 := NewEd25519Signer(priv1, "test1")
	s2 := NewEd25519Signer(priv2, "test2")
	in := DigestInputs{
		Meta:  &fakeMeta{name: "x", ver: "1"},
		Files: map[string][]byte{"a": []byte("x")},
	}
	sig, _ := SignManifest(s1, in)
	if err := VerifyManifest(s2.PublicKey(), sig, in); err == nil {
		t.Fatalf("expected verify failure with wrong key")
	}
}

func TestVerifyRejectsCorruptSignature(t *testing.T) {
	priv, _ := GenerateEd25519Key()
	s := NewEd25519Signer(priv, "t")
	in := DigestInputs{
		Meta:  &fakeMeta{name: "x", ver: "1"},
		Files: map[string][]byte{"a": []byte("x")},
	}
	sig, _ := SignManifest(s, in)
	sig[0] ^= 0xff
	if err := VerifyManifest(s.PublicKey(), sig, in); err == nil {
		t.Fatalf("expected verify failure on corrupt signature")
	}
}

func TestVerifyRejectsShortPublicKey(t *testing.T) {
	in := DigestInputs{
		Meta:  &fakeMeta{name: "x", ver: "1"},
		Files: map[string][]byte{"a": []byte("x")},
	}
	sig := make([]byte, ed25519.SignatureSize)
	err := VerifyManifest([]byte{1, 2, 3}, sig, in)
	if err == nil {
		t.Fatalf("expected length error")
	}
}

func TestKeyIDDeterministic(t *testing.T) {
	priv, _ := GenerateEd25519Key()
	s := NewEd25519Signer(priv, "t")
	id1 := s.KeyID()
	id2 := KeyIDFor(s.PublicKey())
	if id1 != id2 {
		t.Fatalf("KeyID inconsistent: %s vs %s", id1, id2)
	}
	if len(id1) < len("ed25519:")+8 {
		t.Fatalf("KeyID too short: %s", id1)
	}
}

func TestManifestDigestStableAcrossInvocations(t *testing.T) {
	// Build same manifest twice — order of iteration over Files map differs.
	in := DigestInputs{
		Meta:  &fakeMeta{name: "x", ver: "1", skillMD: "a", entry: []string{"b", "a"}, risk: "C"},
		Files: map[string][]byte{"b": []byte("B"), "a": []byte("A")},
	}
	a, _ := ManifestDigestBytes(in)
	b, _ := ManifestDigestBytes(in)
	if string(a) != string(b) {
		t.Fatalf("manifest digest not stable: %s vs %s", a, b)
	}
}

func TestManifestDigestDetectsFileChange(t *testing.T) {
	in := DigestInputs{
		Meta:  &fakeMeta{name: "x", ver: "1"},
		Files: map[string][]byte{"a": []byte("alpha")},
	}
	a, _ := ManifestDigestBytes(in)
	in.Files["a"] = []byte("beta")
	b, _ := ManifestDigestBytes(in)
	if string(a) == string(b) {
		t.Fatalf("manifest digest should change when file changes")
	}
}