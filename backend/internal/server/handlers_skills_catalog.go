package server

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func normalizeCatalogChannel(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "registry", "sync":
		return "registry"
	case "promoted", "promote", "publish":
		return "promoted"
	default:
		return "builtin"
	}
}

func normalizeVisibilityScope(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "workspace", "ws":
		return "workspace"
	case "org", "organization":
		return "org"
	default:
		return "global"
	}
}

func normalizeReleaseChannel(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "beta", "preview":
		return "beta"
	default:
		return "stable"
	}
}

func catalogChannelLabel(ch string) string {
	switch normalizeCatalogChannel(ch) {
	case "registry":
		return "企业 Registry"
	case "promoted":
		return "工作区晋升"
	default:
		return "平台内置"
	}
}

func (s *Server) normalizeCatalogItem(m map[string]any) map[string]any {
	out := s.normalizeSkillItem(m)
	out["channel"] = normalizeCatalogChannel(str(out["channel"]))
	out["visibilityScope"] = normalizeVisibilityScope(str(out["visibilityScope"]))
	out["releaseChannel"] = normalizeReleaseChannel(str(out["releaseChannel"]))
	if str(out["syncedAt"]) == "" {
		if out["channel"] == "builtin" {
			out["syncedAt"] = "种子目录"
		} else {
			out["syncedAt"] = "—"
		}
	}
	out["channelLabel"] = catalogChannelLabel(str(out["channel"]))
	if out["signed"] == nil {
		out["signed"] = true
	}
	if out["vulnerabilityCount"] == nil {
		out["vulnerabilityCount"] = 0
	}
	if str(out["publisher"]) == "" {
		out["publisher"] = "企业能力商店"
	}
	if str(out["status"]) == "" {
		out["status"] = "available"
	}
	return out
}

// normalizeCatalogItemLocked is the lock-free variant for callers that
// already hold Store.Lock (the sync handler does).
func (s *Server) normalizeCatalogItemLocked(m map[string]any) map[string]any {
	out := s.normalizeSkillItemLocked(m)
	out["channel"] = normalizeCatalogChannel(str(out["channel"]))
	out["visibilityScope"] = normalizeVisibilityScope(str(out["visibilityScope"]))
	out["releaseChannel"] = normalizeReleaseChannel(str(out["releaseChannel"]))
	if str(out["syncedAt"]) == "" {
		if out["channel"] == "builtin" {
			out["syncedAt"] = "种子目录"
		} else {
			out["syncedAt"] = "—"
		}
	}
	out["channelLabel"] = catalogChannelLabel(str(out["channel"]))
	if out["signed"] == nil {
		out["signed"] = true
	}
	if out["vulnerabilityCount"] == nil {
		out["vulnerabilityCount"] = 0
	}
	if str(out["publisher"]) == "" {
		out["publisher"] = "企业能力商店"
	}
	if str(out["status"]) == "" {
		out["status"] = "available"
	}
	return out
}

func catalogVisibleToWorkspace(item map[string]any, ws string) bool {
	scope := normalizeVisibilityScope(str(item["visibilityScope"]))
	wid := str(item["workspaceId"])
	switch scope {
	case "global":
		return true
	case "org":
		// org-scoped: visible when same workspace family prefix or exact match; seed uses w1/w2/w3 as tenants
		if wid == "" || wid == ws {
			return true
		}
		// treat first char group loosely: same workspace only for demo org isolation
		return wid == ws
	default: // workspace
		return wid == "" || wid == ws
	}
}

