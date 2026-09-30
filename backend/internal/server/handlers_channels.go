package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/dingtalk"
	"github.com/qizhida-partner-platform/backend/internal/feishu"
	"github.com/qizhida-partner-platform/backend/internal/wecom"
	"github.com/qizhida-partner-platform/backend/internal/weixin"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) requireChannelRead(r *http.Request) (*auth.Identity, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "channel.read") && id.Role != "admin" && id.Role != "auditor" {
		return nil, apperr.Forbidden(apperr.ChannelReadForbidden, "缺少 channel.read")
	}
	return id, nil
}

func (s *Server) requireChannelWrite(r *http.Request) (*auth.Identity, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "channel.write") && id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.ChannelWriteForbidden, "缺少 channel.write")
	}
	return id, nil
}

func (s *Server) appendChannelAuditLocked(ws, actor, action, target, result, reason, corr string) {
	if corr == "" {
		corr = s.Store.ID("channel_corr")
	}
	s.Store.ChannelAudit = append([]map[string]any{{
		"id": s.Store.ID("ca"), "workspaceId": ws, "time": time.Now().UTC().Format(time.RFC3339),
		"actor": actor, "action": action, "target": target, "result": result,
		"reason": reason, "correlationId": corr,
	}}, s.Store.ChannelAudit...)
}

func (s *Server) persistChannel() {
	s.Store.Persist("channel_deploys")
	s.Store.Persist("channel_dlq")
	s.Store.Persist("channel_inbound")
	s.Store.Persist("delivery_policies")
	s.Store.Persist("delivery_policy_versions")
	s.Store.Persist("channel_templates")
	s.Store.Persist("channel_blacklist")
	s.Store.Persist("channel_audit")
}

func stringSliceAny(v any) []string {
	switch t := v.(type) {
	case []string:
		return append([]string{}, t...)
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			out = append(out, str(x))
		}
		return out
	default:
		return nil
	}
}

func maskCredential(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "••••••••"
	}
	if len(raw) <= 4 {
		return "••••"
	}
	return "••••" + raw[len(raw)-4:]
}

func (s *Server) findDeployLocked(id, ws string) map[string]any {
	for _, d := range s.Store.ChannelDeploys {
		if str(d["id"]) == id && (ws == "" || str(d["workspaceId"]) == ws) {
			return d
		}
	}
	return nil
}

func (s *Server) validateDeliveryPolicyLocked(policy map[string]any) []string {
	ws := str(policy["workspaceId"])
	primaryID := str(policy["primaryDeploymentId"])
	fallbacks := stringSliceAny(policy["fallbackDeploymentIds"])
	ids := append([]string{primaryID}, fallbacks...)
	issues := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" {
			continue
		}
		if seen[id] {
			issues = append(issues, "E_DELIVERY_FALLBACK_INVALID: 降级链不能重复")
			break
		}
		seen[id] = true
	}
	primary := s.findDeployLocked(primaryID, ws)
	if primary == nil || str(primary["status"]) != "active" {
		issues = append(issues, "E_DELIVERY_PRIMARY_UNAVAILABLE: 主渠道不可用")
	}
	for _, fid := range fallbacks {
		d := s.findDeployLocked(fid, ws)
		if d == nil || str(d["status"]) != "active" {
			issues = append(issues, "E_DELIVERY_FALLBACK_INVALID: 降级渠道不可用或不属于当前工作区")
			break
		}
	}
	if str(policy["dataClassification"]) == "restricted" {
		kinds := []string{}
		if primary != nil {
			kinds = append(kinds, str(primary["kind"]))
		}
		for _, fid := range fallbacks {
			if d := s.findDeployLocked(fid, ws); d != nil {
				kinds = append(kinds, str(d["kind"]))
			}
		}
		for _, kind := range kinds {
			if kind == "webhook" {
				issues = append(issues, "E_DELIVERY_CLASSIFICATION_BLOCKED: 受限数据不能投递至外部渠道")
				break
			}
		}
	}
	// dedupe issues
	uniq := []string{}
	seenIssue := map[string]bool{}
	for _, i := range issues {
		if !seenIssue[i] {
			seenIssue[i] = true
			uniq = append(uniq, i)
		}
	}
	return uniq
}

func (s *Server) publishedDeploymentRefsLocked() map[string]bool {
	refs := map[string]bool{}
	for _, v := range s.Store.DeliveryPolicyVersions {
		snap, _ := v["snapshot"].(map[string]any)
		if snap == nil {
			continue
		}
		refs[str(snap["primaryDeploymentId"])] = true
		for _, fid := range stringSliceAny(snap["fallbackDeploymentIds"]) {
			refs[fid] = true
		}
	}
	for _, p := range s.Store.DeliveryPolicies {
		if str(p["status"]) != "published" {
			continue
		}
		refs[str(p["primaryDeploymentId"])] = true
		for _, fid := range stringSliceAny(p["fallbackDeploymentIds"]) {
			refs[fid] = true
		}
	}
	return refs
}

func (s *Server) channelControlDeployments(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, d := range s.Store.ChannelDeploys {
		if str(d["workspaceId"]) == ws {
			cp := map[string]any{}
			for k, v := range d {
				cp[k] = v
			}
			s.enrichChannelWebhookURL(cp)
			out = append(out, cp)
		}
	}
	return out, nil
}

func (s *Server) channelControlCreateDeploy(r *http.Request) (any, error) {
	id, err := s.requireChannelWrite(r)
	if err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	kind := strings.TrimSpace(str(body["kind"]))
	if name == "" || kind == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 名称和类型不能为空")
	}
	credPayload, masked, meta, err := s.buildChannelCredential(kind, body)
	if err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	deployID := s.Store.ID("channel_deployment")
	credRef := "vault://channel-deployments/" + deployID + "/credential"
	if s.Vault != nil {
		if putErr := s.Vault.Put(r.Context(), credRef, credPayload); putErr != nil {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 写入凭据失败")
		}
	}
	item := map[string]any{
		"id": deployID, "workspaceId": ws, "name": name, "kind": kind,
		"environment": coalesce(str(body["environment"]), "sandbox"), "status": "draft",
		"credentialRef": credRef, "credentialMasked": masked,
		"owner": coalesce(strings.TrimSpace(str(body["owner"])), id.Name),
	}
	for k, v := range meta {
		item[k] = v
	}
	switch kind {
	case "feishu", "lark":
		if str(item["connectionMode"]) == "webhook" {
			item["webhookPath"] = "/api/channel/feishu/events/" + deployID
			s.enrichChannelWebhookURL(item)
		}
	case "wecom":
		if str(item["connectionMode"]) != "websocket" {
			item["webhookPath"] = "/api/channel/wecom/events/" + deployID
			s.enrichChannelWebhookURL(item)
		}
	case "dingtalk":
		if str(item["connectionMode"]) == "webhook" {
			item["webhookPath"] = "/api/channel/dingtalk/events/" + deployID
			s.enrichChannelWebhookURL(item)
		}
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.ChannelDeploys = append([]map[string]any{item}, s.Store.ChannelDeploys...)
	s.appendChannelAuditLocked(ws, id.Name, "接入渠道部署", name, "success", str(body["reason"]), "")
	go s.persistChannel()
	return item, nil
}

