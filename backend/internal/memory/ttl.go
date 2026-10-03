package memory

import (
	"context"
	"log"
	"time"
)

// StartMemoryMaintenance runs TTL expiry for short/working memory on an
// interval. The goroutine listens on its own ctx, returned via the
// cancel callback so Server.Shutdown can stop it deterministically.
//
// The cancel callback should be registered with Server.closeMu and
// invoked during Shutdown — mirroring the legacy
// Server.MemoryTTLCancel pattern that wired (s *Server).StartMemoryMaintenance
// into the Shutdown fan-out via {"memoryTTL", s.MemoryTTLCancel}.
func (s *Service) StartMemoryMaintenance() (cancel context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		s.runMemoryTTLPass()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runMemoryTTLPass()
			}
		}
	}()
	return cancel
}

// runMemoryTTLPass scans every active / pending_review short_term +
// working memory record and expires the ones whose expiresAt timestamp
// has passed. Long-term records are exempt — they live forever until
// the owner explicitly expires them. Caller MUST NOT hold Store.Lock;
// this helper acquires + releases it itself.
func (s *Service) runMemoryTTLPass() {
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)
	changed := 0

	s.Store.Lock()
	for _, m := range s.Store.MemoryRecords {
		status := str(m["status"])
		if status != "active" && status != "pending_review" {
			continue
		}
		layer := str(m["layer"])
		if layer != "short_term" && layer != "working" {
			continue
		}
		expired := false
		if exp := str(m["expiresAt"]); exp != "" {
			if t, err := time.Parse(time.RFC3339, exp); err == nil && now.After(t) {
				expired = true
			} else if t, err := time.Parse(time.RFC3339Nano, exp); err == nil && now.After(t) {
				expired = true
			}
		} else {
			ws := str(m["workspaceId"])
			policy := s.memoryPolicyFor(ws)
			created := str(m["createdAt"])
			ct, err := time.Parse(time.RFC3339, created)
			if err != nil {
				ct, err = time.Parse(time.RFC3339Nano, created)
			}
			if err == nil {
				if layer == "short_term" {
					hours := int(toFloat(policy["shortTermTtlHours"]))
					if hours <= 0 {
						hours = 24
					}
					expired = now.After(ct.Add(time.Duration(hours) * time.Hour))
				} else {
					days := int(toFloat(policy["workingMemoryTtlDays"]))
					if days <= 0 {
						days = 30
					}
					expired = now.After(ct.Add(time.Duration(days) * 24 * time.Hour))
				}
			}
		}
		if expired {
			m["status"] = "expired"
			m["updatedAt"] = nowStr
			changed++
			s.appendMemoryAuditLocked(str(m["workspaceId"]), "系统", "TTL 自动失效", coalesce(str(m["title"]), str(m["id"])), "success", str(m["correlationId"]))
		}
	}
	if changed > 0 {
		for ws := range s.Store.MemoryPolicies {
			s.recountLongTermCapacityLocked(ws)
		}
	}
	s.Store.Unlock()

	if changed > 0 {
		log.Printf("memory TTL: expired %d records", changed)
		s.persistMemory()
	}
}

// RunMemoryTTLForTest exposes TTL pass for unit tests. Mirrors the
// legacy (s *Server).RunMemoryTTLForTest shim that lived in
// server/memory_ttl.go.
func (s *Service) RunMemoryTTLForTest() { s.runMemoryTTLPass() }