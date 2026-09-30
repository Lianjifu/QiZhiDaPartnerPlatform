package server

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/vault"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// --- Models control plane (aligned with Mock + production guards) ---

func (s *Server) appendModelAudit(ws, actor, action, target, result string, details map[string]any) map[string]any {
	corr := s.Store.ID("corr")
	if details != nil {
		if c := str(details["correlationId"]); c != "" {
			corr = c
		}
	}
	ev := map[string]any{
		"id": s.Store.ID("ma"), "time": time.Now().UTC().Format(time.RFC3339),
		"workspaceId": ws, "actor": actor, "action": action, "target": target,
		"result": result, "correlationId": corr,
	}
	if details != nil {
		if r := str(details["reason"]); r != "" {
			ev["reason"] = r
		}
		if pv := str(details["policyVersion"]); pv != "" {
			ev["policyVersion"] = pv
		}
	}
	s.Store.ModelAudit = append([]map[string]any{ev}, s.Store.ModelAudit...)
	s.Store.PersistCollection("model_audit", s.Store.ModelAudit)
	return ev
}

func (s *Server) findProviderLocked(pid, ws string) (map[string]any, error) {
	for _, x := range s.Store.ModelProviders {
		if str(x["id"]) != pid {
			continue
		}
		if ws != "" && str(x["workspaceId"]) != ws {
			return nil, apperr.NotFoundErr(apperr.ProviderNotFound, "供应商不存在")
		}
		return x, nil
	}
	return nil, apperr.NotFoundErr(apperr.ProviderNotFound, "供应商不存在")
}

func (s *Server) findPolicyLocked(pid, ws string) (map[string]any, error) {
	for _, x := range s.Store.RoutingPolicies {
		if str(x["id"]) != pid {
			continue
		}
		if ws != "" && str(x["workspaceId"]) != ws {
			return nil, apperr.NotFoundErr(apperr.PolicyNotFound, "路由策略不存在")
		}
		return x, nil
	}
	return nil, apperr.NotFoundErr(apperr.PolicyNotFound, "路由策略不存在")
}

func (s *Server) modelByIDLocked(modelID string) (map[string]any, map[string]any) {
	return s.modelByIDInWorkspaceLocked(modelID, "")
}

func (s *Server) modelByIDInWorkspaceLocked(modelID, ws string) (map[string]any, map[string]any) {
	var fallbackM, fallbackP map[string]any
	for _, p := range s.Store.ModelProviders {
		for _, m := range providerModels(p) {
			if str(m["id"]) != modelID {
				continue
			}
			if ws != "" && str(p["workspaceId"]) == ws {
				return m, p
			}
			if fallbackM == nil {
				fallbackM, fallbackP = m, p
			}
		}
	}
	if ws == "" {
		return fallbackM, fallbackP
	}
	// Prefer in-workspace hit only when ws is set; cross-workspace ids are ignored
	// so routed primaryModelId cannot leak another workspace's offline endpoint.
	return nil, nil
}

func (s *Server) providerImpactLocked(providerID string) map[string]any {
	// Only currently published policies block deletion. Historical PolicyVersions
	// remain immutable audit snapshots and must not permanently pin a provider.
	refs := make([]map[string]any, 0)
	for _, pol := range s.Store.RoutingPolicies {
		if str(pol["status"]) != "published" {
			continue
		}
		ids := append([]string{str(pol["primaryModelId"])}, stringSlice(pol["fallbackModelIds"])...)
		hit := false
		for _, mid := range ids {
			if mid == "" {
				continue
			}
			m, _ := s.modelByIDLocked(mid)
			if m != nil && str(m["providerId"]) == providerID {
				hit = true
				break
			}
		}
		if !hit {
			continue
		}
		versionID := ""
		// PolicyVersions are prepended on publish; first matching id is the latest.
		for _, ver := range s.Store.PolicyVersions {
			if str(ver["policyId"]) == str(pol["id"]) {
				versionID = str(ver["id"])
				break
			}
		}
		refs = append(refs, map[string]any{
			"policyId": pol["id"], "level": pol["level"], "versionId": versionID,
		})
	}
	out := map[string]any{
		"providerId": providerID, "routeReferences": refs, "deletionAllowed": len(refs) == 0,
	}
	if len(refs) > 0 {
		out["blockedReason"] = "供应商被已发布路由引用，请先在「模型路由」取消发布或替换模型后再删除。"
	}
	return out
}

func (s *Server) validateRoutingPolicyLocked(policy map[string]any) []string {
	issues := []string{}
	primaryID := str(policy["primaryModelId"])
	fallbacks := stringSlice(policy["fallbackModelIds"])
	modelIDs := append([]string{primaryID}, fallbacks...)
	primary, primaryProv := s.modelByIDLocked(primaryID)
	if primary == nil || str(primary["status"]) != "available" {
		issues = append(issues, "E_MODEL_UNAVAILABLE: 主模型不可用")
	}
	ws := str(policy["workspaceId"])
	seen := map[string]bool{}
	for _, mid := range modelIDs {
		if mid == "" {
			continue
		}
		if seen[mid] {
			issues = append(issues, "E_FALLBACK_INVALID: 降级链不能重复或指向主模型")
			break
		}
		seen[mid] = true
		m, p := s.modelByIDLocked(mid)
		if p != nil && str(p["workspaceId"]) != ws {
			issues = append(issues, "E_MODEL_SCOPE: 模型部署不属于当前工作区")
		}
		if mid != primaryID && (m == nil || str(m["status"]) != "available") {
			issues = append(issues, "E_FALLBACK_INVALID: 降级模型不可用")
		}
		_ = primaryProv
	}
	if str(policy["dataScope"]) == "restricted" && policy["egressAllowed"] == true {
		issues = append(issues, "E_EGRESS_BLOCKED: 受限数据不允许出境")
	}
	if str(policy["dataScope"]) == "restricted" {
		for _, mid := range modelIDs {
			m, _ := s.modelByIDLocked(mid)
			if m != nil && str(m["dataResidency"]) != "cn" {
				issues = append(issues, "E_EGRESS_BLOCKED: 受限数据必须路由至境内模型部署")
				break
			}
		}
	}
	if toFloat(policy["budgetLimitUsd"]) <= 0 {
		issues = append(issues, "E_BUDGET_EXCEEDED: 预算必须大于 0")
	}
	return issues
}

