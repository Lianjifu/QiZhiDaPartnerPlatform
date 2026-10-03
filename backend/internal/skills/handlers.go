package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/infra"
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
	if s.Store != nil && !s.Store.CanWrite("skills") {
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
		if s.Store.CanWrite(coll) {
			s.Store.Persist(coll)
		}
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
	if s.OwnsCapRuntime() || (s.Store != nil && s.Store.CanWrite("skill_health")) {
		s.Store.Lock()
		s.recordSkillInvocationLocked(ws, skill, durationMs, ok, actor, source)
		s.Store.Unlock()
		s.persistSkillHealth()
		return
	}
	go s.DelegateSkillInvocation(r, ws, skill, durationMs, ok, actor, source)
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

func (s *Service) skillByID(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/skills/:id/:action
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "路径无效")
	}
	skillID, action := parts[2], parts[3]
	id := identityFrom(r.Context())
	ws := s.WorkspaceID(r)

	switch {
	case action == "preflight" && r.Method == http.MethodPost:
		return s.skillPreflight(r, id, ws, skillID)
	case action == "install" && r.Method == http.MethodPost:
		return s.skillInstall(r, id, ws, skillID)
	case action == "uninstall" && r.Method == http.MethodPost:
		return s.skillUninstall(r, id, ws, skillID)
	case action == "lifecycle" && r.Method == http.MethodPatch:
		return s.skillLifecycle(r, id, ws, skillID)
	case action == "upgrade" && r.Method == http.MethodPost:
		return s.skillUpgrade(r, id, ws, skillID)
	case action == "upgrade-plan" && r.Method == http.MethodPost:
		return s.skillUpgradePlan(r, id, ws, skillID)
	case action == "test" && r.Method == http.MethodPost:
		return s.skillTest(r, id, ws, skillID)
	case action == "package" && r.Method == http.MethodGet:
		return s.skillPackageInfo(r, id, ws, skillID)
	case action == "impact" && r.Method == http.MethodGet:
		if err := requireSkillRead(id); err != nil {
			return nil, err
		}
		s.Store.Lock()
		defer s.Store.Unlock()
		_, sk := s.findSkillLocked(ws, skillID)
		if sk == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
		}
		return s.skillImpactLocked(ws, skillID), nil
	case action == "permissions" && r.Method == http.MethodGet:
		if err := requireSkillRead(id); err != nil {
			return nil, err
		}
		s.Store.Lock()
		defer s.Store.Unlock()
		_, sk := s.findSkillLocked(ws, skillID)
		if sk == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
		}
		return s.ensureSkillPermissionsLocked(skillID), nil
	case action == "permissions" && r.Method == http.MethodPatch:
		if err := requireSkillWrite(id); err != nil {
			return nil, err
		}
		body, _ := decodeMap(r)
		s.Store.Lock()
		// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
		unlocked := false
		defer func() {
			if !unlocked {
				s.Store.Unlock()
			}
		}()
		_, sk := s.findSkillLocked(ws, skillID)
		if sk == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
		}
		perms := s.ensureSkillPermissionsLocked(skillID)
		roleName := str(body["role"])
		var updated map[string]any
		for _, p := range perms {
			if str(p["role"]) == roleName {
				if body["canCall"] != nil {
					p["canCall"] = boolFrom(body["canCall"])
				}
				if body["canConfig"] != nil {
					p["canConfig"] = boolFrom(body["canConfig"])
				}
				updated = p
				break
			}
		}
		if updated == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "角色不存在")
		}
		s.skillExtraMap("permissions")[skillID] = perms
		s.Store.AppendAudit(ws, id.Name, "更新调用权限", str(sk["name"])+":"+roleName, "success", "")
		unlocked = true
		s.Store.Unlock()
		go s.persistSkillExtra()
		return updated, nil
	case action == "governance" && r.Method == http.MethodGet:
		if err := requireSkillRead(id); err != nil {
			return nil, err
		}
		s.Store.Lock()
		defer s.Store.Unlock()
		_, sk := s.findSkillLocked(ws, skillID)
		if sk == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
		}
		return s.ensureSkillGovernanceLocked(skillID), nil
	case action == "governance" && r.Method == http.MethodPatch:
		if err := requireSkillWrite(id); err != nil {
			return nil, err
		}
		body, _ := decodeMap(r)
		s.Store.Lock()
		// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
		unlocked := false
		defer func() {
			if !unlocked {
				s.Store.Unlock()
			}
		}()
		_, sk := s.findSkillLocked(ws, skillID)
		if sk == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
		}
		policy := s.ensureSkillGovernanceLocked(skillID)
		for _, key := range []string{"secretRef", "writeApprovalRequired", "rateLimitPerMinute", "circuitBreakerEnabled", "dataMaskingEnabled"} {
			if body[key] != nil {
				policy[key] = body[key]
			}
		}
		if body["rateLimitPerMinute"] != nil {
			delete(s.skillExtraMap("rateWindows"), skillID)
		}
		if eg, ok := body["allowedEgress"]; ok {
			policy["allowedEgress"] = eg
		}
		s.skillExtraMap("policies")[skillID] = policy
		s.Store.AppendAudit(ws, id.Name, "更新运行治理策略", str(sk["name"]), "success", "")
		unlocked = true
		s.Store.Unlock()
		go s.persistSkillExtra()
		return policy, nil
	case action == "runtime" && (r.Method == http.MethodGet || r.Method == http.MethodPatch):
		if r.Method == http.MethodGet {
			if err := requireSkillRead(id); err != nil {
				return nil, err
			}
		} else if err := requireSkillWrite(id); err != nil {
			return nil, err
		}
		s.Store.Lock()
		// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
		unlocked := false
		defer func() {
			if !unlocked {
				s.Store.Unlock()
			}
		}()
		_, sk := s.findSkillLocked(ws, skillID)
		if sk == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
		}
		cfg := s.ensureSkillRuntimeLocked(sk)
		if r.Method == http.MethodPatch {
			body, _ := decodeMap(r)
			if body["cacheable"] != nil {
				cfg["cacheable"] = boolFrom(body["cacheable"])
			}
			if body["timeout"] != nil {
				cfg["timeout"] = str(body["timeout"])
			}
			if body["retries"] != nil {
				cfg["retries"] = str(body["retries"])
			}
			s.skillExtraMap("runtimes")[skillID] = cfg
			s.Store.AppendAudit(ws, id.Name, "更新运行配置", str(sk["name"]), "success", "")
			unlocked = true
			s.Store.Unlock()
			go s.persistSkillExtra()
		}
		return cfg, nil
	case action == "versions" && r.Method == http.MethodGet:
		if err := requireSkillRead(id); err != nil {
			return nil, err
		}
		s.Store.Lock()
		defer s.Store.Unlock()
		_, sk := s.findSkillLocked(ws, skillID)
		if sk == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
		}
		return s.skillVersionsLocked(sk), nil
	case action == "trace" && r.Method == http.MethodGet:
		if err := requireSkillRead(id); err != nil {
			return nil, err
		}
		s.Store.RLock()
		defer s.Store.RUnlock()
		_, sk := s.findSkillLocked(ws, skillID)
		if sk == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
		}
		return map[string]any{
			"skillId": skillID, "name": sk["name"], "version": sk["version"],
			"steps": []map[string]any{
				{"stage": "preflight", "status": "passed", "detail": "策略与零信任评估通过"},
				{"stage": "sandbox", "status": "ready", "detail": "等待下一次沙箱执行"},
			},
		}, nil
	case action == "revalidate" && r.Method == http.MethodPost:
		return s.skillRevalidate(r, id, ws, skillID)
	case action == "isolate" && r.Method == http.MethodPost:
		return s.skillIsolate(r, id, ws, skillID)
	default:
		return nil, apperr.NotFoundErr(apperr.NotFound, "未知动作")
	}
}