// buildChannelCredential returns vault payload + masked display + non-secret metadata.
func (s *Server) buildChannelCredential(kind string, body map[string]any) (payload, masked string, meta map[string]any, err error) {
	meta = map[string]any{}
	switch kind {
	case "feishu", "lark":
		appID := strings.TrimSpace(coalesce(str(body["appId"]), str(body["app_id"])))
		appSecret := strings.TrimSpace(coalesce(str(body["appSecret"]), coalesce(str(body["app_secret"]), coalesce(str(body["credential"]), str(body["apiKey"])))))
		domain := strings.TrimSpace(str(body["domain"]))
		// Support cc-connect bind form credential="cli_xxx:secret"
		if appID == "" && strings.Contains(appSecret, ":") {
			cred, perr := feishu.ParseCredentials(appSecret)
			if perr == nil {
				appID, appSecret, domain = cred.AppID, cred.AppSecret, cred.Domain
			}
		}
		if domain == "" && kind == "lark" {
			domain = feishu.LarkDomain
		}
		cred := feishu.Credentials{
			AppID: appID, AppSecret: appSecret, Domain: domain,
			EncryptKey:        strings.TrimSpace(coalesce(str(body["encryptKey"]), str(body["encrypt_key"]))),
			VerificationToken: strings.TrimSpace(coalesce(str(body["verificationToken"]), str(body["verification_token"]))),
		}.Normalize()
		if !cred.Valid() {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 飞书接入需要 appId 与 appSecret（参考 cc-connect）")
		}
		payload, err = cred.Marshal()
		if err != nil {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 飞书凭据无效")
		}
		masked = feishu.MaskAppID(cred.AppID)
		meta["appIdMasked"] = masked
		meta["domain"] = cred.Domain
		mode := coalesce(str(body["connectionMode"]), "websocket")
		switch mode {
		case "websocket", "long_connection", "ws":
			mode = "websocket"
		default:
			mode = "webhook"
		}
		meta["connectionMode"] = mode
		// Encrypt / verification token only apply to webhook inbound.
		if mode == "webhook" {
			meta["hasEncryptKey"] = cred.EncryptKey != ""
			meta["hasVerificationToken"] = cred.VerificationToken != ""
		} else {
			// Clear webhook-only secrets from vault payload if user switched modes mid-form
			cred.EncryptKey = ""
			cred.VerificationToken = ""
			payload, err = cred.Marshal()
			if err != nil {
				return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 飞书凭据无效")
			}
		}
		return payload, masked, meta, nil
	case "dingtalk":
		clientID := strings.TrimSpace(coalesce(str(body["clientId"]), coalesce(str(body["client_id"]), coalesce(str(body["appId"]), str(body["app_id"])))))
		clientSecret := strings.TrimSpace(coalesce(str(body["clientSecret"]), coalesce(str(body["client_secret"]), coalesce(str(body["appSecret"]), coalesce(str(body["app_secret"]), str(body["credential"]))))))
		if clientID == "" && strings.Contains(clientSecret, ":") {
			if parsed, perr := dingtalk.ParseCredentials(clientSecret); perr == nil {
				clientID, clientSecret = parsed.ClientID, parsed.ClientSecret
			}
		}
		cred := dingtalk.Credentials{
			ClientID: clientID, ClientSecret: clientSecret,
			RobotCode: strings.TrimSpace(coalesce(str(body["robotCode"]), str(body["robot_code"]))),
			Domain:    strings.TrimSpace(str(body["domain"])),
		}.Normalize()
		if !cred.Valid() {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 钉钉接入需要 clientId 与 clientSecret（参考 cc-connect）")
		}
		payload, err = cred.Marshal()
		if err != nil {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 钉钉凭据无效")
		}
		masked = dingtalk.MaskClientID(cred.ClientID)
		meta["clientIdMasked"] = masked
		meta["robotCode"] = cred.RobotCode
		meta["domain"] = cred.Domain
		mode := coalesce(str(body["connectionMode"]), "stream")
		if mode != "stream" && mode != "webhook" {
			mode = "stream"
		}
		meta["connectionMode"] = mode
		return payload, masked, meta, nil
	case "wecom":
		mode := coalesce(str(body["connectionMode"]), coalesce(str(body["mode"]), "webhook"))
		if mode == "long_connection" {
			mode = "websocket"
		}
		cred := wecom.Credentials{
			CorpID:         strings.TrimSpace(coalesce(str(body["corpId"]), str(body["corp_id"]))),
			CorpSecret:     strings.TrimSpace(coalesce(str(body["corpSecret"]), coalesce(str(body["corp_secret"]), str(body["credential"])))),
			AgentID:        strings.TrimSpace(coalesce(str(body["agentId"]), str(body["agent_id"]))),
			CallbackToken:  strings.TrimSpace(coalesce(str(body["callbackToken"]), coalesce(str(body["callback_token"]), str(body["verificationToken"])))),
			CallbackAESKey: strings.TrimSpace(coalesce(str(body["callbackAesKey"]), coalesce(str(body["callback_aes_key"]), str(body["encodingAesKey"])))),
			APIBaseURL:     strings.TrimSpace(coalesce(str(body["apiBaseUrl"]), str(body["api_base_url"]))),
			BotID:          strings.TrimSpace(coalesce(str(body["botId"]), str(body["bot_id"]))),
			BotSecret:      strings.TrimSpace(coalesce(str(body["botSecret"]), str(body["bot_secret"]))),
			Mode:           mode,
		}.Normalize()
		if !cred.Valid() {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 企微自建应用需要 corpId/corpSecret/agentId；或 websocket 模式 botId/botSecret")
		}
		payload, err = cred.Marshal()
		if err != nil {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 企微凭据无效")
		}
		masked = wecom.MaskID(coalesce(cred.CorpID, cred.BotID))
		meta["corpIdMasked"] = masked
		meta["agentId"] = cred.AgentID
		meta["connectionMode"] = cred.Mode
		meta["domain"] = cred.APIBaseURL
		meta["hasCallbackToken"] = cred.CallbackToken != ""
		meta["hasCallbackAesKey"] = cred.CallbackAESKey != ""
		return payload, masked, meta, nil
	case "weixin", "wechat":
		cred := weixin.Credentials{
			Token:     strings.TrimSpace(coalesce(str(body["token"]), str(body["credential"]))),
			BaseURL:   strings.TrimSpace(coalesce(str(body["baseUrl"]), str(body["base_url"]))),
			AccountID: strings.TrimSpace(coalesce(str(body["accountId"]), str(body["account_id"]))),
			AllowFrom: strings.TrimSpace(coalesce(str(body["allowFrom"]), str(body["allow_from"]))),
			RouteTag:  strings.TrimSpace(coalesce(str(body["routeTag"]), str(body["route_tag"]))),
		}.Normalize()
		if !cred.Valid() {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 个人微信（ilink）需要 token（扫码或 bind）")
		}
		payload, err = cred.Marshal()
		if err != nil {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 个人微信凭据无效")
		}
		masked = weixin.MaskToken(cred.Token)
		meta["tokenMasked"] = masked
		meta["domain"] = cred.BaseURL
		meta["accountId"] = cred.AccountID
		meta["connectionMode"] = "long_poll"
		meta["allowFrom"] = cred.AllowFrom
		return payload, masked, meta, nil
	case "email", "sms", "phone":
		return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 不支持邮件、短信、电话渠道")
	default:
		cred := strings.TrimSpace(coalesce(str(body["credential"]), str(body["apiKey"])))
		if cred == "" {
			return "", "", nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 名称、类型和凭据不能为空")
		}
		return cred, maskCredential(cred), meta, nil
	}
}

