package server

import (
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) persistSkillExtra() {
	if s.Store != nil && s.Store.CanWrite("skill_extra") {
		s.Store.Persist("skill_extra")
	}
}

func (s *Server) skillExtraSlice(key string) []map[string]any {
	if s.Store.SkillExtra == nil {
		s.Store.SkillExtra = map[string]any{}
	}
	return knowledgeSliceMaps(s.Store.SkillExtra[key])
}

func (s *Server) skillExtraMap(key string) map[string]any {
	if s.Store.SkillExtra == nil {
		s.Store.SkillExtra = map[string]any{}
	}
	m, _ := s.Store.SkillExtra[key].(map[string]any)
	if m == nil {
		m = map[string]any{}
		s.Store.SkillExtra[key] = m
	}
	return m
}

func defaultSkillPermissions(skillID string) []map[string]any {
	roles := []struct {
		role               string
		canCall, canConfig bool
	}{
		{"Admin", true, true},
		{"SRE", true, true},
		{"Sec", false, false},
		{"View", false, false},
	}
	out := make([]map[string]any, 0, len(roles))
	for _, r := range roles {
		out = append(out, map[string]any{
			"skillId": skillID, "role": r.role, "canCall": r.canCall, "canConfig": r.canConfig,
		})
	}
	return out
}

func defaultSkillGovernance(skillID string) map[string]any {
	return map[string]any{
		"skillId":               skillID,
		"secretRef":             "vault://digital-employee/skills/" + skillID,
		"allowedEgress":         []string{},
		"writeApprovalRequired": true,
		"rateLimitPerMinute":    60,
		"circuitBreakerEnabled": true,
		"dataMaskingEnabled":    true,
	}
}