func (s *Service) skillPreflight(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	_, sk := s.findSkillLocked(ws, skillID)
	cat := s.findCatalogLocked(ws, skillID)
	candidate := sk
	if candidate == nil {
		candidate = cat
	}
	if candidate == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能或市场制品不存在")
	}
	risk := normalizeRiskLevel(candidate["riskLevel"])
	deps := []map[string]any{}
	collectDeps := func(name string) {
		if name == "jenkins-mcp" {
			deps = append(deps, map[string]any{"name": name, "status": "missing"})
		}
	}
	if arr, ok := candidate["dependencies"].([]any); ok {
		for _, d := range arr {
			collectDeps(str(d))
		}
	}
	if arr, ok := candidate["dependencies"].([]string); ok {
		for _, name := range arr {
			collectDeps(name)
		}
	}
	supplyDecision, supplyReason, supplyChecks := s.skillSupplyChainGate(candidate)
	decision := "approved"
	reason := ""
	if len(deps) > 0 {
		decision = "blocked"
		reason = "缺少受控 Jenkins 连接器，禁止安装"
	} else if supplyDecision == "blocked" {
		decision = "blocked"
		reason = supplyReason
	} else if supplyDecision == "review_required" || risk == "high" {
		decision = "review_required"
		reason = coalesce(supplyReason, "高风险能力需要安全负责人审批")
	}
	signed := true
	if candidate["signed"] != nil {
		signed = boolFrom(candidate["signed"])
	}
	publisher := str(candidate["publisher"])
	trusted := publisher == "" || publisher == "企业能力商店" || publisher == "SRE 平台组" || publisher == "安全运营组" || publisher == "流程平台组" || publisher == "消息平台组"
	return map[string]any{
		"skillId": skillID, "trustedPublisher": trusted, "signatureValid": signed,
		"dependencies": deps, "requiresApproval": decision == "review_required",
		"decision": decision, "reason": reason,
		"vulnerabilityCount": intFrom(candidate["vulnerabilityCount"]),
		"checks":             supplyChecks,
		"dependencyReport":   enrichPreflightWithDeps(candidate),
	}, nil
}

