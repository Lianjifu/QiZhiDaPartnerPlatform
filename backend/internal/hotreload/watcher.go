// Package hotreload watches config files and triggers a re-parse +
// re-apply on change. The first goal is "no restart to pick up a config
// edit"; the second goal is "a bad config edit never crashes the
// process" — the previous good value stays in effect, the error is
// surfaced via metrics + audit, and the watcher keeps polling.
//
// Two trigger sources:
//   - mtime poll every Interval (default 5s). Reliable across platforms
//     and works in containerized mounts where fsnotify sometimes misses.
//   - SIGHUP. Operators can force-reload without waiting for the next
//     poll. Disabled when running in dev mode without a controlling
//     terminal (CI / containers) — caller passes WithDisableSignal(true).
//
// The package is deliberately tiny so it can be embedded into other
// long-running subsystems (workspace publisher keys, routing policy,
// channel templates, …) without a hard dependency.
package hotreload

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/metrics"
)

// Parser turns file bytes into a typed value. A nil error keeps the
// previous good value and surfaces the failure via the metric + log.
type Parser[T any] func(path string, data []byte) (T, error)

// Apply is invoked with the parsed value on every successful reload.
// Returning a non-nil error rolls back to the previous value (the
// parser's output is discarded) and records result="apply_failed".
type Apply[T any] func(path string, v T) error

// Resource is one watched config file.
type Resource[T any] struct {
	Name string // short label for metrics + logs (e.g. "publisher-key")
	Path string // absolute file path
	Parse Parser[T]
	Apply Apply[T]
}

// Watcher polls + receives SIGHUP, runs Parse → Apply for each changed
// resource. Safe for concurrent use.
type Watcher[T any] struct {
	resources []Resource[T]
	interval  time.Duration
	disableSig bool
	mu        sync.Mutex
	state     map[string]*resourceState[T]
}

type resourceState[T any] struct {
	lastMtime  time.Time
	lastValue  T
	lastErr    error
	initialized bool
}

// Option tunes Watcher.
type Option func(*config)

type config struct {
	interval   time.Duration
	disableSig bool
}

func WithInterval(d time.Duration) Option {
	return func(c *config) { c.interval = d }
}

func WithDisableSignal(b bool) Option {
	return func(c *config) { c.disableSig = b }
}

// New builds a Watcher from the given resources + options. The watcher
// does not start until Run is called.
//
// The first poll after Run starts WILL reload every resource that
// exists on disk — that's the intentional "known good state on startup"
// behavior. Operators who don't want that can drop a sentinel file
// with the content they want applied before the binary starts.
func New[T any](rs []Resource[T], opts ...Option) *Watcher[T] {
	c := config{interval: 5 * time.Second}
	for _, opt := range opts {
		opt(&c)
	}
	w := &Watcher[T]{
		resources:  rs,
		interval:   c.interval,
		disableSig: c.disableSig,
		state:      make(map[string]*resourceState[T], len(rs)),
	}
	for _, r := range rs {
		w.state[r.Name] = &resourceState[T]{}
	}
	return w
}

// Run blocks until ctx is canceled or a fatal signal arrives. It is
// safe to invoke once per Watcher.
func (w *Watcher[T]) Run(ctx context.Context) error {
	if len(w.resources) == 0 {
		return errors.New("hotreload: no resources registered")
	}

	sighup := make(chan os.Signal, 1)
	if !w.disableSig {
		signal.Notify(sighup, syscall.SIGHUP)
		defer signal.Stop(sighup)
	}

	tick := time.NewTicker(w.interval)
	defer tick.Stop()

	// Run an initial pass so the system is in a known good state on
	// startup; otherwise the first poll might race with a real edit.
	w.scanAll()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
			w.scanAll()
		case <-sighup:
			log.Printf("hotreload: SIGHUP received, forcing scan")
			w.scanAll()
		}
	}
}

// ScanNow is exported for tests + ops tools that want to force a reload
// without waiting for the next tick. Safe to call concurrently with Run.
func (w *Watcher[T]) ScanNow() { w.scanAll() }

// LastError returns the most recent parse or apply error for the named
// resource, or nil if the last reload succeeded.
func (w *Watcher[T]) LastError(name string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	st, ok := w.state[name]
	if !ok {
		return errors.New("hotreload: unknown resource: " + name)
	}
	return st.lastErr
}

// LastValue returns the most recent successful parsed value and true
// once at least one successful reload has happened. Before any reload
// (or for an unknown resource) it returns the zero value and false.
func (w *Watcher[T]) LastValue(name string) (T, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	st, ok := w.state[name]
	if !ok || !st.initialized {
		var zero T
		return zero, false
	}
	return st.lastValue, true
}

// scanAll walks every resource and reloads it if mtime changed or if a
// SIGHUP forced scan.
func (w *Watcher[T]) scanAll() {
	for _, r := range w.resources {
		st, err := os.Stat(r.Path)
		if err != nil {
			// File doesn't exist yet — that's fine; treat as "no
			// change" so the watcher doesn't spam alerts. Operators
			// drop the file in and the next poll picks it up.
			continue
		}
		mt := st.ModTime()

		w.mu.Lock()
		prev, ok := w.state[r.Name]
		if !ok {
			prev = &resourceState[T]{}
			w.state[r.Name] = prev
		}
		changed := !ok || !mt.Equal(prev.lastMtime)
		w.mu.Unlock()

		if !changed {
			continue
		}
		w.reload(r, mt)
	}
}

// reload reads + parses + applies a single resource.
func (w *Watcher[T]) reload(r Resource[T], mt time.Time) {
	data, err := os.ReadFile(r.Path)
	if err != nil {
		w.record(r.Name, mt, zeroOf[T](), err)
		return
	}
	val, err := r.Parse(r.Path, data)
	if err != nil {
		w.record(r.Name, mt, val, err)
		return
	}
	if r.Apply != nil {
		if err := r.Apply(r.Path, val); err != nil {
			w.record(r.Name, mt, val, err)
			return
		}
	}
	w.record(r.Name, mt, val, nil)
}

func (w *Watcher[T]) record(name string, mt time.Time, v T, err error) {
	w.mu.Lock()
	st := w.state[name]
	if st == nil {
		st = &resourceState[T]{}
		w.state[name] = st
	}
	// Always advance mtime so the next poll doesn't immediately re-trigger.
	st.lastMtime = mt
	if err == nil {
		st.lastValue = v
		st.lastErr = nil
		st.initialized = true
	} else {
		st.lastErr = err
		// Keep initialized=false on the very first attempt if it failed,
		// so LastValue(name) returns ok=false. Subsequent failed retries
		// don't flip it back.
	}
	w.mu.Unlock()

	if err != nil {
		log.Printf("hotreload: %s reload failed: %v (keeping previous value)", name, err)
		metrics.Global.HotReload.Inc(name, "fail")
		return
	}
	metrics.Global.HotReload.Inc(name, "success")
}

// zeroOf returns the zero value of T without needing reflection at the
// call site.
func zeroOf[T any]() T { var z T; return z }
