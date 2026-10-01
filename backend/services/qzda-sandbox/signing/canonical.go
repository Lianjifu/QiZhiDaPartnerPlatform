package signing

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

// Canonicalize produces a deterministic JSON byte stream for v. The rules:
//
//   - Object keys are sorted lexicographically by their canonical string form.
//   - No whitespace between tokens (compact).
//   - Map values are walked recursively.
//   - Slice values are written in order, no reordering.
//   - String, bool, float64, nil — encoded via encoding/json for correctness.
//   - Integers are encoded as bare numeric tokens (no quotes).
//
// Two calls to Canonicalize with structurally equal inputs MUST produce the
// same bytes, regardless of original map iteration order. This is the
// invariant that makes signatures verifiable across processes / languages.
//
// Limitations: this is NOT a complete RFC 8785 implementation. There is no
// UTF-16 escape, no number canonicalization beyond what encoding/json does,
// no support for arbitrary precision numbers. Day 2's data shape (manifest
// metadata + per-file SHA256 strings + small arrays) does not need them.
func Canonicalize(v any) ([]byte, error) {
	var buf bytes.Buffer
	if err := writeCanonical(&buf, v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeCanonical(buf *bytes.Buffer, v any) error {
	switch t := v.(type) {
	case nil:
		buf.WriteString("null")
	case bool:
		if t {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	case string:
		b, err := json.Marshal(t)
		if err != nil {
			return err
		}
		buf.Write(b)
	case float64:
		// json.Marshal emits a number token; preserves precision.
		b, err := json.Marshal(t)
		if err != nil {
			return err
		}
		buf.Write(b)
	case int:
		buf.WriteString(strconv.FormatInt(int64(t), 10))
	case int64:
		buf.WriteString(strconv.FormatInt(t, 10))
	case int32:
		buf.WriteString(strconv.FormatInt(int64(t), 10))
	case []byte:
		// Treat raw bytes as a base64 string token — useful when the digest
		// payload carries a binary blob that must round-trip identically.
		b, err := json.Marshal(string(t))
		if err != nil {
			return err
		}
		buf.Write(b)
	case map[string]any:
		if err := writeCanonicalMap(buf, t); err != nil {
			return err
		}
	case []any:
		if err := writeCanonicalSlice(buf, t); err != nil {
			return err
		}
	default:
		// Fallback for structs and named types — round-trip through
		// encoding/json then normalize keys via a re-parse.
		raw, err := json.Marshal(t)
		if err != nil {
			return fmt.Errorf("canonical: marshal: %w", err)
		}
		var generic any
		if err := json.Unmarshal(raw, &generic); err != nil {
			return fmt.Errorf("canonical: re-parse: %w", err)
		}
		return writeCanonical(buf, generic)
	}
	return nil
}

func writeCanonicalMap(buf *bytes.Buffer, m map[string]any) error {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	buf.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, err := json.Marshal(k)
		if err != nil {
			return err
		}
		buf.Write(kb)
		buf.WriteByte(':')
		if err := writeCanonical(buf, m[k]); err != nil {
			return err
		}
	}
	buf.WriteByte('}')
	return nil
}

func writeCanonicalSlice(buf *bytes.Buffer, s []any) error {
	buf.WriteByte('[')
	for i, x := range s {
		if i > 0 {
			buf.WriteByte(',')
		}
		if err := writeCanonical(buf, x); err != nil {
			return err
		}
	}
	buf.WriteByte(']')
	return nil
}