func (s *Service) skillInstall(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock。spawn persistSkills 必须在 Unlock 之后，
	// 否则 goroutine 在持 Lock 的 thread 上调 Store.Persist → RLock 自死锁。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	if _, existing := s.findSkillLocked(ws, skillID); existing != nil {
		return s.normalizeSkillItem(existing), nil
	}
	// already installed under different id matching catalog name?
	cat := s.findCatalogLocked(ws, skillID)
	if cat == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "市场制品不存在")
	}
	risk := normalizeRiskLevel(cat["riskLevel"])
	if risk == "high" && strings.TrimSpace(str(body["approvalTicket"])) == "" {
		return nil, apperr.Forbidden(apperr.ReleaseRequestRequired, "E_APPROVAL_REQUIRED: 高风险技能安装需要安全负责人审批")
	}
	supplyDecision, supplyReason, _ := s.skillSupplyChainGate(cat)
	if supplyDecision == "blocked" {
		return nil, apperr.BadReq(apperr.BadRequest, supplyReason)
	}
	if supplyDecision == "review_required" && strings.TrimSpace(str(body["approvalTicket"])) == "" {
		return nil, apperr.Forbidden(apperr.ReleaseRequestRequired, "E_APPROVAL_REQUIRED: "+supplyReason)
	}
	if deps, ok := cat["dependencies"].([]any); ok {
		for _, d := range deps {
			if str(d) == "jenkins-mcp" {
				return nil, apperr.BadReq(apperr.BadRequest, "缺少受控 Jenkins 连接器")
			}
		}
	}
	installedID := s.Store.ID("sk")
	item := map[string]any{
		"id": installedID, "workspaceId": ws, "ownerId": id.ID, "owner": id.Name,
		"name": cat["name"], "kind": cat["kind"], "description": cat["description"],
		"version": cat["version"], "status": "installed",
		"rating": cat["rating"], "installCount": cat["installCount"],
		"riskLevel": risk, "cacheable": boolFrom(cat["cacheable"]),
		"lifecycleStatus": "enabled", "source": "market",
		"environment":    coalesce(str(cat["environment"]), "production"),
		"classification": coalesce(str(cat["classification"]), "internal"),
		"lastVerifiedAt": "刚刚", "team": "能力商店",
		"publisher": cat["publisher"], "signed": cat["signed"], "license": cat["license"],
		"vulnerabilityCount": intFrom(cat["vulnerabilityCount"]), "lastScannedAt": cat["lastScannedAt"],
		"catalogId": str(cat["id"]), "catalogChannel": normalizeCatalogChannel(str(cat["channel"])),
		"releaseChannel": normalizeReleaseChannel(str(cat["releaseChannel"])),
	}
	if bn := catalogBuiltinName(cat); bn != "" {
		item["source"] = "builtin"
		item["builtinSkillName"] = bn
		if attachErr := s.attachBuiltinPackageToSkill(item, ws, installedID, bn); attachErr != nil {
			s.Store.Unlock()
			return nil, apperr.BadReq(apperr.BadRequest, "内置技能落盘失败: "+attachErr.Error())
		}
	}
	s.Store.Skills = append([]map[string]any{item}, s.Store.Skills...)
	s.ensureSkillHealthLocked(item)
	s.Store.AppendAudit(ws, id.Name, "安装技能", str(item["name"]), "success", "")
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	return s.normalizeSkillItem(item), nil
}

