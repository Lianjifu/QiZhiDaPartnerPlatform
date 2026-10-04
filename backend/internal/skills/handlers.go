package skills

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func requireSkillRead(id *auth.Identity) error {
	if id == nil || !auth.Has(id, "skill.read") {
		return apperr.Forbidden(apperr.RoleForbidden, "缺少 skill.read")
	}
	return nil
}

func requireSkillWrite(id *auth.Identity) error {
	if id == nil || !auth.Has(id, "skill.write") {
		return apperr.Forbidden(apperr.RoleForbidden, "缺少 skill.write")
	}
	return nil
}

func (s *Service) persistSkills() {
	if s.Store == nil {
		return
	}
	s.Store.Persist("skills")
	s.Store.Persist("skill_catalog")
	s.persistSkillHealth()
	s.Store.Persist("skill_integrations")
}

func (s *Service) persistSkillHealth() {
	if s.Store == nil {
		return
	}
	for _, coll := range []string{"skill_health", "skill_extra"} {
		s.Store.Persist(coll)
	}
}

func normalizeRiskLevel(v any) string {
	switch strings.ToLower(str(v)) {
	case "low":
		return "low"
	case "high":
		return "high"
	case "medium", "mid":
		return "mid"
	default:
		if str(v) == "" {
			return "mid"
		}
		return "mid"
	}
}

func (s *Service) normalizeSkillItem(m map[string]any) map[string]any {
	out := cloneMap(m)
	if str(out["description"]) == "" {
		out["description"] = str(out["name"])
	}
	if out["rating"] == nil {
		out["rating"] = 0
	}
	if out["installCount"] == nil {
		out["installCount"] = 0
	}
	if out["cacheable"] == nil {
		out["cacheable"] = false
	}
	out["riskLevel"] = normalizeRiskLevel(coalesce(str(out["riskLevel"]), str(out["risk"])))
	delete(out, "risk")
	if str(out["lifecycleStatus"]) == "" {
		out["lifecycleStatus"] = "enabled"
	}
	if str(out["kind"]) == "" {
		out["kind"] = "skill"
	}
	if str(out["status"]) == "" {
		out["status"] = "installed"
	}
	if str(out["source"]) == "" {
		out["source"] = "import"
	}
	if str(out["version"]) == "" {
		out["version"] = "0.1.0"
	}
	// W2-D1 · publisher provenance. Reads workspaceId from the item and
	// stamps 4 fields so the UI can render a trust badge without a
	// second round-trip.
	s.annotateSkillPublisher(out)
	return out
}

// normalizeSkillItemLocked is the lock-free variant for callers that
// already hold Store.Lock / RLock. It MUST NOT be called otherwise — the
// active-publisher lookup below dereferences the store without
// synchronization.
func (s *Service) normalizeSkillItemLocked(m map[string]any) map[string]any {
	out := cloneMap(m)
	if str(out["description"]) == "" {
		out["description"] = str(out["name"])
	}
	if out["rating"] == nil {
		out["rating"] = 0
	}
	if out["installCount"] == nil {
		out["installCount"] = 0
	}
	if out["cacheable"] == nil {
		out["cacheable"] = false
	}
	out["riskLevel"] = normalizeRiskLevel(coalesce(str(out["riskLevel"]), str(out["risk"])))
	delete(out, "risk")
	if str(out["lifecycleStatus"]) == "" {
		out["lifecycleStatus"] = "enabled"
	}
	if str(out["kind"]) == "" {
		out["kind"] = "skill"
	}
	if str(out["status"]) == "" {
		out["status"] = "installed"
	}
	if str(out["source"]) == "" {
		out["source"] = "import"
	}
	if str(out["version"]) == "" {
		out["version"] = "0.1.0"
	}
	annotateSkillPublisherLocked(s, out)
	return out
}