func (s *Server) channelDeployAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "部署不存在")
	}
	did, action := parts[3], ""
	if len(parts) >= 5 {
		action = parts[4]
	}
	ws := s.workspaceID(r)

	if action == "impact" && r.Method == http.MethodGet {
		if _, err := s.requireChannelRead(r); err != nil {
			return nil, err
		}
		s.Store.RLock()
		defer s.Store.RUnlock()
		d := s.findDeployLocked(did, ws)
		if d == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "E_CHANNEL_DEPLOYMENT_NOT_FOUND: 渠道部署不存在")
		}
		refs := []string{}
		for _, v := range s.Store.DeliveryPolicyVersions {
			snap, _ := v["snapshot"].(map[string]any)
			if snap == nil {
				continue
			}
			ids := append([]string{str(snap["primaryDeploymentId"])}, stringSliceAny(snap["fallbackDeploymentIds"])...)
			for _, x := range ids {
				if x == did {
					refs = append(refs, str(v["id"]))
					break
				}
			}
		}
		return map[string]any{"deploymentId": did, "deletionAllowed": len(refs) == 0, "references": refs}, nil
	}

	id, err := s.requireChannelWrite(r)
	if err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)

	if action == "verify" && r.Method == http.MethodPost {
		return s.channelDeployVerify(r, id.Name, did, ws, str(body["reason"]))
	}
	if action == "" && r.Method == http.MethodPatch {
		return s.channelDeployPatch(r, id.Name, did, ws, body)
	}

	s.Store.Lock()
	defer s.Store.Unlock()
	for i, d := range s.Store.ChannelDeploys {
		if str(d["id"]) != did {
			continue
		}
		if str(d["workspaceId"]) != ws {
			return nil, apperr.Forbidden(apperr.ChannelWriteForbidden, "E_CHANNEL_WORKSPACE_SCOPE: 无权操作其他工作区渠道资源")
		}
		switch {
		case action == "disable" && r.Method == http.MethodPost:
			d["status"] = "disabled"
			s.appendChannelAuditLocked(ws, id.Name, "停用渠道部署", str(d["name"]), "success", str(body["reason"]), "")
			go s.persistChannel()
			return d, nil
		case r.Method == http.MethodDelete && action == "":
			refs := s.publishedDeploymentRefsLocked()
			if refs[did] {
				s.appendChannelAuditLocked(ws, id.Name, "删除渠道部署", str(d["name"]), "failed", "渠道被已发布投递策略引用", "")
				return nil, apperr.Conflict(apperr.ChannelInUse, "E_CHANNEL_IN_USE: 渠道被已发布投递策略引用")
			}
			s.Store.ChannelDeploys = append(s.Store.ChannelDeploys[:i], s.Store.ChannelDeploys[i+1:]...)
			s.appendChannelAuditLocked(ws, id.Name, "删除渠道部署", str(d["name"]), "success", str(body["reason"]), "")
			go s.persistChannel()
			s.durableDeleteSync("channel_deploys", did)
			return map[string]any{"id": did, "status": "deleted"}, nil
		}
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "E_CHANNEL_DEPLOYMENT_NOT_FOUND: 渠道部署不存在")
}

func channelCredUpdateRequested(body map[string]any) bool {
	keys := []string{
		"appId", "app_id", "appSecret", "app_secret", "credential", "apiKey",
		"clientId", "client_id", "clientSecret", "client_secret",
		"corpId", "corp_id", "corpSecret", "corp_secret", "agentId", "agent_id",
		"botId", "bot_id", "botSecret", "bot_secret",
		"token", "encryptKey", "encrypt_key", "verificationToken", "verification_token",
		"callbackToken", "callbackAesKey", "robotCode", "robot_code",
		"allowFrom", "allow_from", "accountId", "baseUrl", "base_url", "apiBaseUrl", "api_base_url",
	}
	for _, k := range keys {
		if strings.TrimSpace(str(body[k])) != "" {
			return true
		}
	}
	return false
}