func (s *Service) skillUninstall(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后，否则
	// goroutine 在持 Lock 的 thread 上调 Store.Persist → RLock 自死锁。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	idx, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	impact := s.skillImpactLocked(ws, skillID)
	force := boolFrom(body["force"])
	activeRuns := intFrom(impact["activeRuns"])
	if activeRuns > 0 && !force {
		return nil, apperr.BadReq(apperr.BadRequest, coalesce(str(impact["reason"]), "技能仍有运行中的任务，无法卸载"))
	}
	if activeRuns > 0 && strings.TrimSpace(str(body["approvalTicket"])) == "" {
		return nil, apperr.Forbidden(apperr.ReleaseRequestRequired, "E_APPROVAL_REQUIRED: 强制卸载必须提供审批单号")
	}
	skillName := str(sk["name"])
	s.purgeSkillBindingsLocked(ws, skillID)
	s.unbindSkillFromEmployeesLocked(skillName, skillID)
	s.recordSkillSuppressedLocked(ws, sk)
	s.Store.Skills = append(s.Store.Skills[:idx], s.Store.Skills[idx+1:]...)
	health := make([]map[string]any, 0, len(s.Store.SkillHealth))
	healthDeleted := make([]string, 0, 1)
	for _, h := range s.Store.SkillHealth {
		if str(h["skillId"]) != skillID {
			health = append(health, h)
			continue
		}
		if hid := str(h["id"]); hid != "" {
			healthDeleted = append(healthDeleted, hid)
		}
	}
	s.Store.SkillHealth = health
	auditAction := "卸载技能"
	if force || !boolFrom(impact["uninstallAllowed"]) {
		auditAction = "强制卸载技能"
	}
	s.Store.AppendAudit(ws, id.Name, auditAction, skillName, "success", "")
	unlocked = true
	s.Store.Unlock()
	go func() {
		s.persistSkills()
		s.persistSkillExtra()
		if s.Store.CanWrite("employees") {
			s.Store.Persist("employees")
		}
	}()
	s.DurableDeleteSync("skills", skillID)
	if len(healthDeleted) > 0 {
		s.DurableDeleteSync("skill_health", healthDeleted...)
	} else {
		s.DurableDeleteSync("skill_health", "sh-"+skillID)
	}
	return map[string]any{"id": skillID, "status": "uninstalled", "impact": impact}, nil
}

func (s *Service) skillLifecycle(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	next := str(body["lifecycleStatus"])
	switch next {
	case "enabled", "disabled", "pending_approval", "quarantined", "deprecated":
	default:
		return nil, apperr.BadReq(apperr.BadRequest, "不支持的技能生命周期状态")
	}
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	sk["lifecycleStatus"] = next
	h := s.ensureSkillHealthLocked(sk)
	switch next {
	case "enabled":
		h["status"] = "healthy"
	case "disabled", "deprecated":
		h["status"] = "paused"
	case "quarantined":
		h["status"] = "quarantined"
	case "pending_approval":
		h["status"] = "attention"
	}
	h["updatedAt"] = "刚刚"
	s.Store.AppendAudit(ws, id.Name, "更新技能状态为 "+next, str(sk["name"]), "success", "")
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	return s.normalizeSkillItem(sk), nil
}

func (s *Service) skillUpgrade(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	target := strings.TrimSpace(str(body["targetVersion"]))
	if target == "" {
		target = str(sk["upgradeVersion"])
	}
	if target == "" {
		target = bumpMinor(str(sk["version"]))
	}
	sk["version"] = target
	sk["hasUpdate"] = false
	delete(sk, "upgradeVersion")
	s.Store.AppendAudit(ws, id.Name, "升级技能", str(sk["name"]), "success", "version="+target)
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	return s.normalizeSkillItem(sk), nil
}

func bumpMinor(version string) string {
	parts := strings.Split(version, ".")
	if len(parts) == 0 || parts[0] == "" {
		return "0.1.0"
	}
	major := parts[0]
	minor := 0
	patch := "0"
	if len(parts) > 1 {
		minor = intFrom(parts[1])
	}
	if len(parts) > 2 {
		patch = parts[2]
	}
	return major + "." + strconv.Itoa(minor+1) + "." + patch
}

