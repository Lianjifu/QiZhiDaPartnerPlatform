package server

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCandidateAttemptTimeoutDefault(t *testing.T) {
	t.Setenv("QZDA_MODEL_CANDIDATE_TIMEOUT", "")
	d := candidateAttemptTimeout()
	if d != 45*time.Second {
		t.Fatalf("default want 45s, got %v", d)
	}
	t.Setenv("QZDA_MODEL_CANDIDATE_TIMEOUT", "60")
	if candidateAttemptTimeout() != 60*time.Second {
		t.Fatalf("override")
	}
	t.Setenv("QZDA_MODEL_CANDIDATE_TIMEOUT", "2")
	if candidateAttemptTimeout() != 5*time.Second {
		t.Fatalf("floor 5s, got %v", candidateAttemptTimeout())
	}
}

func TestFormatModelInvokeUserMessageTimeout(t *testing.T) {
	msg := formatModelInvokeUserMessage(errors.New("context deadline exceeded"))
	if !strings.Contains(msg, "模型调用超时") {
		t.Fatalf("got %q", msg)
	}
	if strings.Contains(msg, "无可用模型：context deadline") {
		t.Fatalf("misleading copy still present: %q", msg)
	}
	msg2 := formatModelInvokeUserMessage(errors.New("no model endpoint available"))
	if !strings.HasPrefix(msg2, "无可用模型端点") {
		t.Fatalf("got %q", msg2)
	}
	// idempotent
	if formatModelInvokeUserMessage(errors.New(msg)) != msg {
		t.Fatal("should not double-wrap")
	}
}

func TestClampAttemptToParent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	got := clampAttemptToParent(ctx, 45*time.Second)
	if got > 3*time.Second || got < time.Second {
		t.Fatalf("clamped=%v", got)
	}
}

func TestCopilotStreamTimeoutDefault(t *testing.T) {
	t.Setenv("QZDA_COPILOT_STREAM_TIMEOUT", "")
	if copilotStreamTimeout() != 300*time.Second {
		t.Fatalf("got %v", copilotStreamTimeout())
	}
}
