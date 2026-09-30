package server

import (
	"fmt"
	"strings"
	"time"
)

func asRuntimeMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(m)+8)
	for k, val := range m {
		out[k] = val
	}
	return out
}

func parseTimeFlexible(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05", "2006/1/2 15:04:05"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return t
		}
	}
	return time.Time{}
}

// recordEmployeeRuntimeLocked increments a digital employee's runtime counters after a real call.
// Caller must hold Store.Lock.
func (s *Server) recordEmployeeRuntimeLocked(deID string, durationMs int, ok bool) {
	deID = strings.TrimSpace(deID)
	if deID == "" {
		return
	}
	for _, emp := range s.Store.Employees {
		if str(emp["id"]) != deID {
			continue
		}
		rt := asRuntimeMap(emp["runtime"])
		calls := intFrom(rt["recordedCalls24h"]) + 1
		succ := intFrom(rt["successCount24h"])
		if ok {
			succ++
		}
		rt["recordedCalls24h"] = calls
		rt["successCount24h"] = succ
		rt["calls24h"] = calls
		if calls > 0 {
			rt["successRate"] = float64(succ) / float64(calls)
		}
		if durationMs > intFrom(rt["p95Ms"]) {
			rt["p95Ms"] = durationMs
		}
		rt["costToday"] = round2(floatFrom(rt["costToday"]) + 0.02)
		emp["runtime"] = rt
		emp["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		return
	}
}

func (s *Server) recordEmployeeRuntime(deID string, durationMs int, ok bool) {
	if strings.TrimSpace(deID) == "" {
		return
	}
	s.Store.Lock()
	s.recordEmployeeRuntimeLocked(deID, durationMs, ok)
	s.Store.Unlock()
	s.Store.Persist("employees")
}

func (s *Server) conversationIDsForEmployeeLocked(ws, deID string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, sess := range s.Store.Sessions {
		if ws != "" && str(sess["workspaceId"]) != "" && str(sess["workspaceId"]) != ws {
			continue
		}
		if str(sess["digitalPartnerId"]) != deID {
			continue
		}
		cid := coalesce(str(sess["conversationId"]), str(sess["id"]))
		if cid != "" {
			out[cid] = struct{}{}
		}
	}
	for _, conv := range s.Store.Conversations {
		if ws != "" && str(conv["workspaceId"]) != "" && str(conv["workspaceId"]) != ws {
			continue
		}
		if str(conv["digitalPartnerId"]) != deID {
			continue
		}
		if id := str(conv["id"]); id != "" {
			out[id] = struct{}{}
		}
	}
	for _, mem := range s.Store.MemoryRecords {
		if str(mem["digitalPartnerId"]) != deID {
			continue
		}
		if ws != "" && str(mem["workspaceId"]) != "" && str(mem["workspaceId"]) != ws {
			continue
		}
		if src := str(mem["sourceId"]); src != "" {
			out[src] = struct{}{}
		}
	}
	return out
}

func (s *Server) boundSkillAnomaliesLocked(emp map[string]any) (anomalies, skillCalls int, skillSuccWeighted float64, skillP95 int) {
	caps, _ := emp["capabilities"].(map[string]any)
	names := stringSliceAny(caps["skills"])
	if len(names) == 0 {
		return 0, 0, 0, 0
	}
	for _, sk := range s.Store.Skills {
		name := str(sk["name"])
		matched := false
		for _, want := range names {
			if strings.EqualFold(want, name) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		h := s.ensureSkillHealthLockedReadOnly(sk)
		c := intFrom(h["calls24h"])
		skillCalls += c
		rate := floatFrom(h["successRate"])
		if rate > 1 {
			rate = rate / 100
		}
		skillSuccWeighted += float64(c) * rate
		if p := intFrom(h["p95Ms"]); p > skillP95 {
			skillP95 = p
		}
		switch str(h["status"]) {
		case "attention", "incident", "quarantined":
			anomalies++
		}
	}
	return anomalies, skillCalls, skillSuccWeighted, skillP95
}

func (s *Server) handoffs24hLocked(ws, deID, empName string, cutoff time.Time) int {
	count := 0
	for _, a := range s.Store.Audits {
		if wid := str(a["workspaceId"]); wid != "" && ws != "" && wid != ws {
			continue
		}
		action := str(a["action"])
		target := str(a["target"])
		detail := str(a["detail"])
		blob := action + " " + target + " " + detail
		if !strings.Contains(blob, "交接") && !strings.Contains(strings.ToLower(blob), "handoff") {
			continue
		}
		if deID != "" || empName != "" {
			if !strings.Contains(blob, deID) && !strings.Contains(blob, empName) {
				continue
			}
		}
		t := parseTimeFlexible(coalesce(str(a["time"]), str(a["createdAt"])))
		if !t.IsZero() && t.Before(cutoff) {
			continue
		}
		count++
	}
	return count
}

func (s *Server) memoryCallsForEmployeeLocked(ws, deID string, cutoff, today time.Time) (calls, succ int, cost float64) {
	for _, mem := range s.Store.MemoryRecords {
		if str(mem["digitalPartnerId"]) != deID {
			continue
		}
		if wid := str(mem["workspaceId"]); wid != "" && ws != "" && wid != ws {
			continue
		}
		layer := str(mem["layer"])
		if layer != "" && layer != "short_term" {
			continue
		}
		title := str(mem["title"])
		if strings.HasPrefix(title, "Dream ") {
			continue
		}
		t := parseTimeFlexible(coalesce(str(mem["createdAt"]), str(mem["updatedAt"])))
		if !t.IsZero() && t.Before(cutoff) {
			continue
		}
		calls++
		st := strings.ToLower(str(mem["status"]))
		if st != "failed" && st != "error" {
			succ++
		}
		if t.IsZero() || !t.Before(today) {
			units := len([]rune(str(mem["content"])))
			cost += float64(units) * 0.00002
		}
	}
	return calls, succ, cost
}

// computeEmployeeRuntimeLocked derives runtime metrics from memory, sessions/toolCalls, skill health, and recorded counters.
// Caller must hold Store.RLock or Lock.
func (s *Server) computeEmployeeRuntimeLocked(emp map[string]any) map[string]any {
	deID := str(emp["id"])
	ws := str(emp["workspaceId"])
	name := str(emp["name"])
	stored := asRuntimeMap(emp["runtime"])
	now := time.Now()
	cutoff := now.Add(-24 * time.Hour)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	memCalls, memSucc, memCost := s.memoryCallsForEmployeeLocked(ws, deID, cutoff, today)
	msgCalls, msgSucc := 0, 0
	msgCost := 0.0
	p95 := 0

	for cid := range s.conversationIDsForEmployeeLocked(ws, deID) {
		for _, msg := range s.Store.Messages[cid] {
			if str(msg["role"]) != "assistant" {
				continue
			}
			created := parseTimeFlexible(str(msg["createdAt"]))
			in24h := created.IsZero() || !created.Before(cutoff)
			inToday := created.IsZero() || !created.Before(today)
			if !in24h {
				continue
			}
			tools := knowledgeSliceMaps(msg["toolCalls"])
			if len(tools) == 0 {
				msgCalls++
				msgSucc++
			} else {
				for _, tc := range tools {
					msgCalls++
					st := strings.ToLower(str(tc["status"]))
					if st == "" || st == "success" || st == "ok" {
						msgSucc++
					}
					if d := intFrom(tc["durationMs"]); d > p95 {
						p95 = d
					}
				}
			}
			if inToday {
				units := len([]rune(str(msg["content"])))
				msgCost += float64(units) * 0.00002
			}
		}
	}

	// Prefer durable conversation memories when chat transcripts were not persisted to this unit.
	calls, succ, cost := msgCalls, msgSucc, msgCost
	if memCalls > calls {
		calls, succ, cost = memCalls, memSucc, memCost
	}

	// Recorded counters from live Copilot / skill invocations.
	if rec := intFrom(stored["recordedCalls24h"]); rec > calls {
		calls = rec
		if sc := intFrom(stored["successCount24h"]); sc > 0 {
			succ = sc
		}
		if sp := intFrom(stored["p95Ms"]); sp > p95 {
			p95 = sp
		}
	}
	if sc := floatFrom(stored["costToday"]); sc > cost && intFrom(stored["recordedCalls24h"]) > 0 {
		cost = sc
	}

	anomalies, skillCalls, skillSuccW, skillP95 := s.boundSkillAnomaliesLocked(emp)
	if skillCalls > calls {
		// Bound skill invocations are real platform usage of this role's capabilities.
		if calls == 0 {
			succ = int(skillSuccW + 0.5)
			calls = skillCalls
		} else {
			// Keep conversation-derived calls; only borrow latency.
		}
	}
	if skillP95 > p95 {
		p95 = skillP95
	}

	rate := 0.0
	if calls > 0 {
		if succ > calls {
			succ = calls
		}
		rate = float64(succ) / float64(calls)
		if rate > 1 {
			rate = 1
		}
	}

	handoffs := s.handoffs24hLocked(ws, deID, name, cutoff)
	if h := intFrom(stored["handoffs24h"]); h > handoffs && intFrom(stored["recordedCalls24h"]) > 0 {
		handoffs = h
	}
	if calls >= 3 && rate < 0.85 {
		anomalies++
	}

	return map[string]any{
		"calls24h":         calls,
		"successCount24h":  succ,
		"recordedCalls24h": intFrom(stored["recordedCalls24h"]),
		"successRate":      float64(int(rate*1000+0.5)) / 1000,
		"p95Ms":            p95,
		"costToday":        round2(cost),
		"handoffs24h":      handoffs,
		"anomalies":        anomalies,
	}
}

func (s *Server) employeeWithRuntimeLocked(emp map[string]any) map[string]any {
	out := cloneMap(emp)
	out["runtime"] = s.computeEmployeeRuntimeLocked(emp)
	return out
}

func (s *Server) realEmployeeEvidenceLocked(emp map[string]any, limit int) []map[string]any {
	if limit <= 0 {
		limit = 20
	}
	deID := str(emp["id"])
	name := str(emp["name"])
	ws := str(emp["workspaceId"])
	out := make([]map[string]any, 0, limit)

	for i := len(s.Store.Audits) - 1; i >= 0 && len(out) < limit; i-- {
		a := s.Store.Audits[i]
		if wid := str(a["workspaceId"]); wid != "" && ws != "" && wid != ws {
			continue
		}
		blob := str(a["action"]) + " " + str(a["target"]) + " " + str(a["detail"])
		relevant := strings.Contains(blob, deID) || strings.Contains(blob, name) ||
			strings.Contains(blob, "协作") || strings.Contains(blob, "执行技能") || strings.Contains(blob, "会话")
		if !relevant {
			continue
		}
		out = append(out, map[string]any{
			"id":     coalesce(str(a["id"]), fmt.Sprintf("ev-%d", i)),
			"time":   coalesce(coalesce(str(a["time"]), str(a["createdAt"])), time.Now().UTC().Format(time.RFC3339)),
			"actor":  coalesce(str(a["actor"]), "系统"),
			"action": coalesce(str(a["action"]), "运行事件"),
			"target": coalesce(str(a["target"]), name),
			"result": coalesce(str(a["result"]), "success"),
		})
	}

	if len(out) < limit {
		for i := len(s.Store.MemoryRecords) - 1; i >= 0 && len(out) < limit; i-- {
			mem := s.Store.MemoryRecords[i]
			if str(mem["digitalPartnerId"]) != deID {
				continue
			}
			if str(mem["layer"]) != "" && str(mem["layer"]) != "short_term" {
				continue
			}
			title := str(mem["title"])
			if title == "" || strings.HasPrefix(title, "Dream ") {
				continue
			}
			action := "协作回合"
			if strings.Contains(title, "docx") || strings.Contains(title, "PPT") || strings.Contains(title, "文档") {
				action = "技能调用"
			}
			out = append(out, map[string]any{
				"id":     coalesce(str(mem["id"]), fmt.Sprintf("mem-%d", i)),
				"time":   coalesce(coalesce(str(mem["createdAt"]), str(mem["updatedAt"])), time.Now().UTC().Format(time.RFC3339)),
				"actor":  coalesce(str(mem["ownerName"]), "系统"),
				"action": action,
				"target": name,
				"result": coalesce(str(mem["status"]), "success"),
			})
		}
	}

	if len(out) == 0 {
		rt := s.computeEmployeeRuntimeLocked(emp)
		out = append(out, map[string]any{
			"id": "ev-runtime", "time": time.Now().UTC().Format(time.RFC3339),
			"actor": "系统", "action": "运行观测", "target": name, "result": "success",
			"detail": fmt.Sprintf("24h 调用 %d · 成功率 %.1f%% · P95 %dms",
				intFrom(rt["calls24h"]), floatFrom(rt["successRate"])*100, intFrom(rt["p95Ms"])),
		})
	}
	return out
}