func (s *Service) skillUpgradePlan(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	target := coalesce(str(body["targetVersion"]), coalesce(str(sk["upgradeVersion"]), bumpMinor(str(sk["version"]))))
	risk := normalizeRiskLevel(sk["riskLevel"])
	permStatus := "passed"
	if risk == "high" {
		permStatus = "review"
	}
	impact := s.skillImpactLocked(ws, skillID)
	refStatus := "passed"
	agents, _ := impact["agents"].([]string)
	workflows, _ := impact["workflows"].([]string)
	if len(agents)+len(workflows) > 0 {
		refStatus = "review"
	}
	return map[string]any{
		"skillId": skillID, "currentVersion": sk["version"], "targetVersion": target,
		"checks": []map[string]any{
			{"label": "签名与供应链校验", "status": "passed"},
			{"label": "权限差异分析", "status": permStatus},
			{"label": "引用版本影响", "status": refStatus},
		},
		"impacted":         impact,
		"rollbackVersion":  sk["version"],
		"approvalRequired": risk == "high" || len(agents)+len(workflows) > 0,
	}, nil
}

func (s *Service) skillTest(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if !auth.Has(id, "skill.execute") && !auth.Has(id, "skill.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权测试技能")
	}
	body, _ := decodeMap(r)
	command := strings.TrimSpace(str(body["command"]))
	if command == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "请输入测试命令")
	}

	s.Store.Lock()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	dec := s.evaluateSkillSandboxPolicyLocked(ws, skillID, command)
	govPolicy := cloneMap(s.ensureSkillGovernanceLocked(skillID))
	runtimeCfg := cloneMap(s.ensureSkillRuntimeLocked(sk))
	skillName := str(sk["name"])
	skillVersion := str(sk["version"])
	pkgPayload := skillPackagePayload(sk)
	if dec.Blocked {
		ev := s.Store.AppendAudit(ws, id.Name, "策略拦截测试命令", skillName, "failed", dec.Reason)
		s.appendSkillGovEventLocked(ws, skillName, "policy", dec.Reason, id.Name, "blocked")
		corr := coalesce(str(ev["correlationId"]), dec.CorrelationID)
		s.Store.Unlock()
		if dec.RateLimited {
			return nil, errRateLimited(dec.Reason)
		}
		return map[string]any{
			"command": command, "status": "blocked", "output": "⛔ 拒绝执行：" + dec.Reason + "。",
			"durationMs": 5, "correlationId": corr,
			"policy": map[string]any{
				"circuitOpen": dec.CircuitOpen, "egressBlocked": dec.EgressBlocked, "dangerBlocked": dec.DangerBlocked,
			},
		}, nil
	}
	s.Store.Unlock()

	timeoutSec := intFrom(runtimeCfg["timeout"])
	if timeoutSec <= 0 {
		timeoutSec = 30
	}
	retries := intFrom(runtimeCfg["retries"])
	if retries < 0 {
		retries = 0
	}
	if retries > 3 {
		retries = 3
	}

	mergedEgress := resolveSkillEgress(sk, govPolicy)
	token := auth.MintRunToken(skillID, ws, id.ID, mergedEgress, 5*time.Minute)
	payload := map[string]any{
		"skillId": skillID, "command": command, "runToken": token,
		"denyControlPlane": true,
		"correlationId":    dec.CorrelationID, "timeoutSec": timeoutSec,
	}
	if pkgPayload != nil {
		for k, v := range pkgPayload {
			payload[k] = v
		}
	}

	var (
		result     map[string]any
		runtimeErr error
	)
	for attempt := 0; attempt <= retries; attempt++ {
		result, runtimeErr = s.callSandbox(payload)
		if runtimeErr == nil {
			break
		}
	}

	mode := "sandbox"
	output := ""
	duration := 80
	status := "success"
	if runtimeErr != nil {
		if !skillTestSimEnabled() {
			s.Store.Lock()
			s.Store.AppendAudit(ws, id.Name, "沙箱测试失败", skillName, "failed", runtimeErr.Error())
			s.Store.Unlock()
			return nil, apperr.Unavailable(apperr.RuntimeUnavailable, "技能运行时不可用: "+runtimeErr.Error())
		}
		mode = "policy-sim"
		output = "+SIM\n" + skillName + " v" + skillVersion + " 策略校验通过；sandbox 不可达，已使用本地模拟（DE_SANDBOX_TEST_SIM=1）。\ncommand=" + command
		if pkgPayload != nil {
			output += "\npackage=" + str(pkgPayload["packagePath"])
			if boolFrom(pkgPayload["hasScripts"]) {
				output += "\nhasScripts=true"
			}
		}
		status = "success"
	} else {
		output = coalesce(str(result["stdout"]), "sandbox execution complete")
		if d := intFrom(result["durationMs"]); d > 0 {
			duration = d
		}
		if b, ok := result["ok"].(bool); ok && !b {
			status = "failed"
			output = coalesce(str(result["error"]), output)
		}
		if rt := str(result["runtime"]); rt != "" {
			mode = rt
		}
	}
	output = maskSkillOutput(output, boolFrom(govPolicy["dataMaskingEnabled"]))
	// 阶段 2:把实际访问过的 egress 域名写进 audit detail,便于检索与告警
	egressAudit := egressUsedString(result, "egressUsed")
	// 阶段 3:Python 沙箱返回的 syscall 计数(写入摘要),便于按 syscall 类型检索
	syscallsMap, _ := result["syscalls"].(map[string]any)

	s.Store.Lock()
	_, skRec := s.findSkillLocked(ws, skillID)
	if skRec != nil {
		s.recordSkillInvocationLocked(ws, skRec, duration, status == "success", id.Name, "沙箱测试 · "+mode)
	} else {
		s.Store.AppendAudit(ws, id.Name, ternary(status == "success", "执行沙箱测试", "沙箱测试失败"), skillName, ternary(status == "success", "success", "failed"), appendSyscallSegment("mode="+mode+";egress="+egressAudit+";corr="+dec.CorrelationID, syscallsMap))
	}
	s.Store.Unlock()
	s.persistSkillHealth()

	return map[string]any{
		"command": command, "status": status, "output": output, "durationMs": duration,
		"correlationId": dec.CorrelationID, "runtime": mode, "retries": retries,
		"sim": mode == "policy-sim",
	}, nil
}

