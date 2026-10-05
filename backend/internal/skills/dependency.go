package skills

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var skillExternalBins = map[string][]string{
	"github": {"gh"}, "gog": {"gog"}, "trello": {"trello"}, "1password": {"op"},
	"browser-use": {"python3"}, "spreadsheets": {"node"}, "pptx": {"node"},
	"meeting-recorder-assistant": {"python3"}, "himalaya": {"himalaya"},
	"notion": {"ntn"}, "obsidian": {"obsidian"}, "powershell": {"pwsh", "powershell"},
	"tmux": {"tmux"}, "pdf": {"python3"},
}

func skillRuntimeBinDir() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_BUILTIN_SKILL_BIN")); v != "" {
		return v
	}
	return filepath.Join(builtinSkillsRoot(), "runtime", "bin")
}

func binAvailable(name string) bool {
	if _, err := exec.LookPath(name); err == nil {
		return true
	}
	shim := filepath.Join(skillRuntimeBinDir(), name)
	st, err := os.Stat(shim)
	return err == nil && !st.IsDir() && st.Mode()&0111 != 0
}

func skillDependencyReport(skillName string) map[string]any {
	bins := skillExternalBins[strings.ToLower(skillName)]
	if len(bins) == 0 {
		if meta, ok := loadSkillMetaFromManifest(skillName); ok {
			if arr, ok := meta["externalBins"].([]any); ok {
				for _, b := range arr {
					bins = append(bins, str(b))
				}
			}
		}
	}
	missing := make([]string, 0)
	resolved := make([]string, 0)
	for _, b := range bins {
		if binAvailable(b) {
			if p, err := exec.LookPath(b); err == nil {
				resolved = append(resolved, p)
			} else {
				resolved = append(resolved, filepath.Join(skillRuntimeBinDir(), b))
			}
			continue
		}
		missing = append(missing, b)
	}
	avail := "ready"
	if len(missing) > 0 {
		if len(missing) == len(bins) {
			avail = "missing_deps"
		} else {
			avail = "degraded"
		}
	}
	return map[string]any{
		"skillName": skillName, "externalBins": bins, "missing": missing,
		"resolvedPaths": resolved, "availability": avail,
		"runtimeBinDir": skillRuntimeBinDir(),
	}
}

func loadSkillMetaFromManifest(skillName string) (map[string]any, bool) {
	raw, err := os.ReadFile(filepath.Join(builtinSkillsRoot(), "manifest.json"))
	if err != nil {
		return nil, false
	}
	var m struct {
		SkillMeta map[string]map[string]any `json:"skillMeta"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return nil, false
	}
	meta, ok := m.SkillMeta[skillName]
	return meta, ok
}

func (s *Service) skillDependencyMatrix(_ *http.Request) (any, error) {
	var rows []map[string]any
	for _, name := range listBuiltinSkillDirNames() {
		rows = append(rows, skillDependencyReport(name))
	}
	return map[string]any{"skills": rows, "count": len(rows)}, nil
}

func enrichPreflightWithDeps(candidate map[string]any) map[string]any {
	bn := str(candidate["builtinSkillName"])
	if bn == "" {
		bn = strings.ToLower(str(candidate["name"]))
	}
	if bn == "" {
		return nil
	}
	return skillDependencyReport(bn)
}
