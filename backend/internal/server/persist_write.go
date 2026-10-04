package server

import (
	"log"

	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
)

// afterWrite persists durable collections when the process is not in demo (memory-only) mode.
func (s *Server) afterWrite(collections ...string) {
	if s == nil || s.Store == nil || !runtimeenv.FromEnv().PersistEnabled() {
		return
	}
	for _, c := range collections {
		if c == "" {
			continue
		}
		s.Store.Persist(c)
	}
}

// afterWriteLocked snapshots collections while the caller holds Store.Lock (no nested RLock).
func (s *Server) afterWriteLocked(collections ...string) {
	if s == nil || s.Store == nil || !runtimeenv.FromEnv().PersistEnabled() {
		return
	}
	for _, c := range collections {
		if c == "" {
			continue
		}
		items := s.Store.SnapshotUnderLock(c)
		if items == nil {
			continue
		}
		s.Store.PersistCollection(c, items)
	}
}

// durableDeleteSync removes ids from PG (kv or kernel). Safe when PersistEnabled is false (no-op).
func (s *Server) durableDeleteSync(collection string, ids ...string) {
	if s == nil || s.Store == nil || len(ids) == 0 {
		return
	}
	if err := s.Store.PersistDeleteSync(collection, ids...); err != nil {
		log.Printf("persist-delete %s: %v", collection, err)
	}
}

// idsBeyondKeep returns document ids that would be dropped when keeping only the first keep entries.
func idsBeyondKeep(items []map[string]any, keep int) []string {
	if keep < 0 || len(items) <= keep {
		return nil
	}
	out := make([]string, 0, len(items)-keep)
	for _, m := range items[keep:] {
		if id := str(m["id"]); id != "" {
			out = append(out, id)
		}
	}
	return out
}