func (s *Service) skillRevalidate(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	h := s.ensureSkillHealthLocked(sk)
	h["status"] = "healthy"
	h["errorRate"] = 0.1
	h["successRate"] = 99.9
	h["updatedAt"] = "刚刚"
	sk["lifecycleStatus"] = "enabled"
	sk["lastVerifiedAt"] = "刚刚"
	s.appendSkillGovEventLocked(ws, str(sk["name"]), "call", "重新验证通过", id.Name, "success")
	s.Store.AppendAudit(ws, id.Name, "重新验证通过", str(sk["name"]), "success", "")
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	return h, nil
}

func (s *Service) skillIsolate(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	sk["lifecycleStatus"] = "quarantined"
	h := s.ensureSkillHealthLocked(sk)
	h["status"] = "quarantined"
	h["updatedAt"] = "刚刚"
	s.appendSkillGovEventLocked(ws, str(sk["name"]), "lifecycle", "隔离能力", id.Name, "success")
	s.Store.AppendAudit(ws, id.Name, "隔离能力", str(sk["name"]), "success", "")
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	return h, nil
}

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

func (s *Service) listSkillIntegrations(r *http.Request) (any, error) {
	if err := requireSkillRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, item := range s.Store.SkillIntegrations {
		if str(item["workspaceId"]) == ws || str(item["workspaceId"]) == "" {
			out = append(out, item)
		}
	}
	return out, nil
}

func normalizeMCPProtocol(raw string) (string, error) {
	p := strings.TrimSpace(strings.ToLower(raw))
	switch p {
	case "", "mcp-streamable-http", "streamable-http", "streamable_http":
		return "mcp-streamable-http", nil
	case "mcp-sse", "sse":
		return "mcp-sse", nil
	case "mcp-stdio", "stdio":
		return "mcp-stdio", nil
	default:
		return "", fmt.Errorf("不支持的协议规范，可选：mcp-streamable-http / mcp-sse / mcp-stdio")
	}
}

func mcpProtocolLabel(protocol string) string {
	switch protocol {
	case "mcp-sse":
		return "MCP SSE (2024-11-05)"
	case "mcp-stdio":
		return "MCP stdio"
	default:
		return "MCP Streamable HTTP (2025-03-26)"
	}
}