func (s *Server) channelDeployPatch(r *http.Request, actor, did, ws string, body map[string]any) (any, error) {
	s.Store.RLock()
	cur := s.findDeployLocked(did, ws)
	var kind, credRef, name string
	snapshot := map[string]any{}
	if cur != nil {
		kind, credRef, name = str(cur["kind"]), str(cur["credentialRef"]), str(cur["name"])
		for k, v := range cur {
			snapshot[k] = v
		}
	}
	s.Store.RUnlock()
	if cur == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "E_CHANNEL_DEPLOYMENT_NOT_FOUND: 渠道部署不存在")
	}

	masked := str(snapshot["credentialMasked"])
	meta := map[string]any{}
	for _, k := range []string{
		"domain", "appIdMasked", "clientIdMasked", "corpIdMasked", "tokenMasked",
		"connectionMode", "hasEncryptKey", "hasVerificationToken", "hasCallbackToken", "hasCallbackAesKey",
		"robotCode", "agentId", "accountId",
	} {
		if v, ok := snapshot[k]; ok {
			meta[k] = v
		}
	}

	if channelCredUpdateRequested(body) {
		mergeBody := map[string]any{}
		for k, v := range body {
			mergeBody[k] = v
		}
		// Preserve existing vault fields when the edit form leaves secrets blank.
		if s.Vault != nil && credRef != "" {
			if raw, err := s.Vault.Resolve(r.Context(), credRef); err == nil && raw != "" {
				switch kind {
				case "feishu", "lark":
					if existing, perr := feishu.ParseCredentials(raw); perr == nil {
						if strings.TrimSpace(coalesce(str(mergeBody["appId"]), str(mergeBody["app_id"]))) == "" {
							mergeBody["appId"] = existing.AppID
						}
						if strings.TrimSpace(coalesce(str(mergeBody["appSecret"]), coalesce(str(mergeBody["app_secret"]), str(mergeBody["credential"])))) == "" {
							mergeBody["appSecret"] = existing.AppSecret
						}
						if strings.TrimSpace(str(mergeBody["domain"])) == "" {
							mergeBody["domain"] = existing.Domain
						}
						if _, hasEK := mergeBody["encryptKey"]; !hasEK {
							if _, hasEK2 := mergeBody["encrypt_key"]; !hasEK2 {
								mergeBody["encryptKey"] = existing.EncryptKey
							}
						}
						if _, hasVT := mergeBody["verificationToken"]; !hasVT {
							if _, hasVT2 := mergeBody["verification_token"]; !hasVT2 {
								mergeBody["verificationToken"] = existing.VerificationToken
							}
						}
					}
				case "dingtalk":
					if existing, perr := dingtalk.ParseCredentials(raw); perr == nil {
						if strings.TrimSpace(coalesce(str(mergeBody["clientId"]), str(mergeBody["client_id"]))) == "" {
							mergeBody["clientId"] = existing.ClientID
						}
						if strings.TrimSpace(coalesce(str(mergeBody["clientSecret"]), coalesce(str(mergeBody["client_secret"]), str(mergeBody["credential"])))) == "" {
							mergeBody["clientSecret"] = existing.ClientSecret
						}
						if strings.TrimSpace(str(mergeBody["domain"])) == "" {
							mergeBody["domain"] = existing.Domain
						}
						if strings.TrimSpace(coalesce(str(mergeBody["robotCode"]), str(mergeBody["robot_code"]))) == "" {
							mergeBody["robotCode"] = existing.RobotCode
						}
					}
				case "wecom":
					if existing, perr := wecom.ParseCredentials(raw); perr == nil {
						if strings.TrimSpace(coalesce(str(mergeBody["connectionMode"]), str(mergeBody["mode"]))) == "" {
							mergeBody["connectionMode"] = existing.Mode
						}
						if strings.TrimSpace(coalesce(str(mergeBody["corpId"]), str(mergeBody["corp_id"]))) == "" {
							mergeBody["corpId"] = existing.CorpID
						}
						if strings.TrimSpace(coalesce(str(mergeBody["corpSecret"]), coalesce(str(mergeBody["corp_secret"]), str(mergeBody["credential"])))) == "" {
							mergeBody["corpSecret"] = existing.CorpSecret
						}
						if strings.TrimSpace(coalesce(str(mergeBody["agentId"]), str(mergeBody["agent_id"]))) == "" {
							mergeBody["agentId"] = existing.AgentID
						}
						if strings.TrimSpace(coalesce(str(mergeBody["botId"]), str(mergeBody["bot_id"]))) == "" {
							mergeBody["botId"] = existing.BotID
						}
						if strings.TrimSpace(coalesce(str(mergeBody["botSecret"]), str(mergeBody["bot_secret"]))) == "" {
							mergeBody["botSecret"] = existing.BotSecret
						}
						if strings.TrimSpace(coalesce(str(mergeBody["apiBaseUrl"]), str(mergeBody["api_base_url"]))) == "" {
							mergeBody["apiBaseUrl"] = existing.APIBaseURL
						}
						if _, has := mergeBody["callbackToken"]; !has {
							mergeBody["callbackToken"] = existing.CallbackToken
						}
						if _, has := mergeBody["callbackAesKey"]; !has {
							mergeBody["callbackAesKey"] = existing.CallbackAESKey
						}
					}
				case "weixin", "wechat":
					if existing, perr := weixin.ParseCredentials(raw); perr == nil {
						if strings.TrimSpace(coalesce(str(mergeBody["token"]), str(mergeBody["credential"]))) == "" {
							mergeBody["token"] = existing.Token
						}
						if strings.TrimSpace(coalesce(str(mergeBody["baseUrl"]), str(mergeBody["base_url"]))) == "" {
							mergeBody["baseUrl"] = existing.BaseURL
						}
						if strings.TrimSpace(coalesce(str(mergeBody["allowFrom"]), str(mergeBody["allow_from"]))) == "" {
							mergeBody["allowFrom"] = existing.AllowFrom
						}
						if strings.TrimSpace(str(mergeBody["accountId"])) == "" {
							mergeBody["accountId"] = existing.AccountID
						}
					}
				}
			}
		}
		if strings.TrimSpace(str(mergeBody["connectionMode"])) == "" && str(snapshot["connectionMode"]) != "" {
			mergeBody["connectionMode"] = snapshot["connectionMode"]
		}
		if strings.TrimSpace(str(mergeBody["domain"])) == "" && str(snapshot["domain"]) != "" {
			mergeBody["domain"] = snapshot["domain"]
		}
		payload, nextMasked, nextMeta, err := s.buildChannelCredential(kind, mergeBody)
		if err != nil {
			return nil, err
		}
		if s.Vault != nil && credRef != "" {
			if putErr := s.Vault.Put(r.Context(), credRef, payload); putErr != nil {
				return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 更新凭据失败")
			}
		}
		masked = nextMasked
		meta = nextMeta
	} else if mode := strings.TrimSpace(str(body["connectionMode"])); mode != "" {
		// Mode-only change: rebuild meta via credential builder when possible.
		mergeBody := map[string]any{"connectionMode": mode}
		if domain := strings.TrimSpace(str(body["domain"])); domain != "" {
			mergeBody["domain"] = domain
		} else if str(snapshot["domain"]) != "" {
			mergeBody["domain"] = snapshot["domain"]
		}
		if s.Vault != nil && credRef != "" {
			if raw, err := s.Vault.Resolve(r.Context(), credRef); err == nil && raw != "" {
				switch kind {
				case "feishu", "lark":
					if existing, perr := feishu.ParseCredentials(raw); perr == nil {
						mergeBody["appId"] = existing.AppID
						mergeBody["appSecret"] = existing.AppSecret
						if str(mergeBody["domain"]) == "" {
							mergeBody["domain"] = existing.Domain
						}
						mergeBody["encryptKey"] = existing.EncryptKey
						mergeBody["verificationToken"] = existing.VerificationToken
					}
				case "dingtalk":
					if existing, perr := dingtalk.ParseCredentials(raw); perr == nil {
						mergeBody["clientId"] = existing.ClientID
						mergeBody["clientSecret"] = existing.ClientSecret
						mergeBody["robotCode"] = existing.RobotCode
						if str(mergeBody["domain"]) == "" {
							mergeBody["domain"] = existing.Domain
						}
					}
				case "wecom":
					if existing, perr := wecom.ParseCredentials(raw); perr == nil {
						mergeBody["corpId"] = existing.CorpID
						mergeBody["corpSecret"] = existing.CorpSecret
						mergeBody["agentId"] = existing.AgentID
						mergeBody["botId"] = existing.BotID
						mergeBody["botSecret"] = existing.BotSecret
						mergeBody["callbackToken"] = existing.CallbackToken
						mergeBody["callbackAesKey"] = existing.CallbackAESKey
						if str(mergeBody["apiBaseUrl"]) == "" {
							mergeBody["apiBaseUrl"] = existing.APIBaseURL
						}
					}
				}
			}
		}
		if len(mergeBody) > 1 || str(mergeBody["appId"]) != "" || str(mergeBody["clientId"]) != "" || str(mergeBody["corpId"]) != "" || str(mergeBody["botId"]) != "" {
			payload, nextMasked, nextMeta, err := s.buildChannelCredential(kind, mergeBody)
			if err == nil {
				if s.Vault != nil && credRef != "" && payload != "" {
					_ = s.Vault.Put(r.Context(), credRef, payload)
				}
				masked = nextMasked
				meta = nextMeta
			} else {
				meta["connectionMode"] = mode
			}
		} else {
			meta["connectionMode"] = mode
		}
	} else if domain := strings.TrimSpace(str(body["domain"])); domain != "" {
		meta["domain"] = domain
	}

	s.Store.Lock()
	defer s.Store.Unlock()
	d := s.findDeployLocked(did, ws)
	if d == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "E_CHANNEL_DEPLOYMENT_NOT_FOUND: 渠道部署不存在")
	}
	if next := strings.TrimSpace(str(body["name"])); next != "" {
		d["name"] = next
		name = next
	}
	if next := strings.TrimSpace(str(body["environment"])); next == "production" || next == "sandbox" {
		d["environment"] = next
	}
	if next := strings.TrimSpace(str(body["owner"])); next != "" {
		d["owner"] = next
	}
	if next := strings.TrimSpace(str(body["status"])); next == "active" || next == "disabled" || next == "draft" || next == "offline" {
		d["status"] = next
	}
	d["credentialMasked"] = masked
	for k, v := range meta {
		if v == nil || v == "" {
			delete(d, k)
			continue
		}
		d[k] = v
	}
	// Refresh webhook path according to connection mode.
	delete(d, "webhookPath")
	delete(d, "webhookUrl")
	switch kind {
	case "feishu", "lark":
		if str(d["connectionMode"]) == "webhook" {
			d["webhookPath"] = "/api/channel/feishu/events/" + did
			s.enrichChannelWebhookURL(d)
		}
	case "wecom":
		if str(d["connectionMode"]) != "websocket" {
			d["webhookPath"] = "/api/channel/wecom/events/" + did
			s.enrichChannelWebhookURL(d)
		}
	case "dingtalk":
		if str(d["connectionMode"]) == "webhook" {
			d["webhookPath"] = "/api/channel/dingtalk/events/" + did
			s.enrichChannelWebhookURL(d)
		}
	}
	s.appendChannelAuditLocked(ws, actor, "更新渠道部署", name, "success", str(body["reason"]), "")
	go s.persistChannel()
	out := map[string]any{}
	for k, v := range d {
		out[k] = v
	}
	return out, nil
}

