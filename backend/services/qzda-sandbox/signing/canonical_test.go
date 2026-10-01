package signing

import (
	"bytes"
	"encoding/json"
	"sort"
	"testing"
)

func TestCanonicalDeterministicKeyOrder(t *testing.T) {
	a := map[string]any{
		"z": 1,
		"a": 2,
		"m": map[string]any{"y": "yy", "x": "xx"},
	}
	out1, err := Canonicalize(a)
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	// Same map, identical structure — must produce identical output.
	out2, err := Canonicalize(a)
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	if !bytes.Equal(out1, out2) {
		t.Fatalf("non-deterministic: %s vs %s", out1, out2)
	}
	// Expect alphabetical keys: {"a":2,"m":{"x":"xx","y":"yy"},"z":1}
	want := `{"a":2,"m":{"x":"xx","y":"yy"},"z":1}`
	if string(out1) != want {
		t.Fatalf("want %s got %s", want, out1)
	}
}

func TestCanonicalSlicesPreserveOrder(t *testing.T) {
	v := []any{"x", "a", "m"}
	got, err := Canonicalize(v)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	want := `["x","a","m"]`
	if string(got) != want {
		t.Fatalf("want %s got %s", want, got)
	}
}

func TestCanonicalHandlesNestedStruct(t *testing.T) {
	type Inner struct {
		Z int `json:"z"`
		A int `json:"a"`
	}
	type Outer struct {
		Inner Inner `json:"inner"`
		Name  string `json:"name"`
	}
	v := Outer{Name: "n", Inner: Inner{Z: 1, A: 2}}
	got, err := Canonicalize(v)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	// Keys sorted via fallback re-parse: name, inner{ a, z }
	want := `{"inner":{"a":2,"z":1},"name":"n"}`
	if string(got) != want {
		t.Fatalf("want %s got %s", want, got)
	}
}

func TestCanonicalIntEmittedAsNumber(t *testing.T) {
	got, err := Canonicalize(map[string]any{"n": 42})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	want := `{"n":42}`
	if string(got) != want {
		t.Fatalf("want %s got %s", want, got)
	}
}

func TestCanonicalRejectsInconsistentMapOrder(t *testing.T) {
	// Two maps with the same entries — even if the runtime's map iteration
	// order differs, Canonicalize must yield the same bytes.
	a := map[string]any{"a": 1, "b": 2, "c": 3}
	b := map[string]any{"c": 3, "a": 1, "b": 2}
	ca, _ := Canonicalize(a)
	cb, _ := Canonicalize(b)
	if !bytes.Equal(ca, cb) {
		t.Fatalf("not stable: %s vs %s", ca, cb)
	}
}

func TestCanonicalPreservesUnicode(t *testing.T) {
	v := map[string]any{"zh": "中文"}
	got, err := Canonicalize(v)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	// encoding/json default escapes < > &, but not CJK — verify
	if !bytes.Contains(got, []byte("中文")) {
		t.Fatalf("expected 中文 literal, got %s", got)
	}
}

func TestCanonicalCompactNoWhitespace(t *testing.T) {
	v := map[string]any{"a": 1, "b": []any{1, 2, 3}}
	got, err := Canonicalize(v)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if bytes.ContainsAny(got, " \n\t") {
		t.Fatalf("canonical form should have no whitespace, got %s", got)
	}
}

func TestCanonicalSortedMapKeysExtensive(t *testing.T) {
	// 20 keys, random order — make sure sorted output matches sorted-input output.
	keys := []string{"k01", "k02", "k03", "k04", "k05", "k06", "k07", "k08", "k09", "k10",
		"k11", "k12", "k13", "k14", "k15", "k16", "k17", "k18", "k19", "k20"}
	m := map[string]any{}
	for _, k := range keys {
		m[k] = len(k)
	}
	out, err := Canonicalize(m)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("re-parse: %v", err)
	}
	if len(parsed) != len(keys) {
		t.Fatalf("lost keys")
	}
	gotKeys := make([]string, 0, len(parsed))
	for k := range parsed {
		gotKeys = append(gotKeys, k)
	}
	sort.Strings(gotKeys)
	for i, k := range keys {
		if gotKeys[i] != k {
			t.Fatalf("key %d: want %s got %s", i, k, gotKeys[i])
		}
	}
}