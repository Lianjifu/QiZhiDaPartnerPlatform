// Package heartbeat tracks active session liveness for W4-D1.
//
// The Server registers a Tracker on startup; the auth middleware calls
// Touch() on every authenticated request, and the periodic sweeper
// removes entries whose lastSeen is older than the stale threshold. The
// two HTTP endpoints (/api/heartbeat + /api/online) and the SSE channel
// (/api/online/stream) all read from the same Tracker so dashboards and
// presence indicators stay consistent.
//
// Design choices:
//
//   - One entry per (workspaceID, identityID). Multi-device users
//     collapse into a single "online" status; per-device is a W6-D2
//     concern.
//   - lastSeen is wall-clock UTC; clients never set it directly. The
//     middleware overwrites on every request — clients cannot keep
//     themselves "online" by lying about timestamps.
//   - stale after 3× the configured interval (or QZDA_HEARTBEAT_STALE if
//     set), so a missed beat or two doesn't drop presence.
//   - SSE subscribers are non-blocking — a slow consumer drops events,
//     not the writer. Documented in the subscription helper.
package heartbeat

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Presence describes one identity's last-known activity in a workspace.
type Presence struct {
	WorkspaceID string    `json:"workspaceId"`
	IdentityID  string    `json:"identityId"`
	DisplayName string    `json:"displayName,omitempty"`
	LastSeen    time.Time `json:"lastSeen"`
	// Channel is "web" today; reserved for future mobile / desktop
	// channels so the UI can show a small device icon.
	Channel string `json:"channel,omitempty"`
}

// Event is what we emit to SSE subscribers when presence changes.
type Event struct {
	Type      string    `json:"type"` // "join" | "leave" | "tick"
	Workspace string    `json:"workspace"`
	Identity  string    `json:"identity"`
	LastSeen  time.Time `json:"lastSeen"`
	Online    int       `json:"online"` // count after the change
}

// Config controls the sweep cadence + staleness threshold.
type Config struct {
	// Interval is the suggested heartbeat cadence. The middleware does
	// NOT enforce it — clients can ping as often as they like; we just
	// use it to derive a sensible SweepEvery.
	Interval time.Duration
	// SweepEvery is how often the background goroutine walks the map
	// to evict stale entries. Default: Interval.
	SweepEvery time.Duration
	// StaleAfter is the threshold past which a presence entry is
	// considered offline. Default: 3 × Interval.
	StaleAfter time.Duration
	// ChannelBuffer is the SSE subscriber channel buffer. Default: 16.
	ChannelBuffer int
}

// DefaultConfig is the fallback when env flags are absent.
func DefaultConfig() Config {
	return Config{
		Interval:      30 * time.Second,
		SweepEvery:    30 * time.Second,
		StaleAfter:    90 * time.Second,
		ChannelBuffer: 16,
	}
}

// Tracker is the in-memory presence map + SSE fan-out hub.
type Tracker struct {
	cfg Config

	mu      sync.RWMutex
	byID    map[string]*Presence       // workspaceID|"\x00"|identityID → entry
	byWS    map[string]map[string]bool // workspaceID → set of identityID (for fast Online())
	subs    map[chan Event]struct{}     // SSE subscribers
	lastLag time.Duration               // published via metrics on next scrape

	// nameFn maps identityID → display name; nil → no name shown.
	nameFn func(identityID string) string
}

// New constructs a Tracker with the given config. nameFn is optional.
func New(cfg Config, nameFn func(string) string) *Tracker {
	if cfg.Interval <= 0 {
		cfg = DefaultConfig()
	}
	if cfg.SweepEvery <= 0 {
		cfg.SweepEvery = cfg.Interval
	}
	if cfg.StaleAfter <= 0 {
		cfg.StaleAfter = cfg.Interval * 3
	}
	if cfg.StaleAfter < cfg.SweepEvery {
		// Sweep must run at least as often as the stale window.
		cfg.StaleAfter = cfg.SweepEvery
	}
	if cfg.ChannelBuffer <= 0 {
		cfg.ChannelBuffer = 16
	}
	return &Tracker{
		cfg:    cfg,
		byID:   map[string]*Presence{},
		byWS:   map[string]map[string]bool{},
		subs:   map[chan Event]struct{}{},
		nameFn: nameFn,
	}
}

func key(wsID, idID string) string {
	if wsID == "" {
		wsID = "w1"
	}
	return wsID + "\x00" + idID
}

// Touch records that the given identity is active right now in the given
// workspace. No-op if idID is empty. Returns true if the entry is new
// (first presence after being offline) so the caller can decide whether
// to emit a join event.
func (t *Tracker) Touch(wsID, idID, channel string) (created bool) {
	if idID == "" {
		return false
	}
	now := time.Now().UTC()
	k := key(wsID, idID)

	t.mu.Lock()
	defer t.mu.Unlock()
	prev, exists := t.byID[k]
	if !exists {
		prev = &Presence{
			WorkspaceID: wsID,
			IdentityID:  idID,
			Channel:     channel,
			LastSeen:    now,
		}
		t.byID[k] = prev
		set, ok := t.byWS[wsID]
		if !ok {
			set = map[string]bool{}
			t.byWS[wsID] = set
		}
		set[idID] = true
		if t.nameFn != nil {
			prev.DisplayName = t.nameFn(idID)
		}
		t.lastLag = 0
		t.notify(Event{Type: "join", Workspace: wsID, Identity: idID, LastSeen: now, Online: len(set)})
		return true
	}
	prev.LastSeen = now
	if channel != "" {
		prev.Channel = channel
	}
	t.lastLag = 0
	return false
}

