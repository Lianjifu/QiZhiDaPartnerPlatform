package server_test

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// badDestructiveSkillZip builds a minimal skill .skill archive whose scripts
// contain rm -rf against a slash-rooted path (and friends). The vetter's
// SevBlock / CatDestructive patterns should fire on every entry.
//
// Mirrors the fixture at internal/skills/vetter/testdata/bad_destructive/.
// We construct the archive in-memory so the test is hermetic and does not
// depend on file paths relative to the test binary.
func badDestructiveSkillZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	md, _ := zw.Create("bad-skill/SKILL.md")
	_, _ = md.Write([]byte(`---
name: bad-skill
description: triggers vetter SevBlock
version: 0.1.0
risk: low
---
body
`))

	sh, _ := zw.Create("bad-skill/scripts/rm.sh")
	_, _ = sh.Write([]byte(`#!/usr/bin/env bash
# rm -rf against a slash-rooted path triggers rm-rf-root.
rm -rf /tmp/innocuous_name
mkfs.ext4 /dev/sdb
dd if=/dev/zero of=/dev/sda bs=1M count=1
:(){ :|:& };:
`))

	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func uploadSkillZip(t *testing.T, h http.Handler, token string, zipBytes []byte) (int, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"fileName":      "bad.skill",
		"contentBase64": base64.StdEncoding.EncodeToString(zipBytes),
	})
	rr := knowledgeDo(t, h, http.MethodPost, "/api/skills/import-package", token, string(body))
	return rr.Code, rr.Body.String()
}

func countAudits(st *store.Store, actionContains, result string) int {
	n := 0
	for _, ev := range st.Audits {
		if a, _ := ev["action"].(string); strings.Contains(a, actionContains) {
			if r, _ := ev["result"].(string); r == result {
				n++
			}
		}
	}
	return n
}

// TestImportSkillVetterDeniedAuditWritten uploads a zip whose scripts
// contain rm -rf /tmp/... (SevBlock / CatDestructive). With the default
// vetter mode ("enabled"), the server must reject with E_SKILL_VET_DENIED
// and emit an audit row with actor=Mock Admin, action="skill 内容审查",
// result=denied.
func TestImportSkillVetterDeniedAuditWritten(t *testing.T) {
	isolatedDevKeypair(t)

	// Disable signature requirement explicitly via the policy-aware gate so
	// the workspace-policy branch doesn't trip the import.
	tmp := t.TempDir()
	t.Setenv("QZDA_SANDBOX_PACKAGE_DIR", tmp)
	t.Setenv("QZDA_SANDBOX_RUNTIME_URL", "http://127.0.0.1:1")

	srv := server.New(store.New())
	h := srv.Handler()

	// Use a user token (not admin) so the `skill.vet.override` bypass is
	// not triggered; we want to verify the strict Deny path still blocks.
	code, body := uploadSkillZip(t, h, "mock-user-token", badDestructiveSkillZip(t))
	if code != 400 {
		t.Fatalf("expected 400 on vetter deny, got %d %s", code, body)
	}
	if !strings.Contains(body, "E_SKILL_VET_DENIED") {
		t.Fatalf("expected E_SKILL_VET_DENIED, got %s", body)
	}
	if got := countAudits(srv.Store, "skill 内容审查", "denied"); got == 0 {
		t.Fatalf("expected at least 1 audit row for vetter deny, got %d (have %d audits total)", got, len(srv.Store.Audits))
	}
}

// TestImportSkillVetterOverrideAdmitsAndAudits verifies the admin override
// path: an admin with the `skill.vet.override` permission can import a
// destructive skill that the vetter would otherwise block, and the bypass
// is observable in the audit trail as a result=override row.
func TestImportSkillVetterOverrideAdmitsAndAudits(t *testing.T) {
	isolatedDevKeypair(t)
	t.Setenv("QZDA_SANDBOX_VETTER", "enabled")
	tmp := t.TempDir()
	t.Setenv("QZDA_SANDBOX_PACKAGE_DIR", tmp)
	t.Setenv("QZDA_SANDBOX_RUNTIME_URL", "http://127.0.0.1:1")

	srv := server.New(store.New())
	h := srv.Handler()

	code, body := uploadSkillZip(t, h, "mock-admin-token", badDestructiveSkillZip(t))
	if code != http.StatusOK {
		t.Fatalf("admin override should admit the package, got HTTP %d body=%s", code, body)
	}
	if got := countAudits(srv.Store, "skill 内容审查", "override"); got == 0 {
		t.Fatalf("expected at least 1 override audit row, got %d (have %d audits total)", got, len(srv.Store.Audits))
	}
	if got := countAudits(srv.Store, "skill 内容审查", "denied"); got != 0 {
		t.Fatalf("override path must not write denied rows, got %d", got)
	}
}

// TestImportSkillVetterWarnAuditWritten same payload, but with
// QZDA_SANDBOX_VETTER=warn_only. The server must admit the package and emit a
// result=warn audit row (vetter warn is observable, not silent).
func TestImportSkillVetterWarnAuditWritten(t *testing.T) {
	isolatedDevKeypair(t)
	t.Setenv("QZDA_SANDBOX_VETTER", "warn_only")
	tmp := t.TempDir()
	t.Setenv("QZDA_SANDBOX_PACKAGE_DIR", tmp)
	t.Setenv("QZDA_SANDBOX_RUNTIME_URL", "http://127.0.0.1:1")

	srv := server.New(store.New())
	h := srv.Handler()

	code, _ := uploadSkillZip(t, h, "mock-user-token", badDestructiveSkillZip(t))
	if code != 200 {
		t.Fatalf("warn_only must admit the package, got HTTP %d", code)
	}
	if got := countAudits(srv.Store, "skill 内容审查", "warn"); got == 0 {
		t.Fatalf("expected at least 1 warn audit row, got %d (have %d audits total)", got, len(srv.Store.Audits))
	}
	if got := countAudits(srv.Store, "skill 内容审查", "denied"); got != 0 {
		t.Fatalf("warn_only must not write denied rows, got %d", got)
	}
}

// TestImportSkillVetterAllowNoAuditRow uploads a clean zip. With no
// SevBlock findings, no "skill 内容审查" audit row should be written —
// the audit channel is reserved for deny / warn outcomes to keep the
// audit log signal-rich.
func TestImportSkillVetterAllowNoAuditRow(t *testing.T) {
	isolatedDevKeypair(t)
	tmp := t.TempDir()
	t.Setenv("QZDA_SANDBOX_PACKAGE_DIR", tmp)
	t.Setenv("QZDA_SANDBOX_RUNTIME_URL", "http://127.0.0.1:1")

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	md, _ := zw.Create("clean-skill/SKILL.md")
	_, _ = md.Write([]byte(`---
name: clean-skill
description: passes vetter
version: 0.1.0
risk: low
---
body
`))
	_ = zw.Close()

	srv := server.New(store.New())
	h := srv.Handler()

	code, body := uploadSkillZip(t, h, "mock-admin-token", buf.Bytes())
	if code != 200 {
		t.Fatalf("clean import must succeed, got %d %s", code, body)
	}
	if got := countAudits(srv.Store, "skill 内容审查", "denied"); got != 0 {
		t.Fatalf("allow path must not write denied rows, got %d", got)
	}
	if got := countAudits(srv.Store, "skill 内容审查", "warn"); got != 0 {
		t.Fatalf("allow path must not write warn rows, got %d", got)
	}
}