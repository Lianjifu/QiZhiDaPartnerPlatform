package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/dingtalk"
	"github.com/qizhida-partner-platform/backend/internal/wecom"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

// handleWecomWebhook serves GET/POST /api/channel/wecom/events/{deploymentId}
// (企业微信自建应用 API 接收 — 公开，靠 Token + EncodingAESKey).
func (s *Server) handleWecomWebhook(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	deployID := parts[4]
	deploy, credRef, ws, name := s.lookupChannelDeploy(deployID)
	if deploy == nil {
		http.Error(w, "deployment not found", http.StatusNotFound)
		return
	}
	rawCred := s.resolveVault(r, credRef)
	if rawCred == "" {
		http.Error(w, "credential missing", http.StatusBadRequest)
		return
	}
	cred, err := wecom.ParseCredentials(rawCred)
	if err != nil {
		http.Error(w, "invalid credential", http.StatusBadRequest)
		return
	}

	q := r.URL.Query()
	msgSig, timestamp, nonce := q.Get("msg_signature"), q.Get("timestamp"), q.Get("nonce")

	if r.Method == http.MethodGet {
		echo, err := wecom.VerifyURLEcho(cred, msgSig, timestamp, nonce, q.Get("echostr"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte(echo))
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}
	msg, err := wecom.ParseEncryptedCallback(cred, msgSig, timestamp, nonce, body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	inbound := map[string]any{
		"id": s.Store.ID("cin"), "workspaceId": ws, "deploymentId": deployID,
		"provider": "wecom", "receivedAt": time.Now().UTC().Format(time.RFC3339),
		"eventType": msg.MsgType, "messageId": msg.MsgID,
		"senderOpenId": msg.FromUserName, "text": msg.Text, "agentId": msg.AgentID,
		"chatId": msg.ChatID, "channelThreadId": msg.ThreadID(),
	}
	s.appendChannelInbound(ws, name, inbound)
	if strings.TrimSpace(msg.Text) != "" && msg.ThreadID() != "" {
		if msg.MsgID == "" || !s.inboundEventDuplicate("messageId", msg.MsgID) {
			actor := channelInboundIdentity(contract.ChannelWecom, ws, msg.FromUserName)
			employeeID := s.defaultEmployeeIDForWorkspace(ws, deploy)
			if _, _, created := s.bindInboundSession(ws, contract.ChannelWecom, msg.ThreadID(), deployID, employeeID, actor); created {
				s.persistChannelSessionIfLocal(true)
			}
			deployCopy := deploy
			go func() {
				defer func() { _ = recover() }()
				s.routeWecomMessage(context.Background(), ws, deployID, deployCopy, msg)
			}()
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write([]byte(`{}`))
}

// handleDingtalkWebhook serves POST /api/channel/dingtalk/events/{deploymentId}
func (s *Server) handleDingtalkWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	deployID := parts[4]
	deploy, credRef, ws, name := s.lookupChannelDeploy(deployID)
	if deploy == nil {
		http.Error(w, "deployment not found", http.StatusNotFound)
		return
	}
	rawCred := s.resolveVault(r, credRef)
	if rawCred == "" {
		http.Error(w, "credential missing", http.StatusBadRequest)
		return
	}
	cred, err := dingtalk.ParseCredentials(rawCred)
	if err != nil {
		http.Error(w, "invalid credential", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}
	ts := coalesce(r.Header.Get("timestamp"), r.URL.Query().Get("timestamp"))
	sign := coalesce(r.Header.Get("sign"), r.URL.Query().Get("sign"))
	if !dingtalk.VerifyRobotSign(ts, sign, cred.ClientSecret) {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}
	msg, err := dingtalk.ParseRobotCallback(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	inbound := map[string]any{
		"id": s.Store.ID("cin"), "workspaceId": ws, "deploymentId": deployID,
		"provider": "dingtalk", "receivedAt": time.Now().UTC().Format(time.RFC3339),
		"eventType": "robot_message", "messageId": msg.MessageID,
		"chatId": msg.ConversationID, "chatType": msg.ConversationType,
		"senderOpenId": msg.SenderID, "senderNick": msg.SenderNick,
		"text": msg.Text, "sessionWebhook": msg.SessionWebhook,
		"channelThreadId": msg.ThreadID(),
	}
	s.appendChannelInbound(ws, name, inbound)
	if strings.TrimSpace(msg.Text) != "" && msg.ThreadID() != "" {
		if msg.MessageID == "" || !s.inboundEventDuplicate("messageId", msg.MessageID) {
			actor := channelInboundIdentity(contract.ChannelDingtalk, ws, msg.SenderID)
			employeeID := s.defaultEmployeeIDForWorkspace(ws, deploy)
			if _, _, created := s.bindInboundSession(ws, contract.ChannelDingtalk, msg.ThreadID(), deployID, employeeID, actor); created {
				s.persistChannelSessionIfLocal(true)
			}
			deployCopy := deploy
			go func() {
				defer func() { _ = recover() }()
				s.routeDingtalkMessage(context.Background(), ws, deployID, deployCopy, msg)
			}()
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{})
}

func (s *Server) lookupChannelDeploy(deployID string) (deploy map[string]any, credRef, ws, name string) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, d := range s.Store.ChannelDeploys {
		if str(d["id"]) == deployID {
			return d, str(d["credentialRef"]), str(d["workspaceId"]), str(d["name"])
		}
	}
	return nil, "", "", ""
}

func (s *Server) resolveVault(r *http.Request, credRef string) string {
	if s.Vault == nil || credRef == "" {
		return ""
	}
	v, err := s.Vault.Resolve(r.Context(), credRef)
	if err != nil {
		return ""
	}
	return v
}

func (s *Server) appendChannelInbound(ws, deployName string, inbound map[string]any) {
	s.Store.Lock()
	s.Store.ChannelInbound = append([]map[string]any{inbound}, s.Store.ChannelInbound...)
	dropped := idsBeyondKeep(s.Store.ChannelInbound, 500)
	if len(s.Store.ChannelInbound) > 500 {
		s.Store.ChannelInbound = s.Store.ChannelInbound[:500]
	}
	action := "接收渠道事件"
	target := deployName
	if t := str(inbound["text"]); t != "" {
		action = "接收渠道消息"
		target = truncateRunes(t, 32)
	}
	s.appendChannelAuditLocked(ws, str(inbound["provider"])+"-webhook", action, target, "success", str(inbound["eventType"]), str(inbound["messageId"]))
	s.Store.Unlock()
	if len(dropped) > 0 {
		s.durableDeleteSync("channel_inbound", dropped...)
	}
	go s.persistChannel()
}

func (s *Server) enrichChannelWebhookURL(item map[string]any) {
	path := str(item["webhookPath"])
	if path == "" {
		return
	}
	if base := channelPublicBaseURL(); base != "" {
		item["webhookUrl"] = base + path
	} else {
		item["webhookUrl"] = path
	}
}
