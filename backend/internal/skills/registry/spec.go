// Package registry is the v2 skill registry.
//
// Replaces the flat []registeredTool slice in internal/server/copilot_tools.go
// with a Spec-driven model. Each skill declares its lifecycle (stable,
// beta, deprecated), risk class, required permissions, approval mode, and
// schema constraints. The Registry is the single source of truth used by
// copilot_tools, skill_invocation, and the catalog.
package registry

import (
	"errors"
	"sort"
	"strings"
	"sync"
)

// Lifecycle is the maturity state of a skill.
type Lifecycle string

const (
	LifecycleStable     Lifecycle = "stable"
	LifecycleBeta       Lifecycle = "beta"
	LifecycleDeprecated Lifecycle = "deprecated"
	LifecycleDraft      Lifecycle = "draft"
)

// RiskClass is the inferred risk surface of a skill. Combined with the
// caller's risk level to decide whether approval is required.
type RiskClass string

const (
	RiskReadOnly RiskClass = "read_only"
	RiskLocalIO  RiskClass = "local_io"
	RiskNetwork  RiskClass = "network"
	RiskExec     RiskClass = "exec"
	RiskSecrets  RiskClass = "secrets"
	RiskDestructive RiskClass = "destructive"
)

// ApprovalMode declares how a skill should be authorized.
type ApprovalMode string

const (
	ApprovalAuto      ApprovalMode = "auto"
	ApprovalConfirm   ApprovalMode = "confirm"
	ApprovalSOD       ApprovalMode = "sod"          // requires separate approver
	ApprovalForbidden ApprovalMode = "forbidden"    // denied regardless of policy
)

// Spec is the canonical description of a registered skill.
type Spec struct {
	Key              string            `json:"key"`              // unique id, e.g. "skill:pptx"
	Name             string            `json:"name"`             // human-readable display name
	Kind             string            `json:"kind"`             // builtin | tool | skill | workflow
	Mode             string            `json:"mode"`             // capability mode (read|write|exec)
	Description      string            `json:"description"`
	Version          string            `json:"version"`
	Lifecycle        Lifecycle         `json:"lifecycle"`
	RiskClass        RiskClass         `json:"riskClass"`
	Approval         ApprovalMode      `json:"approval"`
	RequiredPerms    []string          `json:"requiredPerms"`
	Tags             []string          `json:"tags"`
	ArgSchema        map[string]ArgDef `json:"argSchema,omitempty"`
	OwnerDigitalPartner string         `json:"ownerDigitalPartner,omitempty"`
}

// ArgDef describes one accepted argument.
type ArgDef struct {
	Type        string `json:"type"`        // string|int|bool|object
	Required    bool   `json:"required"`
	Description string `json:"description,omitempty"`
}

// ErrNotFound is returned by Lookup when the key is absent.
var ErrNotFound = errors.New("skill registry: not found")

// ErrLifecycleBlocked is returned when a caller asks for a skill in draft or
// deprecated state and didn't opt in.
var ErrLifecycleBlocked = errors.New("skill registry: lifecycle blocks invocation")

// Registry is a thread-safe in-memory spec store.
type Registry struct {
	mu    sync.RWMutex
	specs map[string]Spec
	byTag map[string][]string
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{
		specs: map[string]Spec{},
		byTag: map[string][]string{},
	}
}

// Register stores a spec. Replaces any existing entry with the same Key.
func (r *Registry) Register(s Spec) error {
	if strings.TrimSpace(s.Key) == "" {
		return errors.New("skill registry: empty key")
	}
	if strings.TrimSpace(s.Name) == "" {
		return errors.New("skill registry: empty name")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.specs[s.Key] = s
	for _, t := range s.Tags {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" {
			continue
		}
		r.byTag[t] = appendUnique(r.byTag[t], s.Key)
	}
	return nil
}

// Lookup returns the spec for the given key.
func (r *Registry) Lookup(key string) (Spec, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.specs[strings.TrimSpace(key)]
	if !ok {
		return Spec{}, ErrNotFound
	}
	return s, nil
}

// All returns every spec sorted by Key.
func (r *Registry) All() []Spec {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Spec, 0, len(r.specs))
	for _, s := range r.specs {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// ByLifecycle returns specs matching the lifecycle state.
func (r *Registry) ByLifecycle(lc Lifecycle) []Spec {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []Spec{}
	for _, s := range r.specs {
		if s.Lifecycle == lc {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// ByTag returns specs carrying the given tag (lowercased).
func (r *Registry) ByTag(tag string) []Spec {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tag = strings.ToLower(strings.TrimSpace(tag))
	keys := r.byTag[tag]
	out := make([]Spec, 0, len(keys))
	for _, k := range keys {
		if s, ok := r.specs[k]; ok {
			out = append(out, s)
		}
	}
	return out
}

// Callable reports whether a caller may invoke the spec. Lifecycle and
// approval rules are evaluated; permission checks live in the policy
// package and are layered on top.
func (r *Registry) Callable(s Spec, allowBeta, allowDeprecated bool) error {
	switch s.Lifecycle {
	case LifecycleDraft:
		return ErrLifecycleBlocked
	case LifecycleDeprecated:
		if !allowDeprecated {
			return ErrLifecycleBlocked
		}
	case LifecycleBeta:
		if !allowBeta {
			return ErrLifecycleBlocked
		}
	}
	if s.Approval == ApprovalForbidden {
		return errors.New("skill registry: forbidden by approval mode")
	}
	return nil
}

func appendUnique(s []string, v string) []string {
	for _, x := range s {
		if x == v {
			return s
		}
	}
	return append(s, v)
}
