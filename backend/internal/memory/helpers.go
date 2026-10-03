package memory

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// --- pure utility helpers (mirror server helpers so it never imports server/) ---

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func coalesce(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case float32:
		return float64(t)
	default:
		return 0
	}
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func itoa(n int) string { return strconv.Itoa(n) }

func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if n <= 0 || len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

// coalesceAny returns def when v is nil/empty/zero — used for non-string
// body fields like confidence (float) and digitalPartnerId (any).
func coalesceAny(v, def any) any {
	if v == nil {
		return def
	}
	switch t := v.(type) {
	case string:
		if strings.TrimSpace(t) == "" {
			return def
		}
	case []string:
		if len(t) == 0 {
			return def
		}
	case []any:
		if len(t) == 0 {
			return def
		}
	}
	return v
}

// --- memory-specific helpers ---

// memoryCanRead mirrors the policy: admin / auditor see all; non-admin can
// read restricted/confidential only if they own the record.
func memoryCanRead(id *auth.Identity, item map[string]any) bool {
	if id == nil || id.Role == "admin" || id.Role == "auditor" {
		return true
	}
	class := str(item["classification"])
	if class == "restricted" || class == "confidential" {
		return str(item["ownerId"]) == id.ID || str(item["createdBy"]) == id.ID
	}
	return true
}

// memoryCanChange mirrors the policy: admin / owner / creator can mutate.
func memoryCanChange(id *auth.Identity, item map[string]any) bool {
	if id == nil || id.Role == "admin" {
		return true
	}
	return str(item["ownerId"]) == id.ID || str(item["createdBy"]) == id.ID
}

// defaultMemoryPolicy is the seed policy applied to a workspace the first
// time any memory operation references it.
func defaultMemoryPolicy(ws string) map[string]any {
	return map[string]any{
		"workspaceId": ws, "shortTermTtlHours": 24, "workingMemoryTtlDays": 30, "dailyRefinementTime": "02:00",
		"shortToWorkingEnabled": true, "workingToLongEnabled": true, "longToKnowledgeEnabled": true,
		"minimumConfidence": 0.85, "longTermWriteApproval": true, "sensitiveDataMasking": true,
		"longTermCapacity": 5000, "usedCapacity": 0,
	}
}

// memoryPolicyFor returns the workspace memory policy, materializing the
// default if absent. Read-only; does NOT mutate the store.
func (s *Service) memoryPolicyFor(ws string) map[string]any {
	if p := s.Store.MemoryPolicies[ws]; p != nil {
		return p
	}
	return defaultMemoryPolicy(ws)
}

// appendMemoryAuditLocked records a single audit row in the global memory
// audit slice. Caller MUST hold Store.Lock.
func (s *Service) appendMemoryAuditLocked(ws, actor, action, target, result, corr string) {
	if corr == "" {
		corr = s.Store.ID("memory_corr")
	}
	s.Store.MemoryAudits = append([]map[string]any{{
		"id": s.Store.ID("ma"), "workspaceId": ws, "time": time.Now().UTC().Format(time.RFC3339),
		"actor": actor, "action": action, "target": target, "result": result, "correlationId": corr,
	}}, s.Store.MemoryAudits...)
}

// persistMemory flushes the four memory collections to the durable backend.
// Called via `go s.persistMemory()` after successful mutations.
func (s *Service) persistMemory() {
	for _, coll := range []string{"memory_records", "memory_candidates", "memory_policies", "memory_audits"} {
		if s.Store.CanWrite(coll) {
			s.Store.Persist(coll)
		}
	}
}

// recountLongTermCapacityLocked recomputes the long_term memory usage
// counter on the workspace policy. Caller MUST hold Store.Lock.
func (s *Service) recountLongTermCapacityLocked(ws string) {
	p := s.Store.MemoryPolicies[ws]
	if p == nil {
		p = defaultMemoryPolicy(ws)
		s.Store.MemoryPolicies[ws] = p
	}
	used := 0
	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) == ws && str(m["layer"]) == "long_term" && str(m["status"]) == "active" {
			used++
		}
	}
	p["usedCapacity"] = used
}

// requireMemoryGovernance is the admin + zero-trust gate used by every
// memory mutation that can change governance state (candidate
// approve/reject, refinement run, policy patch, identity CRUD).
func (s *Service) requireMemoryGovernance(r *http.Request, actionLabel string) (*auth.Identity, error) {
	id := s.Deps.IdentityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.RoleForbidden, actionLabel+"仅限管理员执行")
	}
	eval, err := s.Deps.EvaluateZeroTrust(id, "memory", "write", "internal", false, "")
	if err != nil {
		return nil, err
	}
	if str(eval["decision"]) == "deny" {
		return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, coalesce(str(eval["reason"]), "零信任拒绝记忆写操作"))
	}
	return id, nil
}

// workspaceID is a convenience wrapper over Deps.WorkspaceID that nil-checks
// the dep so individual handlers can call it without a verbose guard.
// Mirrors the (s *Server).workspaceID helper that lived in context.go.
func (s *Service) workspaceID(r *http.Request) string {
	if s.Deps.WorkspaceID == nil {
		return "w1"
	}
	return s.Deps.WorkspaceID(r)
}

// identityFrom is a convenience wrapper over Deps.IdentityFrom that
// nil-checks the dep. Mirrors the server.identityFrom free function.
func (s *Service) identityFrom(ctx context.Context) *auth.Identity {
	if s.Deps.IdentityFrom == nil {
		return nil
	}
	return s.Deps.IdentityFrom(ctx)
}

// decodeMap is a convenience wrapper over Deps.DecodeMap that nil-checks
// the dep. Mirrors the server.decodeMap free function.
func (s *Service) decodeMap(r *http.Request) (map[string]any, error) {
	if s.Deps.DecodeMap == nil {
		return map[string]any{}, nil
	}
	return s.Deps.DecodeMap(r)
}

// appendKnowledgeAuditLocked is a thin delegator over Deps so handler code
// can read "s.appendKnowledgeAuditLocked(...)" the same way it read
// "s.appendKnowledgeAuditLocked(...)" on the legacy *Server.
func (s *Service) appendKnowledgeAuditLocked(ws, actor, action, target, result, reason string) {
	if s.Deps.AppendKnowledgeAuditLocked == nil {
		return
	}
	s.Deps.AppendKnowledgeAuditLocked(ws, actor, action, target, result, reason)
}

// persistKnowledgeExtra is a thin delegator over Deps.PersistKnowledgeExtra.
func (s *Service) persistKnowledgeExtra() {
	if s.Deps.PersistKnowledgeExtra == nil {
		return
	}
	s.Deps.PersistKnowledgeExtra()
}

// knowledgeSliceMaps is a thin delegator over Deps.KnowledgeSliceMaps.
func (s *Service) knowledgeSliceMaps(v any) []map[string]any {
	if s.Deps.KnowledgeSliceMaps == nil {
		return nil
	}
	return s.Deps.KnowledgeSliceMaps(v)
}