func (s *Server) putProviderCredential(r *http.Request, providerID, raw string) (credRef, masked string, err error) {
	if raw == "" {
		return "", "", apperr.BadReq(apperr.ProviderInvalid, "凭据不能为空")
	}
	if vaultRequiredForCredentials() && (s.Vault == nil || !s.Vault.Enabled()) {
		return "", "", apperr.BadReq(apperr.ProviderCredential, "生产环境必须配置 Vault")
	}
	credRef = "vault://model-providers/" + providerID + "/credential"
	masked = modelprov.MaskCredential(raw)
	if s.Vault != nil {
		if err := s.Vault.Put(r.Context(), credRef, raw); err != nil {
			IncModelVaultError()
			return "", "", apperr.BadReq(apperr.ProviderCredential, "写入凭据失败")
		}
	}
	// Local durable mirror when Vault is optional (dev / LaunchAgent).
	// Must not nest Store.Lock — callers like PATCH already hold it, then unlock first.
	if !vaultRequiredForCredentials() {
		s.Store.Lock()
		if s.Store.ModelSecrets == nil {
			s.Store.ModelSecrets = map[string]string{}
		}
		s.Store.ModelSecrets[credRef] = raw
		s.Store.Unlock()
		if err := s.Store.PersistSync("model_secrets"); err != nil {
			return "", "", apperr.BadReq(apperr.ProviderCredential, "凭据持久化失败，重启后将丢失")
		}
	}
	return credRef, masked, nil
}

func (s *Server) resolveProviderCredential(ctx context.Context, credRef string) string {
	if credRef == "" {
		return ""
	}
	if s.Vault != nil {
		if v, err := s.Vault.Resolve(ctx, credRef); err == nil && v != "" {
			return v
		}
	}
	// DE_BAN_MOCK_TOKEN 只禁 mock 身份，不能挡住本地 model_secrets。
	// 真实 staging/prod 才强制只走 Vault。
	if vaultRequiredForCredentials() {
		return ""
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	if s.Store.ModelSecrets != nil {
		return s.Store.ModelSecrets[credRef]
	}
	return ""
}

func (s *Server) listModelProvidersFE(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, p := range s.Store.ModelProviders {
		if str(p["workspaceId"]) == ws {
			cp := map[string]any{}
			for k, v := range p {
				cp[k] = v
			}
			cp["tier"] = normalizeTier(str(p["tier"]))
			models := providerModels(p)
			if models == nil {
				models = []map[string]any{}
			}
			cp["models"] = models
			out = append(out, cp)
		}
	}
	return out, nil
}

func (s *Server) createModelProviderFE(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	if err := s.evaluateWrite(r, "model", "create", policy.Input{}); err != nil && id.Role != "admin" {
		return nil, err
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	name := strings.TrimSpace(str(body["name"]))
	modelName := strings.TrimSpace(str(body["model"]))
	cred := modelprov.ExtractCredential(body)
	if name == "" || modelName == "" || cred == "" {
		s.Store.Lock()
		s.appendModelAudit(ws, id.Name, "接入供应商", coalesce(name, "未命名供应商"), "failed", map[string]any{"reason": "名称、模型和凭据引用必填"})
		s.Store.Unlock()
		return nil, apperr.BadReq(apperr.ProviderInvalid, "供应商名称、模型和凭据不能为空")
	}
	region := coalesce(str(body["region"]), coalesce(str(body["cloudRegion"]), "global"))
	residency := modelprov.DataResidencyFromRegion(region)
	providerID := s.Store.ID("mp")
	credRef, masked, err := s.putProviderCredential(r, providerID, cred)
	if err != nil {
		return nil, err
	}
	modelID := s.Store.ID("mdl")
	model := map[string]any{
		"id": modelID, "providerId": providerID, "name": modelName,
		"cloudRegion": region, "dataResidency": residency,
		"capabilities": []string{"chat"}, "status": "available", "contextWindow": 32000,
	}
	item := map[string]any{
		"id": providerID, "workspaceId": ws, "name": name,
		"tier":           normalizeTier(coalesce(str(body["tier"]), "connectable")),
		"protocol":       coalesce(str(body["protocol"]), "openai_compatible"),
		"baseUrl":        strings.TrimSpace(str(body["baseUrl"])),
		"apiVersion":     strings.TrimSpace(str(body["apiVersion"])),
		"organizationId": strings.TrimSpace(str(body["organizationId"])),
		"deploymentName": strings.TrimSpace(str(body["deploymentName"])),
		"note":           strings.TrimSpace(str(body["note"])),
		"cloudRegion":    region, "dataResidency": residency,
		"status": "standby", "credentialRef": credRef, "credentialMasked": masked,
		"models": []map[string]any{model},
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.ModelProviders = append([]map[string]any{item}, s.Store.ModelProviders...)
	s.Store.PersistCollection("model_providers", s.Store.ModelProviders)
	s.appendModelAudit(ws, id.Name, "接入供应商", name, "success", map[string]any{"reason": str(body["reason"])})
	s.Store.AppendAudit(ws, id.Name, "接入模型供应商", name, "success", "credentialRef="+credRef)
	return item, nil
}

func (s *Server) modelProviderAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.ProviderNotFound, "供应商不存在")
	}
	pid, action := parts[2], ""
	if len(parts) >= 4 {
		action = parts[3]
	}
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)

	if action == "impact" && r.Method == http.MethodGet {
		if err := requireModelRead(id); err != nil {
			return nil, err
		}
		s.Store.RLock()
		defer s.Store.RUnlock()
		if _, err := s.findProviderLocked(pid, ws); err != nil {
			return nil, err
		}
		return s.providerImpactLocked(pid), nil
	}

	if err := requireModelWrite(id); err != nil {
		return nil, err
	}

	switch {
	case action == "test" && r.Method == http.MethodPost:
		return s.testModelProvider(r, id, ws, pid)
	case action == "disable" && r.Method == http.MethodPost:
		if err := s.evaluateWrite(r, "model", "disable", policy.Input{}); err != nil && id.Role != "admin" {
			return nil, err
		}
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findProviderLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		p["status"] = "disabled"
		models := providerModels(p)
		for _, m := range models {
			m["status"] = "unavailable"
		}
		setProviderModels(p, models)
		s.Store.PersistCollection("model_providers", s.Store.ModelProviders)
		s.appendModelAudit(ws, id.Name, "停用供应商", str(p["name"]), "success", nil)
		return p, nil
	case r.Method == http.MethodPatch:
		return s.patchModelProvider(r, id, ws, pid)
	case r.Method == http.MethodDelete:
		return s.deleteModelProvider(r, id, ws, pid)
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "未知供应商动作")
}

