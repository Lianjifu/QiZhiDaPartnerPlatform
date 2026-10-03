package memory

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// memoryOverviewAligned → GET /api/memory/overview
// Returns per-layer counts (only active records) + the pending-candidates
// count + the workspace memory policy.
func (s *Service) memoryOverviewAligned(r *http.Request) map[string]any {
	ws := s.workspaceID(r)
	id := s.identityFrom(r.Context())
	s.Store.RLock()
	defer s.Store.RUnlock()
	short, working, long, pending := 0, 0, 0, 0
	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) != ws || !memoryCanRead(id, m) {
			continue
		}
		if str(m["status"]) != "active" {
			continue
		}
		switch str(m["layer"]) {
		case "short_term":
			short++
		case "working":
			working++
		case "long_term":
			long++
		}
	}
	for _, c := range s.Store.MemoryCands {
		if str(c["workspaceId"]) == ws && str(c["status"]) == "pending_review" {
			pending++
		}
	}
	policy := s.memoryPolicyFor(ws)
	return map[string]any{
		"workspaceId": ws,
		"totals": map[string]any{
			"shortTerm": short, "working": working, "longTerm": long, "pendingCandidates": pending,
		},
		"policy": policy,
	}
}

// listMemory → GET /api/memory/records
// Returns all memory records visible to the requester (filtered by
// memoryCanRead).
func (s *Service) listMemory(r *http.Request) any {
	ws := s.workspaceID(r)
	id := s.identityFrom(r.Context())
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) == ws && memoryCanRead(id, m) {
			out = append(out, m)
		}
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out
}

// createMemory → POST /api/memory/records
// Validates the title / content / layer triplet, applies TTL derivation
// from the workspace policy, enforces long-term capacity + write-approval
// gates, and stamps an audit row.
func (s *Service) createMemory(r *http.Request) (map[string]any, error) {
	id := s.identityFrom(r.Context())
	body, _ := s.decodeMap(r)
	title := strings.TrimSpace(str(body["title"]))
	content := strings.TrimSpace(str(body["content"]))
	layer := str(body["layer"])
	if title == "" || content == "" || layer == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_INVALID: 标题、内容与记忆层级不能为空")
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)

	s.Store.Lock()
	defer s.Store.Unlock()
	policy := s.memoryPolicyFor(ws)
	if s.Store.MemoryPolicies[ws] == nil {
		s.Store.MemoryPolicies[ws] = policy
	}
	if layer == "long_term" {
		if policy["longTermWriteApproval"] == true {
			return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_APPROVAL_REQUIRED: 长期记忆写入需要通过提炼审核")
		}
		cap := int(toFloat(policy["longTermCapacity"]))
		used := int(toFloat(policy["usedCapacity"]))
		if cap > 0 && used >= cap {
			return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_CAPACITY: 长期记忆容量已满")
		}
	}
	item := map[string]any{
		"id": s.Store.ID("memory"), "workspaceId": ws, "ownerId": id.ID,
		"digitalPartnerId": body["digitalPartnerId"],
		"layer":             layer, "scope": coalesce(str(body["scope"]), "user"),
		"title": title, "content": content,
		"classification": coalesce(str(body["classification"]), "internal"),
		"sourceType":     coalesce(str(body["sourceType"]), "manual"),
		"sourceId":       coalesce(str(body["sourceId"]), "manual"),
		"correlationId":  coalesce(str(body["correlationId"]), s.Store.ID("memory_corr")),
		"confidence":     coalesceAny(body["confidence"], 0.8),
		"status":         "active", "createdAt": now, "updatedAt": now,
	}
	if exp := str(body["expiresAt"]); exp != "" {
		item["expiresAt"] = exp
	} else if layer == "short_term" {
		hours := int(toFloat(policy["shortTermTtlHours"]))
		if hours <= 0 {
			hours = 24
		}
		item["expiresAt"] = time.Now().UTC().Add(time.Duration(hours) * time.Hour).Format(time.RFC3339)
	} else if layer == "working" {
		days := int(toFloat(policy["workingMemoryTtlDays"]))
		if days <= 0 {
			days = 30
		}
		item["expiresAt"] = time.Now().UTC().Add(time.Duration(days) * 24 * time.Hour).Format(time.RFC3339)
	}
	s.Store.MemoryRecords = append([]map[string]any{item}, s.Store.MemoryRecords...)
	if layer == "long_term" {
		s.recountLongTermCapacityLocked(ws)
	}
	s.appendMemoryAuditLocked(ws, id.Name, "写入记忆", title, "success", str(item["correlationId"]))
	go s.persistMemory()
	return item, nil
}