// Sweep evicts entries whose lastSeen is older than StaleAfter. Returns
// the count of evicted entries (for tests + metric).
func (t *Tracker) Sweep() (evicted int) {
	now := time.Now().UTC()
	threshold := now.Add(-t.cfg.StaleAfter)
	t.mu.Lock()
	defer t.mu.Unlock()
	for k, p := range t.byID {
		if p.LastSeen.Before(threshold) {
			delete(t.byID, k)
			if set, ok := t.byWS[p.WorkspaceID]; ok {
				delete(set, p.IdentityID)
				if len(set) == 0 {
					delete(t.byWS, p.WorkspaceID)
				}
			}
			evicted++
			t.notify(Event{Type: "leave", Workspace: p.WorkspaceID, Identity: p.IdentityID, LastSeen: p.LastSeen, Online: onlineCount(t.byWS[p.WorkspaceID])})
		}
	}
	return evicted
}

// Online returns the list of currently-online identities in a workspace,
// sorted by lastSeen descending. Stale entries are filtered out (the
// caller doesn't need to invoke Sweep first).
func (t *Tracker) Online(wsID string) []Presence {
	now := time.Now().UTC()
	threshold := now.Add(-t.cfg.StaleAfter)
	t.mu.RLock()
	defer t.mu.RUnlock()
	set, ok := t.byWS[wsID]
	if !ok {
		return nil
	}
	out := make([]Presence, 0, len(set))
	for idID := range set {
		p, ok := t.byID[key(wsID, idID)]
		if !ok || p.LastSeen.Before(threshold) {
			continue
		}
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastSeen.Equal(out[j].LastSeen) {
			return out[i].IdentityID < out[j].IdentityID
		}
		return out[i].LastSeen.After(out[j].LastSeen)
	})
	return out
}

// OnlineCount returns the (live, filtered) count for a workspace.
func (t *Tracker) OnlineCount(wsID string) int {
	now := time.Now().UTC()
	threshold := now.Add(-t.cfg.StaleAfter)
	t.mu.RLock()
	defer t.mu.RUnlock()
	set, ok := t.byWS[wsID]
	if !ok {
		return 0
	}
	n := 0
	for idID := range set {
		p, ok := t.byID[key(wsID, idID)]
		if !ok || p.LastSeen.Before(threshold) {
			continue
		}
		n++
	}
	return n
}

// LagSinceLastTouch returns the wall-clock duration since the most
// recent Touch call across all identities, capped at StaleAfter.
func (t *Tracker) LagSinceLastTouch() time.Duration {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if len(t.byID) == 0 {
		return 0
	}
	var latest time.Time
	for _, p := range t.byID {
		if p.LastSeen.After(latest) {
			latest = p.LastSeen
		}
	}
	if latest.IsZero() {
		return 0
	}
	lag := time.Since(latest)
	if lag > t.cfg.StaleAfter {
		lag = t.cfg.StaleAfter
	}
	return lag
}

// Subscribe returns a buffered channel that receives presence Events.
// The caller must call the returned cancel func to unsubscribe. A
// slow consumer drops events; we never block the writer.
func (t *Tracker) Subscribe(wsID string) (<-chan Event, func()) {
	ch := make(chan Event, t.cfg.ChannelBuffer)
	t.mu.Lock()
	t.subs[ch] = struct{}{}
	t.mu.Unlock()
	cancel := func() {
		t.mu.Lock()
		delete(t.subs, ch)
		t.mu.Unlock()
		close(ch)
	}
	// Push a synthetic tick so subscribers see the initial state.
	if wsID != "" {
		ch <- Event{Type: "tick", Workspace: wsID, Online: t.OnlineCount(wsID)}
	}
	return ch, cancel
}

// Run starts the sweeper goroutine and blocks until ctx is cancelled.
// Designed to be launched once per process.
func (t *Tracker) Run(ctx context.Context) {
	tk := time.NewTicker(t.cfg.SweepEvery)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			t.Sweep()
		}
	}
}

// notify fans out one Event to all subscribers, non-blocking.
func (t *Tracker) notify(ev Event) {
	for ch := range t.subs {
		select {
		case ch <- ev:
		default:
			// Drop — slow consumer. We deliberately do not block the
			// writer; the next tick will re-emit the latest state.
		}
	}
}

func onlineCount(set map[string]bool) int {
	if set == nil {
		return 0
	}
	return len(set)
}

// Snapshot returns workspace → online count. Used by the metrics scrape.
func (t *Tracker) Snapshot() map[string]int {
	now := time.Now().UTC()
	threshold := now.Add(-t.cfg.StaleAfter)
	t.mu.RLock()
	defer t.mu.RUnlock()
	out := make(map[string]int, len(t.byWS))
	for wsID, set := range t.byWS {
		n := 0
		for idID := range set {
			p, ok := t.byID[key(wsID, idID)]
			if !ok || p.LastSeen.Before(threshold) {
				continue
			}
			n++
		}
		out[wsID] = n
	}
	return out
}

// Config returns the active config (read-only).
func (t *Tracker) Config() Config {
	return t.cfg
}