package server

// ServiceMode selects the deployment shape. qzda-sys/qzda-collab/qzda-cap/
// qzda-workflow were collapsed into a single qzda-app monolith (Phase 2),
// so the only runtime mode is ModeApp. ModeAll survives for tests that need
// every handler regardless of features.
type ServiceMode string

const (
	ModeAll ServiceMode = "all"
	ModeApp ServiceMode = "app"
)

func unifiedMode(m ServiceMode) bool {
	return m == ModeAll || m == ModeApp
}

// IsUnified reports monolith / full-route modes (tests + qzda-app deployment).
func (m ServiceMode) IsUnified() bool {
	return unifiedMode(m)
}

// ParseServiceMode resolves QZDA_SERVICE / cmdline mode names. The legacy
// coarse-split names (sys / cap / workflow) are accepted and coerced to
// ModeApp so older scripts don't fail; the binary they referenced is gone.
func ParseServiceMode(s string) ServiceMode {
	switch s {
	case "all", "test":
		return ModeAll
	}
	return ModeApp
}

func (m ServiceMode) String() string {
	switch m {
	case ModeAll:
		return "qzda-all"
	case ModeApp:
		return "qzda-app"
	default:
		return "qzda-app"
	}
}