func (s *Server) testModelProvider(r *http.Request, id *auth.Identity, ws, pid string) (any, error) {
	if !s.allowModelRate(ws+":test", 30, time.Minute) {
		return nil, apperr.New(apperr.RateLimited, 429, "探活请求过于频繁")
	}
	if err := s.evaluateWrite(r, "model", "test", policy.Input{}); err != nil && id.Role != "admin" {
		return nil, err
	}
	body, _ := decodeMap(r)

	s.Store.RLock()
	p, err := s.findProviderLocked(pid, ws)
	if err != nil {
		s.Store.RUnlock()
		return nil, err
	}
	protocol := coalesce(str(p["protocol"]), "openai_compatible")
	baseURL := str(p["baseUrl"])
	apiVersion := str(p["apiVersion"])
	deployment := str(p["deploymentName"])
	ref := str(p["credentialRef"])
	name := str(p["name"])
	s.Store.RUnlock()

	secret := ""
	resolved := false
	if override := modelprov.ExtractCredential(body); override != "" {
		secret = override
		resolved = true
	} else if ref != "" {
		secret = s.resolveProviderCredential(r.Context(), ref)
		resolved = secret != ""
		if !resolved && s.Vault != nil && s.Vault.Enabled() {
			IncModelVaultError()
			s.Store.Lock()
			s.appendModelAudit(ws, id.Name, "验证供应商连通性", name, "failed", map[string]any{"reason": "凭据不可用"})
			s.Store.Unlock()
			return nil, apperr.BadReq(apperr.ProviderCredential, "凭据不可用: "+vault.Redact(ref))
		}
		if !resolved && protocol != "ollama" {
			s.Store.Lock()
			s.appendModelAudit(ws, id.Name, "验证供应商连通性", name, "failed", map[string]any{"reason": "凭据不可用"})
			s.Store.Unlock()
			return nil, apperr.BadReq(apperr.ProviderCredential, "凭据不可用，请重新填写 API Key 后再验证")
		}
	}

	statusLabel := "healthy"
	providerStatus := "active"
	verifiedAt := time.Now().UTC().Format(time.RFC3339)
	latency := int64(0)

	if baseURL != "" {
		pr, err := s.modelProbe().Probe(r.Context(), protocol, baseURL, secret, apiVersion, deployment)
		latency = pr.LatencyMS
		IncModelProbe(err == nil && pr.Healthy, latency)
		if err != nil {
			code := apperr.ProviderUnreachable
			msg := "供应商不可达"
			if strings.Contains(err.Error(), "auth") {
				code = apperr.ProviderAuth
				msg = "供应商鉴权失败"
			} else if strings.Contains(err.Error(), "timeout") {
				code = apperr.ProviderTimeout
				msg = "供应商探活超时"
			} else if strings.Contains(err.Error(), "ssrf") || strings.Contains(err.Error(), "private") {
				code = apperr.EgressBlocked
				msg = "目标地址被安全策略拦截"
			}
			s.Store.Lock()
			if p2, e2 := s.findProviderLocked(pid, ws); e2 == nil {
				p2["status"] = "offline"
				p2["lastProbeLatencyMs"] = latency
				s.Store.PersistCollection("model_providers", s.Store.ModelProviders)
			}
			s.appendModelAudit(ws, id.Name, "验证供应商连通性", name, "failed", map[string]any{"reason": msg})
			s.Store.Unlock()
			return nil, apperr.BadReq(code, msg)
		}
	} else if !resolved && protocol != "ollama" {
		// No endpoint and no credential — cannot verify.
		return nil, apperr.BadReq(apperr.ProviderInvalid, "请先配置 API 请求地址")
	}

	s.Store.Lock()
	defer s.Store.Unlock()
	p, err = s.findProviderLocked(pid, ws)
	if err != nil {
		return nil, err
	}
	st := str(p["status"])
	if st == "standby" || st == "draft" || st == "offline" {
		p["status"] = "active"
	}
	providerStatus = str(p["status"])
	p["lastVerifiedAt"] = verifiedAt
	p["lastProbeLatencyMs"] = latency
	models := providerModels(p)
	for _, m := range models {
		if providerStatus == "active" {
			m["status"] = "available"
		}
	}
	setProviderModels(p, models)
	s.Store.PersistCollection("model_providers", s.Store.ModelProviders)
	s.appendModelAudit(ws, id.Name, "验证供应商连通性", name, "success", map[string]any{"reason": str(body["reason"])})
	return map[string]any{
		"providerId": pid, "status": statusLabel, "providerStatus": providerStatus,
		"verifiedAt": verifiedAt, "credentialResolved": resolved, "latencyMs": latency,
	}, nil
}

