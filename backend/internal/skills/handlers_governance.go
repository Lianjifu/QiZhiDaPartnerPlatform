package skills

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/infra"
)

// skillsGovernanceOverview returns the workspace-level KPI summary:
// 24h call volume, success rate, p95 latency, abnormal-skill count,
// and pending-approval action count. Hydrates from KV before reading so
// the metrics survive a process restart.
func (s *Service) skillsGovernanceOverview(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillRead(id); err != nil {
		return nil, err
	}
	s.refreshSkillGovernanceFromKV()
	ws := s.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	calls := 0
	weighted := 0.0
	abnormal := 0
	p95Max := 0
	for _, sk := range s.Store.Skills {
		if str(sk["workspaceId"]) != ws {
			continue
		}
		h := s.ensureSkillHealthLockedReadOnly(sk)
		c := intFrom(h["calls24h"])
		calls += c
		weighted += float64(c) * floatFrom(h["successRate"])
		st := str(h["status"])
		if st == "attention" || st == "incident" || st == "quarantined" {
			abnormal++
		}
		if p := intFrom(h["p95Ms"]); p > p95Max {
			p95Max = p
		}
	}
	success := 100.0
	if calls > 0 {
		success = weighted / float64(calls)
	}
	pending := 0
	for _, sk := range s.Store.Skills {
		if str(sk["workspaceId"]) == ws && str(sk["lifecycleStatus"]) == "pending_approval" {
			pending++
		}
	}
	for _, inc := range knowledgeSliceMaps(s.Store.SkillExtra["incidents"]) {
		if wid := str(inc["workspaceId"]); wid != "" && wid != ws {
			continue
		}
		if str(inc["status"]) == "open" {
			pending++
		}
	}
	return map[string]any{
		"calls24h": calls, "successRate": round2(success), "p95Ms": p95Max,
		"abnormalSkills": abnormal, "pendingActions": pending,
	}, nil
}

func (s *Service) ensureSkillHealthLockedReadOnly(skill map[string]any) map[string]any {
	sid := str(skill["id"])
	for _, h := range s.Store.SkillHealth {
		if str(h["skillId"]) == sid {
			return h
		}
	}
	status := "healthy"
	switch str(skill["lifecycleStatus"]) {
	case "disabled", "deprecated":
		status = "paused"
	case "quarantined":
		status = "quarantined"
	case "pending_approval":
		status = "attention"
	}
	return map[string]any{
		"id": "sh-" + sid, "skillId": sid, "name": skill["name"], "kind": skill["kind"],
		"environment": coalesce(str(skill["environment"]), "production"),
		"status":      status, "calls24h": 0, "successRate": 100, "p95Ms": 0, "errorRate": 0,
		"riskLevel":  normalizeRiskLevel(skill["riskLevel"]),
		"owner":      coalesce(str(skill["owner"]), "未指定"),
		"references": 0, "updatedAt": "尚未调用",
	}
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func floatFrom(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		return 0
	}
}

func (s *Service) skillsGovernanceHealth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillRead(id); err != nil {
		return nil, err
	}
	s.refreshSkillGovernanceFromKV()
	ws := s.WorkspaceID(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	out := make([]map[string]any, 0)
	for _, sk := range s.Store.Skills {
		if str(sk["workspaceId"]) != ws {
			continue
		}
		h := s.ensureSkillHealthLocked(sk)
		item := cloneMap(h)
		item["name"] = sk["name"]
		item["kind"] = sk["kind"]
		item["riskLevel"] = normalizeRiskLevel(sk["riskLevel"])
		out = append(out, item)
	}
	return out, nil
}

func (s *Service) skillsGovernanceTrends(r *http.Request) (any, error) {
	if err := requireSkillRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	s.refreshSkillGovernanceFromKV()
	ws := s.WorkspaceID(r)
	s.Store.Lock()
	buckets := s.skillTrendBucketsLocked(ws)
	out := make([]map[string]any, 0, len(buckets))
	for _, b := range buckets {
		out = append(out, map[string]any{
			"time":      str(b["time"]),
			"calls":     intFrom(b["calls"]),
			"errorRate": floatFrom(b["errorRate"]),
			"p95":       intFrom(b["p95"]),
		})
	}
	s.Store.Unlock()
	return out, nil
}

func (s *Service) skillsGovernanceEmpty(r *http.Request) (any, error) {
	if err := requireSkillRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	return []any{}, nil
}

// skillsGovernanceBatch applies a single bulk action (pause / revalidate)
// to many skills in one round trip. Used by the governance dashboard to
// flip an entire fleet's lifecycle status during an incident response.
func (s *Service) skillsGovernanceBatch(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	action := str(body["action"])
	rawIDs, _ := body["skillIds"].([]any)
	ws := s.WorkspaceID(r)
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	out := make([]map[string]any, 0)
	for _, x := range rawIDs {
		sid := str(x)
		_, sk := s.findSkillLocked(ws, sid)
		if sk == nil {
			continue
		}
		h := s.ensureSkillHealthLocked(sk)
		if action == "pause" {
			sk["lifecycleStatus"] = "disabled"
			h["status"] = "paused"
		} else {
			sk["lifecycleStatus"] = "enabled"
			h["status"] = "healthy"
		}
		h["updatedAt"] = "刚刚"
		out = append(out, cloneMap(h))
	}
	s.Store.AppendAudit(ws, id.Name, ternary(action == "pause", "批量暂停技能", "批量重新验证技能"), strconv.Itoa(len(out))+" 项", "success", "")
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	return out, nil
}

// refreshSkillGovernanceFromKV pulls the latest skill_health +
// skill_extra collections from the optional KV store so the in-memory
// metrics survive a process restart. Hydration does NOT touch the
// `skills` collection (would clobber local EnsureDocxSkillReady
// installs); only metrics + per-skill extras.
func (s *Service) refreshSkillGovernanceFromKV() {
	kv := s.kvStore()
	if kv == nil || !kv.Available() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// Only metrics/events — do not rehydrate `skills` (would wipe EnsureDocxSkillReady / local installs).
	for _, coll := range []string{"skill_health", "skill_extra"} {
		items, err := kv.List(ctx, coll)
		if err != nil || len(items) == 0 {
			continue
		}
		// HydrateFrom already acquires Store.Lock — do not wrap it.
		s.Store.HydrateFrom(coll, items)
	}
}

// kvStore resolves the optional KVStore callback from Deps.
func (s *Service) kvStore() *infra.KVStore {
	if s.KV == nil {
		return nil
	}
	raw := s.KV()
	kv, _ := raw.(*infra.KVStore)
	return kv
}
