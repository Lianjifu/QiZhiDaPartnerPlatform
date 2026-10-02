package copilot

import (
	"strings"
	"testing"
)

func TestThoughtForToolChoice(t *testing.T) {
	title, detail := thoughtForToolChoice("skill:docx")
	if title == "" || detail == "" {
		t.Fatalf("docx thought empty: %q %q", title, detail)
	}
	title, _ = thoughtForToolChoice("knowledge.retrieve")
	if !strings.Contains(title, "检索") {
		t.Fatalf("retrieve title=%q", title)
	}
}

func TestThoughtForRouteMode(t *testing.T) {
	title, _ := thoughtForRouteMode(modePlanExec, "plan_hint")
	if title == "" {
		t.Fatal("empty plan mode thought")
	}
}

func TestThoughtUnderstandTask(t *testing.T) {
	title, _ := thoughtUnderstandTask("招聘进度简报")
	if !strings.Contains(title, "招聘进度简报") {
		t.Fatalf("title=%q", title)
	}
}
