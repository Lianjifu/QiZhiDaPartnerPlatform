package copilot

import (
	"strings"
	"testing"
)

func TestIsPendingAssistantReply(t *testing.T) {
	cases := []struct {
		text string
		want bool
	}{
		{"好的，正在为您生成 Word 版《入职材料清单通知》，请稍候。", true},
		{"请稍候，我马上处理。", true},
		{"已为您生成 Word 文档「入职材料清单通知」。\n\n下载链接：/api/skill-artifacts/x.docx", false},
		{strings.Repeat("长", 300) + "请稍候", false},
	}
	for _, tc := range cases {
		if got := isPendingAssistantReply(tc.text); got != tc.want {
			t.Fatalf("isPendingAssistantReply(%q)=%v want %v", tc.text, got, tc.want)
		}
	}
}

func TestEnrichCopilotFinalTextReplacesPendingWithArtifact(t *testing.T) {
	toolCalls := []map[string]any{{
		"name":   "skill.docx",
		"status": "success",
		"result": "已生成 Word 文档「入职材料清单通知」\n下载链接：/api/skill-artifacts/abc-入职材料清单通知.docx",
	}}
	full := "好的，正在为您生成 Word 版《入职材料清单通知》，请稍候。"
	got := enrichCopilotFinalText(full, toolCalls, "生成 Word 版通知文档")
	if isPendingAssistantReply(got) {
		t.Fatalf("still pending: %q", got)
	}
	if !strings.Contains(got, "已为您生成 Word 文档") && !strings.Contains(got, "已生成 Word 文档") {
		t.Fatalf("missing completion text: %q", got)
	}
	if !strings.Contains(got, "/api/skill-artifacts/") {
		t.Fatalf("missing artifact link: %q", got)
	}
}

func TestEnrichCopilotFinalTextNoOpWithoutToolOutput(t *testing.T) {
	full := "好的，正在为您生成 Word 版通知，请稍候。"
	got := enrichCopilotFinalText(full, nil, "生成 Word")
	if got != full {
		t.Fatalf("got %q", got)
	}
}

func TestEnrichCopilotFinalTextPreservesNonPendingReply(t *testing.T) {
	toolCalls := []map[string]any{{
		"status": "success",
		"result": "已生成 Word 文档「模板」\n下载链接：/api/skill-artifacts/t.docx",
	}}
	full := "这是完整说明正文，不包含请稍候。"
	got := enrichCopilotFinalText(full, toolCalls, "生成模板")
	if !strings.Contains(got, full) {
		t.Fatalf("lost body: %q", got)
	}
	if !strings.Contains(got, "/api/skill-artifacts/t.docx") {
		t.Fatalf("missing link: %q", got)
	}
}
