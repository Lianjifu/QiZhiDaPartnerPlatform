package runtimeenv

import (
	"testing"
)

func TestFromEnvResolvesDevAndPro(t *testing.T) {
	cases := map[string]Mode{
		"": ModeDev, "dev": ModeDev, " DEV ": ModeDev,
		"pro": ModePro, "PRO": ModePro,
		"staging": ModePro, "production": ModePro, "demo": ModePro, "typo": ModePro,
	}
	for in, want := range cases {
		t.Run("QZDA_MODE="+in, func(t *testing.T) {
			t.Setenv("QZDA_MODE", in)
			if got := FromEnv(); got != want {
				t.Fatalf("FromEnv() with QZDA_MODE=%q = %q, want %q", in, got, want)
			}
		})
	}
}

func TestDevDefaultFlags(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	m := FromEnv()
	if !m.PersistEnabled() || m.MemoryStore() || m.EnsureGeneralEmployeeAllowed() {
		t.Fatal("dev without QZDA_DATA_BACKEND should persist to Postgres")
	}
	if !m.AllowsMockIdentity() || m.BanMockToken() {
		t.Fatal("dev should allow mock identity and password login")
	}
	if m.DualApproval() || m.RequiresVault() || !m.AutoProvisionsSkillKeys() {
		t.Fatal("dev should skip dual approval and vault, and auto-provision dev keypair")
	}
}

func TestDevMemoryStore(t *testing.T) {
	t.Setenv("QZDA_MODE", "dev")
	t.Setenv("QZDA_DATA_BACKEND", "memory")
	m := FromEnv()
	if !m.MemoryStore() || m.PersistEnabled() || !m.EnsureGeneralEmployeeAllowed() {
		t.Fatal("dev + memory backend should not persist and should seed")
	}
}

func TestProIgnoresMemoryBackend(t *testing.T) {
	t.Setenv("QZDA_MODE", "pro")
	t.Setenv("QZDA_DATA_BACKEND", "memory")
	m := FromEnv()
	if m.MemoryStore() || !m.PersistEnabled() || m.EnsureGeneralEmployeeAllowed() {
		t.Fatal("pro must always persist and never seed, regardless of QZDA_DATA_BACKEND")
	}
}

func TestProFlags(t *testing.T) {
	t.Setenv("QZDA_MODE", "pro")
	m := FromEnv()
	if m.AllowsMockIdentity() || !m.BanMockToken() {
		t.Fatal("pro must reject mock identity, mock tokens and password login")
	}
	if !m.DualApproval() || !m.RequiresVault() || m.AutoProvisionsSkillKeys() {
		t.Fatal("pro must enforce dual approval and vault, and never auto-provision keys")
	}
}

func TestSessionSyncEnabledFlagVariants(t *testing.T) {
	// "0" / "false" / "FALSE" → disabled; "1" / "true" / "" / unset → enabled.
	disabled := []string{"0", "false", "FALSE", "False", "  false  "}
	enabled := []string{"", "1", "true", "TRUE", "yes", "on"}

	for _, v := range disabled {
		t.Run("disabled_"+v, func(t *testing.T) {
			t.Setenv("QZDA_SESSION_SYNC_ENABLED", v)
			if SessionSyncEnabled() {
				t.Fatalf("SessionSyncEnabled()=true for %q, want false", v)
			}
		})
	}
	for _, v := range enabled {
		t.Run("enabled_"+v, func(t *testing.T) {
			t.Setenv("QZDA_SESSION_SYNC_ENABLED", v)
			if !SessionSyncEnabled() {
				t.Fatalf("SessionSyncEnabled()=false for %q, want true", v)
			}
		})
	}
}