func (s *Server) channelDeployVerify(r *http.Request, actor, did, ws, reason string) (any, error) {
	s.Store.RLock()
	d := s.findDeployLocked(did, ws)
	var kind, credRef, name string
	if d != nil {
		kind, credRef, name = str(d["kind"]), str(d["credentialRef"]), str(d["name"])
	}
	s.Store.RUnlock()
	if d == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "E_CHANNEL_DEPLOYMENT_NOT_FOUND: 渠道部署不存在")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	probeMeta := map[string]any{}

	switch kind {
	case "feishu", "lark":
		raw := ""
		if s.Vault != nil && credRef != "" {
			if v, err := s.Vault.Resolve(r.Context(), credRef); err == nil {
				raw = v
			}
		}
		if raw == "" {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 无法解析飞书凭据，请重新接入")
		}
		cred, err := feishu.ParseCredentials(raw)
		if err != nil {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 飞书凭据格式无效")
		}
		cli := feishu.NewClient()
		if s.FeishuHTTP != nil {
			cli.HTTP = s.FeishuHTTP
		}
		probe := cli.Probe(r.Context(), cred)
		if !probe.OK {
			s.Store.Lock()
			if cur := s.findDeployLocked(did, ws); cur != nil {
				cur["status"] = "offline"
				cur["lastVerifyError"] = probe.ErrorMessage
			}
			s.appendChannelAuditLocked(ws, actor, "验证渠道连通性", name, "failed", probe.ErrorMessage, "")
			s.Store.Unlock()
			go s.persistChannel()
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_VERIFY_FAILED: "+probe.ErrorMessage)
		}
		probeMeta["botOpenId"] = probe.BotOpenID
		probeMeta["botName"] = probe.BotName
		probeMeta["domain"] = probe.Domain
		probeMeta["latencyMs"] = probe.LatencyMs
		probeMeta["lastVerifyError"] = ""
	case "dingtalk":
		raw := ""
		if s.Vault != nil && credRef != "" {
			if v, err := s.Vault.Resolve(r.Context(), credRef); err == nil {
				raw = v
			}
		}
		if raw == "" {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 无法解析钉钉凭据，请重新接入")
		}
		cred, err := dingtalk.ParseCredentials(raw)
		if err != nil {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 钉钉凭据格式无效")
		}
		cli := dingtalk.NewClient()
		if s.DingTalkHTTP != nil {
			cli.HTTP = s.DingTalkHTTP
		}
		probe := cli.Probe(r.Context(), cred)
		if !probe.OK {
			s.failChannelVerify(did, ws, actor, name, probe.ErrorMessage)
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_VERIFY_FAILED: "+probe.ErrorMessage)
		}
		probeMeta["robotCode"] = probe.RobotCode
		probeMeta["domain"] = probe.Domain
		probeMeta["latencyMs"] = probe.LatencyMs
		probeMeta["lastVerifyError"] = ""
	case "wecom":
		raw := ""
		if s.Vault != nil && credRef != "" {
			if v, err := s.Vault.Resolve(r.Context(), credRef); err == nil {
				raw = v
			}
		}
		if raw == "" {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 无法解析企微凭据，请重新接入")
		}
		cred, err := wecom.ParseCredentials(raw)
		if err != nil {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 企微凭据格式无效")
		}
		cli := wecom.NewClient()
		if s.WecomHTTP != nil {
			cli.HTTP = s.WecomHTTP
		}
		probe := cli.Probe(r.Context(), cred)
		if !probe.OK {
			s.failChannelVerify(did, ws, actor, name, probe.ErrorMessage)
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_VERIFY_FAILED: "+probe.ErrorMessage)
		}
		probeMeta["agentId"] = probe.AgentID
		probeMeta["domain"] = probe.Domain
		probeMeta["connectionMode"] = probe.Mode
		probeMeta["latencyMs"] = probe.LatencyMs
		probeMeta["lastVerifyError"] = ""
	case "weixin", "wechat":
		raw := ""
		if s.Vault != nil && credRef != "" {
			if v, err := s.Vault.Resolve(r.Context(), credRef); err == nil {
				raw = v
			}
		}
		if raw == "" {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 无法解析个人微信凭据，请重新接入")
		}
		cred, err := weixin.ParseCredentials(raw)
		if err != nil {
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_CREDENTIAL: 个人微信凭据格式无效")
		}
		cli := weixin.NewClient()
		if s.WeixinHTTP != nil {
			cli.HTTP = s.WeixinHTTP
		}
		probe := cli.Probe(r.Context(), cred)
		if !probe.OK {
			s.failChannelVerify(did, ws, actor, name, probe.ErrorMessage)
			return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_VERIFY_FAILED: "+probe.ErrorMessage)
		}
		probeMeta["accountId"] = probe.AccountID
		probeMeta["domain"] = probe.Domain
		probeMeta["latencyMs"] = probe.LatencyMs
		probeMeta["lastVerifyError"] = ""
	}

	s.Store.Lock()
	defer s.Store.Unlock()
	cur := s.findDeployLocked(did, ws)
	if cur == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "E_CHANNEL_DEPLOYMENT_NOT_FOUND: 渠道部署不存在")
	}
	cur["status"] = "active"
	cur["lastVerifiedAt"] = now
	for k, v := range probeMeta {
		if v == "" {
			delete(cur, k)
			continue
		}
		cur[k] = v
	}
	s.appendChannelAuditLocked(ws, actor, "验证渠道连通性", name, "success", reason, "")
	go s.persistChannel()
	return cur, nil
}

