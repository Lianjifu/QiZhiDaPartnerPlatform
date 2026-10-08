// Package runtimeenv is the single source of truth for the dev / pro runtime profile.
package runtimeenv

import (
	"os"
	"strings"
)

type Mode string

const (
	ModeDev Mode = "dev"
	ModePro Mode = "pro"
)

// FromEnv reads QZDA_MODE. Empty means dev. Any other value resolves to pro so
// a misspelled value fails closed.
func FromEnv() Mode {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_MODE"))) {
	case "", "dev":
		return ModeDev
	default:
		return ModePro
	}
}

func (m Mode) String() string { return string(m) }

func (m Mode) IsDev() bool { return m == ModeDev }

func (m Mode) IsPro() bool { return m == ModePro }

// MemoryStore reports whether dev runs on the in-process store with the ACME seed.
// QZDA_DATA_BACKEND=memory is honored only in dev; pro always uses Postgres.
func (m Mode) MemoryStore() bool {
	return m.IsDev() && strings.EqualFold(strings.TrimSpace(os.Getenv("QZDA_DATA_BACKEND")), "memory")
}

func (m Mode) PersistEnabled() bool { return !m.MemoryStore() }

// AllowsMockIdentity permits x-mock-* identity headers and mock-*-token logins.
func (m Mode) AllowsMockIdentity() bool { return m.IsDev() }

// BanMockToken rejects mock-*-token credentials and issues JWT on login.
func (m Mode) BanMockToken() bool { return m.IsPro() }

// RequiresVault is true when credentials must be written to Vault.
func (m Mode) RequiresVault() bool { return m.IsPro() }

// DualApproval enables SoD / dual approval gates.
func (m Mode) DualApproval() bool { return m.IsPro() }

// AutoProvisionsSkillKeys reports whether a developer signing keypair is generated on first start.
func (m Mode) AutoProvisionsSkillKeys() bool { return m.IsDev() }

// EnsureGeneralEmployeeAllowed reports whether the built-in general employee is seeded.
func (m Mode) EnsureGeneralEmployeeAllowed() bool { return m.MemoryStore() }

// SessionSyncEnabled reads QZDA_SESSION_SYNC_ENABLED (default true). When set
// to "false" / "FALSE" / "0", session-sync metric writes are rejected and the
// FE should likewise disable BroadcastChannel + heartbeat. The mirror reader
// keeps FE/BE consistent so ops can globally disable the feature. Matching
// is case-insensitive on the boolean value.
func SessionSyncEnabled() bool {
	v := strings.TrimSpace(os.Getenv("QZDA_SESSION_SYNC_ENABLED"))
	if v == "" {
		return true
	}
	return v != "0" && !strings.EqualFold(v, "false")
}
