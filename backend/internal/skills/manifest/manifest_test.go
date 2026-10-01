package manifest

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func writeSkillMD(t *testing.T, dir, body string) string {
	t.Helper()
	path := filepath.Join(dir, "SKILL.md")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExtractEgress_InlineList(t *testing.T) {
	dir := t.TempDir()
	path := writeSkillMD(t, dir, `---
name: weather
description: weather skill
egress: ["wttr.in", "api.weather.gov"]
---

# Weather skill
`)
	got := ExtractEgress(path)
	want := []string{"wttr.in", "api.weather.gov"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("inline list: got %v, want %v", got, want)
	}
}

func TestExtractEgress_BlockList(t *testing.T) {
	dir := t.TempDir()
	path := writeSkillMD(t, dir, `---
name: docx-fetcher
description: pulls templates
egress:
  - wttr.in
  - api.weather.gov
  - "registry.example.com"
---

body
`)
	got := ExtractEgress(path)
	want := []string{"wttr.in", "api.weather.gov", "registry.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("block list: got %v, want %v", got, want)
	}
}

func TestExtractEgress_NoFrontMatter(t *testing.T) {
	dir := t.TempDir()
	path := writeSkillMD(t, dir, "# Weather skill\n\nNo front-matter here.\n")
	got := ExtractEgress(path)
	if got != nil {
		t.Fatalf("expected nil for no front-matter, got %v", got)
	}
}

func TestExtractEgress_NoEgressField(t *testing.T) {
	dir := t.TempDir()
	path := writeSkillMD(t, dir, `---
name: no-network
description: pure
`)
	got := ExtractEgress(path)
	if got != nil {
		t.Fatalf("expected nil for missing egress, got %v", got)
	}
}

func TestExtractEgress_MissingFile(t *testing.T) {
	got := ExtractEgress(filepath.Join(t.TempDir(), "nope.md"))
	if got != nil {
		t.Fatalf("expected nil for missing file, got %v", got)
	}
}

func TestExtractEgress_SingleQuotesAndSpaces(t *testing.T) {
	dir := t.TempDir()
	path := writeSkillMD(t, dir, `---
egress: ['wttr.in',"api.weather.gov"  ]
---
`)
	got := ExtractEgress(path)
	want := []string{"wttr.in", "api.weather.gov"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("mixed quotes/spaces: got %v, want %v", got, want)
	}
}