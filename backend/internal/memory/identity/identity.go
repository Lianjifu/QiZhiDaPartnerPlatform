// Package identity implements the identity tier of the memory center.
//
// Mem5 — the previous system stored only ephemeral short_term / working /
// long_term records keyed by workspace + employee. There was no slot for
// "who am I as a digital employee" stable facts (preferred name, locale,
// primary language, communication style, hard NOs). This package defines
// an IdentityProfile with those fields and a tiny in-memory store.
//
// Storage is backed by Server.Store.KnowledgeExtra? No — by MemoryExtra
// (the memory center has its own extra block). The Server wires hydration.
package identity

import (
	"errors"
	"sort"
	"strings"
	"sync"
)

// Profile is the durable identity of one digital employee.
type Profile struct {
	WorkspaceID       string   `json:"workspaceId"`
	DigitalPartnerID string   `json:"digitalPartnerId"`
	PreferredName     string   `json:"preferredName"`
	Locale            string   `json:"locale"`
	PrimaryLanguage   string   `json:"primaryLanguage"`
	CommunicationStyle string  `json:"communicationStyle"` // formal | casual | mixed
	HardNo            []string `json:"hardNo"`             // topics/categories to never discuss
	CustomFacts       []string `json:"customFacts"`
	UpdatedAt         string   `json:"updatedAt"` // RFC3339
}

// ErrNotFound is returned by Get when no profile exists.
var ErrNotFound = errors.New("identity profile: not found")

// ErrInvalid is returned by Set when required fields are missing.
var ErrInvalid = errors.New("identity profile: invalid")

// Store is an in-memory profile store keyed by (workspace, digitalEmployee).
type Store struct {
	mu       sync.RWMutex
	profiles map[string]Profile
}

// NewStore returns an empty Store.
func NewStore() *Store {
	return &Store{profiles: map[string]Profile{}}
}

// key returns the dedup key.
func key(ws, de string) string { return strings.ToLower(ws) + "|" + strings.ToLower(de) }

// Get returns the profile for the given DE.
func (s *Store) Get(ws, de string) (Profile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.profiles[key(ws, de)]
	if !ok {
		return Profile{}, ErrNotFound
	}
	return p, nil
}

// Set replaces or creates the profile. Returns ErrInvalid if required
// fields are blank.
func (s *Store) Set(p Profile) error {
	if strings.TrimSpace(p.WorkspaceID) == "" || strings.TrimSpace(p.DigitalPartnerID) == "" {
		return ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.profiles[key(p.WorkspaceID, p.DigitalPartnerID)] = p
	return nil
}

// Delete removes the profile. Returns ErrNotFound if absent.
func (s *Store) Delete(ws, de string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := key(ws, de)
	if _, ok := s.profiles[k]; !ok {
		return ErrNotFound
	}
	delete(s.profiles, k)
	return nil
}

// ListAll returns profiles for a workspace, sorted by DigitalPartnerID.
func (s *Store) ListAll(ws string) []Profile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Profile{}
	for _, p := range s.profiles {
		if p.WorkspaceID != ws {
			continue
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DigitalPartnerID < out[j].DigitalPartnerID })
	return out
}

// ShouldRefuse returns true when the query touches a hard-no category.
// Case-insensitive substring match; multi-word "hard no" entries split on
// whitespace.
func (p Profile) ShouldRefuse(query string) (string, bool) {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return "", false
	}
	for _, n := range p.HardNo {
		terms := strings.Fields(strings.ToLower(n))
		if len(terms) == 0 {
			continue
		}
		matched := 0
		for _, t := range terms {
			if strings.Contains(q, t) {
				matched++
			}
		}
		// For single-word hard no, any match counts.
		// For multi-word, require at least one match.
		if len(terms) == 1 {
			if matched == 1 {
				return n, true
			}
			continue
		}
		if matched >= 1 {
			return n, true
		}
	}
	return "", false
}
