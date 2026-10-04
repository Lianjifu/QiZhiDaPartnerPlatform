package server

import "testing"

// In the qzda-app monolith there is no per-unit route ownership. This
// test now only documents that ModeApp / ModeAll accept the share +
// attachments routes (ModeApp is the only runtime mode; ModeAll is a
// test-only switch).
func TestAcceptsShareAndAttachments(t *testing.T) {
	paths := []string{
		"/api/share/tok",
		"/api/attachments/a.bin",
		"/api/sessions/s1/share",
		"/api/internal/channel-sessions",
		"/api/internal/skill-catalog",
	}
	for _, mode := range []ServiceMode{ModeApp, ModeAll} {
		for _, p := range paths {
			if !mode.IsUnified() {
				t.Fatalf("%s should be unified for %s", mode, p)
			}
		}
	}
}
