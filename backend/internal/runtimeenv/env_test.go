package runtimeenv

import (
	"testing"
)

func TestParseAliases(t *testing.T) {
	cases := map[string]Mode{
		"": ModeDevelopment, "dev": ModeDevelopment, "local": ModeDevelopment,
		"demo": ModeDemo, "mock": ModeDemo,
		"staging": ModeStaging, "production": ModeProduction, "prod": ModeProduction,
	}
	for in, want := range cases {
		if got := Parse(in); got != want {
			t.Fatalf("Parse(%q)=%q want %q", in, got, want)
		}
	}
}

func TestDemoModeFlags(t *testing.T) {
	m := ModeDemo
	if !m.IsDemo() || m.PersistEnabled() || m.RequiresPostgres() || !m.AllowsSeed() {
		t.Fatalf("demo flags wrong: %+v persist=%v pg=%v seed=%v", m, m.PersistEnabled(), m.RequiresPostgres(), m.AllowsSeed())
	}
	if !m.AllowsDemoToken() || m.DualApproval() || m.RequiresVault() {
		t.Fatal("demo should allow token, no dual approval, no vault")
	}
}

func TestProductionModeFlags(t *testing.T) {
	m := ModeProduction
	if m.IsDemo() || !m.PersistEnabled() || !m.RequiresPostgres() || m.AllowsSeed() {
		t.Fatal("production data flags")
	}
	if m.AllowsDemoToken() || !m.DualApproval() || !m.RequiresVault() {
		t.Fatal("production governance flags")
	}
}

func TestBanMockDoesNotImplyDualApproval(t *testing.T) {
	t.Setenv("QZDA_ENV", "development")
	t.Setenv("QZDA_BAN_MOCK_TOKEN", "1")
	m := FromEnv()
	if m.DualApproval() {
		t.Fatal("QZDA_BAN_MOCK_TOKEN must not enable dual approval in development")
	}
	if m.AllowsDemoToken() {
		t.Fatal("development + BAN should not allow demo token")
	}
}

func TestSessionSyncEnabledFlagVariants(t *testing.T) {
	// "0" / "false" / "FALSE" → disabled; "1" / "true" / "" / unset → enabled.
	disabled := []string{"0", "false", "FALSE", "False", "  false  "}
	enabled := []string{"", "1", "true", "TRUE", "yes", "on"}

	for _, v := range disabled {
		t.Run("disabled_"+v, func(t *testing.T) {
			if v == "" {
				t.Setenv("QZDA_SESSION_SYNC_ENABLED", "")
			} else {
				t.Setenv("QZDA_SESSION_SYNC_ENABLED", v)
			}
			// The empty case is also handled by the enabled group below; skip here.
			if v == "" {
				t.Skip()
			}
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
