package copilot

import (
	"strings"
	"testing"
)

func TestStripArtifactNoise(t *testing.T) {
	full := "正文说明。\n文件名：招聘岗位模板.docx\n下载链接：/api/skill-artifacts/abc-招聘岗位模板.docx\n结语。"
	got := stripArtifactNoise(full)
	if strings.Contains(got, "/api/skill-artifacts/") {
		t.Fatalf("artifact path should be stripped: %q", got)
	}
	if !strings.Contains(got, "正文说明") || !strings.Contains(got, "结语") {
		t.Fatalf("body kept: %q", got)
	}
}

func TestAppendArtifactSegments(t *testing.T) {
	full := "# 模板\n\n下载链接：/api/skill-artifacts/x-招聘岗位模板.docx"
	segs := appendArtifactSegments([]AssistantSegment{
		{ID: "m1", Kind: segmentKindBody, Content: full},
	}, full, "m1", func() string { return "m2" })
	if len(segs) != 2 {
		t.Fatalf("want 2 segments, got %d", len(segs))
	}
	if segs[1].Kind != segmentKindArtifact {
		t.Fatalf("second kind=%s", segs[1].Kind)
	}
	if segs[1].ID != "m1_artifact" {
		t.Fatalf("artifact id=%s", segs[1].ID)
	}
	if strings.Contains(segs[0].Content, "/api/skill-artifacts/") {
		t.Fatalf("body should not contain artifact path: %q", segs[0].Content)
	}
}

func TestBuildIntentSegmentsDocumentMergesDelimiter(t *testing.T) {
	chunks := []string{"短确认", "第一章", "第二章"}
	segs := buildIntentSegments(chunks, segmentPolicyDocument)
	if len(segs) != 1 {
		t.Fatalf("document policy should merge, got %d", len(segs))
	}
	if !strings.Contains(segs[0].Content, "第一章") || !strings.Contains(segs[0].Content, "第二章") {
		t.Fatalf("merged content: %q", segs[0].Content)
	}
}

func TestBuildIntentSegmentsConversationalShortLead(t *testing.T) {
	chunks := []string{"好的，我来整理。", strings.Repeat("正", 200)}
	segs := buildIntentSegments(chunks, segmentPolicyConversational)
	if len(segs) != 2 {
		t.Fatalf("want 2 conversational segments, got %d: %#v", len(segs), segs)
	}
}
