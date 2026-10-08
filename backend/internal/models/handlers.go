package models

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
	"github.com/qizhida-partner-platform/backend/internal/secretbox"
	"github.com/qizhida-partner-platform/backend/internal/vault"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// --- Internal lookups / builders (moved from handlers_models.go) ---

// appendModelAudit prepends a model_audit entry to s.Store.ModelAudit and
// persists the collection. If a correlationId is supplied via details, it
// is preferred over a freshly minted id. Mirrors the legacy
// `*Server.appendModelAudit`.
func (s *Service) appendModelAudit(ws, actor, action, target, result string, details map[string]any) map[string]any {
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

// findProviderLocked looks up a model provider by id (optionally scoped to
// the named workspace). Caller must NOT hold Store.Lock.
func (s *Service) findProviderLocked(pid, ws string) (map[string]any, error) {
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

// findPolicyLocked looks up a routing policy by id (optionally scoped to the
// named workspace). Caller must NOT hold Store.Lock.
func (s *Service) findPolicyLocked(pid, ws string) (map[string]any, error) {
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

// modelByIDLocked returns the model and its owning provider, both nil when no
// match. Workspace-unscoped.
func (s *Service) modelByIDLocked(modelID string) (map[string]any, map[string]any) {
	return s.modelByIDInWorkspaceLocked(modelID, "")
}

// ModelByIDLocked is the exported bridge for non-M08 call sites
// (buildPartnerSvc) that used to call `s.modelByIDLocked(id)` on *Server.
// Delegates to the unexported implementation; returns (nil, nil) when
// the id doesn't resolve.
func (s *Service) ModelByIDLocked(modelID string) (map[string]any, map[string]any) {
	return s.modelByIDLocked(modelID)
}

// modelByIDInWorkspaceLocked returns the model and provider for the given
// modelID. When ws != "" only in-workspace hits are returned.
func (s *Service) modelByIDInWorkspaceLocked(modelID, ws string) (map[string]any, map[string]any) {
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

// providerImpactLocked reports whether removing the named provider would break
// a published routing policy. Caller must NOT hold Store.Lock.
func (s *Service) providerImpactLocked(providerID string) map[string]any {
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

// validateRoutingPolicyLocked returns the validation issue strings for a
// routing policy. Caller must NOT hold Store.Lock.
func (s *Service) validateRoutingPolicyLocked(policy map[string]any) []string {
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

// putProviderCredential stores a raw credential in Vault when it is enabled,
// otherwise in the durable model_secrets map. In pro that map holds only
// AES-GCM ciphertext (QZDA_CREDENTIAL_KEY). Caller MUST NOT hold Store.Lock
// when calling this; the local-secrets path takes it internally.
func (s *Service) putProviderCredential(r *http.Request, providerID, raw string) (credRef, masked string, err error) {
	if raw == "" {
		return "", "", apperr.BadReq(apperr.ProviderInvalid, "凭据不能为空")
	}
	credRef = "vault://model-providers/" + providerID + "/credential"
	masked = modelprov.MaskCredential(raw)
	if v := s.currentVault(); v != nil && v.Enabled() {
		if err := v.Put(r.Context(), credRef, raw); err != nil {
			if s.IncModelVaultError != nil {
				s.IncModelVaultError()
			}
			return "", "", apperr.BadReq(apperr.ProviderCredential, "写入凭据失败")
		}
		return credRef, masked, nil
	}
	stored, err := sealLocalCredential(raw)
	if err != nil {
		return "", "", apperr.BadReq(apperr.ProviderCredential, err.Error())
	}
	// Must not nest Store.Lock — callers like PATCH already hold it, then unlock first.
	s.Store.Lock()
	if s.Store.ModelSecrets == nil {
		s.Store.ModelSecrets = map[string]string{}
	}
	s.Store.ModelSecrets[credRef] = stored
	s.Store.Unlock()
	if err := s.Store.PersistSync("model_secrets"); err != nil {
		return "", "", apperr.BadReq(apperr.ProviderCredential, "凭据持久化失败，重启后将丢失")
	}
	return credRef, masked, nil
}

// sealLocalCredential encrypts a credential for local storage in pro; dev keeps
// the plaintext mirror it has always used.
func sealLocalCredential(raw string) (string, error) {
	if !runtimeenv.FromEnv().IsPro() {
		return raw, nil
	}
	key, err := secretbox.KeyFromEnv()
	if err != nil {
		return "", errors.New("生产环境必须配置凭据加密密钥 QZDA_CREDENTIAL_KEY")
	}
	return secretbox.Seal(key, raw)
}

// openLocalCredential decrypts a stored local credential. In pro a plaintext
// entry is refused, so a value written without encryption is never used.
func openLocalCredential(stored string) string {
	if secretbox.IsSealed(stored) {
		key, err := secretbox.KeyFromEnv()
		if err != nil {
			return ""
		}
		plain, err := secretbox.Open(key, stored)
		if err != nil {
			return ""
		}
		return plain
	}
	if runtimeenv.FromEnv().IsPro() {
		return ""
	}
	return stored
}

// resolveProviderCredential returns the raw API key for the named credential
// reference. Falls back to the local model_secrets store when the vault lookup
// fails and we're not in a vault-required env.
func (s *Service) resolveProviderCredential(ctx context.Context, credRef string) string {
	if credRef == "" {
		return ""
	}
	if v := s.currentVault(); v != nil {
		if val, err := v.Resolve(ctx, credRef); err == nil && val != "" {
			return val
		}
	}
	s.Store.RLock()
	stored := s.Store.ModelSecrets[credRef]
	s.Store.RUnlock()
	return openLocalCredential(stored)
}

// checkModelBudgetLocked returns an error when the workspace's published
// budget is exceeded. Caller MUST hold Store.Lock.
func (s *Service) checkModelBudgetLocked(workspaceID string) error {
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
		if s.IncModelBudgetDeny != nil {
			s.IncModelBudgetDeny()
		}
		return apperr.Forbidden(apperr.BudgetExceeded, "工作区模型预算已超限")
	}
	return nil
}

// CheckModelBudgetLocked is the exported bridge for non-M08 call sites
// (copilot harness, channel ingress, models_budget_test.go) that used
// to call `s.checkModelBudgetLocked(ws)` on *Server. Delegates to the
// unexported implementation; returns nil when budgetEnforceEnabled is
// off.
func (s *Service) CheckModelBudgetLocked(workspaceID string) error {
	return s.checkModelBudgetLocked(workspaceID)
}

// ResolveProviderCredential is the exported bridge for non-M08 call
// sites (model_secrets_test.go) that used to call
// `s.resolveProviderCredential(ctx, ref)` on *Server. Delegates to the
// unexported implementation.
func (s *Service) ResolveProviderCredential(ctx context.Context, credRef string) string {
	return s.resolveProviderCredential(ctx, credRef)
}

// --- Provider CRUD (FE-friendly paths) ---

// ListModelProviders → GET /api/model-providers
func (s *Service) ListModelProviders(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
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

// CreateModelProvider → POST /api/model-providers
func (s *Service) CreateModelProvider(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	if err := s.EvaluateWrite(r, "model", "create", policy.Input{}); err != nil {
		// No-op: legacy code did `if err := ...; err != nil && id.Role != "admin"`
		// Preserve the original guard: only fail when err != nil AND not admin.
		if id.Role != "admin" {
			return nil, err
		}
	}
	body, _ := s.DecodeMap(r)
	ws := s.WorkspaceID(r)
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
	if s.AppendAudit != nil {
		s.AppendAudit(ws, id.Name, "接入模型供应商", name, "success", "credentialRef="+credRef)
	}
	return item, nil
}

// DiscoverModels → POST /api/model-providers/discover-models
func (s *Service) DiscoverModels(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
	if !s.allowModelRate(ws+":discover", 30, time.Minute) {
		return nil, apperr.New(apperr.RateLimited, 429, "拉取请求过于频繁")
	}
	body, _ := s.DecodeMap(r)
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
			msg = "目标地址被安全策略拦截（内网地址需设置 QZDA_MODEL_ALLOW_PRIVATE=1）"
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

// TestModelConnection → POST /api/model-providers/test-connection
func (s *Service) TestModelConnection(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
	if !s.allowModelRate(ws+":probe", 30, time.Minute) {
		return nil, apperr.New(apperr.RateLimited, 429, "探活请求过于频繁")
	}
	body, _ := s.DecodeMap(r)
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
	if s.IncModelProbe != nil {
		s.IncModelProbe(err == nil && pr.Healthy, pr.LatencyMS)
	}
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

// ModelProviderAction → /api/model-providers/{id}/{action} catch-all
// (impact / test / disable / patch / delete).
func (s *Service) ModelProviderAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.ProviderNotFound, "供应商不存在")
	}
	pid, action := parts[2], ""
	if len(parts) >= 4 {
		action = parts[3]
	}
	id := s.IdentityFrom(r.Context())
	ws := s.WorkspaceID(r)

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
		if err := s.EvaluateWrite(r, "model", "disable", policy.Input{}); err != nil {
			if id.Role != "admin" {
				return nil, err
			}
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

// testModelProvider probes an existing provider (by id). Pulled out of the
// action switch so the body stays readable.
func (s *Service) testModelProvider(r *http.Request, id *auth.Identity, ws, pid string) (any, error) {
	if !s.allowModelRate(ws+":test", 30, time.Minute) {
		return nil, apperr.New(apperr.RateLimited, 429, "探活请求过于频繁")
	}
	if err := s.EvaluateWrite(r, "model", "test", policy.Input{}); err != nil {
		if id.Role != "admin" {
			return nil, err
		}
	}
	body, _ := s.DecodeMap(r)

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
		if !resolved {
			v := s.currentVault()
			if v != nil && v.Enabled() {
				if s.IncModelVaultError != nil {
					s.IncModelVaultError()
				}
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
}

	statusLabel := "healthy"
	providerStatus := "active"
	verifiedAt := time.Now().UTC().Format(time.RFC3339)
	latency := int64(0)

	if baseURL != "" {
		pr, err := s.modelProbe().Probe(r.Context(), protocol, baseURL, secret, apiVersion, deployment)
		latency = pr.LatencyMS
		if s.IncModelProbe != nil {
			s.IncModelProbe(err == nil && pr.Healthy, latency)
		}
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

// patchModelProvider applies a PATCH body to an existing provider. Caller
// already authenticated and authorized; this only mutates store state.
func (s *Service) patchModelProvider(r *http.Request, id *auth.Identity, ws, pid string) (any, error) {
	body, _ := s.DecodeMap(r)
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

// deleteModelProvider removes a provider (subject to impact check).
func (s *Service) deleteModelProvider(r *http.Request, id *auth.Identity, ws, pid string) (any, error) {
	if err := s.EvaluateWrite(r, "model", "delete", policy.Input{}); err != nil {
		if id.Role != "admin" {
			return nil, err
		}
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
	if s.AppendAudit != nil {
		s.AppendAudit(ws, id.Name, "删除模型供应商", pid, "success", "")
	}
	if err := s.Store.PersistDeleteSync("model_providers", pid); err != nil {
		log.Printf("persist-delete model_providers %s: %v", pid, err)
	}
	if ref != "" {
		delete(s.Store.ModelSecrets, ref)
		s.Store.PersistDelete("model_secrets", ref)
		if v := s.currentVault(); v != nil {
			_ = v.Delete(r.Context(), ref)
		}
	}
	return map[string]any{"id": pid, "status": "deleted"}, nil
}

// ModelGovernanceOverview → GET /api/model-governance/overview
func (s *Service) ModelGovernanceOverview(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
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

// ListModelAudit → GET /api/model-audit
func (s *Service) ListModelAudit(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
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

// FailoverTest → POST /api/model-routing/failover-tests
func (s *Service) FailoverTest(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
	if !s.allowModelRate(ws+":failover", 30, time.Minute) {
		return nil, apperr.New(apperr.RateLimited, 429, "演练请求过于频繁")
	}
	body, _ := s.DecodeMap(r)
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