// Package vetter statically scans skill packages for dangerous patterns before
// they enter Store.Skills. W1-D1 introduces this as a last line of defense
// against skill packages that try to destruct files, exfiltrate data, expose
// credentials, escalate privileges, or persist on the host.
//
// Two entry points:
//
//   - Run(rootDir string) — walks a directory tree on disk (used for builtins).
//   - RunBytes(files map[string][]byte) — scans an in-memory virtual FS (used
//     for future upload paths that carry package bytes instead of metadata).
//
// The two share the same scanning core (scanFile) so behavior is identical.
package vetter

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/metrics"
)

// Decision is the top-level verdict of a scan.
type Decision int

const (
	// Allow — no findings.
	Allow Decision = iota
	// Warn — findings exist but none are SevBlock (reserved for future use;
	// current pattern set is all SevBlock).
	Warn
	// Deny — at least one SevBlock finding. Caller should refuse to install.
	Deny
)

// String renders the verdict as the canonical "pass"/"warn"/"block" string
// shared with the audit log and the SSE envelope.
func (d Decision) String() string {
	switch d {
	case Allow:
		return "pass"
	case Warn:
		return "warn"
	case Deny:
		return "block"
	}
	return "unknown"
}

// Severity ranks a single finding.
type Severity string

const (
	SevBlock Severity = "block"
	SevWarn  Severity = "warn"
	SevInfo  Severity = "info"
)

// Category groups findings by the kind of risk they represent.
type Category string

const (
	CatDestructive Category = "destructive"
	CatEgress       Category = "egress"
	CatCredential   Category = "credential"
	CatEscalation   Category = "escalation"
	CatPersistence  Category = "persistence"
)

// Finding is a single rule violation inside the package.
type Finding struct {
	Category   Category
	Severity   Severity
	Pattern    string // rule name (e.g. "rm-rf-root", "curl-egress")
	File       string // path relative to the package root, forward-slash separated
	Line       int    // 1-indexed; 0 when the finding is file-level rather than line-level
	Snippet    string // matched line, trimmed to 120 runes; empty when Line == 0
	Suggestion string // actionable remediation hint surfaced to the author
}

// Result aggregates one scan run.
type Result struct {
	Decision  Decision
	Verdict   string    // mirrors Decision.String()
	Findings  []Finding
	ScannedAt time.Time
	RootDir   string // logical root used for reporting; for RunBytes this is "<bytes>"

	// scannedFiles is the number of files actually inspected (text-only;
	// binary files are skipped). Exposed primarily for tests and logging.
	scannedFiles int

	// suppressedPatterns lists pattern names that were disabled for this run
	// via .vetter-allow.json at the skill root. Empty for RunBytes (no fs).
	suppressedPatterns []string
}

// SuppressedPatterns returns the pattern names that were suppressed by an
// override file in the package. Surfaced in the audit log so operators can
// see WHY a known-dangerous pattern was allowed through.
func (r Result) SuppressedPatterns() []string {
	if r.suppressedPatterns == nil {
		return nil
	}
	out := make([]string, len(r.suppressedPatterns))
	copy(out, r.suppressedPatterns)
	return out
}

// Run walks rootDir and scans every text file. The returned Result.RootDir is
// set to the absolute rootDir. An error is returned only for fs-level failures
// (permission, missing root); scanning errors are surfaced as Findings.
//
// A `<rootDir>/.vetter-allow.json` file may suppress specific pattern names
// for this package — used by skills that legitimately need a flagged
// primitive (e.g. frontend-slides installs vercel globally). The override
// file has shape `{"suppressPatterns":["system-install"]}`.
func Run(rootDir string) (Result, error) {
	res := Result{ScannedAt: time.Now().UTC(), RootDir: filepath.Clean(rootDir)}
	res.suppressedPatterns = loadAllowFile(rootDir)
	override := map[string]bool{}
	for _, n := range res.suppressedPatterns {
		override[n] = true
	}
	walkErr := filepath.WalkDir(rootDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			if shouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !isScannable(path) {
			return nil
		}
		body, err := readFileLimited(path, 4<<20) // 4MB per file ceiling
		if err != nil {
			// unreadable file → record but keep walking
			res.Findings = append(res.Findings, Finding{
				Category:   CatDestructive,
				Severity:   SevWarn,
				Pattern:    "unreadable-file",
				File:       relPath(rootDir, path),
				Suggestion: "ensure file is readable by the server process",
			})
			return nil
		}
		scanFile(relPath(rootDir, path), body, &res.Findings, override)
		res.scannedFiles++
		return nil
	})
	res.Decision = decide(res.Findings)
	res.Verdict = res.Decision.String()
	metrics.Global.Vetter.Inc(res.Verdict)
	if walkErr != nil && len(res.Findings) == 0 {
		return res, walkErr
	}
	sortFindings(&res.Findings)
	return res, nil
}

// RunBytes scans an in-memory virtual FS. The keys are forward-slash separated
// paths relative to a synthetic root; values are file bodies. No fs errors are
// possible — every entry is by definition readable.
func RunBytes(files map[string][]byte) Result {
	res := Result{ScannedAt: time.Now().UTC(), RootDir: "<bytes>"}
	// Iterate in sorted order so test assertions are deterministic.
	keys := make([]string, 0, len(files))
	for k := range files {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !isScannable(k) {
			continue
		}
		if shouldSkipDir(filepath.Base(filepath.Dir(k))) {
			continue
		}
		scanFile(filepath.ToSlash(k), files[k], &res.Findings, nil)
		res.scannedFiles++
	}
	res.Decision = decide(res.Findings)
	res.Verdict = res.Decision.String()
	sortFindings(&res.Findings)
	return res
}

// allowFileName is the per-skill override file. If `<root>/.vetter-allow.json`
// is present and parses, its suppressPatterns list is honored.
const allowFileName = ".vetter-allow.json"

// loadAllowFile reads .vetter-allow.json from rootDir if present. Returns
// nil silently on any error (missing file, bad JSON, bad type) — the vetter
// runs cleanly with no overrides.
func loadAllowFile(rootDir string) []string {
	body, err := os.ReadFile(filepath.Join(rootDir, allowFileName))
	if err != nil {
		return nil
	}
	var cfg struct {
		SuppressPatterns []string `json:"suppressPatterns"`
	}
	if err := json.Unmarshal(body, &cfg); err != nil {
		return nil
	}
	out := make([]string, 0, len(cfg.SuppressPatterns))
	for _, p := range cfg.SuppressPatterns {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// decide folds findings into the top-level Decision.
func decide(findings []Finding) Decision {
	for _, f := range findings {
		if f.Severity == SevBlock {
			return Deny
		}
	}
	if len(findings) > 0 {
		return Warn
	}
	return Allow
}

// sortFindings makes Findings deterministic: by file, then line, then pattern.
func sortFindings(findings *[]Finding) {
	sort.SliceStable(*findings, func(i, j int) bool {
		a, b := (*findings)[i], (*findings)[j]
		if a.File != b.File {
			return a.File < b.File
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		return a.Pattern < b.Pattern
	})
}