func (s *Server) patchModelProvider(r *http.Request, id *auth.Identity, ws, pid string) (any, error) {
	body, _ := decodeMap(r)
	has := false
	for _, k := range []string{"name", "region", "tier", "baseUrl", "protocol", "model", "note", "apiVersion", "organizationId", "deploymentName", "credential", "apiKey"} {
		if _, ok := body[k]; ok {
			has = true
			break
		}
	}
	if !has {
		return nil, apperr.BadReq(apperr.ProviderInvalid, "请至少提供一项连接配置变更")
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	p, err := s.findProviderLocked(pid, ws)
	if err != nil {
		return nil, err
	}
	if v := strings.TrimSpace(str(body["name"])); v != "" {
		p["name"] = v
	}
	if _, ok := body["note"]; ok {
		p["note"] = strings.TrimSpace(str(body["note"]))
	}
	if v := str(body["protocol"]); v != "" {
		p["protocol"] = v
	}
	if v := str(body["tier"]); v != "" {
		p["tier"] = normalizeTier(v)
	}
	if _, ok := body["baseUrl"]; ok {
		p["baseUrl"] = strings.TrimSpace(str(body["baseUrl"]))
	}
	if _, ok := body["apiVersion"]; ok {
		p["apiVersion"] = strings.TrimSpace(str(body["apiVersion"]))
	}
	if _, ok := body["organizationId"]; ok {
		p["organizationId"] = strings.TrimSpace(str(body["organizationId"]))
	}
	if _, ok := body["deploymentName"]; ok {
		p["deploymentName"] = strings.TrimSpace(str(body["deploymentName"]))
	}
	if region := str(body["region"]); region != "" {
		p["cloudRegion"] = region
		p["dataResidency"] = modelprov.DataResidencyFromRegion(region)
		models := providerModels(p)
		for _, m := range models {
			m["cloudRegion"] = p["cloudRegion"]
			m["dataResidency"] = p["dataResidency"]
		}
		setProviderModels(p, models)
	}
	if modelName := strings.TrimSpace(str(body["model"])); modelName != "" {
		models := providerModels(p)
		if len(models) == 0 {
			models = []map[string]any{{
				"id": s.Store.ID("mdl"), "providerId": pid, "name": modelName,
				"cloudRegion": p["cloudRegion"], "dataResidency": p["dataResidency"],
				"capabilities": []string{"chat"}, "status": "available", "contextWindow": 32000,
			}}
		} else {
			models[0]["name"] = modelName
			models[0]["cloudRegion"] = p["cloudRegion"]
			models[0]["dataResidency"] = p["dataResidency"]
		}
		setProviderModels(p, models)
	}
	cred := modelprov.ExtractCredential(body)
	if cred != "" {
		// Release store lock before secrets write to avoid nested Lock deadlock.
		s.Store.Unlock()
		credRef, masked, err := s.putProviderCredential(r, pid, cred)
		s.Store.Lock()
		if err != nil {
			return nil, err
		}
		p, err = s.findProviderLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		p["credentialRef"] = credRef
		p["credentialMasked"] = masked
		if str(p["status"]) == "active" {
			p["status"] = "standby"
		}
	}
	// Never persist plaintext credential fields
	delete(p, "credential")
	delete(p, "apiKey")
	s.Store.PersistCollection("model_providers", s.Store.ModelProviders)
	s.appendModelAudit(ws, id.Name, "更新供应商资料", str(p["name"]), "success", map[string]any{"reason": str(body["reason"])})
	return p, nil
}

func (s *Server) deleteModelProvider(r *http.Request, id *auth.Identity, ws, pid string) (any, error) {
	if err := s.evaluateWrite(r, "model", "delete", policy.Input{}); err != nil && id.Role != "admin" {
		return nil, err
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	p, err := s.findProviderLocked(pid, ws)
	if err != nil {
		return nil, err
	}
	impact := s.providerImpactLocked(pid)
	if impact["deletionAllowed"] != true {
		s.appendModelAudit(ws, id.Name, "删除供应商", str(p["name"]), "failed", map[string]any{"reason": str(impact["blockedReason"])})
		return nil, apperr.Conflict(apperr.ProviderInUse, str(impact["blockedReason"]))
	}
	ref := str(p["credentialRef"])
	name := str(p["name"])
	out := make([]map[string]any, 0, len(s.Store.ModelProviders))
	for _, x := range s.Store.ModelProviders {
		if str(x["id"]) != pid {
			out = append(out, x)
		}
	}
	s.Store.ModelProviders = out
	s.Store.PersistCollection("model_providers", s.Store.ModelProviders)
	s.appendModelAudit(ws, id.Name, "删除供应商", name, "success", nil)
	s.Store.AppendAudit(ws, id.Name, "删除模型供应商", pid, "success", "")
	if err := s.Store.PersistDeleteSync("model_providers", pid); err != nil {
		log.Printf("persist-delete model_providers %s: %v", pid, err)
	}
	if ref != "" {
		delete(s.Store.ModelSecrets, ref)
		s.Store.PersistDelete("model_secrets", ref)
		if s.Vault != nil {
			_ = s.Vault.Delete(r.Context(), ref)
		}
	}
	return map[string]any{"id": pid, "status": "deleted"}, nil
}

func (s *Server) discoverModels(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	if !s.allowModelRate(ws+":discover", 30, time.Minute) {
		return nil, apperr.New(apperr.RateLimited, 429, "拉取请求过于频繁")
	}
	body, _ := decodeMap(r)
	protocol := coalesce(str(body["protocol"]), "openai_compatible")
	baseURL := strings.TrimSpace(str(body["baseUrl"]))
	apiKey := modelprov.ExtractCredential(body)
	if apiKey == "" {
		apiKey = strings.TrimSpace(str(body["apiKey"]))
	}
	apiVersion := str(body["apiVersion"])
	credRef := ""
	if pid := str(body["providerId"]); pid != "" {
		s.Store.RLock()
		if p, err := s.findProviderLocked(pid, ws); err == nil {
			if baseURL == "" {
				baseURL = str(p["baseUrl"])
			}
			if protocol == "openai_compatible" || str(body["protocol"]) == "" {
				protocol = coalesce(str(p["protocol"]), protocol)
			}
			if apiVersion == "" {
				apiVersion = str(p["apiVersion"])
			}
			if apiKey == "" {
				credRef = str(p["credentialRef"])
			}
		}
		s.Store.RUnlock()
		if apiKey == "" && credRef != "" {
			apiKey = s.resolveProviderCredential(r.Context(), credRef)
		}
	}
	if baseURL == "" {
		return nil, apperr.BadReq(apperr.ProviderDiscoverInvalid, "请先填写 API 请求地址")
	}
	if !strings.HasPrefix(strings.ToLower(baseURL), "http://") && !strings.HasPrefix(strings.ToLower(baseURL), "https://") {
		return nil, apperr.BadReq(apperr.ProviderDiscoverInvalid, "API 请求地址格式无效")
	}
	if protocol != "ollama" && apiKey == "" && str(body["providerId"]) == "" {
		return nil, apperr.BadReq(apperr.ProviderDiscoverAuth, "拉取模型列表需要 API Key")
	}
	dr, err := s.modelProbe().Discover(r.Context(), protocol, baseURL, apiKey, apiVersion)
	if err != nil {
		msg := "拉取模型失败：无法从供应商端点获取模型列表"
		code := apperr.ProviderUnreachable
		if strings.Contains(err.Error(), "auth") {
			code = apperr.ProviderAuth
			msg = "拉取模型鉴权失败，请检查 API Key 与协议是否匹配"
		} else if strings.Contains(err.Error(), "ssrf") || strings.Contains(err.Error(), "private") {
			code = apperr.EgressBlocked
			msg = "目标地址被安全策略拦截（内网地址需设置 DE_MODEL_ALLOW_PRIVATE=1）"
		} else if strings.Contains(err.Error(), "empty") {
			msg = "供应商返回空模型列表，请确认 Base URL / 协议是否正确"
		}
		s.Store.Lock()
		s.appendModelAudit(ws, id.Name, "拉取模型列表", baseURL, "failed", map[string]any{"reason": msg})
		s.Store.Unlock()
		return nil, apperr.BadReq(code, msg)
	}
	models := make([]map[string]any, 0, len(dr.Models))
	for _, m := range dr.Models {
		models = append(models, map[string]any{"id": m["id"], "name": m["name"]})
	}
	s.Store.Lock()
	s.appendModelAudit(ws, id.Name, "拉取模型列表", baseURL, "success", map[string]any{
		"reason": protocol + ":" + itoa(len(models)) + ":" + dr.Source,
	})
	s.Store.Unlock()
	return map[string]any{
		"protocol": dr.Protocol, "baseUrl": dr.BaseURL, "models": models, "fetchedAt": dr.FetchedAt,
		"source": dr.Source, "resolvedUrl": dr.ResolvedURL, "suggestedProtocol": dr.SuggestedProt,
	}, nil
}

// testModelConnection probes a draft provider config before create (no provider id required).
func (s *Server) testModelConnection(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	if !s.allowModelRate(ws+":probe", 30, time.Minute) {
		return nil, apperr.New(apperr.RateLimited, 429, "探活请求过于频繁")
	}
	body, _ := decodeMap(r)
	protocol := coalesce(str(body["protocol"]), "openai_compatible")
	baseURL := strings.TrimSpace(str(body["baseUrl"]))
	apiKey := modelprov.ExtractCredential(body)
	apiVersion := str(body["apiVersion"])
	deployment := str(body["deploymentName"])
	if baseURL == "" {
		return nil, apperr.BadReq(apperr.ProviderInvalid, "请先填写 API 请求地址")
	}
	if protocol != "ollama" && apiKey == "" {
		return nil, apperr.BadReq(apperr.ProviderDiscoverAuth, "连接测试需要 API Key")
	}
	pr, err := s.modelProbe().Probe(r.Context(), protocol, baseURL, apiKey, apiVersion, deployment)
	IncModelProbe(err == nil && pr.Healthy, pr.LatencyMS)
	if err != nil {
		msg := "连接测试失败"
		code := apperr.ProviderUnreachable
		if strings.Contains(err.Error(), "auth") {
			code = apperr.ProviderAuth
			msg = "鉴权失败，请检查 API Key 或协议（DeepSeek 请用 OpenAI 兼容）"
		} else if strings.Contains(err.Error(), "timeout") {
			code = apperr.ProviderTimeout
			msg = "连接超时"
		} else if strings.Contains(err.Error(), "ssrf") || strings.Contains(err.Error(), "private") {
			code = apperr.EgressBlocked
			msg = "目标地址被安全策略拦截"
		}
		s.Store.Lock()
		s.appendModelAudit(ws, id.Name, "连接测试", baseURL, "failed", map[string]any{"reason": msg})
		s.Store.Unlock()
		return nil, apperr.BadReq(code, msg)
	}
	s.Store.Lock()
	s.appendModelAudit(ws, id.Name, "连接测试", baseURL, "success", map[string]any{
		"reason": "latencyMs=" + itoa(int(pr.LatencyMS)),
	})
	s.Store.Unlock()
	return map[string]any{
		"status": "healthy", "latencyMs": pr.LatencyMS, "protocol": protocol,
		"baseUrl": baseURL, "suggestedProtocol": modelprov.InferProtocolFromURL(baseURL),
		"verifiedAt": time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) listRoutingPolicies(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, p := range s.Store.RoutingPolicies {
		if str(p["workspaceId"]) != ws {
			continue
		}
		cp := map[string]any{}
		for k, v := range p {
			cp[k] = v
		}
		fb := stringSlice(p["fallbackModelIds"])
		if fb == nil {
			fb = []string{}
		}
		cp["fallbackModelIds"] = fb
		issues := stringSlice(p["validationIssues"])
		if issues == nil {
			issues = []string{}
		}
		cp["validationIssues"] = issues
		out = append(out, cp)
	}
	return out, nil
}

func (s *Server) createRoutingPolicy(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	dataScope := coalesce(str(body["dataScope"]), "internal")
	egress := body["egressAllowed"] == true
	if dataScope == "restricted" && egress {
		return nil, apperr.Forbidden(apperr.EgressBlocked, "受限数据不允许出境")
	}
	item := map[string]any{
		"id": s.Store.ID("rp"), "workspaceId": ws,
		"level": coalesce(str(body["level"]), "P3"), "primaryModelId": coalesce(str(body["primaryModelId"]), ""),
		"fallbackModelIds": stringSlice(body["fallbackModelIds"]), "dataScope": dataScope,
		"egressAllowed": egress, "budgetLimitUsd": body["budgetLimitUsd"],
		"status": "draft", "validationIssues": []string{},
	}
	if item["budgetLimitUsd"] == nil {
		item["budgetLimitUsd"] = 0
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.RoutingPolicies = append([]map[string]any{item}, s.Store.RoutingPolicies...)
	s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
	s.appendModelAudit(ws, id.Name, "创建路由草稿", str(item["level"]), "success", nil)
	return item, nil
}

func (s *Server) routingPolicyAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.PolicyNotFound, "策略不存在")
	}
	pid := parts[3]
	action := ""
	if len(parts) >= 5 {
		action = parts[4]
	}
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)

	if action == "versions" && r.Method == http.MethodGet {
		if err := requireModelRead(id); err != nil {
			return nil, err
		}
		s.Store.RLock()
		defer s.Store.RUnlock()
		if _, err := s.findPolicyLocked(pid, ws); err != nil {
			return nil, err
		}
		var out []map[string]any
		for _, v := range s.Store.PolicyVersions {
			if str(v["policyId"]) == pid {
				out = append(out, v)
			}
		}
		return out, nil
	}

	if err := requireModelWrite(id); err != nil {
		return nil, err
	}

	switch action {
	case "draft":
		if r.Method != http.MethodPatch {
			return nil, apperr.NotFoundErr(apperr.NotFound, "未知策略动作")
		}
		body, _ := decodeMap(r)
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		for _, k := range []string{"level", "primaryModelId", "fallbackModelIds", "dataScope", "egressAllowed", "budgetLimitUsd"} {
			if v, ok := body[k]; ok {
				p[k] = v
			}
		}
		p["id"] = pid
		p["workspaceId"] = ws
		p["status"] = "draft"
		p["validationIssues"] = []string{}
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		s.appendModelAudit(ws, id.Name, "更新路由草稿", str(p["level"]), "success", map[string]any{"reason": str(body["reason"])})
		return p, nil
	case "validate":
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		issues := s.validateRoutingPolicyLocked(p)
		p["validationIssues"] = issues
		if len(issues) == 0 {
			p["status"] = "ready"
		} else {
			p["status"] = "draft"
		}
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		result := "success"
		reason := ""
		if len(issues) > 0 {
			result = "failed"
			reason = strings.Join(issues, "；")
		}
		s.appendModelAudit(ws, id.Name, "校验路由草稿", str(p["level"]), result, map[string]any{"reason": reason})
		return p, nil
	case "publish":
		s.Store.Lock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			s.Store.Unlock()
			return nil, err
		}
		st := str(p["status"])
		if st != "ready" && st != "pending_approval" && st != "pending_countersign" {
			s.appendModelAudit(ws, id.Name, "发布路由版本", str(p["level"]), "failed", map[string]any{"reason": "草稿尚未通过校验"})
			s.Store.Unlock()
			return nil, apperr.BadReq(apperr.PolicyNotReady, "草稿尚未通过校验，无法发布")
		}
		if requiresPeerApprovalGate(id) && st == "ready" {
			p["status"] = "pending_approval"
			p["requestedBy"] = id.Name
			p["requestedById"] = id.ID
			p["requestedAt"] = time.Now().UTC().Format(time.RFC3339)
			s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
			s.appendModelAudit(ws, id.Name, "申请发布路由版本", str(p["level"]), "success", map[string]any{"reason": "待管理员审批"})
			s.Store.Unlock()
			return p, nil
		}
		if err := requireProductionDualApproval(str(p["requestedById"]), str(p["requestedBy"]), id, "路由发布"); err != nil {
			s.Store.Unlock()
			return nil, err
		}
		if hold, herr := maybeHoldForCountersign(p, id, str(p["dataScope"]), "路由发布"); herr != nil {
			s.Store.Unlock()
			return nil, herr
		} else if hold {
			s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
			s.appendModelAudit(ws, id.Name, "路由发布会签待副署", str(p["level"]), "success", map[string]any{"reason": "pending_countersign"})
			s.Store.Unlock()
			return p, nil
		}
		s.Store.Unlock()
		if err := s.evaluateWrite(r, "model", "publish", policy.Input{ApproverID: id.ID, SubmitterID: id.ID}); err != nil && id.Role != "admin" {
			return nil, err
		}
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err = s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		// supersede other published at same level
		for _, other := range s.Store.RoutingPolicies {
			if str(other["workspaceId"]) == ws && str(other["level"]) == str(p["level"]) && str(other["id"]) != pid && str(other["status"]) == "published" {
				other["status"] = "superseded"
			}
		}
		maxVer := 0
		for _, v := range s.Store.PolicyVersions {
			if str(v["policyId"]) == pid {
				if n := intFrom(v["version"]); n > maxVer {
					maxVer = n
				}
			}
		}
		snap := map[string]any{}
		for k, v := range p {
			snap[k] = v
		}
		snap["fallbackModelIds"] = append([]string{}, stringSlice(p["fallbackModelIds"])...)
		snap["validationIssues"] = []string{}
		ver := map[string]any{
			"id": s.Store.ID("rpv"), "policyId": pid, "version": maxVer + 1,
			"snapshot": snap, "publishedAt": time.Now().UTC().Format(time.RFC3339), "publishedBy": id.Name,
		}
		p["status"] = "published"
		s.Store.PolicyVersions = append([]map[string]any{ver}, s.Store.PolicyVersions...)
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		s.Store.PersistCollection("policy_versions", s.Store.PolicyVersions)
		s.appendModelAudit(ws, id.Name, "发布路由版本", str(p["level"]), "success", map[string]any{"policyVersion": str(ver["id"])})
		s.Store.AppendAudit(ws, id.Name, "发布路由策略", str(p["level"]), "success", "")
		IncModelPolicyPublish()
		return ver, nil
	case "unpublish":
		body, _ := decodeMap(r)
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		if str(p["status"]) != "published" {
			s.appendModelAudit(ws, id.Name, "取消发布路由", str(p["level"]), "failed", map[string]any{"reason": "仅已发布路由可取消发布"})
			return nil, apperr.BadReq(apperr.PolicyNotPublished, "仅已发布路由可取消发布")
		}
		p["status"] = "draft"
		p["validationIssues"] = []string{}
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		s.appendModelAudit(ws, id.Name, "取消发布路由", str(p["level"]), "success", map[string]any{"reason": str(body["reason"])})
		s.Store.AppendAudit(ws, id.Name, "取消发布路由策略", str(p["level"]), "success", str(body["reason"]))
		return p, nil
	case "rollback":
		body, _ := decodeMap(r)
		versionID := str(body["versionId"])
		s.Store.Lock()
		defer s.Store.Unlock()
		p, err := s.findPolicyLocked(pid, ws)
		if err != nil {
			return nil, err
		}
		var target map[string]any
		for _, v := range s.Store.PolicyVersions {
			if str(v["id"]) == versionID && str(v["policyId"]) == pid {
				target = v
				break
			}
		}
		if target == nil {
			return nil, apperr.NotFoundErr(apperr.VersionNotFound, "路由版本不存在")
		}
		snap, _ := target["snapshot"].(map[string]any)
		if snap == nil {
			return nil, apperr.BadReq(apperr.RollbackInvalid, "版本快照无效")
		}
		rollbackSnap := map[string]any{}
		for k, v := range snap {
			rollbackSnap[k] = v
		}
		rollbackSnap["status"] = "ready"
		rollbackSnap["fallbackModelIds"] = append([]string{}, stringSlice(snap["fallbackModelIds"])...)
		rollbackSnap["validationIssues"] = []string{}
		issues := s.validateRoutingPolicyLocked(rollbackSnap)
		if len(issues) > 0 {
			s.appendModelAudit(ws, id.Name, "回滚路由版本", str(p["level"]), "failed", map[string]any{
				"reason": strings.Join(issues, "；"), "policyVersion": str(target["id"]),
			})
			return nil, apperr.BadReq(apperr.RollbackInvalid, strings.Join(issues, "；"))
		}
		maxVer := 0
		for _, v := range s.Store.PolicyVersions {
			if str(v["policyId"]) == pid {
				if n := intFrom(v["version"]); n > maxVer {
					maxVer = n
				}
			}
		}
		newSnap := map[string]any{}
		for k, v := range snap {
			newSnap[k] = v
		}
		newSnap["status"] = "published"
		newSnap["fallbackModelIds"] = append([]string{}, stringSlice(snap["fallbackModelIds"])...)
		newSnap["validationIssues"] = []string{}
		ver := map[string]any{
			"id": s.Store.ID("rpv"), "policyId": pid, "version": maxVer + 1,
			"snapshot": newSnap, "publishedAt": time.Now().UTC().Format(time.RFC3339),
			"publishedBy": id.Name, "rollbackOf": target["id"],
		}
		for k, v := range newSnap {
			if k != "id" {
				p[k] = v
			}
		}
		p["status"] = "published"
		s.Store.PolicyVersions = append([]map[string]any{ver}, s.Store.PolicyVersions...)
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		s.Store.PersistCollection("policy_versions", s.Store.PolicyVersions)
		s.appendModelAudit(ws, id.Name, "回滚路由版本", str(p["level"]), "success", map[string]any{"policyVersion": str(ver["id"])})
		s.Store.AppendAudit(ws, id.Name, "回滚路由策略", pid, "success", "")
		return ver, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "未知策略动作")
}

