package server

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func writeEgressFrontMatter(t *testing.T, dir, body string) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "SKILL.md")
}

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func TestResolveSkillEgress_Intersection(t *testing.T) {
	dir := t.TempDir()
	writeEgressFrontMatter(t, dir, "---\negress: [\"wttr.in\", \"api.weather.gov\"]\n---\n")
	sk := map[string]any{"packagePath": dir, "skillMdPath": "SKILL.md"}
	gov := map[string]any{"allowedEgress": []any{"wttr.in", "api.weather.gov"}}
	got := resolveSkillEgress(sk, gov)
	// 输出顺序 = declared 顺序(显式保留,与保险/求助类技能遵循相同声明顺序)。
	want := []string{"wttr.in", "api.weather.gov"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("intersection: got %v, want %v", got, want)
	}
}

func TestResolveSkillEgress_DeclaredWiderThanPolicy(t *testing.T) {
	dir := t.TempDir()
	writeEgressFrontMatter(t, dir, "---\negress: [\"wttr.in\", \"evil.com\"]\n---\n")
	sk := map[string]any{"packagePath": dir}
	gov := map[string]any{"allowedEgress": []any{"wttr.in"}}
	got := resolveSkillEgress(sk, gov)
	want := []string{"wttr.in"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("declared wider than policy: got %v, want %v", got, want)
	}
}

func TestResolveSkillEgress_NoDeclaration_DenyAll(t *testing.T) {
	dir := t.TempDir()
	writeEgressFrontMatter(t, dir, "---\nname: no-network\n---\n")
	sk := map[string]any{"packagePath": dir}
	gov := map[string]any{"allowedEgress": []any{"wttr.in"}}
	got := resolveSkillEgress(sk, gov)
	if got == nil || len(got) != 0 {
		t.Fatalf("no declaration → deny-all, got %v", got)
	}
}

func TestResolveSkillEgress_EmptyPolicy_DenyAll(t *testing.T) {
	dir := t.TempDir()
	writeEgressFrontMatter(t, dir, "---\negress: [\"wttr.in\"]\n---\n")
	sk := map[string]any{"packagePath": dir}
	gov := map[string]any{"allowedEgress": []any{}}
	got := resolveSkillEgress(sk, gov)
	if got == nil || len(got) != 0 {
		t.Fatalf("empty policy + declaration → deny-all, got %v", got)
	}
}

func TestResolveSkillEgress_NoPackagePath(t *testing.T) {
	sk := map[string]any{} // 无 packagePath
	gov := map[string]any{"allowedEgress": []any{"wttr.in"}}
	if got := resolveSkillEgress(sk, gov); got != nil {
		t.Fatalf("no packagePath → nil, got %v", got)
	}
}

func TestResolveSkillEgress_NilSkill(t *testing.T) {
	if got := resolveSkillEgress(nil, nil); got != nil {
		t.Fatalf("nil skill → nil, got %v", got)
	}
}

func TestResolveSkillEgress_NormalizesCaseAndTrim(t *testing.T) {
	dir := t.TempDir()
	writeEgressFrontMatter(t, dir, "---\negress: [\"WTTR.IN  \"]\n---\n")
	sk := map[string]any{"packagePath": dir}
	gov := map[string]any{"allowedEgress": []any{"wttr.in"}}
	got := resolveSkillEgress(sk, gov)
	want := []string{"wttr.in"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalize: got %v, want %v", got, want)
	}
}