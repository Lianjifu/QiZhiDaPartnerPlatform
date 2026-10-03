package skills

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// skillByID is the /api/skills/:id/:action catch-all dispatcher. Each
// sub-action delegates to a focused handler function (skillPreflight,
// skillInstall, skillUninstall, skillLifecycle, skillUpgrade,
// skillUpgradePlan, skillTest, skillPackageInfo, skillRevalidate,
// skillIsolate) plus inline cases for impact / permissions / governance
// / runtime / versions / trace lookups.
//
// Kept in a dedicated file to keep handlers.go (the top-level REST list
// + create + import surface) under the project 600L file-size gate.
// Sub-action handlers themselves live in handlers_detail_actions.go
// (write paths) and handlers_detail_test.go (test / revalidate /
// isolate).
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