// memoryRecordAction → POST/DELETE /api/memory/records/{id}[/{action}]
// Routes:
//   - POST /api/memory/records/{id}/expire    → soft-expire a record
//   - POST /api/memory/records/{id}/candidate → promote to candidate (long_term only)
//   - DELETE /api/memory/records/{id}         → soft-revoke a record
func (s *Service) memoryRecordAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "记忆不存在")
	}
	mid, action := parts[3], ""
	if len(parts) >= 5 {
		action = parts[4]
	}
	id := s.identityFrom(r.Context())
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)

	s.Store.Lock()
	defer s.Store.Unlock()
	for _, m := range s.Store.MemoryRecords {
		if str(m["id"]) != mid {
			continue
		}
		if str(m["workspaceId"]) != ws {
			return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, "E_WORKSPACE_SCOPE: 无权操作其他工作区记忆")
		}
		if !memoryCanChange(id, m) {
			return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, "E_MEMORY_OWNER_SCOPE: 仅可维护本人创建的记忆")
		}
		switch {
		case action == "expire" && r.Method == http.MethodPost:
			m["status"] = "expired"
			m["updatedAt"] = now
			s.appendMemoryAuditLocked(ws, id.Name, "使记忆失效", coalesce(str(m["title"]), mid), "success", str(m["correlationId"]))
			if str(m["layer"]) == "long_term" {
				s.recountLongTermCapacityLocked(ws)
			}
			go s.persistMemory()
			return m, nil
		case action == "candidate" && r.Method == http.MethodPost:
			if str(m["layer"]) != "long_term" {
				return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_LAYER_INVALID: 仅长期记忆可以提炼为知识候选")
			}
			for _, c := range s.Store.MemoryCands {
				if str(c["memoryId"]) == mid && str(c["status"]) == "pending_review" {
					return c, nil
				}
			}
			summary := str(m["content"])
			if len([]rune(summary)) > 180 {
				summary = string([]rune(summary)[:180])
			}
			cand := map[string]any{
				"id": s.Store.ID("memory_candidate"), "workspaceId": ws, "memoryId": mid,
				"title": coalesce(str(m["title"]), "记忆候选"), "summary": summary,
				"classification":      coalesce(str(m["classification"]), "internal"),
				"sourceCorrelationId": coalesce(str(m["correlationId"]), s.Store.ID("memory_corr")),
				"status":              "pending_review", "submittedAt": now,
			}
			s.Store.MemoryCands = append([]map[string]any{cand}, s.Store.MemoryCands...)
			m["status"] = "pending_review"
			m["updatedAt"] = now
			s.appendMemoryAuditLocked(ws, id.Name, "提炼知识候选", str(cand["title"]), "success", str(cand["sourceCorrelationId"]))
			go s.persistMemory()
			return cand, nil
		case r.Method == http.MethodDelete:
			m["status"] = "revoked"
			m["updatedAt"] = now
			s.appendMemoryAuditLocked(ws, id.Name, "删除记忆", coalesce(str(m["title"]), mid), "success", str(m["correlationId"]))
			if str(m["layer"]) == "long_term" {
				s.recountLongTermCapacityLocked(ws)
			}
			go s.persistMemory()
			return map[string]any{"id": mid, "status": "revoked"}, nil
		}
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "记忆不存在")
}

// getMemoryPolicy → GET /api/memory/policy
// Returns the workspace memory policy (lazily materializes the default).
func (s *Service) getMemoryPolicy(r *http.Request) any {
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.memoryPolicyFor(ws)
}

// patchMemoryPolicy → PATCH /api/memory/policy
// Admin-only + zero-trust gated. Body fields are merged onto the
// workspace policy (workspaceId + usedCapacity are reserved).
func (s *Service) patchMemoryPolicy(r *http.Request) (map[string]any, error) {
	id, err := s.requireMemoryGovernance(r, "更新记忆策略")
	if err != nil {
		return nil, err
	}
	body, _ := s.decodeMap(r)
	ws := s.workspaceID(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	p := s.Store.MemoryPolicies[ws]
	if p == nil {
		p = defaultMemoryPolicy(ws)
		s.Store.MemoryPolicies[ws] = p
	}
	for k, v := range body {
		if k == "workspaceId" || k == "usedCapacity" {
			continue
		}
		p[k] = v
	}
	p["workspaceId"] = ws
	s.recountLongTermCapacityLocked(ws)
	s.appendMemoryAuditLocked(ws, id.Name, "更新记忆策略", "记忆策略", "success", "")
	go s.persistMemory()
	return p, nil
}

// listMemoryAudits → GET /api/memory/audit
// Returns the workspace-scoped audit trail (newest first), deduped by id.
func (s *Service) listMemoryAudits(r *http.Request) any {
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, a := range s.Store.MemoryAudits {
		if str(a["workspaceId"]) == ws {
			out = append(out, a)
		}
	}
	if out == nil {
		out = []map[string]any{}
	}
	return store.DedupeMapsByID(out)
}