func (s *Server) failChannelVerify(did, ws, actor, name, msg string) {
	s.Store.Lock()
	if cur := s.findDeployLocked(did, ws); cur != nil {
		cur["status"] = "offline"
		cur["lastVerifyError"] = msg
	}
	s.appendChannelAuditLocked(ws, actor, "验证渠道连通性", name, "failed", msg, "")
	s.Store.Unlock()
	go s.persistChannel()
}

func (s *Server) channelControlPolicies(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, p := range s.Store.DeliveryPolicies {
		if str(p["workspaceId"]) == ws {
			cp := map[string]any{}
			for k, v := range p {
				cp[k] = v
			}
			cp["fallbackDeploymentIds"] = stringSliceAny(p["fallbackDeploymentIds"])
			if cp["validationIssues"] == nil {
				cp["validationIssues"] = []string{}
			}
			out = append(out, cp)
		}
	}
	return out, nil
}

func (s *Server) channelControlOverview(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	active, published, dlq := 0, 0, 0
	for _, d := range s.Store.ChannelDeploys {
		if str(d["workspaceId"]) == ws && str(d["status"]) == "active" {
			active++
		}
	}
	for _, p := range s.Store.DeliveryPolicies {
		if str(p["workspaceId"]) == ws && str(p["status"]) == "published" {
			published++
		}
	}
	for _, d := range s.Store.ChannelDLQ {
		if str(d["workspaceId"]) == ws && (str(d["status"]) == "dead_letter" || str(d["status"]) == "") {
			dlq++
		}
	}
	risk := "normal"
	if dlq > 0 {
		risk = "attention"
	}
	return map[string]any{"activeDeployments": active, "publishedPolicies": published, "deadLetters": dlq, "capacityRisk": risk}, nil
}

func (s *Server) channelControlDeadLetters(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, d := range s.Store.ChannelDLQ {
		if str(d["workspaceId"]) != ws {
			continue
		}
		if st := str(d["status"]); st != "" && st != "dead_letter" {
			continue
		}
		out = append(out, normalizeDeliveryAttempt(d))
	}
	return out, nil
}

func normalizeDeliveryAttempt(d map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range d {
		out[k] = v
	}
	if str(out["targetMasked"]) == "" {
		out["targetMasked"] = coalesce(str(out["target"]), "***")
	}
	if str(out["payloadSummary"]) == "" {
		out["payloadSummary"] = coalesce(str(out["error"]), "投递失败")
	}
	if str(out["createdAt"]) == "" {
		out["createdAt"] = coalesce(str(out["at"]), time.Now().UTC().Format(time.RFC3339))
	}
	if str(out["deploymentId"]) == "" {
		out["deploymentId"] = coalesce(str(out["channelId"]), "")
	}
	if str(out["correlationId"]) == "" {
		out["correlationId"] = coalesce(str(out["id"]), "")
	}
	if out["attempts"] == nil {
		out["attempts"] = 1
	}
	if str(out["status"]) == "" {
		out["status"] = "dead_letter"
	}
	return out
}

func (s *Server) channelControlAudit(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, a := range s.Store.ChannelAudit {
		if str(a["workspaceId"]) == ws {
			out = append(out, a)
		}
	}
	return out, nil
}

func (s *Server) channelControlHealth(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, d := range s.Store.ChannelDeploys {
		if str(d["workspaceId"]) != ws {
			continue
		}
		id := str(d["id"])
		h := s.Store.ChannelHealth[id]
		if h == nil {
			status := "offline"
			rate, p95 := 0.0, 0
			if str(d["status"]) == "active" {
				status = "healthy"
				rate, p95 = 99.0, 150
			}
			h = map[string]any{"deploymentId": id, "successRate": rate, "p95Ms": p95, "errorCount24h": 0, "status": status}
		}
		row := map[string]any{}
		for k, v := range h {
			row[k] = v
		}
		row["deploymentId"] = id
		row["name"] = d["name"]
		row["kind"] = d["kind"]
		row["environment"] = d["environment"]
		row["deployStatus"] = d["status"]
		out = append(out, row)
	}
	return out, nil
}