func (s *Server) modelGovernanceOverview(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	active, standby, disabled := 0, 0, 0
	var latencySum int64
	latencyN := 0
	regionMap := map[string]int{}
	providers := 0
	for _, p := range s.Store.ModelProviders {
		if str(p["workspaceId"]) != ws {
			continue
		}
		providers++
		regionMap[coalesce(str(p["cloudRegion"]), "unknown")]++
		switch str(p["status"]) {
		case "active":
			active++
		case "standby":
			standby++
		case "disabled":
			disabled++
		}
		if n := intFrom(p["lastProbeLatencyMs"]); n > 0 {
			latencySum += int64(n)
			latencyN++
		}
	}
	published, draft := 0, 0
	publishedBudget, draftBudget := 0.0, 0.0
	for _, p := range s.Store.RoutingPolicies {
		if str(p["workspaceId"]) != ws {
			continue
		}
		status := str(p["status"])
		switch status {
		case "published":
			published++
			// 占用上限与强制限额一致：仅已发布；已替代/草稿不计入分母。
			publishedBudget += toFloat(p["budgetLimitUsd"])
		case "draft", "ready":
			draft++
			draftBudget += toFloat(p["budgetLimitUsd"])
		}
	}
	budget := publishedBudget
	spend := 0.0
	for _, b := range s.Store.ModelBudgets {
		if str(b["workspaceId"]) == ws {
			spend += toFloat(b["usedUsd"])
		}
	}
	if spend == 0 && budget > 0 {
		// Derive a soft estimate from usage meters when budget rows empty.
		units := 0
		for _, u := range s.Store.UsageMeters {
			if str(u["workspaceId"]) == ws && (str(u["kind"]) == "copilot" || str(u["kind"]) == "model") {
				units += intFrom(u["units"])
			}
		}
		spend = float64(units) * 0.002
	}
	risk := "normal"
	if budget <= 0 {
		risk = "attention"
	} else if spend/budget > 0.85 {
		risk = "critical"
	} else if spend/budget > 0.65 {
		risk = "attention"
	}
	healthyShare := 0
	if providers > 0 {
		healthyShare = int(float64(active) / float64(providers) * 100)
	}
	avgLat := 0
	if latencyN > 0 {
		avgLat = int(latencySum / int64(latencyN))
	}
	regions := make([]map[string]any, 0, len(regionMap))
	for region, count := range regionMap {
		regions = append(regions, map[string]any{"region": region, "count": count})
	}
	return map[string]any{
		"activeProviders": active, "standbyProviders": standby, "disabledProviders": disabled,
		"publishedRoutes": published, "draftRoutes": draft, "budgetRisk": risk,
		"monthlyBudgetUsd": budget, "draftBudgetUsd": draftBudget, "monthlySpendUsd": spend,
		"healthyShare": healthyShare, "avgLatencyMs": avgLat,
		"regionDistribution": regions, "updatedAt": time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) listModelAudit(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	action := r.URL.Query().Get("action")
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, a := range s.Store.ModelAudit {
		if str(a["workspaceId"]) != ws {
			continue
		}
		if action != "" && action != "all" && !strings.Contains(str(a["action"]), action) {
			continue
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *Server) failoverTest(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	if !s.allowModelRate(ws+":failover", 30, time.Minute) {
		return nil, apperr.New(apperr.RateLimited, 429, "演练请求过于频繁")
	}
	body, _ := decodeMap(r)
	scope := str(body["scope"])
	if scope != "sandbox" && scope != "canary" {
		return nil, apperr.BadReq(apperr.DrillScopeInvalid, "演练仅允许在 sandbox 或 canary 隔离范围执行")
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	p, err := s.findPolicyLocked(str(body["policyId"]), ws)
	if err != nil {
		return nil, err
	}
	if str(p["status"]) != "published" {
		s.appendModelAudit(ws, id.Name, "执行隔离故障切换演练", str(p["level"]), "failed", map[string]any{"reason": "仅已发布路由可执行演练"})
		return nil, apperr.BadReq(apperr.PolicyNotPublished, "仅已发布路由可执行演练")
	}
	issues := s.validateRoutingPolicyLocked(p)
	if len(issues) > 0 {
		s.appendModelAudit(ws, id.Name, "执行隔离故障切换演练", str(p["level"]), "failed", map[string]any{"reason": strings.Join(issues, "；")})
		return nil, apperr.BadReq(apperr.DrillInvalid, strings.Join(issues, "；"))
	}
	fallbacks := stringSlice(p["fallbackModelIds"])
	if len(fallbacks) == 0 {
		return nil, apperr.BadReq(apperr.FallbackInvalid, "当前策略没有可用降级链")
	}
	corr := s.Store.ID("drill")
	s.appendModelAudit(ws, id.Name, "执行隔离故障切换演练", str(p["level"]), "success", map[string]any{
		"reason": str(body["reason"]), "correlationId": corr,
	})
	return map[string]any{
		"id": s.Store.ID("failover"), "policyId": str(p["id"]), "scope": scope,
		"status": "passed", "fromModelId": str(p["primaryModelId"]), "toModelId": fallbacks[0],
		"correlationId": corr,
	}, nil
}

// checkModelBudgetLocked returns error when published budget is exceeded (caller holds lock).
func (s *Server) checkModelBudgetLocked(workspaceID string) error {
	if !budgetEnforceEnabled() {
		return nil
	}
	limit := 0.0
	for _, p := range s.Store.RoutingPolicies {
		if str(p["workspaceId"]) == workspaceID && str(p["status"]) == "published" {
			limit += toFloat(p["budgetLimitUsd"])
		}
	}
	if limit <= 0 {
		return nil
	}
	spend := 0.0
	for _, b := range s.Store.ModelBudgets {
		if str(b["workspaceId"]) == workspaceID {
			spend += toFloat(b["usedUsd"])
		}
	}
	units := 0
	for _, u := range s.Store.UsageMeters {
		if str(u["workspaceId"]) == workspaceID && (str(u["kind"]) == "copilot" || str(u["kind"]) == "model") {
			units += intFrom(u["units"])
		}
	}
	est := spend
	if est == 0 {
		est = float64(units) * 0.002
	}
	if est >= limit {
		IncModelBudgetDeny()
		return apperr.Forbidden(apperr.BudgetExceeded, "工作区模型预算已超限")
	}
	return nil
}
