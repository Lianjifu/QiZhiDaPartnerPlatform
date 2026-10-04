package copilot

import (
	"testing"
)

func TestStampVariantRootAndSibling(t *testing.T) {
	root := StampVariantRoot(map[string]any{"id": "m1", "role": "assistant"}, "")
	if root[MsgKeyBranchIndex] != 0 {
		t.Fatalf("root BranchIndex=%v, want 0", root[MsgKeyBranchIndex])
	}
	if root[MsgKeyIsActive] != true {
		t.Fatalf("root IsActive=%v, want true", root[MsgKeyIsActive])
	}
	if got := root[MsgKeyVariantsGroupID]; got != "m1" {
		t.Fatalf("root groupID=%v, want m1", got)
	}

	sib := StampVariantSibling(map[string]any{"id": "m2", "role": "assistant"}, "m1", 1)
	if sib[MsgKeyParentMessageID] != "m1" {
		t.Fatalf("sibling parent=%v, want m1", sib[MsgKeyParentMessageID])
	}
	if sib[MsgKeyBranchIndex] != 1 {
		t.Fatalf("sibling BranchIndex=%v, want 1", sib[MsgKeyBranchIndex])
	}
	if sib[MsgKeyVariantsGroupID] != "m1" {
		t.Fatalf("sibling groupID=%v, want m1", sib[MsgKeyVariantsGroupID])
	}
}

func TestSwitchActiveVariant(t *testing.T) {
	msgs := []map[string]any{
		{"id": "m1", "role": "assistant", MsgKeyIsActive: true},
		{"id": "m2", "role": "assistant", MsgKeyParentMessageID: "m1", MsgKeyBranchIndex: 1, MsgKeyIsActive: false},
		{"id": "m3", "role": "assistant", MsgKeyParentMessageID: "m1", MsgKeyBranchIndex: 2, MsgKeyIsActive: false},
		{"id": "u1", "role": "user"},
	}
	touched, prev := SwitchActiveVariant(msgs, "m1", "m3")
	if touched != 2 {
		t.Fatalf("touched=%d, want 2", touched)
	}
	if prev != "m1" {
		t.Fatalf("previous=%q, want m1", prev)
	}
	if msgs[0][MsgKeyIsActive] != false {
		t.Fatalf("m1 should be inactive")
	}
	if msgs[2][MsgKeyIsActive] != true {
		t.Fatalf("m3 should be active")
	}
}

func TestListVariantsOrder(t *testing.T) {
	msgs := []map[string]any{
		{"id": "u0", "role": "user"},
		{"id": "m1", "role": "assistant", MsgKeyIsActive: true, "content": "first"},
		{"id": "m2", "role": "assistant", MsgKeyParentMessageID: "m1", MsgKeyBranchIndex: 1, MsgKeyIsActive: false, "content": "second"},
		{"id": "u1", "role": "user"},
	}
	variants := ListVariants(msgs, msgs[1])
	if len(variants) != 2 {
		t.Fatalf("variants count=%d, want 2", len(variants))
	}
	if variants[0]["id"] != "m1" {
		t.Fatalf("first variant id=%v, want m1", variants[0]["id"])
	}
	if variants[1]["id"] != "m2" {
		t.Fatalf("second variant id=%v, want m2", variants[1]["id"])
	}
}

func TestActiveVariantIDFallback(t *testing.T) {
	msgs := []map[string]any{
		{"id": "m1", "role": "assistant", "content": "legacy no IsActive flag"},
		{"id": "u1", "role": "user"},
	}
	got := ActiveVariantID(msgs, msgs[0])
	if got != "m1" {
		t.Fatalf("ActiveVariantID fallback=%q, want m1", got)
	}
}

func TestVariantGroupIDNilSafe(t *testing.T) {
	if got := VariantGroupID(nil); got != "" {
		t.Fatalf("VariantGroupID(nil)=%q, want \"\"", got)
	}
	if got := ListVariants(nil, map[string]any{"id": "x"}); got != nil {
		t.Fatalf("ListVariants(nil,...)=%v, want nil", got)
	}
	if touched, prev := SwitchActiveVariant(nil, "g", "x"); touched != 0 || prev != "" {
		t.Fatalf("SwitchActiveVariant(nil) returned %d/%q, want 0/\"\"", touched, prev)
	}
}