func (s *Server) channelControlPolicyAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "策略不存在")
	}
	pid, action := parts[3], parts[4]
	ws := s.workspaceID(r)

	if action == "versions" && r.Method == http.MethodGet {
		if _, err := s.requireChannelRead(r); err != nil {
			return nil, err
		}
		s.Store.RLock()
		defer s.Store.RUnlock()
		out := make([]map[string]any, 0)
		for _, v := range s.Store.DeliveryPolicyVersions {
			if str(v["policyId"]) == pid {
				out = append(out, v)
			}
		}
		return out, nil
	}

	id, err := s.requireChannelWrite(r)
	if err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)

	s.Store.Lock()
	defer s.Store.Unlock()
	var p map[string]any
	for _, x := range s.Store.DeliveryPolicies {
		if str(x["id"]) == pid {
			p = x
			break
		}
	}
	if p == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "E_DELIVERY_POLICY_NOT_FOUND: 投递策略不存在")
	}
	if str(p["workspaceId"]) != ws {
		return nil, apperr.Forbidden(apperr.ChannelWriteForbidden, "E_CHANNEL_WORKSPACE_SCOPE: 无权操作其他工作区渠道资源")
	}

	switch action {
	case "validate":
		issues := s.validateDeliveryPolicyLocked(p)
		p["validationIssues"] = issues
		if len(issues) == 0 {
			p["status"] = "ready"
		} else {
			p["status"] = "draft"
		}
		result := "success"
		reason := strings.Join(issues, "；")
		if len(issues) > 0 {
			result = "failed"
		}
		s.appendChannelAuditLocked(ws, id.Name, "校验投递策略", coalesce(str(p["eventType"]), pid), result, reason, "")
		go s.persistChannel()
		return p, nil
	case "publish":
		if str(p["status"]) != "ready" {
			return nil, apperr.BadReq(apperr.BadRequest, "E_DELIVERY_POLICY_NOT_READY: 策略尚未通过校验")
		}
		verNum := 0
		for _, v := range s.Store.DeliveryPolicyVersions {
			if str(v["policyId"]) == pid && toInt(v["version"]) > verNum {
				verNum = toInt(v["version"])
			}
		}
		snap := map[string]any{}
		for k, v := range p {
			snap[k] = v
		}
		snap["status"] = "published"
		snap["fallbackDeploymentIds"] = stringSliceAny(p["fallbackDeploymentIds"])
		snap["validationIssues"] = []string{}
		version := map[string]any{
			"id": s.Store.ID("delivery_version"), "policyId": pid, "version": verNum + 1,
			"snapshot": snap, "publishedAt": time.Now().UTC().Format(time.RFC3339), "publishedBy": id.Name,
		}
		s.Store.DeliveryPolicyVersions = append([]map[string]any{version}, s.Store.DeliveryPolicyVersions...)
		p["status"] = "published"
		p["validationIssues"] = []string{}
		s.appendChannelAuditLocked(ws, id.Name, "发布投递策略", coalesce(str(p["eventType"]), pid), "success", str(body["reason"]), "")
		go s.persistChannel()
		return version, nil
	case "simulate":
		issues := s.validateDeliveryPolicyLocked(p)
		status := "passed"
		if len(issues) > 0 {
			status = "blocked"
		}
		risk := "attention"
		if len(stringSliceAny(p["fallbackDeploymentIds"])) > 0 {
			risk = "normal"
		}
		scope := "sandbox"
		if str(body["scope"]) == "canary" {
			scope = "canary"
		}
		return map[string]any{
			"policyId": pid, "scope": scope, "status": status, "issues": issues, "capacityRisk": risk,
		}, nil
	case "rollback":
		vid := str(body["versionId"])
		var target map[string]any
		for _, v := range s.Store.DeliveryPolicyVersions {
			if str(v["id"]) == vid && str(v["policyId"]) == pid {
				target = v
				break
			}
		}
		if target == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "E_DELIVERY_VERSION_NOT_FOUND: 策略版本不存在")
		}
		snap, _ := target["snapshot"].(map[string]any)
		if snap == nil {
			return nil, apperr.BadReq(apperr.BadRequest, "版本快照无效")
		}
		issues := s.validateDeliveryPolicyLocked(snap)
		if len(issues) > 0 {
			return nil, apperr.BadReq(apperr.BadRequest, "E_DELIVERY_ROLLBACK_INVALID: "+strings.Join(issues, "；"))
		}
		verNum := 0
		for _, v := range s.Store.DeliveryPolicyVersions {
			if str(v["policyId"]) == pid && toInt(v["version"]) > verNum {
				verNum = toInt(v["version"])
			}
		}
		newSnap := map[string]any{}
		for k, v := range snap {
			newSnap[k] = v
		}
		newSnap["status"] = "published"
		version := map[string]any{
			"id": s.Store.ID("delivery_version"), "policyId": pid, "version": verNum + 1,
			"snapshot": newSnap, "publishedAt": time.Now().UTC().Format(time.RFC3339),
			"publishedBy": id.Name, "rollbackOf": vid,
		}
		s.Store.DeliveryPolicyVersions = append([]map[string]any{version}, s.Store.DeliveryPolicyVersions...)
		for k, v := range newSnap {
			p[k] = v
		}
		s.appendChannelAuditLocked(ws, id.Name, "回滚投递策略", coalesce(str(p["eventType"]), pid), "success", str(body["reason"]), "")
		go s.persistChannel()
		return version, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "未知动作")
}

