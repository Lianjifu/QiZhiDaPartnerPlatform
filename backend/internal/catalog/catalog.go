// Package catalog defines the contract between the assembly catalog
// handler and the heterogeneous data sources it reads from. In split
// deploy (qzda-collab) skills/knowledge/models/channels live on qzda-cap
// and workflow skills on qzda-workflow; in monolith they all live in the
// local store. Both shapes must satisfy Source so the handler can
// fan out to either uniformly.
//
// The package is pure: no I/O, no goroutines, no time. Sources are
// expected to be fast (already-cached reads or in-process store reads);
// the contract test below asserts dedup / order / workspace isolation
// without touching the network.
package catalog

import (
	"context"
	"errors"
	"sort"
	"strings"
)

// Option is a single dropdown entry returned by a Source. Sources
// MUST populate Name (used as the dedup key within a Section); ID is
// optional and may equal Name for stable identities. Kind MUST equal
// the source's Kind() return.
type Option struct {
	ID   string
	Name string
	Meta string
	Kind string
}

// Section is the assembled catalog keyed by asset kind. Handler code
// reads these directly to render the digital-employee assembly UI.
//
// The current handler also adds a synthetic "platformTools" /
// "runtimeTools" block; those are out of scope for catalog (they're
// capability flags, not sourced assets).
type Section map[string][]Option

// KindSkill, KindTool, KindMCP, KindWorkflow, KindKnowledge,
// KindChannel, KindModel are the recognized asset kinds. Sources that
// produce Options of an unknown Kind are still merged — the Section
// is just a map, not an enum — but the catalog handler ignores them.
const (
	KindSkill     = "skill"
	KindTool      = "tool"
	KindMCP       = "mcp"
	KindWorkflow  = "workflow"
	KindKnowledge = "knowledge"
	KindChannel   = "channel"
	KindModel     = "model"
)

// Source is the contract every catalog data source MUST satisfy.
//
//	Kind() returns one of the Kind* constants; the same source MUST
//	     return the same Kind() on every call.
//	Fetch(ctx, ws) returns the Options visible to the given workspace.
//	     MUST NOT include Options whose implicit workspaceId is neither
//	     equal to ws nor empty/"*" (workspace isolation is the source's
//	     responsibility; the registry does not second-guess it).
//	     MUST return a non-nil slice on success (empty is fine).
//	     MUST return ctx.Err() if the context is cancelled.
type Source interface {
	Kind() string
	Fetch(ctx context.Context, ws string) ([]Option, error)
}

// Registry aggregates multiple Sources and exposes a single Assemble
// entry point. Sources are additive: an Option from one source fills
// gaps left by another, and identical Names are deduped (first wins).
type Registry struct {
	// FailOpen, when true, lets a partial assembly succeed even if a
	// source returned an error. The error is still recorded in the
	// returned []error slice so the caller can surface it. When false,
	// any error aborts Assemble (returns the partial Section collected
	// so far alongside the first error).
	FailOpen bool

	// Sources, evaluated in slice order. Sources with the same Kind
	// are merged in order; first occurrence of a Name wins.
	Sources []Source
}

// Assemble fans out to every source, merges Options by Kind, dedupes
// within each Kind by Name (preserving first-seen order), and returns
// the resulting Section plus any per-source errors.
//
// The returned Section is always non-nil; empty kinds are present as
// empty slices so callers can range without nil checks.
func (r *Registry) Assemble(ctx context.Context, ws string) (Section, []error) {
	out := Section{
		KindSkill:     {},
		KindTool:      {},
		KindMCP:       {},
		KindWorkflow:  {},
		KindKnowledge: {},
		KindChannel:   {},
		KindModel:     {},
	}
	var errs []error
	for _, src := range r.Sources {
		if err := ctx.Err(); err != nil {
			errs = append(errs, err)
			if !r.FailOpen {
				return out, errs
			}
			continue
		}
		kind := src.Kind()
		opts, err := src.Fetch(ctx, ws)
		if err != nil {
			errs = append(errs, err)
			if !r.FailOpen {
				return out, errs
			}
			continue
		}
		// Drop options with empty Name — they have no stable identity
		// to dedup on, and the catalog UI shows Name verbatim.
		filtered := make([]Option, 0, len(opts))
		for _, o := range opts {
			if strings.TrimSpace(o.Name) == "" {
				continue
			}
			if o.Kind == "" {
				o.Kind = kind
			}
			filtered = append(filtered, o)
		}
		out[kind] = MergeOptions(out[kind], filtered)
	}
	// Stable order for snapshot-style assertions in the contract test:
	// keep insertion order within each kind (do NOT sort). Callers that
	// need alphabetical UI ordering sort downstream.
	return out, errs
}

// MergeOptions concatenates two option slices and dedupes by Name
// (case-sensitive, trimmed). The first occurrence of each Name is
// preserved; later duplicates are dropped. Returned slice is the same
// backing as `base` when no growth happens — callers may mutate
// cautiously.
//
// Pure function: no I/O, no global state.
func MergeOptions(base, extra []Option) []Option {
	if len(extra) == 0 {
		return base
	}
	seen := make(map[string]bool, len(base)+len(extra))
	out := make([]Option, 0, len(base)+len(extra))
	add := func(opts []Option) {
		for _, o := range opts {
			name := strings.TrimSpace(o.Name)
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			out = append(out, o)
		}
	}
	add(base)
	add(extra)
	return out
}

// StaticSource is a Source backed by an in-memory slice. Useful in
// tests and for hand-coded catalogs (e.g. the always-present Web
// channel that the catalog handler appends).
type StaticSource struct {
	K    string
	Opts []Option
}

// Kind implements Source.
func (s *StaticSource) Kind() string { return s.K }

// Fetch implements Source.
func (s *StaticSource) Fetch(ctx context.Context, ws string) ([]Option, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	out := make([]Option, 0, len(s.Opts))
	for _, o := range s.Opts {
		if o.Kind == "" {
			o.Kind = s.K
		}
		out = append(out, o)
	}
	return out, nil
}

// SortedNames returns a sorted copy of Names from a Section's Kind —
// helper for tests / snapshot assertions that need order-insensitive
// comparison.
func SortedNames(section Section, kind string) []string {
	opts := section[kind]
	names := make([]string, 0, len(opts))
	for _, o := range opts {
		names = append(names, o.Name)
	}
	sort.Strings(names)
	return names
}

// ErrUnsupportedKind is returned by sources that decline to answer
// for a given workspace (e.g. an empty-mode store). The Registry
// treats this the same as any other error under FailOpen semantics.
var ErrUnsupportedKind = errors.New("catalog: unsupported kind for workspace")