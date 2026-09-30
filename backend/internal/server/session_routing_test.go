package server

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

func TestResolveDefaultSessionModeMissing(t *testing.T) {
	s := &Server{Store: store.NewEmpty()}
	if got := s.resolveDefaultSessionMode("missing"); got != contract.SessionModeInvestigate {
		t.Fatalf("want investigate default, got %s", got)
	}
}

func TestResolveDefaultSessionModeFromSpec(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees, map[string]any{
		"id": "de-exec", "name": "执行型",
		"spec": map[string]any{"defaultSessionMode": "execute"},
	})
	s := &Server{Store: st}
	if got := s.resolveDefaultSessionMode("de-exec"); got != "execute" {
		t.Fatalf("want execute, got %s", got)
	}
}

func TestResolveDefaultSessionModeFallsBackForUnknown(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees, map[string]any{
		"id": "de-bad", "name": "X",
		"spec": map[string]any{"defaultSessionMode": "bogus"},
	})
	s := &Server{Store: st}
	if got := s.resolveDefaultSessionMode("de-bad"); got != contract.SessionModeInvestigate {
		t.Fatalf("want investigate for invalid value, got %s", got)
	}
}

func TestResolveDefaultRiskLevelFromSpec(t *testing.T) {
	st := store.NewEmpty()
	st.Employees = append(st.Employees, map[string]any{
		"id": "de-high", "spec": map[string]any{"defaultRiskLevel": "high"},
	})
	s := &Server{Store: st}
	if got := s.resolveDefaultRiskLevel("de-high"); got != "high" {
		t.Fatalf("want high, got %s", got)
	}
	if got := s.resolveDefaultRiskLevel(""); got != contract.RiskLevelMedium {
		t.Fatalf("empty de should default to medium, got %s", got)
	}
}
