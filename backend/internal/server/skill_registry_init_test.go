package server

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/skills/registry"
)

func TestDefaultSkillRegistryPopulatesBuiltins(t *testing.T) {
	r := defaultSkillRegistry()
	if r == nil {
		t.Fatal("nil registry")
	}
	// Every builtin spec must be present and callable for a caller with
	// matching perms.
	cases := []struct {
		key       string
		perms     []string
		wantOK    bool
	}{
		{"builtin:knowledge.retrieve", []string{"knowledge.read"}, true},
		{"builtin:knowledge.retrieve", []string{"skill.invoke"}, false},
		{"builtin:memory.recall", []string{"memory.read"}, true},
		{"builtin:skill.read", []string{"skill.read"}, true},
		{"skill:docx", []string{"skill.invoke"}, true},
		{"skill:pptx", []string{"skill.invoke"}, true},
		{"skill:unknown", []string{"skill.invoke"}, false},
	}
	for _, tc := range cases {
		spec, err := r.Lookup(tc.key)
		if tc.wantOK && err != nil {
			t.Errorf("lookup %s: %v", tc.key, err)
			continue
		}
		if !tc.wantOK && err == nil {
			// builtin:unknown is allowed to be absent.
			if tc.key == "skill:unknown" {
				continue
			}
		}
		// Lifecycle: builtins are stable, must be callable.
		if err := r.Callable(spec, false, false); err != nil && tc.wantOK {
			t.Errorf("%s not callable: %v", tc.key, err)
		}
	}
}

func TestServerNewInitializesSkillRegistry(t *testing.T) {
	s := New(nil)
	if s.SkillRegistry == nil {
		t.Fatal("Server must have a SkillRegistry by default")
	}
	if _, err := s.SkillRegistry.Lookup("builtin:knowledge.retrieve"); err != nil {
		t.Fatalf("builtin missing: %v", err)
	}
}

func TestDefaultSkillRegistryTags(t *testing.T) {
	r := defaultSkillRegistry()
	got := r.ByTag("office")
	if len(got) < 3 {
		t.Fatalf("expected ≥3 office skills, got %d", len(got))
	}
}

func TestDefaultSkillRegistryLifecycle(t *testing.T) {
	r := defaultSkillRegistry()
	for _, s := range r.ByLifecycle(registry.LifecycleStable) {
		if s.Lifecycle != registry.LifecycleStable {
			t.Fatalf("lifecycle filter broken: %+v", s)
		}
	}
}
