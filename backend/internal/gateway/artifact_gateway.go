// Package gateway is the single chokepoint for high-risk HTTP routes in the
// skill artifact surface. It pulls every per-request guard (path traversal,
// size cap, MIME allow-list, auth, audit) out of individual handlers so
// adding a new artifact route is one ValidateArtifactRequest call away from
// being safe.
//
// The package intentionally depends only on net/http + stdlib + pkg/errors.
// No coupling to internal/auth or internal/server so the same gate can be
// unit-tested with stub IdentityProvider / AuditFunc values.
package gateway

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// IdentityProvider is the minimal surface the gateway needs from a request
// to enforce auth and write audit rows. *auth.Identity implements this
// implicitly via the WithIdentity adapter (see server.appendAuditFn).
type IdentityProvider interface {
	ActorName() string
	WorkspaceID() string
}

// AuditFunc is the gateway's view of the audit pipeline. Adapts to
// store.Store.AppendAudit by closing over workspace / actor defaults.
type AuditFunc func(workspaceID, actor, action, target, result, reason string)

// ArtifactPolicy is the gate configuration. Construct via
// DefaultArtifactPolicy then mutate per-env.
type ArtifactPolicy struct {
	MaxBytes    int64
	AllowExt    map[string]bool // keys are lowercase extensions WITH the leading dot
	RequireAuth bool
}

const (
	extDocx         = ".docx"
	extPptx         = ".pptx"
	extXlsx         = ".xlsx"
	extPdf          = ".pdf"
	extPng          = ".png"
	extJpg          = ".jpg"
	extJpeg         = ".jpeg"
	auditAction     = "skill 产物下载"
	defaultAuditWs  = "w1"
)

// DefaultArtifactPolicy returns the production defaults: 100 MB cap, the
// 7 MIME types the document-preview surface actually consumes, and auth
// required. Operators override MaxBytes via DE_ARTIFACT_MAX_BYTES and
// RequireAuth via DE_ARTIFACT_REQUIRE_AUTH in the server wrapper.
func DefaultArtifactPolicy() *ArtifactPolicy {
	return &ArtifactPolicy{
		MaxBytes: 100 * 1024 * 1024,
		AllowExt: map[string]bool{
			extDocx: true,
			extPptx: true,
			extXlsx: true,
			extPdf:  true,
			extPng:  true,
			extJpg:  true,
			extJpeg: true,
		},
		RequireAuth: true,
	}
}

// ValidateArtifactRequest is the gate. It returns ok=false when ANY check
// fails and has already written the HTTP error response to w; callers must
// return without further work. On success it returns cleanName (the
// decoded + path-canonicalized basename, safe to join with rootDir) and
// ok=true. cleanName is guaranteed to be a single path segment (no `/`,
// no `..`, no NUL).
//
// Check order is deliberate:
//  1. Empty / whitespace → 400 (cheap reject).
//  2. URL-decode THEN re-base THEN clean → blocks encoded traversal like
//     %2e%2e%2f that Base() on the raw string would miss.
//  3. Extension allow-list → 415 (run BEFORE stat so a bad extension
//     always 415s, never leaks whether the file exists).
//  4. Stat + size cap → 404 / 413.
//  5. Auth → 401 (only after file is otherwise valid so attackers can't
//     probe identity state via timing).
//  6. Audit row on every outcome (success or denied).
func ValidateArtifactRequest(w http.ResponseWriter, r *http.Request, rawName, rootDir string, p *ArtifactPolicy, id IdentityProvider, audit AuditFunc) (string, bool) {
	if p == nil {
		p = DefaultArtifactPolicy()
	}
	root := filepath.Clean(rootDir)
	actor := ""
	ws := defaultAuditWs
	if id != nil {
		actor = id.ActorName()
		if w := id.WorkspaceID(); w != "" {
			ws = w
		}
	}

	// 1. Empty / whitespace.
	trimmed := strings.TrimSpace(rawName)
	if trimmed == "" {
		deny(w, audit, ws, actor, trimmed, "empty artifact name", http.StatusBadRequest, apperr.BadRequest, "无效产物名")
		return "", false
	}

	// 2. Decode, then detect explicit traversal markers BEFORE re-base.
	// filepath.Base("../../etc/passwd") silently returns "passwd", which
	// would then stat root/passwd and 404 — masking the attack as a
	// missing file. Reject any decoded name that still contains a path
	// separator or a `..` segment so we return 400 instead.
	decoded := trimmed
	if d, err := url.PathUnescape(trimmed); err == nil && d != "" {
		decoded = d
	}
	decoded = strings.TrimSpace(decoded)
	if strings.ContainsAny(decoded, "/\\") || strings.Contains(decoded, "..") {
		deny(w, audit, ws, actor, trimmed, "path traversal", http.StatusBadRequest, apperr.BadRequest, "无效产物路径")
		return "", false
	}
	name := filepath.Base(decoded)
	name = strings.Trim(name, "`\"'")
	if name == "" || name == "." || name == ".." || strings.ContainsRune(name, 0) {
		deny(w, audit, ws, actor, trimmed, "path traversal", http.StatusBadRequest, apperr.BadRequest, "无效产物路径")
		return "", false
	}
	cleaned := filepath.Clean(filepath.Join(root, name))
	if cleaned != filepath.Join(root, name) {
		deny(w, audit, ws, actor, name, "cleaned path mismatch", http.StatusBadRequest, apperr.BadRequest, "无效产物路径")
		return "", false
	}
	if !strings.HasPrefix(cleaned, root+string(os.PathSeparator)) && cleaned != root {
		deny(w, audit, ws, actor, name, "escapes root", http.StatusBadRequest, apperr.BadRequest, "无效产物路径")
		return "", false
	}

	// 4. Extension allow-list (runs BEFORE stat so a bad extension always
	// returns 415, even if the file is missing — avoids leaking whether
	// an arbitrary extension exists on disk).
	ext := strings.ToLower(filepath.Ext(name))
	if !p.AllowExt[ext] {
		deny(w, audit, ws, actor, name, "extension "+ext+" not allowed", http.StatusUnsupportedMediaType, apperr.UnsupportedMediaType, "该文件类型不允许下载")
		return "", false
	}

	// 3. Stat + size (after extension is known good — no point telling
	// a non-allowlisted extension about size).
	st, err := os.Stat(cleaned)
	if err != nil || st.IsDir() {
		deny(w, audit, ws, actor, name, "not found", http.StatusNotFound, apperr.NotFound, "产物不存在")
		return "", false
	}
	if p.MaxBytes > 0 && st.Size() > p.MaxBytes {
		deny(w, audit, ws, actor, name, fmt.Sprintf("oversize %d > %d", st.Size(), p.MaxBytes), http.StatusRequestEntityTooLarge, apperr.PayloadTooLarge, "产物超过大小上限")
		return "", false
	}

	// 5. Auth.
	if p.RequireAuth && actor == "" {
		deny(w, audit, ws, actor, name, "missing identity", http.StatusUnauthorized, apperr.Unauthorized, "需要登录")
		return "", false
	}

	// 6. Success audit.
	if audit != nil {
		audit(ws, actor, auditAction, name, "success", fmt.Sprintf("size=%d ext=%s", st.Size(), ext))
	}
	return name, true
}

func deny(w http.ResponseWriter, audit AuditFunc, ws, actor, name, reason string, status int, code apperr.Code, msg string) {
	if audit != nil {
		audit(ws, actor, auditAction, name, "denied", reason)
	}
	http.Error(w, fmt.Sprintf(`{"code":%q,"message":%q}`, string(code), msg), status)
}