package signing

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"

	"github.com/qizhida-partner-platform/backend/internal/metrics"
)

// ManifestDigest is the canonical form that gets signed. It captures the
// skill package identity (name + version), the SKILL.md fingerprint, and a
// per-file SHA256 list. Anything outside this struct is NOT covered by the
// signature — the package format must be parseable into ManifestDigest to
// be verifiable.
//
// The struct shape is intentionally explicit (not just a `map[string]any`)
// because the canonical encoder needs to know field ordering via Go's struct
// reflection + the fallback to json.Marshal. Adding a field is a breaking
// change: old signatures will no longer match.
type ManifestDigest struct {
	Name          string       `json:"name"`
	Version       string       `json:"version"`
	SkillMDSha256 string       `json:"skillMdSha256"`
	Files         []FileDigest `json:"files"`
	Entrypoints   []string     `json:"entrypoints,omitempty"`
	RiskLevel     string       `json:"riskLevel,omitempty"`
}

// FileDigest records the SHA256 of one file in the package. Path is
// forward-slash separated, relative to the package root.
type FileDigest struct {
	Path   string `json:"path"`
	Sha256 string `json:"sha256"`
}

// SkillMeta is the minimum input the signer needs from skillPackageManifest.
// Defined as an interface here so the signing package doesn't import
// internal/server (which would create a cycle).
type SkillMeta interface {
	GetName() string
	GetVersion() string
	GetSkillMDRel() string
	GetEntrypoints() []string
	GetRiskLevel() string
}

// DigestInputs is the input bundle for ManifestDigest.
type DigestInputs struct {
	Meta  SkillMeta
	Files map[string][]byte
}

// ManifestDigestBytes computes the canonical bytes that must be passed to
// ed25519.Sign / .Verify for a skill package.
//
// Returns the canonical JSON bytes (NOT the SHA256 of them — the signer
// already hashes internally). Sort order is fixed: paths lexicographic,
// entrypoints lexicographic.
func ManifestDigestBytes(in DigestInputs) ([]byte, error) {
	paths := make([]string, 0, len(in.Files))
	for p := range in.Files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	fd := make([]FileDigest, 0, len(paths))
	for _, p := range paths {
		h := sha256.Sum256(in.Files[p])
		fd = append(fd, FileDigest{Path: p, Sha256: hex.EncodeToString(h[:])})
	}
	skillMDHash := ""
	if rel := in.Meta.GetSkillMDRel(); rel != "" {
		if body, ok := in.Files[rel]; ok {
			h := sha256.Sum256(body)
			skillMDHash = hex.EncodeToString(h[:])
		}
	}
	entrypoints := append([]string(nil), in.Meta.GetEntrypoints()...)
	sort.Strings(entrypoints)
	d := ManifestDigest{
		Name:          in.Meta.GetName(),
		Version:       in.Meta.GetVersion(),
		SkillMDSha256: skillMDHash,
		Files:         fd,
		Entrypoints:   entrypoints,
		RiskLevel:     in.Meta.GetRiskLevel(),
	}
	return Canonicalize(d)
}

// SignManifest signs the canonical bytes of a package's manifest digest.
// Convenience wrapper that handles the canonicalization call site.
func SignManifest(s Signer, in DigestInputs) ([]byte, error) {
	canon, err := ManifestDigestBytes(in)
	if err != nil {
		return nil, err
	}
	return s.Sign(canon)
}

// VerifyManifest verifies a manifest signature. pub is the public key of
// the publisher; sig is the raw signature bytes; meta+files describe the
// package. Returns nil on success, an error otherwise.
//
// The caller is expected to have already validated that sig is for the
// expected KeyID (via TrustStore.Lookup). This function does NOT consult
// any trust store — it just does the crypto.
func VerifyManifest(pub []byte, sig []byte, in DigestInputs) error {
	canon, err := ManifestDigestBytes(in)
	if err != nil {
		return err
	}
	if err := Verify(pub, canon, sig); err != nil {
		metrics.Global.Sign.IncVerify("bad_signature")
		return err
	}
	metrics.Global.Sign.IncVerify("ok")
	return nil
}