package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/dingtalk"
	"github.com/qizhida-partner-platform/backend/internal/feishu"
	"github.com/qizhida-partner-platform/backend/internal/wecom"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) ensureChannelSession(ws, channel, threadID, deployID, employeeID, actorID string) (sessionID, conversationID string, created bool) {
	channel = strings.TrimSpace(channel)
	threadID = strings.TrimSpace(threadID)
	if ws == "" || channel == "" || threadID == "" {
		return "", "", false
	}
	now := time.Now().UTC().Format(time.RFC3339)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, sess := range s.Store.Sessions {
		if str(sess["workspaceId"]) != ws {
			continue
		}
		if str(sess["channel"]) != channel || str(sess["channelThreadId"]) != threadID {
			continue
		}
		if str(sess["status"]) == "closed" {
			continue
		}
		sid := str(sess["id"])
		cid := coalesce(str(sess["conversationId"]), sid)
		if employeeID != "" && str(sess["digitalPartnerId"]) == "" {
			sess["digitalPartnerId"] = employeeID
		}
		sess["updatedAt"] = now
		return sid, cid, false
	}
	convID := s.Store.ID("conv")
	sessID := s.Store.ID("sess")
	deName := "助手"
	if employeeID != "" {
		for _, emp := range s.Store.Employees {
			if str(emp["id"]) == employeeID {
				deName = coalesce(str(emp["name"]), coalesce(str(emp["role"]), deName))
				break
			}
		}
	}
	title := channelSessionTitle(channel)
	sessionMode := s.resolveDefaultSessionMode(employeeID)
	riskLevel := s.resolveDefaultRiskLevel(employeeID)
	s.Store.Conversations = append([]map[string]any{{
		"id": convID, "workspaceId": ws, "title": title,
		"digitalPartnerId": employeeID, "updatedAt": now,
		"channel": channel, "channelThreadId": threadID,
	}}, s.Store.Conversations...)
	s.Store.Sessions = append([]map[string]any{{
		"id": sessID, "workspaceId": ws, "ownerId": actorID, "title": title,
		"preview": "渠道入站", "agent": deName,
		"digitalPartnerId": employeeID, "digitalPartnerName": deName,
		"conversationId": convID, "status": "active",
		"channel": channel, "channelThreadId": threadID, "channelDeploymentId": deployID,
		"sessionMode": sessionMode, "riskLevel": riskLevel,
		"createdAt": now, "updatedAt": now, "lastMessageAt": now,
	}}, s.Store.Sessions...)
	if s.Store.Messages[convID] == nil {
		s.Store.Messages[convID] = []map[string]any{}
	}
	return sessID, convID, true
}

func (s *Server) bindInboundSession(ws, channel, threadID, deployID, employeeID string, actor *auth.Identity) (sessionID, conversationID string, created bool) {
	actorID := ""
	if actor != nil {
		actorID = actor.ID
	}
	if s.ownsCollabRuntime() {
		return s.ensureChannelSession(ws, channel, threadID, deployID, employeeID, actorID)
	}
	req := s.requestWithActor(nil, actor, ws)
	data, err := s.peerPOST(req, collabBaseURL(), "/api/internal/channel-sessions", map[string]any{
		"workspaceId": ws, "channel": channel, "channelThreadId": threadID,
		"deploymentId": deployID, "digitalPartnerId": employeeID, "actorId": actorID,
	})
	if err != nil {
		return "", "", false
	}
	m, _ := data.(map[string]any)
	if m == nil {
		return "", "", false
	}
	return str(m["sessionId"]), str(m["conversationId"]), m["created"] == true
}

func (s *Server) dispatchInboundCopilot(ctx context.Context, ws, sessID, convID, corr string, actor *auth.Identity, payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	if s.ownsCollabRuntime() {
		req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/"+sessID+"/stream", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-workspace-id", ws)
		req.Header.Set("x-correlation-id", corr)
		if actor != nil {
			wsCtx := &WorkspaceCtx{TenantID: actor.TenantID, WorkspaceID: ws, ActorID: actor.ID, Role: actor.Role}
			req = req.WithContext(withWorkspace(auth.WithIdentity(ctx, actor), wsCtx))
		} else {
			req = req.WithContext(ctx)
		}
		rr := httptest.NewRecorder()
		s.copilotStream(rr, req)
		return s.lastAssistantText(convID, corr)
	}
	req := s.requestWithActor(nil, actor, ws)
	req = req.WithContext(ctx)
	text, err := s.peerPOSTStream(req, collabBaseURL(), "/api/copilot/conversations/"+sessID+"/stream", payload)
	if err != nil {
		return ""
	}
	return text
}

