package memory

import (
	"net/http"
	"time"
)

// memoryRefinement → POST /api/memory/refinement/run
// Admin-only + zero-trust gated daily progressive refinement pipeline.
//
// Layer transitions (gated by the workspace policy flags):
//   - short_term → working   (per-session dream-compress dedup via
//     hasWorkingDreamCompressLocked; confidence bumped +0.02, capped at 0.99)
//   - working   → long_term  (only if confidence ≥ minimumConfidence AND
//     long-term capacity not exhausted)
//   - long_term → candidate  (pending_review candidate + status flip on the
//     parent record; skipped when a pending candidate already exists)
//
// The pipeline returns a stats block (workingCreated / longCreated /
// candidatesCreated) so the UI can show a delta per run. Audit row is
// stamped once with all three counters.
func (s *Service) memoryRefinement(r *http.Request) (map[string]any, error) {
	id, err := s.requireMemoryGovernance(r, "执行记忆渐进提炼")
	if err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)

	s.Store.Lock()
	defer s.Store.Unlock()
	policy := s.memoryPolicyFor(ws)
	if s.Store.MemoryPolicies[ws] == nil {
		s.Store.MemoryPolicies[ws] = policy
	}
	minConf := toFloat(policy["minimumConfidence"])
	if minConf <= 0 {
		minConf = 0.85
	}
	workingDays := int(toFloat(policy["workingMemoryTtlDays"]))
	if workingDays <= 0 {
		workingDays = 30
	}
	cap := int(toFloat(policy["longTermCapacity"]))

	hasLayerSource := func(layer, sourceID string) bool {
		for _, m := range s.Store.MemoryRecords {
			if str(m["workspaceId"]) == ws && str(m["layer"]) == layer && str(m["sourceId"]) == sourceID {
				return true
			}
		}
		return false
	}
	hasPendingCand := func(memoryID string) bool {
		for _, c := range s.Store.MemoryCands {
			if str(c["memoryId"]) == memoryID && str(c["status"]) == "pending_review" {
				return true
			}
		}
		return false
	}

	workingCreated, longCreated, candidatesCreated := 0, 0, 0
	snapshot := append([]map[string]any{}, s.Store.MemoryRecords...)

	if policy["shortToWorkingEnabled"] == true {
		for _, source := range snapshot {
			if str(source["workspaceId"]) != ws || str(source["layer"]) != "short_term" || str(source["status"]) != "active" {
				continue
			}
			if hasLayerSource("working", str(source["sourceId"])) {
				continue
			}
			if hasWorkingDreamCompressLocked(s.Store.MemoryRecords, ws, str(source["sourceId"])) {
				continue
			}
			item := map[string]any{}
			for k, v := range source {
				item[k] = v
			}
			item["id"] = s.Store.ID("memory_work")
			item["layer"] = "working"
			item["scope"] = "team"
			item["title"] = coalesce(str(source["title"]), "短期记忆") + " · 会话摘要"
			item["content"] = "每日归纳：" + str(source["content"])
			item["confidence"] = minFloat(0.99, toFloat(source["confidence"])+0.02)
			item["expiresAt"] = now.Add(time.Duration(workingDays) * 24 * time.Hour).Format(time.RFC3339)
			item["createdAt"] = nowStr
			item["updatedAt"] = nowStr
			item["status"] = "active"
			s.Store.MemoryRecords = append([]map[string]any{item}, s.Store.MemoryRecords...)
			workingCreated++
		}
	}

	if policy["workingToLongEnabled"] == true {
		for _, source := range snapshot {
			if str(source["workspaceId"]) != ws || str(source["layer"]) != "working" || str(source["status"]) != "active" {
				continue
			}
			if toFloat(source["confidence"]) < minConf {
				continue
			}
			if hasLayerSource("long_term", str(source["sourceId"])) {
				continue
			}
			used := int(toFloat(policy["usedCapacity"]))
			if cap > 0 && used+longCreated >= cap {
				continue
			}
			item := map[string]any{}
			for k, v := range source {
				item[k] = v
			}
			item["id"] = s.Store.ID("memory_long")
			item["layer"] = "long_term"
			item["scope"] = "workspace"
			item["title"] = coalesce(str(source["title"]), "工作记忆") + " · 日结经验"
			item["content"] = "经每日提炼的可复用经验：" + str(source["content"])
			item["status"] = "active"
			delete(item, "expiresAt")
			item["createdAt"] = nowStr
			item["updatedAt"] = nowStr
			s.Store.MemoryRecords = append([]map[string]any{item}, s.Store.MemoryRecords...)
			longCreated++
		}
	}

	if policy["longToKnowledgeEnabled"] == true {
		for _, source := range s.Store.MemoryRecords {
			if str(source["workspaceId"]) != ws || str(source["layer"]) != "long_term" || str(source["status"]) != "active" {
				continue
			}
			if toFloat(source["confidence"]) < minConf {
				continue
			}
			if hasPendingCand(str(source["id"])) {
				continue
			}
			summary := str(source["content"])
			if len([]rune(summary)) > 180 {
				summary = string([]rune(summary)[:180])
			}
			cand := map[string]any{
				"id": s.Store.ID("memory_candidate"), "workspaceId": ws, "memoryId": source["id"],
				"title": coalesce(str(source["title"]), "长期记忆"), "summary": summary,
				"classification":      coalesce(str(source["classification"]), "internal"),
				"sourceCorrelationId": coalesce(str(source["correlationId"]), s.Store.ID("memory_corr")),
				"status":              "pending_review", "submittedAt": nowStr,
			}
			s.Store.MemoryCands = append([]map[string]any{cand}, s.Store.MemoryCands...)
			source["status"] = "pending_review"
			source["updatedAt"] = nowStr
			candidatesCreated++
		}
	}

	s.recountLongTermCapacityLocked(ws)
	s.appendMemoryAuditLocked(ws, id.Name, "执行每日渐进提炼",
		"短期→工作 "+itoa(workingCreated)+" · 工作→长期 "+itoa(longCreated)+" · 长期→知识候选 "+itoa(candidatesCreated),
		"success", "")
	go s.persistMemory()
	return map[string]any{
		"scheduledFor":      coalesce(str(policy["dailyRefinementTime"]), "02:00"),
		"workingCreated":    workingCreated,
		"longCreated":       longCreated,
		"candidatesCreated": candidatesCreated,
	}, nil
}

// hasWorkingDreamCompressLocked returns true when a working-layer
// record sourced from a prior dream-compress pass exists for the
// given (workspace, sourceId) tuple — short_term records that have
// already been dream-compressed should NOT be re-promoted into the
// working layer during a refinement run (avoids the obvious loop).
func hasWorkingDreamCompressLocked(records []map[string]any, ws, sourceID string) bool {
	if sourceID == "" {
		return false
	}
	for _, m := range records {
		if str(m["workspaceId"]) == ws && str(m["layer"]) == "working" && str(m["status"]) == "active" &&
			str(m["sourceId"]) == sourceID && str(m["sourceType"]) == "dream_compress" {
			return true
		}
	}
	return false
}