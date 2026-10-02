// Small utility helpers used by the M02 copilot module. Duplicates of
// helpers in internal/server/ — kept here so copilot never imports server/.
// The originals in server/ continue to exist for server-side callers.
//
// Names / signatures here MUST match the server originals one-for-one; if
// you change one, change the other.
package copilot

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// skillScriptCommandRe mirrors server.skillScriptCommandRe. Compiled once
// at package init; reused by looksLikeSkillScriptCommand and any other
// helper that needs to classify a script-style command.
var skillScriptCommandRe = regexp.MustCompile(
	`(?i)^(?:(?:python3?|node|bash|sh)\s+)?(?:\./)?((?:scripts|\.copilot-ws)/[A-Za-z0-9._/-]+\.(?:py|sh|js|mjs|ts))(?:\s+.*)?$`,
)

// lookupEnv is a tiny os.Getenv wrapper kept for symmetry with server/.Env
// callers. Mirrors server.lookupEnv.
func lookupEnv(k string) string { return os.Getenv(k) }

// chunkText splits s into fixed-rune-sized chunks (n ≤ 0 → single chunk).
// Mirrors server.chunkText; used by long-context segmentation (segments.go).
func chunkText(s string, n int) []string {
	runes := []rune(s)
	if n <= 0 {
		return []string{s}
	}
	var out []string
	for i := 0; i < len(runes); i += n {
		j := i + n
		if j > len(runes) {
			j = len(runes)
		}
		out = append(out, string(runes[i:j]))
	}
	return out
}

// idsBeyondKeep returns the ids (m["id"]) of items at positions >= keep.
// Nil when keep is negative or items is already short enough.
// Mirrors server.idsBeyondKeep; used by snapshot compaction pruning.
func idsBeyondKeep(items []map[string]any, keep int) []string {
	if keep < 0 || len(items) <= keep {
		return nil
	}
	out := make([]string, 0, len(items)-keep)
	for _, m := range items[keep:] {
		if id := str(m["id"]); id != "" {
			out = append(out, id)
		}
	}
	return out
}

// conversationIDFromPath extracts the conversation id from a URL path under
// either /api/conversations/:id/... or /api/copilot/conversations/:id/....
// Mirrors server.conversationIDFromPath.
func conversationIDFromPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if p != "conversations" || i+1 >= len(parts) {
			continue
		}
		next := parts[i+1]
		switch next {
		case "", "stream", "messages", "tasks":
			continue
		default:
			return next
		}
	}
	return ""
}

// mapsFromAny normalizes a JSON-shaped value ([]map[string]any / []any /
// map with items) into []map[string]any. Mirrors server.mapsFromAny.
func mapsFromAny(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, item := range t {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	case map[string]any:
		if items, ok := t["items"]; ok {
			return mapsFromAny(items)
		}
		return nil
	default:
		return nil
	}
}

// runtimeModeLocal / runtimeModeRemote mirror the constants from
// server/runtime_loop.go. They drive the snapshot payload's "runtimeMode"
// field; copilot needs to render the same labels as server to keep
// payloads byte-identical.
const (
	runtimeModeLocal  = "local"
	runtimeModeRemote = "remote"
)

// runtimeMode returns the current runtime mode ("local" or "remote") based
// on DE_RUNTIME_MODE. Mirrors server.runtimeMode.
func runtimeMode() string {
	switch strings.ToLower(strings.TrimSpace(lookupEnv("DE_RUNTIME_MODE"))) {
	case "remote", "sidecar", "python":
		return runtimeModeRemote
	default:
		return runtimeModeLocal
	}
}

// envOr returns lookupEnv(k) when non-empty, else def. Mirrors server.envOr.
func envOr(k, def string) string {
	if v := strings.TrimSpace(lookupEnv(k)); v != "" {
		return v
	}
	return def
}

// asMapSlice normalizes heterogeneous JSON shapes into []map[string]any.
// Mirrors server.asMapSlice (defined in handlers_actions.go).
func asMapSlice(v any) []map[string]any {
	switch x := v.(type) {
	case []map[string]any:
		return x
	case []any:
		out := make([]map[string]any, 0, len(x))
		for _, item := range x {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

// skillTurnSteps returns the "steps" entry of a Skill Turn plan as
// []map[string]any. Mirrors server.skillTurnSteps.
func skillTurnSteps(plan map[string]any) []map[string]any {
	if plan == nil {
		return nil
	}
	return asMapSlice(plan["steps"])
}

// looksLikeSkillScriptCommand reports whether cmd matches the script-path
// regex used by skill.run planning. Mirrors server.looksLikeSkillScriptCommand
// (which delegates to skillScriptCommandRe in skill_harness.go).
func looksLikeSkillScriptCommand(cmd string) bool {
	return skillScriptCommandRe.MatchString(strings.TrimSpace(cmd))
}

// looksLikeClarificationSpeech is a lightweight heuristic for short
// clarification questions vs structured office-skill bodies. Mirrors
// server.looksLikeClarificationSpeech (skill_artifacts_office.go).
func looksLikeClarificationSpeech(content string) bool {
	s := strings.TrimSpace(content)
	if s == "" {
		return false
	}
	runes := len([]rune(s))
	if runes > 400 && looksLikeStructuredDocxBody(s) {
		return false
	}
	hints := []string{
		"请告诉我", "请问您", "请补充", "方便提供", "您希望", "能否确认",
		"需要确认", "还请提供", "请先说明", "我需要了解", "为了生成",
		"请提供以下信息", "请问需要", "您可以提供",
	}
	hits := 0
	for _, h := range hints {
		if strings.Contains(s, h) {
			hits++
		}
	}
	if hits >= 2 {
		return true
	}
	if hits >= 1 && runes < 220 && !looksLikeStructuredDocxBody(s) {
		return true
	}
	return false
}

// cleanupSkillArtifactsTTL removes old artifact files beyond maxAge /
// caps the on-disk count at maxFiles. Mirrors server.cleanupSkillArtifactsTTL.
func cleanupSkillArtifactsTTL(maxAge time.Duration, maxFiles int) {
	dir := skillArtifactDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type item struct {
		name string
		mod  time.Time
		size int64
	}
	var files []item
	now := time.Now()
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		low := strings.ToLower(name)
		if !(strings.HasSuffix(low, ".docx") || strings.HasSuffix(low, ".pptx") || strings.HasSuffix(low, ".xlsx") || strings.HasSuffix(low, ".pdf")) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if maxAge > 0 && now.Sub(info.ModTime()) > maxAge {
			_ = os.Remove(filepath.Join(dir, name))
			continue
		}
		files = append(files, item{name: name, mod: info.ModTime(), size: info.Size()})
	}
	if maxFiles <= 0 || len(files) <= maxFiles {
		return
	}
	// Sort oldest first by bubbling (small N).
	for i := 0; i < len(files); i++ {
		for j := i + 1; j < len(files); j++ {
			if files[j].mod.Before(files[i].mod) {
				files[i], files[j] = files[j], files[i]
			}
		}
	}
	drop := len(files) - maxFiles
	for i := 0; i < drop; i++ {
		_ = os.Remove(filepath.Join(dir, files[i].name))
	}
}
