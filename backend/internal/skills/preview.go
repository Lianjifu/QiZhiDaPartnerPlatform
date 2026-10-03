package skills

import (
	"net/http"
	"strings"
)

// W3-D3 preview-sandbox helpers.
//
// These set response headers that make artifact delivery safe to embed
// in an iframe from the same origin (or to render inline via
// `?inline=1`). The threat model is documented in ADR-030:
//
//   - X-Frame-Options: SAMEORIGIN   — reject cross-origin iframe embed
//   - Content-Security-Policy       — limit what the inline render can do
//   - X-Content-Type-Options: nosniff — never let the browser guess a MIME
//   - Cache-Control: private        — never put artifacts behind a shared cache
//
// The set is intentionally conservative — every artifact endpoint gets
// these headers regardless of `inline`, because the cost is zero and a
// future caller might pass `inline=1` without remembering to harden.

// previewSandboxHeaders returns the headers that every artifact
// endpoint should set. The caller can override individual headers
// afterward (e.g. to set a custom Content-Type).
func previewSandboxHeaders(extraCSP ...string) http.Header {
	h := http.Header{}
	h.Set("X-Frame-Options", "SAMEORIGIN")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	csp := "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'"
	for _, extra := range extraCSP {
		csp = strings.TrimSpace(extra)
		if csp == "" {
			continue
		}
		h.Set("Content-Security-Policy", csp)
		return h
	}
	h.Set("Content-Security-Policy", csp)
	return h
}

// writePreviewSandboxHeaders sets the standard headers in one call.
func writePreviewSandboxHeaders(w http.ResponseWriter) {
	for k, vs := range previewSandboxHeaders() {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
}

// wantInline returns true when the caller asked for inline delivery via
// ?inline=1. Used to flip Content-Disposition from "attachment" to
// "inline" so the browser renders the artifact instead of downloading.
func wantInline(r *http.Request) bool {
	if r == nil {
		return false
	}
	v := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("inline")))
	return v == "1" || v == "true" || v == "yes"
}

// inlineContentDisposition mirrors contentDispositionAttachment but
// uses "inline" instead of "attachment" so the browser renders the
// artifact in-place when ?inline=1 is set. Same filename conventions —
// Save-As still works.
func inlineContentDisposition(name string) string {
	// Trim display name same way contentDispositionAttachment does.
	display := name
	if strings.HasSuffix(strings.ToLower(name), ".pptx") || strings.HasSuffix(strings.ToLower(name), ".pdf") {
		if i := strings.Index(name, "-"); i > 0 && i < len(name)-1 {
			display = name[i+1:]
		}
	}
	return "inline; filename=\"" + asciiFallbackFilename(display) + "\"; filename*=UTF-8''" + name
}