// annotateSkillPublisher sets publisherKeyId / publisherStatus /
// workspacePublisherStatus / signatureTrust on a normalized skill item.
// Safe to call without a server context (Store==nil becomes no-op).
//
// The caller MUST NOT hold Store.Lock / RLock when invoking this method;
// it acquires RLock internally. If the caller already holds the lock,
// call annotateSkillPublisherLocked instead.
func (s *Service) annotateSkillPublisher(item map[string]any) {
	if s == nil || s.Store == nil {
		annotateSkillPublisherLocked(nil, item)
		return
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	annotateSkillPublisherLocked(s, item)
}

// annotateSkillPublisherLocked is the lock-free core. Caller must hold
// at least RLock on s.Store (or pass nil s when Store is unavailable).
func annotateSkillPublisherLocked(s *Service, item map[string]any) {
	wsID := str(item["workspaceId"])
	item["publisherKeyId"] = coalesce(str(item["signedKeyId"]), str(item["publisherKeyId"]))
	item["signatureTrust"] = "missing"
	item["workspacePublisherStatus"] = "none"
	item["publisherStatus"] = ""

	if s == nil || s.Store == nil || wsID == "" {
		return
	}
	if str(item["signedKeyId"]) != "" || str(item["publisherKeyId"]) != "" {
		item["signatureTrust"] = "workspace"
	}
	active := s.Store.ActivePublisherKey(wsID)
	if active != nil {
		item["workspacePublisherStatus"] = str(active["status"])
		if item["publisherKeyId"] == str(active["keyId"]) {
			item["publisherStatus"] = "active"
		} else if str(item["publisherKeyId"]) != "" {
			if _, _, err := s.ResolvePublisherKey(wsID, str(item["publisherKeyId"])); err == nil {
				item["publisherStatus"] = "rotated"
			} else {
				item["publisherStatus"] = "revoked"
			}
		}
	} else if str(item["publisherKeyId"]) != "" {
		if _, _, err := s.ResolvePublisherKey(wsID, str(item["publisherKeyId"])); err == nil {
			item["publisherStatus"] = "rotated"
		} else {
			item["publisherStatus"] = "revoked"
		}
	}
}

func cloneMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m)+4)
	for k, v := range m {
		out[k] = v
	}
	return out
}

func (s *Service) findSkillLocked(ws, id string) (int, map[string]any) {
	for i, sk := range s.Store.Skills {
		if str(sk["id"]) != id {
			continue
		}
		skWS := str(sk["workspaceId"])
		if skWS != "" && skWS != ws {
			continue
		}
		return i, sk
	}
	return -1, nil
}

func (s *Service) findCatalogLocked(ws, id string) map[string]any {
	for _, item := range s.Store.SkillCatalog {
		if str(item["id"]) != id {
			continue
		}
		if !catalogVisibleToWorkspace(item, ws) {
			continue
		}
		return item
	}
	return nil
}

func (s *Service) ensureSkillHealthLocked(skill map[string]any) map[string]any {
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
	item := map[string]any{
		"id": "sh-" + sid, "skillId": sid, "name": skill["name"], "kind": skill["kind"],
		"environment": coalesce(str(skill["environment"]), "production"),
		"status":      status, "calls24h": 0, "successRate": 100, "p95Ms": 0, "errorRate": 0,
		"riskLevel":  normalizeRiskLevel(skill["riskLevel"]),
		"owner":      coalesce(str(skill["owner"]), "未指定"),
		"references": 0, "updatedAt": "尚未调用",
	}
	s.Store.SkillHealth = append(s.Store.SkillHealth, item)
	return item
}