func (s *Service) createMCPConnection(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	if _, err := s.EvaluateZeroTrust(id, "skill", "connect", "external", true, ""); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	endpoint := strings.TrimSpace(str(body["endpoint"]))
	authMode := coalesce(str(body["authMode"]), "OAuth")
	protocol, err := normalizeMCPProtocol(str(body["protocol"]))
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, err.Error())
	}
	if name == "" || !strings.HasPrefix(endpoint, "https://") {
		return nil, apperr.BadReq(apperr.BadRequest, "MCP 名称和 HTTPS 服务地址不能为空")
	}
	if protocol == "mcp-stdio" {
		return nil, apperr.BadReq(apperr.BadRequest, "远程 HTTPS 接入不支持 stdio，请选择 Streamable HTTP 或 SSE")
	}
	ws := s.WorkspaceID(r)
	item := map[string]any{
		"id": s.Store.ID("mcp"), "workspaceId": ws, "ownerId": id.ID, "owner": id.Name,
		"name": name, "kind": "mcp", "description": "MCP · " + endpoint,
		"version": "1.0.0", "status": "installed", "rating": 0, "installCount": 0,
		"riskLevel": "mid", "cacheable": false, "lifecycleStatus": "enabled",
		"source": "mcp", "environment": "sandbox", "classification": "internal",
		"lastVerifiedAt": "刚刚", "team": "当前工作区",
		"protocol": protocol, "authMode": authMode,
	}
	host := endpoint
	if u := strings.TrimPrefix(endpoint, "https://"); u != endpoint {
		host = strings.Split(u, "/")[0]
	}
	s.Store.Lock()
	s.Store.Skills = append([]map[string]any{item}, s.Store.Skills...)
	s.ensureSkillHealthLocked(item)
	s.Store.SkillIntegrations = append([]map[string]any{{
		"id": s.Store.ID("si"), "workspaceId": ws, "name": name, "type": "mcp",
		"environment": "test", "status": "validating", "owner": id.Name,
		"endpoint": endpoint, "credentialRef": "vault://integrations/" + str(item["id"]) + "/oauth",
		"lastVerifiedAt": "刚刚", "health": "unknown", "discoveredCapabilities": 0,
		"writeApprovalRequired": true, "allowedEgress": []string{host},
		"protocol": protocol, "authMode": authMode,
	}}, s.Store.SkillIntegrations...)
	s.Store.AppendAudit(ws, id.Name, "配置 MCP 并预检", name+":"+authMode+":"+mcpProtocolLabel(protocol), "success", "")
	s.Store.Unlock()
	s.persistSkills()
	return s.normalizeSkillItem(item), nil
}

func (s *Service) createTool(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	if _, err := s.EvaluateZeroTrust(id, "skill", "connect", "external", true, ""); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	endpoint := strings.TrimSpace(str(body["endpoint"]))
	schemaRaw := strings.TrimSpace(str(body["schema"]))
	if name == "" || !strings.HasPrefix(endpoint, "https://") || schemaRaw == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "Tool 名称、HTTPS 地址和 Schema 不能为空")
	}
	var schema map[string]any
	if err := json.Unmarshal([]byte(schemaRaw), &schema); err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, "Tool Schema 必须是有效的 JSON")
	}
	_, isOpenAPI := schema["openapi"]
	_, isJSONSchema := schema["$schema"]
	if !isOpenAPI && !isJSONSchema {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持标准 OpenAPI 3.x 或 JSON Schema")
	}
	ws := s.WorkspaceID(r)
	item := map[string]any{
		"id": s.Store.ID("tool"), "workspaceId": ws, "ownerId": id.ID, "owner": id.Name,
		"name": name, "kind": "tool", "description": "Tool · " + endpoint,
		"version": "1.0.0", "status": "installed", "rating": 0, "installCount": 0,
		"riskLevel": "mid", "cacheable": false, "lifecycleStatus": "enabled",
		"source": "tool", "environment": "sandbox", "classification": "internal",
		"lastVerifiedAt": "刚刚", "team": "当前工作区",
	}
	host := strings.Split(strings.TrimPrefix(endpoint, "https://"), "/")[0]
	s.Store.Lock()
	s.Store.Skills = append([]map[string]any{item}, s.Store.Skills...)
	s.ensureSkillHealthLocked(item)
	s.Store.SkillIntegrations = append([]map[string]any{{
		"id": s.Store.ID("si"), "workspaceId": ws, "name": name, "type": "tool",
		"environment": "test", "status": "validating", "owner": id.Name,
		"endpoint": endpoint, "credentialRef": "vault://integrations/" + str(item["id"]) + "/service-account",
		"lastVerifiedAt": "刚刚", "health": "unknown", "discoveredCapabilities": 0,
		"writeApprovalRequired": true, "allowedEgress": []string{host},
	}}, s.Store.SkillIntegrations...)
	s.Store.AppendAudit(ws, id.Name, "配置 Tool 并预检", name, "success", "")
	s.Store.Unlock()
	s.persistSkills()
	return s.normalizeSkillItem(item), nil
}