func (s *Server) listSkillCatalog(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillRead(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	q := r.URL.Query()
	filterChannel := strings.TrimSpace(q.Get("channel"))
	filterRelease := strings.TrimSpace(q.Get("releaseChannel"))
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, item := range s.Store.SkillCatalog {
		if !catalogVisibleToWorkspace(item, ws) {
			continue
		}
		norm := s.normalizeCatalogItem(item)
		if filterChannel != "" && str(norm["channel"]) != normalizeCatalogChannel(filterChannel) {
			continue
		}
		if filterRelease != "" && str(norm["releaseChannel"]) != normalizeReleaseChannel(filterRelease) {
			continue
		}
		out = append(out, norm)
	}
	return map[string]any{
		"items": out,
		"meta": map[string]any{
			"demoNotice": "平台内置条目用于冷启动；生产来源以 Registry 同步与工作区晋升为主。",
			"channels": []map[string]any{
				{"id": "builtin", "label": catalogChannelLabel("builtin")},
				{"id": "registry", "label": catalogChannelLabel("registry")},
				{"id": "promoted", "label": catalogChannelLabel("promoted")},
			},
			"releaseChannels": []string{"stable", "beta"},
		},
	}, nil
}

func (s *Server) publishSkillToCatalog(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	skillID := strings.TrimSpace(str(body["skillId"]))
	if skillID == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "skillId 必填")
	}
	release := normalizeReleaseChannel(str(body["releaseChannel"]))
	scope := normalizeVisibilityScope(coalesce(str(body["visibilityScope"]), "workspace"))
	ticket := strings.TrimSpace(str(body["approvalTicket"]))
	ws := s.workspaceID(r)

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
		return nil, apperr.NotFoundErr(apperr.NotFound, "工作区技能不存在，无法晋升上架")
	}
	candidate := cloneMap(sk)
	if candidate["signed"] == nil {
		// builtin/market are trusted signed; import/package stay unsigned until marked
		src := str(sk["source"])
		candidate["signed"] = src == "market" || src == "builtin" || boolFrom(sk["signed"])
	}
	decision, reason, checks := s.skillSupplyChainGate(candidate)
	risk := normalizeRiskLevel(sk["riskLevel"])
	needsApproval := decision == "review_required" || risk == "high" || scope == "global" || scope == "org"
	if decision == "blocked" {
		return nil, apperr.BadReq(apperr.BadRequest, reason)
	}
	// 管理员上架免审批单；普通用户高风险/全局可见仍须审批单号。
	if needsApproval && ticket == "" && !actorIsAdmin(id) {
		return nil, apperr.Forbidden(apperr.ReleaseRequestRequired, "E_APPROVAL_REQUIRED: 晋升上架需要审批单号（高风险/全局可见/需复核）")
	}
	if id.Role != "admin" && (scope == "global" || scope == "org") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "仅管理员可将技能晋升为全局/组织可见")
	}

	name := str(sk["name"])
	version := coalesce(str(sk["version"]), "0.1.0")
	// replace same name+version+scope in catalog
	kept := make([]map[string]any, 0, len(s.Store.SkillCatalog)+1)
	removedCatalogIDs := make([]string, 0)
	for _, item := range s.Store.SkillCatalog {
		same := str(item["name"]) == name && str(item["version"]) == version &&
			normalizeVisibilityScope(str(item["visibilityScope"])) == scope
		if same && (scope == "workspace" && str(item["workspaceId"]) == ws || scope != "workspace") {
			if oid := str(item["id"]); oid != "" {
				removedCatalogIDs = append(removedCatalogIDs, oid)
			}
			continue
		}
		kept = append(kept, item)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	entry := map[string]any{
		"id": s.Store.ID("sc"), "workspaceId": ternary(scope == "workspace", ws, ternary(scope == "org", ws, "")),
		"name": name, "kind": coalesce(str(sk["kind"]), "skill"),
		"description": coalesce(str(sk["description"]), name),
		"version":     version, "status": "available",
		"rating": coalesceNum(sk["rating"], 0), "installCount": coalesceNum(sk["installCount"], 0),
		"riskLevel": risk, "cacheable": boolFrom(sk["cacheable"]),
		"publisher":             coalesce(str(sk["publisher"]), id.Name),
		"signed":                boolFrom(candidate["signed"]),
		"dependencies":          sk["dependencies"],
		"license":               coalesce(str(sk["license"]), "内部许可"),
		"lastScannedAt":         "刚刚",
		"vulnerabilityCount":    intFrom(sk["vulnerabilityCount"]),
		"supportedEnvironments": coalesceAny(sk["supportedEnvironments"], []string{"测试", "生产"}),
		"environment":           coalesce(str(sk["environment"]), "production"),
		"classification":        coalesce(str(sk["classification"]), "internal"),
		"channel":               "promoted", "channelLabel": catalogChannelLabel("promoted"),
		"syncedAt": now, "visibilityScope": scope, "releaseChannel": release,
		"sourceSkillId": skillID, "promotedBy": id.Name, "approvalTicket": ticket,
		"supplyChecks": checks,
	}
	s.Store.SkillCatalog = append([]map[string]any{entry}, kept...)
	s.Store.AppendAudit(ws, id.Name, "晋升技能上架", name+"@"+version, "success", "scope="+scope+";channel="+release+";ticket="+ticket)
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	if len(removedCatalogIDs) > 0 {
		s.Store.PersistDelete("skill_catalog", removedCatalogIDs...)
	}
	// Caller still holds Store.Lock — use the lock-free annotation path.
	return s.normalizeCatalogItemLocked(entry), nil
}

func coalesceNum(v any, def float64) float64 {
	if v == nil {
		return def
	}
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return def
	}
}

func coalesceAny(v any, def any) any {
	if v == nil {
		return def
	}
	return v
}

