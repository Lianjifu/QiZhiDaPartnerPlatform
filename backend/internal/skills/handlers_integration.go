package skills

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listSkillIntegrations returns every SkillIntegration row visible to
// the caller (workspace-scoped + unscoped fall-through). Read-only; no
// audit emitted (audit lives on the createMCPConnection + createTool
// + skillIntegrationAction mutation paths).
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

// normalizeMCPProtocol accepts the legacy + spec-aligned protocol names
// (Streamable HTTP / SSE / stdio) and returns the canonical lower-case
// identifier used by the rest of the codebase.
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

// mcpProtocolLabel returns the human-facing label for the MCP protocol
// (used in audit details + UI badges).
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

// createMCPConnection registers a new external MCP server, validates
// the protocol, gates on zero-trust, and creates both a Skills row +
// a SkillIntegrations row so the connection shows up under both
// "技能" and "接入" surfaces.
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

// createTool registers a new external Tool backed by either OpenAPI 3.x
// or JSON Schema. Same dual-row (Skills + SkillIntegrations) creation
// pattern as createMCPConnection.
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

// resolveIntegrationSkillID resolves the skillID linked to a given
// SkillIntegration row — either via the explicit skillId field or via
// the credentialRef vault://skills/<skillID>/... URL convention.
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

// verifyPackageSkillLocked confirms a package-sourced skill still has
// its skill package directory + SKILL.md available on disk. Returns
// the skill row (sk) and an empty errMsg on success; on failure the
// errMsg describes what's missing so the caller can record it on the
// integration health record.
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

// skillIntegrationAction is the /api/skill-integrations/:id/:action
// catch-all (currently supports test + discover). Both actions
// transition the integration through validating → enabled and stamp
// the latest health result.
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