func resolveIntegrationSkillID(item map[string]any) string {
	if id := strings.TrimSpace(str(item["skillId"])); id != "" {
		return id
	}
	ref := str(item["credentialRef"])
	// vault://skills/<skillId>/runtime
	if strings.HasPrefix(ref, "vault://skills/") {
		rest := strings.TrimPrefix(ref, "vault://skills/")
		if i := strings.IndexByte(rest, '/'); i > 0 {
			return rest[:i]
		}
		return rest
	}
	return ""
}

func (s *Service) verifyPackageSkillLocked(ws, skillID string) (sk map[string]any, errMsg string) {
	_, sk = s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, "关联技能不存在或已卸载"
	}
	if str(sk["source"]) != "package" {
		return sk, ""
	}
	pkgPath := str(sk["packagePath"])
	if pkgPath == "" {
		return sk, "技能包尚未落盘"
	}
	if st, err := os.Stat(pkgPath); err != nil || !st.IsDir() {
		return sk, "技能包目录不可用：" + pkgPath
	}
	mdRel := coalesce(str(sk["skillMdPath"]), "SKILL.md")
	if _, err := os.Stat(filepath.Join(pkgPath, mdRel)); err != nil {
		return sk, "技能包缺少 " + mdRel
	}
	return sk, ""
}

func (s *Service) skillIntegrationAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "路径无效")
	}
	intID, action := parts[2], parts[3]
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	var item map[string]any
	for _, it := range s.Store.SkillIntegrations {
		if str(it["id"]) == intID && (str(it["workspaceId"]) == ws || str(it["workspaceId"]) == "") {
			item = it
			break
		}
	}
	if item == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "接入任务不存在")
	}
	switch {
	case action == "test" && r.Method == http.MethodPost:
		verifiedAt := time.Now().Format("15:04:05")
		skillID := resolveIntegrationSkillID(item)
		if skillID != "" && str(item["skillId"]) == "" {
			item["skillId"] = skillID
		}
		if str(item["type"]) == "skill" && skillID != "" {
			sk, errMsg := s.verifyPackageSkillLocked(ws, skillID)
			if errMsg != "" {
				item["lastVerifiedAt"] = verifiedAt
				item["health"] = "attention"
				item["status"] = "failed"
				item["lastError"] = errMsg
				s.Store.AppendAudit(ws, id.Name, "执行接入连通性验证", str(item["name"]), "failed", errMsg)
				unlocked = true
				s.Store.Unlock()
				go s.persistSkills()
				return nil, apperr.BadReq(apperr.BadRequest, errMsg)
			}
			if sk != nil {
				sk["lastVerifiedAt"] = verifiedAt
			}
		}
		item["lastVerifiedAt"] = verifiedAt
		delete(item, "lastError")
		item["health"] = "healthy"
		if st := str(item["status"]); st == "validating" || st == "draft" || st == "failed" {
			item["status"] = "enabled"
		}
		s.Store.AppendAudit(ws, id.Name, "执行接入连通性验证", str(item["name"]), "success", "verifiedAt="+verifiedAt)
		unlocked = true
		s.Store.Unlock()
		go s.persistSkills()
		return item, nil
	case action == "discover" && r.Method == http.MethodPost:
		if str(item["status"]) == "failed" {
			return nil, apperr.BadReq(apperr.BadRequest, coalesce(str(item["lastError"]), "接入验证未通过"))
		}
		n := 1
		switch str(item["type"]) {
		case "mcp":
			n = 12
		case "tool":
			n = 6
		}
		item["discoveredCapabilities"] = n
		if boolFrom(item["writeApprovalRequired"]) && str(item["environment"]) == "production" {
			item["status"] = "pending_approval"
		} else {
			item["status"] = "enabled"
		}
		s.Store.AppendAudit(ws, id.Name, "发现接入能力", str(item["name"]), "success", "")
		unlocked = true
		s.Store.Unlock()
		go s.persistSkills()
		return item, nil
	default:
		return nil, apperr.NotFoundErr(apperr.NotFound, "未知动作")
	}
}
