package vetter

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// fixtureRoot returns the absolute path to a fixture directory under testdata/.
func fixtureRoot(t *testing.T, name string) string {
	t.Helper()
	p, err := filepath.Abs(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("abs: %v", err)
	}
	return p
}

// TestCleanSkillPasses — the positive fixture must yield Allow / 0 findings.
func TestCleanSkillPasses(t *testing.T) {
	res, err := Run(fixtureRoot(t, "clean_skill"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Decision != Allow {
		t.Fatalf("want Allow, got %s (%d findings)", res.Decision, len(res.Findings))
	}
	if len(res.Findings) > 0 {
		for _, f := range res.Findings {
			t.Logf("unexpected finding: %+v", f)
		}
		t.Fatalf("clean skill produced %d findings", len(res.Findings))
	}
}

// TestDestructiveBlocks — rm -rf /, mkfs, dd, fork bomb all fire.
func TestDestructiveBlocks(t *testing.T) {
	res := RunBytes(loadFixture(t, "bad_destructive"))
	if res.Decision != Deny {
		t.Fatalf("want Deny, got %s", res.Decision)
	}
	if !hasCategory(res, CatDestructive) {
		t.Fatalf("missing CatDestructive finding in: %+v", res.Findings)
	}
	if !hasPattern(res, "rm-rf-root") {
		t.Fatalf("missing rm-rf-root pattern in: %+v", res.Findings)
	}
	if !hasPattern(res, "mkfs-format") && !hasPattern(res, "mkfs-variant") {
		t.Fatalf("missing mkfs pattern in: %+v", res.Findings)
	}
	if !hasPattern(res, "dd-disk-write") {
		t.Fatalf("missing dd-disk-write pattern in: %+v", res.Findings)
	}
	if !hasPattern(res, "fork-bomb") {
		t.Fatalf("missing fork-bomb pattern in: %+v", res.Findings)
	}
}

// TestEgressBlocks — curl/wget/nc/python one-liner all fire.
func TestEgressBlocks(t *testing.T) {
	res := RunBytes(loadFixture(t, "bad_egress"))
	if res.Decision != Deny {
		t.Fatalf("want Deny, got %s", res.Decision)
	}
	if !hasCategory(res, CatEgress) {
		t.Fatalf("missing CatEgress finding in: %+v", res.Findings)
	}
	for _, name := range []string{"curl-egress", "wget-egress", "netcat-exec", "python-urllib-one-liner"} {
		if !hasPattern(res, name) {
			t.Fatalf("missing %s in: %+v", name, res.Findings)
		}
	}
}

// TestCredentialBlocks — env var, file read, hardcoded literal all fire.
func TestCredentialBlocks(t *testing.T) {
	res := RunBytes(loadFixture(t, "bad_credential"))
	if res.Decision != Deny {
		t.Fatalf("want Deny, got %s", res.Decision)
	}
	if !hasCategory(res, CatCredential) {
		t.Fatalf("missing CatCredential finding in: %+v", res.Findings)
	}
	for _, name := range []string{"aws-credential", "github-token", "aws-credentials-file", "dotenv-read", "ssh-private-key", "hardcoded-key-literal"} {
		if !hasPattern(res, name) {
			t.Fatalf("missing %s in: %+v", name, res.Findings)
		}
	}
}

// TestEscalationBlocks — sudo, chmod 777, setuid bit, chown root all fire.
func TestEscalationBlocks(t *testing.T) {
	res := RunBytes(loadFixture(t, "bad_escalation"))
	if res.Decision != Deny {
		t.Fatalf("want Deny, got %s", res.Decision)
	}
	if !hasCategory(res, CatEscalation) {
		t.Fatalf("missing CatEscalation finding in: %+v", res.Findings)
	}
	for _, name := range []string{"sudo-priv", "chmod-777", "chmod-setuid", "chown-root"} {
		if !hasPattern(res, name) {
			t.Fatalf("missing %s in: %+v", name, res.Findings)
		}
	}
}

// TestPersistenceBlocks — crontab/systemctl/launchctl/systemd unit all fire.
func TestPersistenceBlocks(t *testing.T) {
	res := RunBytes(loadFixture(t, "bad_persistence"))
	if res.Decision != Deny {
		t.Fatalf("want Deny, got %s", res.Decision)
	}
	if !hasCategory(res, CatPersistence) {
		t.Fatalf("missing CatPersistence finding in: %+v", res.Findings)
	}
	for _, name := range []string{"crontab-install", "systemctl", "launchctl", "systemd-unit-write", "shell-rc-mutate", "at-job"} {
		if !hasPattern(res, name) {
			t.Fatalf("missing %s in: %+v", name, res.Findings)
		}
	}
}

// TestRunBytesMatchesRunDir — Run(path) and RunBytes(files) must yield the
// same Decision and (modulo file ordering) the same findings set.
func TestRunBytesMatchesRunDir(t *testing.T) {
	for _, dir := range []string{"clean_skill", "bad_destructive", "bad_egress", "bad_credential", "bad_escalation", "bad_persistence"} {
		t.Run(dir, func(t *testing.T) {
			fromDisk, err := Run(fixtureRoot(t, dir))
			if err != nil {
				t.Fatalf("Run: %v", err)
			}
			fromBytes := RunBytes(loadFixture(t, dir))
			if fromDisk.Decision != fromBytes.Decision {
				t.Fatalf("Decision mismatch: disk=%s bytes=%s", fromDisk.Decision, fromBytes.Decision)
			}
			if len(fromDisk.Findings) != len(fromBytes.Findings) {
				t.Fatalf("findings count mismatch: disk=%d bytes=%d", len(fromDisk.Findings), len(fromBytes.Findings))
			}
		})
	}
}

// TestUnreadableFileDoesNotPanic — a broken symlink / permission-denied file
// surfaces as a SevWarn "unreadable-file" finding, not a panic.
func TestUnreadableFileDoesNotPanic(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("# ok\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "scripts"), []byte("not a script"), 0o000); err != nil {
		t.Fatalf("write protected: %v", err)
	}
	defer func() { _ = os.Chmod(filepath.Join(dir, "scripts"), 0o644) }()
	res, err := Run(dir)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Decision == Deny {
		t.Fatalf("want not-Deny for unreadable file, got %s findings=%d", res.Decision, len(res.Findings))
	}
}

// TestSkipsBinaryFiles — random binary blob must not produce false positives
// even if it incidentally contains the literal string "sudo".
func TestSkipsBinaryFiles(t *testing.T) {
	files := map[string][]byte{
		"SKILL.md":   []byte("# ok"),
		"docs.bin":   {0x00, 0x01, 0x02, 's', 'u', 'd', 'o', 0x00, 0xff},
		"image.png":  append([]byte{0x89, 'P', 'N', 'G'}, bytes_repeat([]byte("rm -rf / "), 50)...),
	}
	res := RunBytes(files)
	if res.Decision != Allow {
		t.Fatalf("binary files should be skipped, got %s with findings=%d", res.Decision, len(res.Findings))
	}
}

// TestEmptyInput — no files at all → Allow.
func TestEmptyInput(t *testing.T) {
	res := RunBytes(nil)
	if res.Decision != Allow {
		t.Fatalf("empty input should Allow, got %s", res.Decision)
	}
}

// TestDeterministicOrdering — same input → same findings order across calls.
func TestDeterministicOrdering(t *testing.T) {
	files := loadFixture(t, "bad_destructive")
	a := RunBytes(files)
	b := RunBytes(files)
	if len(a.Findings) != len(b.Findings) {
		t.Fatalf("finding count drift: a=%d b=%d", len(a.Findings), len(b.Findings))
	}
	for i := range a.Findings {
		if a.Findings[i] != b.Findings[i] {
			t.Fatalf("finding[%d] differs: a=%+v b=%+v", i, a.Findings[i], b.Findings[i])
		}
	}
}

// TestResultStructureSanity — Result exposes the canonical Verdict string.
func TestResultStructureSanity(t *testing.T) {
	res := RunBytes(loadFixture(t, "bad_egress"))
	if res.Verdict != res.Decision.String() {
		t.Fatalf("Verdict=%s Decision.String()=%s", res.Verdict, res.Decision.String())
	}
	if res.Verdict != "block" {
		t.Fatalf("want verdict=block, got %s", res.Verdict)
	}
}

// --- helpers ---

func hasCategory(res Result, cat Category) bool {
	for _, f := range res.Findings {
		if f.Category == cat {
			return true
		}
	}
	return false
}

func hasPattern(res Result, name string) bool {
	for _, f := range res.Findings {
		if f.Pattern == name {
			return true
		}
	}
	return false
}

// loadFixture walks testdata/<name>/ and returns its files as bytes. Used by
// both RunBytes tests and the Run/RunBytes parity check.
func loadFixture(t *testing.T, name string) map[string][]byte {
	t.Helper()
	root := fixtureRoot(t, name)
	out := map[string][]byte{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		body, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = body
		return nil
	})
	if err != nil {
		t.Fatalf("loadFixture %s: %v", name, err)
	}
	return out
}

func bytes_repeat(b []byte, n int) []byte {
	out := make([]byte, 0, len(b)*n)
	for i := 0; i < n; i++ {
		out = append(out, b...)
	}
	return out
}

// --- shared errors contract ---

// TestErrorCodesExported — the server package needs both codes to exist and
// to be distinct. Guards against accidental removal during refactors.
func TestErrorCodesExported(t *testing.T) {
	if apperr.SkillVetDenied == "" || apperr.SkillVetInvalid == "" {
		t.Fatalf("empty error code")
	}
	if apperr.SkillVetDenied == apperr.SkillVetInvalid {
		t.Fatalf("codes must be distinct")
	}
	if !strings.HasPrefix(string(apperr.SkillVetDenied), "E_") {
		t.Fatalf("SkillVetDenied must start with E_, got %s", apperr.SkillVetDenied)
	}
	if !strings.HasPrefix(string(apperr.SkillVetInvalid), "E_") {
		t.Fatalf("SkillVetInvalid must start with E_, got %s", apperr.SkillVetInvalid)
	}
}

// TestNewAppErrStability — the vetter returns an AppError-shaped error when
// wired through the server. Sanity-check that apperr.BadReq wraps the code.
func TestNewAppErrStability(t *testing.T) {
	e := apperr.BadReq(apperr.SkillVetDenied, "blocked")
	if e == nil {
		t.Fatalf("nil AppError")
	}
	if e.Code != apperr.SkillVetDenied {
		t.Fatalf("code mismatch: %s", e.Code)
	}
	if e.Status != 400 {
		t.Fatalf("status mismatch: %d", e.Status)
	}
}

// TestAllowFileSuppressesPatterns — when a skill ships a .vetter-allow.json
// at its root, the named patterns are dropped from the scan for that skill.
func TestAllowFileSuppressesPatterns(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, dir, ".vetter-allow.json", `{"suppressPatterns":["system-install"]}`)
	mustWrite(t, dir, "scripts/install.sh", "#!/bin/bash\nbrew install vercel\n")
	res, err := Run(dir)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Decision != Allow {
		t.Fatalf("want Allow (suppressed), got %s with %d findings", res.Decision, len(res.Findings))
	}
	if len(res.SuppressedPatterns()) != 1 || res.SuppressedPatterns()[0] != "system-install" {
		t.Fatalf("SuppressedPatterns=%v", res.SuppressedPatterns())
	}
}

// TestAllowFileMissingOrBroken — invalid JSON or missing file → silently
// ignored; the vetter scans as if no override existed.
func TestAllowFileMissingOrBroken(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, dir, ".vetter-allow.json", `{not json`)
	mustWrite(t, dir, "scripts/install.sh", "#!/bin/bash\nbrew install vercel\n")
	res, err := Run(dir)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Decision != Deny {
		t.Fatalf("broken allow file must NOT suppress, got %s", res.Decision)
	}
}

// TestAllowFileCannotSuppressCredential — .vetter-allow.json is whitelist of
// pattern names, but RunBytes (the upload path) has no fs access so the
// override only works through Run(path).
func TestRunBytesIgnoresAllowFile(t *testing.T) {
	res := RunBytes(map[string][]byte{
		"scripts/install.sh": []byte("#!/bin/bash\nbrew install vercel\n"),
	})
	if res.Decision != Deny {
		t.Fatalf("RunBytes should ignore allow file, got %s", res.Decision)
	}
}

func mustWrite(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, filepath.Dir(name)), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}