func (s *Server) persistChannelSessionIfLocal(created bool) {
	if !created || !s.ownsCollabRuntime() {
		return
	}
	s.Store.Persist("sessions")
	s.Store.Persist("conversations")
	s.Store.Persist("messages")
}

func (s *Server) defaultEmployeeIDForWorkspace(ws string, deploy map[string]any) string {
	if de := str(deploy["digitalPartnerId"]); de != "" {
		return de
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, emp := range s.Store.Employees {
		if str(emp["workspaceId"]) != ws {
			continue
		}
		life := str(emp["lifecycle"])
		if life == "active" || life == "published" {
			return str(emp["id"])
		}
	}
	return ""
}

func channelSessionTitle(channel string) string {
	switch channel {
	case contract.ChannelFeishu:
		return "飞书会话"
	case contract.ChannelWecom:
		return "企微会话"
	case contract.ChannelDingtalk:
		return "钉钉会话"
	default:
		return "渠道会话"
	}
}

// resolveDefaultSessionMode returns the digital employee's configured
// session mode (Ch7), or SessionModeInvestigate when unspecified.
//
// The mode lives under employee["spec"]["defaultSessionMode"]. Legacy
// employees without an explicit Spec fall back to the safe default.
func (s *Server) resolveDefaultSessionMode(employeeID string) string {
	if employeeID == "" || s.Store == nil {
		return contract.SessionModeInvestigate
	}
	for _, emp := range s.Store.Employees {
		if str(emp["id"]) != employeeID {
			continue
		}
		spec, _ := emp["spec"].(map[string]any)
		if spec != nil {
			if m := strings.TrimSpace(str(spec["defaultSessionMode"])); m != "" && validSessionMode(m) {
				return m
			}
		}
		break
	}
	return contract.SessionModeInvestigate
}

// resolveDefaultRiskLevel returns the digital employee's configured risk
// floor (Ch7), or RiskLevelMedium when unspecified.
func (s *Server) resolveDefaultRiskLevel(employeeID string) string {
	if employeeID == "" || s.Store == nil {
		return contract.RiskLevelMedium
	}
	for _, emp := range s.Store.Employees {
		if str(emp["id"]) != employeeID {
			continue
		}
		spec, _ := emp["spec"].(map[string]any)
		if spec != nil {
			if r := strings.TrimSpace(str(spec["defaultRiskLevel"])); r != "" && validRiskLevel(r) {
				return r
			}
		}
		break
	}
	return contract.RiskLevelMedium
}

func validSessionMode(m string) bool {
	switch m {
	case contract.SessionModeInvestigate, contract.SessionModeExecute:
		return true
	}
	return false
}

func validRiskLevel(r string) bool {
	switch r {
	case contract.RiskLevelLow, contract.RiskLevelMedium, contract.RiskLevelHigh:
		return true
	}
	return false
}

func channelInboundIdentity(channel, ws, openID string) *auth.Identity {
	ch := strings.TrimSpace(channel)
	if ch == "" {
		ch = "channel"
	}
	uid := ch + ":inbound"
	if strings.TrimSpace(openID) != "" {
		uid = ch + ":" + strings.TrimSpace(openID)
	}
	name := "渠道用户"
	switch ch {
	case contract.ChannelFeishu:
		name = "飞书用户"
	case contract.ChannelWecom:
		name = "企微用户"
	case contract.ChannelDingtalk:
		name = "钉钉用户"
	}
	return &auth.Identity{
		ID: uid, Name: name, Role: "user",
		TenantID: "tenant-acme", WorkspaceID: ws, WorkspaceIDs: []string{ws},
		EnvironmentScopes: []string{"sandbox", "staging", "production"},
		Permissions:       auth.RolePermissions("user"),
	}
}

func (s *Server) routeFeishuMessage(ctx context.Context, ws, deployID string, deploy map[string]any, msg *feishu.InboundMessage) {
	if msg == nil || strings.TrimSpace(msg.Text) == "" || strings.TrimSpace(msg.ChatID) == "" {
		return
	}
	actor := channelInboundIdentity(contract.ChannelFeishu, ws, msg.SenderOpenID)
	employeeID := s.defaultEmployeeIDForWorkspace(ws, deploy)
	sessID, convID, created := s.bindInboundSession(ws, contract.ChannelFeishu, msg.ChatID, deployID, employeeID, actor)
	if sessID == "" {
		s.appendChannelThreadUnbound(ws, contract.ChannelFeishu, deployID, msg.ChatID, msg.EventID)
		return
	}
	s.persistChannelSessionIfLocal(created)
	corr := s.Store.ID("corr")
	reply := s.dispatchInboundCopilot(ctx, ws, sessID, convID, corr, actor, map[string]any{
		"content":           msg.Text,
		"correlationId":     corr,
		"digitalPartnerId": employeeID,
		"sessionMode":       contract.SessionModeInvestigate,
		"channel":           contract.ChannelFeishu,
		"channelThreadId":   msg.ChatID,
		"clientMsgId":       coalesce(msg.MessageID, msg.EventID),
	})
	if strings.TrimSpace(reply) == "" {
		return
	}
	if err := s.deliverFeishuReply(ctx, deploy, msg.ChatID, reply); err != nil {
		s.pushChannelDLQ(ws, deployID, contract.ChannelFeishu, msg.ChatID, reply, corr, err.Error())
	}
}

func (s *Server) inboundEventDuplicate(field, value string) bool {
	if value == "" {
		return false
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	n := 0
	for _, in := range s.Store.ChannelInbound {
		if str(in[field]) == value {
			n++
			if n > 1 {
				return true
			}
		}
	}
	return false
}

func (s *Server) appendChannelThreadUnbound(ws, channel, deployID, threadID, eventID string) {
	s.Store.Lock()
	s.appendChannelAuditLocked(ws, channel+"-webhook", "渠道路由失败", threadID, "failed", string(apperr.ChannelThreadUnbound), eventID)
	s.Store.Unlock()
	s.Store.Persist("channel_audit")
}

func (s *Server) lastAssistantText(conversationID, corr string) string {
	s.Store.RLock()
	defer s.Store.RUnlock()
	msgs := s.Store.Messages[conversationID]
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if str(m["role"]) != "assistant" {
			continue
		}
		if corr != "" && str(m["correlationId"]) != corr {
			continue
		}
		return str(m["content"])
	}
	return ""
}

func (s *Server) deliverFeishuReply(ctx context.Context, deploy map[string]any, chatID, text string) error {
	credRef := str(deploy["credentialRef"])
	raw := ""
	if s.Vault != nil && credRef != "" {
		if v, err := s.Vault.Resolve(ctx, credRef); err == nil {
			raw = v
		}
	}
	if raw == "" {
		return apperr.BadReq(apperr.CredentialsRequired, "飞书凭据缺失")
	}
	cred, err := feishu.ParseCredentials(raw)
	if err != nil {
		return err
	}
	cli := feishu.NewClient()
	if s.FeishuHTTP != nil {
		cli.HTTP = s.FeishuHTTP
	}
	_, err = cli.SendText(ctx, cred, "chat_id", chatID, text)
	return err
}

func (s *Server) pushChannelDLQ(ws, deployID, channel, target, summary, corr, errMsg string) {
	now := time.Now().UTC().Format(time.RFC3339)
	item := map[string]any{
		"id": s.Store.ID("dlq"), "workspaceId": ws, "deploymentId": deployID,
		// channelId stores the REAL chat/thread identifier (Feishu chatID,
		// Wecom/Dingtalk threadID) — earlier this stored deployID which
		// made the DLQ unfilterable for replay tooling ("which chat thread
		// do I retry on" is the natural filter, and the deploy id answered
		// the wrong question).
		"channelId":       target,
		"channelThreadId": target,
		"kind":            channel, "status": "dead_letter",
		"targetMasked":    maskTarget(target), "payloadSummary": truncateRunes(summary, 48),
		"error": errMsg, "at": now, "createdAt": now, "attempts": 1,
		"replayable": true, "correlationId": corr,
	}
	s.Store.Lock()
	s.Store.ChannelDLQ = append([]map[string]any{item}, s.Store.ChannelDLQ...)
	s.appendChannelAuditLocked(ws, channel+"-webhook", "渠道出站失败入DLQ", target, "failed", errMsg, corr)
	s.Store.Unlock()
	s.Store.Persist("channel_dlq")
	s.Store.Persist("channel_audit")
}

func (s *Server) routeWecomMessage(ctx context.Context, ws, deployID string, deploy map[string]any, msg *wecom.InboundMessage) {
	if msg == nil || strings.TrimSpace(msg.Text) == "" {
		return
	}
	threadID := msg.ThreadID()
	if threadID == "" {
		return
	}
	actor := channelInboundIdentity(contract.ChannelWecom, ws, msg.FromUserName)
	employeeID := s.defaultEmployeeIDForWorkspace(ws, deploy)
	sessID, convID, created := s.bindInboundSession(ws, contract.ChannelWecom, threadID, deployID, employeeID, actor)
	if sessID == "" {
		s.appendChannelThreadUnbound(ws, contract.ChannelWecom, deployID, threadID, msg.MsgID)
		return
	}
	s.persistChannelSessionIfLocal(created)
	corr := s.Store.ID("corr")
	reply := s.dispatchInboundCopilot(ctx, ws, sessID, convID, corr, actor, map[string]any{
		"content":           msg.Text,
		"correlationId":     corr,
		"digitalPartnerId": employeeID,
		"sessionMode":       contract.SessionModeInvestigate,
		"channel":           contract.ChannelWecom,
		"channelThreadId":   threadID,
		"clientMsgId":       msg.MsgID,
	})
	if strings.TrimSpace(reply) == "" {
		return
	}
	if err := s.deliverWecomReply(ctx, deploy, msg.FromUserName, reply); err != nil {
		s.pushChannelDLQ(ws, deployID, contract.ChannelWecom, threadID, reply, corr, err.Error())
	}
}

func (s *Server) deliverWecomReply(ctx context.Context, deploy map[string]any, toUser, text string) error {
	credRef := str(deploy["credentialRef"])
	raw := ""
	if s.Vault != nil && credRef != "" {
		if v, err := s.Vault.Resolve(ctx, credRef); err == nil {
			raw = v
		}
	}
	if raw == "" {
		return apperr.BadReq(apperr.CredentialsRequired, "企微凭据缺失")
	}
	cred, err := wecom.ParseCredentials(raw)
	if err != nil {
		return err
	}
	cli := wecom.NewClient()
	if s.WecomHTTP != nil {
		cli.HTTP = s.WecomHTTP
	}
	_, err = cli.SendText(ctx, cred, toUser, text)
	return err
}

func (s *Server) routeDingtalkMessage(ctx context.Context, ws, deployID string, deploy map[string]any, msg *dingtalk.InboundMessage) {
	if msg == nil || strings.TrimSpace(msg.Text) == "" {
		return
	}
	threadID := msg.ThreadID()
	if threadID == "" {
		return
	}
	actor := channelInboundIdentity(contract.ChannelDingtalk, ws, msg.SenderID)
	employeeID := s.defaultEmployeeIDForWorkspace(ws, deploy)
	sessID, convID, created := s.bindInboundSession(ws, contract.ChannelDingtalk, threadID, deployID, employeeID, actor)
	if sessID == "" {
		s.appendChannelThreadUnbound(ws, contract.ChannelDingtalk, deployID, threadID, msg.MessageID)
		return
	}
	s.persistChannelSessionIfLocal(created)
	corr := s.Store.ID("corr")
	reply := s.dispatchInboundCopilot(ctx, ws, sessID, convID, corr, actor, map[string]any{
		"content":           msg.Text,
		"correlationId":     corr,
		"digitalPartnerId": employeeID,
		"sessionMode":       contract.SessionModeInvestigate,
		"channel":           contract.ChannelDingtalk,
		"channelThreadId":   threadID,
		"clientMsgId":       msg.MessageID,
	})
	if strings.TrimSpace(reply) == "" {
		return
	}
	if err := s.deliverDingtalkReply(ctx, deploy, msg, reply); err != nil {
		s.pushChannelDLQ(ws, deployID, contract.ChannelDingtalk, threadID, reply, corr, err.Error())
	}
}

func (s *Server) deliverDingtalkReply(ctx context.Context, deploy map[string]any, msg *dingtalk.InboundMessage, text string) error {
	cli := dingtalk.NewClient()
	if s.DingTalkHTTP != nil {
		cli.HTTP = s.DingTalkHTTP
	}
	if msg != nil && strings.TrimSpace(msg.SessionWebhook) != "" {
		return cli.ReplySession(ctx, msg.SessionWebhook, text)
	}
	credRef := str(deploy["credentialRef"])
	raw := ""
	if s.Vault != nil && credRef != "" {
		if v, err := s.Vault.Resolve(ctx, credRef); err == nil {
			raw = v
		}
	}
	if raw == "" {
		return apperr.BadReq(apperr.CredentialsRequired, "钉钉凭据缺失")
	}
	cred, err := dingtalk.ParseCredentials(raw)
	if err != nil {
		return err
	}
	to := ""
	if msg != nil {
		to = msg.SenderID
	}
	_, err = cli.SendText(ctx, cred, to, text)
	return err
}
