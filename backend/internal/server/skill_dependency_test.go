package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSkillDependencyReport_UsesBundledShims(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "builtin", "skills"))
	if err != nil {
		t.Skip(err)
	}
	if _, err := os.Stat(filepath.Join(root, "runtime", "bin", "gh")); err != nil {
		t.Skip("bundled skill bin shims missing")
	}
	t.Setenv("QZDA_BUILTIN_SKILLS_DIR", root)
	t.Setenv("QZDA_BUILTIN_SKILL_BIN", filepath.Join(root, "runtime", "bin"))

	for _, skill := range []string{"github", "1password", "gog", "himalaya", "notion", "obsidian", "powershell", "tmux", "trello"} {
		rep := skillDependencyReport(skill)
		missing, _ := rep["missing"].([]string)
		if len(missing) > 0 {
			t.Fatalf("%s still missing bins: %v", skill, missing)
		}
		if rep["availability"] != "ready" {
			t.Fatalf("%s availability=%v", skill, rep["availability"])
		}
	}
}
