package server

import (
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestSplitAssistantSegmentsDelimiter(t *testing.T) {
	text := "我先确认一下。<<<NEXT>>>这是正文。<<<NEXT>>>这是结论。"
	segs := splitAssistantSegments(text, segmentSplitConfig{MinRunes: 10, MaxSegments: 5})
	if len(segs) != 3 {
		t.Fatalf("expected 3 segments, got %d: %#v", len(segs), segs)
	}
}

func TestBuildSegmentsFromTurnSingle(t *testing.T) {
	segs := buildSegmentsFromTurn("hello", reactTurnResult{}, replyModeSingle, segmentPolicyDocument, "m1", func() string { return "x" }, nil)
	if len(segs) != 1 || segs[0].ID != "m1" {
		t.Fatalf("single segment: %#v", segs)
	}
}

func TestBuildSegmentsFromTurnSegmentedNoImplicitSplit(t *testing.T) {
	text := "段一内容足够长，超过四十个字以便触发分段逻辑。\n\n段二也有足够长的内容，同样超过四十个字。"
	segs := buildSegmentsFromTurn(text, reactTurnResult{}, replyModeSegmented, segmentPolicyDocument, "m1", func() string { return "x" }, nil)
	if len(segs) != 1 {
		t.Fatalf("expected single segment without <<<NEXT>>> delimiter, got %#v", segs)
	}
}

func TestBuildSegmentsFromTurnSegmented(t *testing.T) {
	text := "段一内容足够长，超过四十个字以便触发分段逻辑。<<<NEXT>>>段二也有足够长的内容，同样超过四十个字。"
	segs := buildSegmentsFromTurn(text, reactTurnResult{}, replyModeSegmented, segmentPolicyDocument, "m1", func() string { return "x" }, nil)
	if len(segs) != 1 {
		t.Fatalf("document policy should merge <<<NEXT>>> chunks, got %#v", segs)
	}
}

func TestBuildSegmentsFromTurnSegmentedConversational(t *testing.T) {
	text := "好的，收到。<<<NEXT>>>段二也有足够长的内容，同样超过四十个字以便作为正文展示。"
	segs := buildSegmentsFromTurn(text, reactTurnResult{}, replyModeSegmented, segmentPolicyConversational, "m1", func() string { return "x" }, nil)
	if len(segs) != 2 {
		t.Fatalf("expected 2 conversational segments, got %#v", segs)
	}
	if segs[0].ID != "m1" {
		t.Fatalf("first segment should reuse firstMessageID, got %s", segs[0].ID)
	}
}

func TestBuildSegmentsFromTurnArtifactBubble(t *testing.T) {
	t.Setenv("DE_COPILOT_ARTIFACT_SEGMENT", "1")
	full := "# 模板\n正文\n下载链接：/api/skill-artifacts/x-招聘岗位模板.docx"
	segs := buildSegmentsFromTurn(full, reactTurnResult{}, replyModeSegmented, segmentPolicyDocument, "m1", func() string { return "m2" }, nil)
	if len(segs) != 2 {
		t.Fatalf("want body+artifact, got %#v", segs)
	}
	if segs[1].Kind != segmentKindArtifact {
		t.Fatalf("artifact kind=%s", segs[1].Kind)
	}
	if segs[1].ID != "m1_artifact" {
		t.Fatalf("artifact id=%s", segs[1].ID)
	}
}

func TestBuildSegmentsFromTurnArtifactInlineDefault(t *testing.T) {
	t.Setenv("DE_COPILOT_ARTIFACT_SEGMENT", "0")
	t.Setenv("DE_COPILOT_ARTIFACT_INLINE", "1")
	full := "正文\n下载链接：/api/skill-artifacts/x-招聘岗位模板.docx"
	segs := buildSegmentsFromTurn(full, reactTurnResult{}, replyModeSegmented, segmentPolicyDocument, "m1", func() string { return "m2" }, nil)
	if len(segs) != 1 {
		t.Fatalf("inline should keep single body segment, got %#v", segs)
	}
	if !strings.Contains(segs[0].Content, "/api/skill-artifacts/") {
		t.Fatalf("inline body should retain artifact link: %q", segs[0].Content)
	}
}

func TestReconcileSegmentsPreservesStreamedIDs(t *testing.T) {
	t.Setenv("DE_COPILOT_ARTIFACT_SEGMENT", "1")
	streamed := []AssistantSegment{
		{ID: "client-reply", Kind: segmentKindBody, Content: "old body"},
		{ID: "client-reply_artifact", Kind: segmentKindArtifact, Content: "old art"},
	}
	full := "new body\n下载链接：/api/skill-artifacts/x-招聘岗位模板.docx"
	got := reconcileSegmentsWithFinalText(streamed, full, reactTurnResult{}, replyModeSegmented, segmentPolicyDocument, "client-reply", func() string { return "new-id" })
	if len(got) != 2 {
		t.Fatalf("got %#v", got)
	}
	if got[0].ID != "client-reply" || got[1].ID != "client-reply_artifact" {
		t.Fatalf("ids not preserved: %#v", got)
	}
	if strings.Contains(got[0].Content, "/api/skill-artifacts/") {
		t.Fatalf("body should strip artifact path: %q", got[0].Content)
	}
}

func TestMergeStoredAssistantTurns(t *testing.T) {
	stored := []map[string]any{
		{"role": "user", "content": "hi", "correlationId": "c1"},
		{"role": "assistant", "content": "a", "correlationId": "c1"},
		{"role": "assistant", "content": "b", "correlationId": "c1"},
	}
	merged := mergeStoredAssistantTurns(stored)
	if len(merged) != 2 {
		t.Fatalf("expected 2 after merge, got %d", len(merged))
	}
	if str(merged[1]["content"]) != "a\n\nb" {
		t.Fatalf("merged content: %s", merged[1]["content"])
	}
}

func TestModelIDFromStoredMessage(t *testing.T) {
	if got := modelIDFromStoredMessage(map[string]any{"metrics": map[string]any{"model": "sonnet-4"}}); got != "sonnet-4" {
		t.Fatalf("got %q", got)
	}
}

func TestAssistantMessagesFromSegmentsIndexOffset(t *testing.T) {
	segs := []AssistantSegment{{ID: "m2", Content: "body"}}
	msgs := assistantMessagesFromSegments(segs, "corr", replyModeSegmented, "now", nil, false, nil, nil, 1)
	if len(msgs) != 1 {
		t.Fatalf("len=%d", len(msgs))
	}
	if intFrom(msgs[0]["segmentIndex"]) != 1 {
		t.Fatalf("segmentIndex=%v", msgs[0]["segmentIndex"])
	}
}

func TestRememberIdempotentTurnMultiMessage(t *testing.T) {
	s := &Server{Store: store.New()}
	msgs := []map[string]any{
		{"id": "a1", "role": "assistant", "content": "one", "correlationId": "c1", "segmentIndex": 0},
		{"id": "a2", "role": "assistant", "content": "two", "correlationId": "c1", "segmentIndex": 1},
	}
	rememberIdempotentTurn(s, "conv", "client-1", msgs)
	got := s.loadIdempotentTurn("conv", "client-1")
	if len(got) != 2 {
		t.Fatalf("want 2 messages, got %d", len(got))
	}
}

func TestResolveReplyModeDefaults(t *testing.T) {
	if got := resolveReplyMode(nil, nil); got != replyModeSegmented {
		t.Fatalf("platform default got %s want segmented", got)
	}
	emp := map[string]any{"runtime": map[string]any{"replyMode": "segmented"}}
	if got := resolveReplyMode(nil, emp); got != replyModeSegmented {
		t.Fatalf("employee segmented got %s", got)
	}
	if got := resolveReplyMode(map[string]any{"replyMode": "stepwise"}, emp); got != replyModeStepwise {
		t.Fatalf("body override got %s", got)
	}
	if got := resolveReplyMode(map[string]any{"replyMode": "single"}, emp); got != replyModeSingle {
		t.Fatalf("body single override got %s", got)
	}
	empSingle := map[string]any{"runtime": map[string]any{"replyMode": "single"}}
	if got := resolveReplyMode(nil, empSingle); got != replyModeSingle {
		t.Fatalf("employee single got %s", got)
	}
}

func TestResolveSegmentPolicyDefaults(t *testing.T) {
	if got := resolveSegmentPolicy(nil, nil); got != segmentPolicyDocument {
		t.Fatalf("default policy got %s", got)
	}
	emp := map[string]any{"runtime": map[string]any{"segmentPolicy": "conversational"}}
	if got := resolveSegmentPolicy(nil, emp); got != segmentPolicyConversational {
		t.Fatalf("employee policy got %s", got)
	}
	if got := resolveSegmentPolicy(map[string]any{"segmentPolicy": "document"}, emp); got != segmentPolicyDocument {
		t.Fatalf("body override got %s", got)
	}
}
