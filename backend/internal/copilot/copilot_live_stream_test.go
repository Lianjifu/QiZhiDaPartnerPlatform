package copilot

import (
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

func TestLiveAnswerStreamPlainDelta(t *testing.T) {
	var events []string
	emit := func(typ, stage string, extra map[string]any) {
		events = append(events, typ+":"+str(extra["text"]))
	}
	ls := newLiveAnswerStream(emit, replyModeSingle, segmentPolicyDocument, "corr", "m1", "sonnet", func() string { return "x" })
	ls.OnDelta("你", "你")
	ls.OnDelta("好", "你好")
	if len(events) != 2 || events[0] != contract.StreamDelta+":你" || events[1] != contract.StreamDelta+":好" {
		t.Fatalf("events=%v", events)
	}
}

func TestLiveAnswerStreamSkipsToolBlock(t *testing.T) {
	var events []string
	emit := func(typ, stage string, extra map[string]any) {
		events = append(events, typ)
	}
	ls := newLiveAnswerStream(emit, replyModeSegmented, segmentPolicyDocument, "corr", "m1", "sonnet", func() string { return "m2" })
	ls.OnDelta("<<<TOOL>>>", "<<<TOOL>>>")
	if len(events) != 0 {
		t.Fatalf("expected no events, got %v", events)
	}
}

func TestLiveAnswerStreamDocumentDoesNotSplitOnDelimiter(t *testing.T) {
	var deltas []string
	emit := func(typ, stage string, extra map[string]any) {
		if typ == contract.StreamMessageDelta {
			deltas = append(deltas, str(extra["text"]))
		}
	}
	ls := newLiveAnswerStream(emit, replyModeSegmented, segmentPolicyDocument, "corr", "m1", "sonnet", func() string { return "m2" })
	full := "第一段<<<NEXT>>>第二段"
	ls.OnDelta(full, full)
	if len(deltas) != 1 {
		t.Fatalf("document policy should not split live stream, got %d deltas", len(deltas))
	}
	if !strings.Contains(deltas[0], "<<<NEXT>>>") {
		t.Fatalf("delimiter kept in single bubble: %q", deltas[0])
	}
}

func TestLiveAnswerStreamConversationalDelimiter(t *testing.T) {
	var types []string
	emit := func(typ, stage string, extra map[string]any) {
		types = append(types, typ)
	}
	ls := newLiveAnswerStream(emit, replyModeSegmented, segmentPolicyConversational, "corr", "m1", "sonnet", func() string { return "m2" })
	full := "第一段说明。<<<NEXT>>>第二段正文。"
	ls.OnDelta(full, full)
	joined := strings.Join(types, ",")
	if !strings.Contains(joined, contract.StreamMessageStart) {
		t.Fatalf("missing message_start: %v", types)
	}
	if !strings.Contains(joined, contract.StreamMessageDone) {
		t.Fatalf("missing message_done: %v", types)
	}
}