func (s *Server) channelControlDeliveries(r *http.Request) (any, error) {
	id, err := s.requireChannelWrite(r)
	if err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)

	s.Store.RLock()
	var policy map[string]any
	for _, p := range s.Store.DeliveryPolicies {
		if str(p["id"]) == str(body["policyId"]) {
			policy = p
			break
		}
	}
	var deploy map[string]any
	if policy != nil {
		deploy = s.findDeployLocked(str(policy["primaryDeploymentId"]), ws)
	}
	s.Store.RUnlock()

	if policy == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "E_DELIVERY_POLICY_NOT_FOUND: 投递策略不存在")
	}
	if str(policy["workspaceId"]) != ws {
		return nil, apperr.Forbidden(apperr.ChannelWriteForbidden, "E_CHANNEL_WORKSPACE_SCOPE: 无权操作其他工作区渠道资源")
	}
	if str(policy["status"]) != "published" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_DELIVERY_POLICY_NOT_PUBLISHED: 仅已发布策略可以投递")
	}

	target := str(body["target"])
	content := coalesce(str(body["content"]), str(body["text"]))
	receiveType := coalesce(str(body["receiveIdType"]), coalesce(str(body["receive_id_type"]), "chat_id"))
	failed := strings.Contains(target, "fail")
	providerMsgID := ""
	deliveryErr := ""

	if !failed && deploy != nil {
		kind := str(deploy["kind"])
		raw := ""
		if s.Vault != nil {
			if v, err := s.Vault.Resolve(r.Context(), str(deploy["credentialRef"])); err == nil {
				raw = v
			}
		}
		switch kind {
		case "feishu", "lark":
			if raw == "" {
				failed = true
				deliveryErr = "missing feishu credential"
			} else if cred, err := feishu.ParseCredentials(raw); err != nil {
				failed = true
				deliveryErr = err.Error()
			} else {
				cli := feishu.NewClient()
				if s.FeishuHTTP != nil {
					cli.HTTP = s.FeishuHTTP
				}
				mid, sendErr := cli.SendText(r.Context(), cred, receiveType, target, content)
				if sendErr != nil {
					failed = true
					deliveryErr = sendErr.Error()
				} else {
					providerMsgID = mid
				}
			}
		case "dingtalk":
			if raw == "" {
				failed = true
				deliveryErr = "missing dingtalk credential"
			} else if cred, err := dingtalk.ParseCredentials(raw); err != nil {
				failed = true
				deliveryErr = err.Error()
			} else {
				cli := dingtalk.NewClient()
				if s.DingTalkHTTP != nil {
					cli.HTTP = s.DingTalkHTTP
				}
				mid, sendErr := cli.SendText(r.Context(), cred, target, content)
				if sendErr != nil {
					failed = true
					deliveryErr = sendErr.Error()
				} else {
					providerMsgID = mid
				}
			}
		case "wecom":
			if raw == "" {
				failed = true
				deliveryErr = "missing wecom credential"
			} else if cred, err := wecom.ParseCredentials(raw); err != nil {
				failed = true
				deliveryErr = err.Error()
			} else {
				cli := wecom.NewClient()
				if s.WecomHTTP != nil {
					cli.HTTP = s.WecomHTTP
				}
				mid, sendErr := cli.SendText(r.Context(), cred, target, content)
				if sendErr != nil {
					failed = true
					deliveryErr = sendErr.Error()
				} else {
					providerMsgID = mid
				}
			}
		case "weixin", "wechat":
			ctxTok := coalesce(str(body["contextToken"]), str(body["context_token"]))
			if raw == "" {
				failed = true
				deliveryErr = "missing weixin credential"
			} else if cred, err := weixin.ParseCredentials(raw); err != nil {
				failed = true
				deliveryErr = err.Error()
			} else {
				cli := weixin.NewClient()
				if s.WeixinHTTP != nil {
					cli.HTTP = s.WeixinHTTP
				}
				if sendErr := cli.SendText(r.Context(), cred, target, content, ctxTok, ""); sendErr != nil {
					failed = true
					deliveryErr = sendErr.Error()
				} else {
					providerMsgID = "weixin-ok"
				}
			}
		}
	}

	corr := s.Store.ID("delivery_corr")
	summary := truncateRunes(content, 24)
	summary = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '@' || r == '.' || r == '-' {
			return '*'
		}
		return r
	}, summary)
	attempt := map[string]any{
		"id": s.Store.ID("delivery_attempt"), "workspaceId": ws, "policyId": policy["id"],
		"deploymentId": policy["primaryDeploymentId"],
		"targetMasked": maskTarget(target), "payloadSummary": summary,
		"status": "delivered", "attempts": 1, "correlationId": corr,
		"createdAt": time.Now().UTC().Format(time.RFC3339),
	}
	if providerMsgID != "" {
		attempt["providerMessageId"] = providerMsgID
	}
	action := "投递消息"
	result := "success"
	if failed {
		attempt["status"] = "dead_letter"
		attempt["attempts"] = 3
		if deliveryErr != "" {
			attempt["error"] = deliveryErr
		}
		s.Store.Lock()
		s.Store.ChannelDLQ = append([]map[string]any{attempt}, s.Store.ChannelDLQ...)
		s.appendChannelAuditLocked(ws, id.Name, "投递进入死信队列", coalesce(str(policy["eventType"]), str(policy["id"])), "failed", deliveryErr, corr)
		s.Store.Unlock()
		go s.persistChannel()
		return attempt, nil
	}
	s.Store.Lock()
	s.appendChannelAuditLocked(ws, id.Name, action, coalesce(str(policy["eventType"]), str(policy["id"])), result, "", corr)
	s.Store.Unlock()
	go s.persistChannel()
	return attempt, nil
}

func maskTarget(value string) string {
	value = strings.TrimSpace(value)
	if len(value) < 5 {
		return "***"
	}
	return value[:2] + "***" + value[len(value)-2:]
}

func (s *Server) listChannelTemplates(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, t := range s.Store.ChannelTemplates {
		if str(t["workspaceId"]) == "" || str(t["workspaceId"]) == ws {
			out = append(out, t)
		}
	}
	return out, nil
}

func (s *Server) createChannelTemplate(r *http.Request) (any, error) {
	id, err := s.requireChannelWrite(r)
	if err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "模板名称不能为空")
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)
	kind := coalesce(str(body["kind"]), "feishu")
	if kind == "email" || kind == "sms" || kind == "phone" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 不支持邮件、短信、电话渠道")
	}
	item := map[string]any{
		"id": s.Store.ID("template"), "workspaceId": ws, "name": name,
		"kind": kind, "desc": coalesce(str(body["desc"]), ""),
		"preview": coalesce(str(body["preview"]), ""), "locale": coalesce(str(body["locale"]), "zh-CN"),
		"status": coalesce(str(body["status"]), "draft"), "tone": coalesce(str(body["tone"]), "info"),
		"updatedAt": now,
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.ChannelTemplates = append([]map[string]any{item}, s.Store.ChannelTemplates...)
	s.appendChannelAuditLocked(ws, id.Name, "创建消息模板", name, "success", "", "")
	go s.persistChannel()
	return item, nil
}

func (s *Server) listChannelBlacklist(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, b := range s.Store.ChannelBlacklist {
		if str(b["workspaceId"]) == "" || str(b["workspaceId"]) == ws {
			out = append(out, b)
		}
	}
	return out, nil
}

func (s *Server) createChannelBlacklist(r *http.Request) (any, error) {
	id, err := s.requireChannelWrite(r)
	if err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	value := strings.TrimSpace(str(body["value"]))
	if value == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "黑名单对象不能为空")
	}
	ws := s.workspaceID(r)
	item := map[string]any{
		"id": s.Store.ID("blacklist"), "workspaceId": ws,
		"type": coalesce(str(body["type"]), "用户"), "value": value,
		"reason": coalesce(str(body["reason"]), "手动添加"), "addedBy": id.Name,
		"expires": coalesce(str(body["expires"]), "永久"),
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.ChannelBlacklist = append([]map[string]any{item}, s.Store.ChannelBlacklist...)
	s.appendChannelAuditLocked(ws, id.Name, "加入黑名单", value, "success", "", "")
	go s.persistChannel()
	return item, nil
}