func (s *Server) ensureSkillPermissionsLocked(skillID string) []map[string]any {
	permsMap := s.skillExtraMap("permissions")
	if raw, ok := permsMap[skillID]; ok {
		switch t := raw.(type) {
		case []map[string]any:
			return t
		case []any:
			out := make([]map[string]any, 0, len(t))
			for _, x := range t {
				if m, ok := x.(map[string]any); ok {
					out = append(out, m)
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	perms := defaultSkillPermissions(skillID)
	permsMap[skillID] = perms
	return perms
}

func (s *Server) ensureSkillGovernanceLocked(skillID string) map[string]any {
	policies := s.skillExtraMap("policies")
	if raw, ok := policies[skillID].(map[string]any); ok && raw != nil {
		return raw
	}
	policy := defaultSkillGovernance(skillID)
	policies[skillID] = policy
	return policy
}

func (s *Server) ensureSkillRuntimeLocked(skill map[string]any) map[string]any {
	sid := str(skill["id"])
	runtimes := s.skillExtraMap("runtimes")
	if raw, ok := runtimes[sid].(map[string]any); ok && raw != nil {
		return raw
	}
	cfg := map[string]any{
		"cacheable": boolFrom(skill["cacheable"]),
		"timeout":   "30",
		"retries":   "1",
	}
	runtimes[sid] = cfg
	return cfg
}

func (s *Server) skillVersionsLocked(skill map[string]any) []map[string]any {
	sid := str(skill["id"])
	versionsMap := s.skillExtraMap("versions")
	if raw, ok := versionsMap[sid]; ok {
		switch t := raw.(type) {
		case []map[string]any:
			return t
		case []any:
			out := make([]map[string]any, 0, len(t))
			for _, x := range t {
				if m, ok := x.(map[string]any); ok {
					out = append(out, m)
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	ver := coalesce(str(skill["version"]), "0.1.0")
	seed := []map[string]any{{
		"version": ver, "date": time.Now().UTC().Format("2006-01-02"), "type": "minor",
		"notes": []string{"当前已安装版本"},
	}}
	versionsMap[sid] = seed
	return seed
}

func (s *Server) skillImpactLocked(ws, skillID string) map[string]any {
	agents := make([]string, 0)
	workflows := make([]string, 0)
	for _, b := range s.skillExtraSlice("bindings") {
		if str(b["capabilityId"]) != skillID {
			continue
		}
		if wid := str(b["workspaceId"]); wid != "" && wid != ws {
			continue
		}
		if str(b["status"]) == "disabled" {
			continue
		}
		name := coalesce(str(b["targetName"]), str(b["targetId"]))
		switch str(b["targetType"]) {
		case "agent":
			agents = append(agents, name)
		case "workflow":
			workflows = append(workflows, name)
		}
	}
	allowed := len(agents)+len(workflows) == 0
	reason := ""
	if !allowed {
		reason = "存在智能体或工作流引用，卸载时将自动解除绑定"
	}
	// refresh health references
	for _, h := range s.Store.SkillHealth {
		if str(h["skillId"]) == skillID {
			h["references"] = len(agents) + len(workflows)
		}
	}
	return map[string]any{
		"skillId": skillID, "agents": agents, "workflows": workflows,
		"activeRuns": 0, "uninstallAllowed": allowed, "reason": reason,
	}
}

func (s *Server) purgeSkillBindingsLocked(ws, skillID string) {
	bindings := s.skillExtraSlice("bindings")
	if len(bindings) == 0 {
		return
	}
	kept := make([]map[string]any, 0, len(bindings))
	for _, b := range bindings {
		if str(b["capabilityId"]) != skillID {
			kept = append(kept, b)
			continue
		}
		bws := str(b["workspaceId"])
		if bws != "" && bws != ws {
			kept = append(kept, b)
		}
	}
	s.Store.SkillExtra["bindings"] = kept
}

func (s *Server) unbindSkillFromEmployeesLocked(skillName, skillID string) {
	lname := strings.ToLower(strings.TrimSpace(skillName))
	for _, emp := range s.Store.Employees {
		caps, _ := emp["capabilities"].(map[string]any)
		if caps != nil {
			skills := decodeStringSlice(caps["skills"])
			filtered := make([]string, 0, len(skills))
			for _, n := range skills {
				if strings.EqualFold(n, skillName) || n == skillID {
					continue
				}
				filtered = append(filtered, n)
			}
			if len(filtered) != len(skills) {
				caps["skills"] = filtered
			}
		}
		bp, _ := emp["boundaryPolicy"].(map[string]any)
		if bp == nil {
			continue
		}
		modes, _ := bp["capabilityModes"].([]any)
		if len(modes) == 0 {
			continue
		}
		kept := make([]any, 0, len(modes))
		for _, raw := range modes {
			m, _ := raw.(map[string]any)
			if m == nil {
				continue
			}
			if str(m["capabilityType"]) == "skill" &&
				(strings.EqualFold(str(m["capabilityName"]), lname) || str(m["capabilityId"]) == skillID) {
				continue
			}
			kept = append(kept, m)
		}
		if len(kept) != len(modes) {
			bp["capabilityModes"] = kept
		}
	}
}

func (s *Server) recordSkillSuppressedLocked(ws string, sk map[string]any) {
	skillID := str(sk["id"])
	skillName := coalesce(str(sk["builtinSkillName"]), str(sk["name"]))
	s.Store.RecordSkillSuppressedUnlocked(ws, skillName)
	if skillID != "" && !strings.EqualFold(skillID, skillName) {
		s.Store.RecordSkillSuppressedUnlocked(ws, skillID)
	}
}

func (s *Server) listSkillAudit(r *http.Request) (any, error) {
	if err := requireSkillRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	keywords := []string{"技能", "MCP", "Tool", "接入", "隔离", "验证", "导入", "安装", "卸载", "升级", "发布流程技能"}
	for _, a := range s.Store.Audits {
		if str(a["workspaceId"]) != ws && str(a["workspaceId"]) != "" {
			continue
		}
		action := str(a["action"])
		match := false
		for _, k := range keywords {
			if strings.Contains(action, k) {
				match = true
				break
			}
		}
		if !match {
			continue
		}
		item := cloneMap(a)
		item["correlationId"] = coalesce(str(a["correlationId"]), "skill:"+str(a["target"]))
		out = append(out, item)
		if len(out) >= 100 {
			break
		}
	}
	return out, nil
}

func (s *Server) skillsGovernanceIncidents(r *http.Request) (any, error) {
	if err := requireSkillRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	s.refreshSkillGovernanceFromKV()
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, item := range s.skillExtraSlice("incidents") {
		if wid := str(item["workspaceId"]); wid == "" || wid == ws {
			out = append(out, item)
		}
	}
	return out, nil
}

func (s *Server) skillsGovernanceEvents(r *http.Request) (any, error) {
	if err := requireSkillRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	s.refreshSkillGovernanceFromKV()
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, item := range s.skillExtraSlice("events") {
		if wid := str(item["workspaceId"]); wid == "" || wid == ws {
			out = append(out, item)
		}
	}
	return out, nil
}

func (s *Server) appendSkillGovEventLocked(ws, skillName, typ, action, actor, result string) {
	evt := map[string]any{
		"id": s.Store.ID("sev"), "workspaceId": ws,
		"time": time.Now().Format("15:04"), "skillName": skillName,
		"type": typ, "action": action, "actor": actor, "result": result,
	}
	events := s.skillExtraSlice("events")
	s.Store.SkillExtra["events"] = append([]map[string]any{evt}, events...)
}

func (s *Server) bindAgentSkill(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/agents/:id/skills
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "路径无效")
	}
	agentID := parts[2]
	body, _ := decodeMap(r)
	skillID := str(body["skillId"])
	ws := s.workspaceID(r)

	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	var agent map[string]any
	for _, e := range s.Store.Employees {
		if str(e["id"]) == agentID && (str(e["workspaceId"]) == ws || str(e["workspaceId"]) == "") {
			agent = e
			break
		}
	}
	if agent == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "智能体不存在")
	}
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	bindings := s.skillExtraSlice("bindings")
	for _, b := range bindings {
		if str(b["targetType"]) == "agent" && str(b["targetId"]) == agentID && str(b["capabilityId"]) == skillID && str(b["status"]) == "active" {
			return b, nil
		}
	}
	item := map[string]any{
		"id": s.Store.ID("cap"), "workspaceId": ws,
		"targetType": "agent", "targetId": agentID, "targetName": agent["name"],
		"capabilityKind": coalesce(str(sk["kind"]), "skill"), "capabilityId": skillID,
		"pinnedVersion": coalesce(str(sk["version"]), "0.1.0"),
		"status":        "active", "createdBy": id.Name,
		"createdAt": time.Now().UTC().Format(time.RFC3339),
		"auditId":   s.Store.ID("audit"),
	}
	s.Store.SkillExtra["bindings"] = append([]map[string]any{item}, bindings...)
	s.skillImpactLocked(ws, skillID)
	s.Store.AppendAudit(ws, id.Name, "分配技能到智能体", str(sk["name"])+":"+str(agent["name"]), "success", "")
	unlocked = true
	s.Store.Unlock()
	go func() { s.persistSkills(); s.persistSkillExtra() }()
	return item, nil
}

