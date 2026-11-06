package copilot

import "testing"

// TestEvolveMemoryPromoteWithoutMemoryDepFailsLoudly guards the P1 fix:
// approving a memory-promote candidate while the memory module is not wired
// used to return {"memoryId": "", ...} — a fake success that made the UI
// report a promotion that never happened.
func TestEvolveMemoryPromoteWithoutMemoryDepFailsLoudly(t *testing.T) {
	svc := &Service{}
	cand := map[string]any{
		"id": "ev-1", "workspaceId": "w1", "kind": evolveKindMemoryPromote,
		"title": "会话偏好晋升候选", "summary": "用户偏好",
		"payload": map[string]any{"targetLayer": "working", "content": "偏好 X"},
	}
	out, err := svc.applyEvolveCandidateLocked("w1", "u1", "管理员", cand)
	if err == nil {
		t.Fatalf("expected an error, got result %#v", out)
	}
	if out != nil {
		t.Fatalf("expected no result on failure, got %#v", out)
	}
}