func (s *Server) syncSkillCatalog(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "仅管理员可触发 Registry 同步")
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	rawItems, _ := body["items"].([]any)
	// Allow empty items + registryUrl to inject a demo synced artifact (local/dev)
	if len(rawItems) == 0 {
		if strings.TrimSpace(str(body["registryUrl"])) == "" && !boolFrom(body["seedDemo"]) {
			return nil, apperr.BadReq(apperr.BadRequest, "请提供 items[] 或 seedDemo=true")
		}
		rawItems = []any{
			map[string]any{
				"name": "registry-demo-cli", "version": "1.0.0", "kind": "skill",
				"description": "从企业 Registry 同步的演示技能",
				"publisher":   "企业能力商店", "signed": true, "vulnerabilityCount": 0,
				"license": "Apache-2.0", "riskLevel": "low", "releaseChannel": "stable",
				"visibilityScope": "global", "registryRef": "oci://registry.internal/skills/registry-demo-cli:1.0.0",
			},
		}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	accepted := make([]map[string]any, 0)
	rejected := make([]map[string]any, 0)
	removedCatalogIDs := make([]string, 0)

	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	for _, x := range rawItems {
		m, ok := x.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(str(m["name"]))
		version := coalesce(str(m["version"]), "0.1.0")
		if name == "" {
			rejected = append(rejected, map[string]any{"reason": "缺少 name", "item": m})
			continue
		}
		candidate := cloneMap(m)
		if candidate["signed"] == nil {
			candidate["signed"] = false
		}
		decision, reason, checks := s.skillSupplyChainGate(candidate)
		if decision == "blocked" {
			rejected = append(rejected, map[string]any{"name": name, "version": version, "reason": reason, "checks": checks})
			continue
		}
		scope := normalizeVisibilityScope(coalesce(str(m["visibilityScope"]), "global"))
		release := normalizeReleaseChannel(str(m["releaseChannel"]))
		// upsert
		kept := make([]map[string]any, 0, len(s.Store.SkillCatalog))
		for _, item := range s.Store.SkillCatalog {
			if str(item["name"]) == name && str(item["version"]) == version &&
				normalizeCatalogChannel(str(item["channel"])) == "registry" &&
				normalizeVisibilityScope(str(item["visibilityScope"])) == scope {
				if oid := str(item["id"]); oid != "" {
					removedCatalogIDs = append(removedCatalogIDs, oid)
				}
				continue
			}
			kept = append(kept, item)
		}
		entry := map[string]any{
			"id": s.Store.ID("sc"), "workspaceId": ternary(scope == "workspace" || scope == "org", ws, ""),
			"name": name, "kind": coalesce(str(m["kind"]), "skill"),
			"description": coalesce(str(m["description"]), "Registry 同步 · "+name),
			"version":     version, "status": "available",
			"rating": coalesceNum(m["rating"], 4.0), "installCount": coalesceNum(m["installCount"], 0),
			"riskLevel": normalizeRiskLevel(m["riskLevel"]), "cacheable": boolFrom(m["cacheable"]),
			"publisher":             coalesce(str(m["publisher"]), "企业能力商店"),
			"signed":                boolFrom(candidate["signed"]),
			"dependencies":          m["dependencies"],
			"license":               coalesce(str(m["license"]), "内部许可"),
			"lastScannedAt":         "刚刚",
			"vulnerabilityCount":    intFrom(m["vulnerabilityCount"]),
			"supportedEnvironments": coalesceAny(m["supportedEnvironments"], []string{"测试", "生产"}),
			"environment":           "production", "classification": ternary(normalizeRiskLevel(m["riskLevel"]) == "high", "restricted", "internal"),
			"channel": "registry", "channelLabel": catalogChannelLabel("registry"),
			"syncedAt": now, "visibilityScope": scope, "releaseChannel": release,
			"registryRef":    coalesce(str(m["registryRef"]), "registry://"+name+":"+version),
			"supplyChecks":   checks,
			"reviewRequired": decision == "review_required",
		}
		kept = append([]map[string]any{entry}, kept...)
		s.Store.SkillCatalog = kept
		// Caller holds Store.Lock — must use the lock-free annotation
		// variant to avoid RLock-on-Lock deadlock.
		accepted = append(accepted, s.normalizeCatalogItemLocked(entry))
	}
	s.Store.AppendAudit(ws, id.Name, "同步技能商店 Registry", strconv.Itoa(len(accepted))+" 接受/"+strconv.Itoa(len(rejected))+" 拒绝", "success", "")
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	if len(removedCatalogIDs) > 0 {
		s.Store.PersistDelete("skill_catalog", removedCatalogIDs...)
	}
	return map[string]any{
		"accepted": accepted, "rejected": rejected,
		"syncedAt": now, "acceptedCount": len(accepted), "rejectedCount": len(rejected),
	}, nil
}