// recordSkillInvocationLocked updates SkillHealth + gov events + audit after a real execution.
// Caller must hold Store.Lock.
func (s *Service) recordSkillInvocationLocked(ws string, skill map[string]any, durationMs int, ok bool, actor, source string) {
	if skill == nil || str(skill["id"]) == "" {
		return
	}
	if actor == "" {
		actor = "系统"
	}
	if source == "" {
		source = "执行技能"
	}
	h := s.ensureSkillHealthLocked(skill)
	calls := intFrom(h["calls24h"]) + 1
	succ := intFrom(h["successCount24h"])
	if ok {
		succ++
	}
	h["calls24h"] = calls
	h["successCount24h"] = succ
	rate := 100.0
	if calls > 0 {
		rate = 100.0 * float64(succ) / float64(calls)
	}
	h["successRate"] = round2(rate)
	h["errorRate"] = round2(100.0 - rate)
	if durationMs < 0 {
		durationMs = 0
	}
	// Lightweight latency tracker: keep observed max as P95 proxy for the 24h window.
	if durationMs > intFrom(h["p95Ms"]) {
		h["p95Ms"] = durationMs
	}
	h["updatedAt"] = "刚刚"
	h["name"] = skill["name"]
	h["kind"] = skill["kind"]
	if str(skill["lifecycleStatus"]) == "quarantined" {
		h["status"] = "quarantined"
	} else if floatFrom(h["errorRate"]) >= 35 && calls >= 3 {
		h["status"] = "attention"
	} else if str(h["status"]) == "paused" {
		// keep paused
	} else {
		h["status"] = "healthy"
	}
	result := "success"
	if !ok {
		result = "failed"
	}
	s.appendSkillGovEventLocked(ws, str(skill["name"]), "call", source, actor, result)
	s.Store.AppendAudit(ws, actor, "执行技能", str(skill["name"]), result,
		fmt.Sprintf("source=%s;durationMs=%d", source, durationMs))
	s.bumpSkillTrendLocked(ws, durationMs, ok)
}

func (s *Service) recordSkillInvocation(ws string, skill map[string]any, durationMs int, ok bool, actor, source string) {
	s.recordSkillInvocationWithRequest(nil, ws, skill, durationMs, ok, actor, source)
}

func (s *Service) recordSkillInvocationWithRequest(r *http.Request, ws string, skill map[string]any, durationMs int, ok bool, actor, source string) {
	if skill == nil {
		return
	}
	s.Store.Lock()
	s.recordSkillInvocationLocked(ws, skill, durationMs, ok, actor, source)
	s.Store.Unlock()
	s.persistSkillHealth()
}

func defaultSkillTrendBuckets() []map[string]any {
	return []map[string]any{
		{"time": "00:00", "calls": 0, "fails": 0, "errorRate": 0, "p95": 0},
		{"time": "04:00", "calls": 0, "fails": 0, "errorRate": 0, "p95": 0},
		{"time": "08:00", "calls": 0, "fails": 0, "errorRate": 0, "p95": 0},
		{"time": "12:00", "calls": 0, "fails": 0, "errorRate": 0, "p95": 0},
		{"time": "16:00", "calls": 0, "fails": 0, "errorRate": 0, "p95": 0},
		{"time": "20:00", "calls": 0, "fails": 0, "errorRate": 0, "p95": 0},
	}
}

func (s *Service) skillTrendBucketsLocked(ws string) []map[string]any {
	byWS := s.skillExtraMap("trendByWorkspace")
	raw := knowledgeSliceMaps(byWS[ws])
	if len(raw) == 0 {
		raw = defaultSkillTrendBuckets()
		byWS[ws] = raw
		return raw
	}
	// Ensure canonical 6 slots exist.
	index := map[string]map[string]any{}
	for _, b := range raw {
		index[str(b["time"])] = b
	}
	out := defaultSkillTrendBuckets()
	for i, b := range out {
		if prev, ok := index[str(b["time"])]; ok {
			out[i] = prev
		}
	}
	byWS[ws] = out
	return out
}

func (s *Service) bumpSkillTrendLocked(ws string, durationMs int, ok bool) {
	buckets := s.skillTrendBucketsLocked(ws)
	slot := (time.Now().Hour() / 4) * 4
	key := fmt.Sprintf("%02d:00", slot)
	for _, b := range buckets {
		if str(b["time"]) != key {
			continue
		}
		calls := intFrom(b["calls"]) + 1
		fails := intFrom(b["fails"])
		if !ok {
			fails++
		}
		b["calls"] = calls
		b["fails"] = fails
		if calls > 0 {
			b["errorRate"] = round2(100.0 * float64(fails) / float64(calls))
		}
		if durationMs > intFrom(b["p95"]) {
			b["p95"] = durationMs
		}
		return
	}
}

func (s *Service) listSkills(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillRead(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, sk := range s.Store.Skills {
		if str(sk["workspaceId"]) == ws {
			out = append(out, s.normalizeSkillItem(sk))
		}
	}
	return out, nil
}

func (s *Service) listSkillsAligned(r *http.Request) (any, error) {
	return s.listSkills(r)
}

func (s *Service) createSkill(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	desc := strings.TrimSpace(str(body["description"]))
	if name == "" || desc == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "技能名称和说明不能为空")
	}
	risk := normalizeRiskLevel(body["riskLevel"])
	ws := s.WorkspaceID(r)
	item := map[string]any{
		"id": s.Store.ID("sk"), "workspaceId": ws, "ownerId": id.ID, "owner": id.Name,
		"name": name, "kind": coalesce(str(body["kind"]), "skill"), "description": desc,
		"version": coalesce(str(body["version"]), "0.1.0"),
		"status":  ternary(risk == "high", "beta", "installed"),
		"rating":  0, "installCount": 0, "riskLevel": risk,
		"cacheable":       boolFrom(body["cacheable"]),
		"lifecycleStatus": ternary(risk == "high", "pending_approval", "enabled"),
		"source":          "import", "environment": "sandbox", "classification": "internal",
		"lastVerifiedAt": "刚刚", "team": "当前工作区",
	}
	s.Store.Lock()
	s.Store.Skills = append([]map[string]any{item}, s.Store.Skills...)
	s.ensureSkillHealthLocked(item)
	s.Store.AppendAudit(ws, id.Name, "创建技能", name, "success", "")
	s.Store.Unlock()
	s.persistSkills()
	return s.normalizeSkillItem(item), nil
}

func ternary(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}

func boolFrom(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return t == "true" || t == "1"
	default:
		return false
	}
}

func (s *Service) importSkills(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	raw, _ := body["items"].([]any)
	if len(raw) == 0 {
		return nil, apperr.BadReq(apperr.BadRequest, "未识别到可导入的技能")
	}
	ws := s.WorkspaceID(r)
	created := make([]map[string]any, 0, len(raw))
	s.Store.Lock()
	for _, x := range raw {
		m, ok := x.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(str(m["name"]))
		if name == "" {
			continue
		}
		risk := normalizeRiskLevel(m["riskLevel"])
		item := map[string]any{
			"id": s.Store.ID("sk"), "workspaceId": ws, "ownerId": id.ID, "owner": id.Name,
			"name": name, "kind": coalesce(str(m["kind"]), "skill"),
			"description": coalesce(strings.TrimSpace(str(m["description"])), "导入技能 · "+name),
			"version":     coalesce(str(m["version"]), "0.1.0"),
			"status":      ternary(risk == "high", "beta", "installed"),
			"rating":      0, "installCount": 0, "riskLevel": risk,
			"cacheable":       boolFrom(m["cacheable"]),
			"lifecycleStatus": ternary(risk == "high", "pending_approval", "enabled"),
			"source":          "import", "environment": "sandbox", "classification": "internal",
			"lastVerifiedAt": "刚刚", "team": "当前工作区",
		}
		s.Store.Skills = append([]map[string]any{item}, s.Store.Skills...)
		s.ensureSkillHealthLocked(item)
		s.Store.SkillIntegrations = append([]map[string]any{{
			"id": s.Store.ID("si"), "workspaceId": ws, "name": name, "type": item["kind"],
			"skillId":     str(item["id"]),
			"environment": "test", "status": "validating", "owner": id.Name,
			"endpoint":       "registry://import/" + name + ":" + str(item["version"]),
			"credentialRef":  "vault://registries/import-reader",
			"lastVerifiedAt": "刚刚", "health": "unknown", "discoveredCapabilities": 0,
			"writeApprovalRequired": risk == "high",
			"allowedEgress":         []string{"registry.internal.example.com"},
		}}, s.Store.SkillIntegrations...)
		created = append(created, item)
	}
	if len(created) == 0 {
		s.Store.Unlock()
		return nil, apperr.BadReq(apperr.BadRequest, "未识别到可导入的技能")
	}
	s.Store.AppendAudit(ws, id.Name, "批量导入技能", strconv.Itoa(len(created))+" 项", "success", "")
	s.Store.Unlock()
	// 在 Lock 外 normalize：normalizeSkillItem 内部 RLock，否则同 goroutine 自死锁。
	normalized := make([]map[string]any, 0, len(created))
	for _, item := range created {
		normalized = append(normalized, s.normalizeSkillItem(item))
	}
	s.persistSkills()
	return normalized, nil
}
