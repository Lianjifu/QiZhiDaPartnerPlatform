package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/feishu"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

// handleFeishuWebhook is the public Feishu/Lark event callback endpoint
// (no Bearer auth — verified via Encrypt Key signature / Verification Token).
// Path: POST /api/channel/feishu/events/{deploymentId}
func (s *Server) handleFeishuWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api channel feishu events {id}
	if len(parts) < 5 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	deployID := parts[4]

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}

	s.Store.RLock()
	var deploy map[string]any
	for _, d := range s.Store.ChannelDeploys {
		if str(d["id"]) == deployID {
			deploy = d
			break
		}
	}
	credRef := ""
	ws := ""
	name := ""
	if deploy != nil {
		credRef = str(deploy["credentialRef"])
		ws = str(deploy["workspaceId"])
		name = str(deploy["name"])
	}
	s.Store.RUnlock()
	if deploy == nil {
		http.Error(w, "deployment not found", http.StatusNotFound)
		return
	}

	rawCred := ""
	if s.Vault != nil && credRef != "" {
		if v, rerr := s.Vault.Resolve(r.Context(), credRef); rerr == nil {
			rawCred = v
		}
	}
	if rawCred == "" {
		http.Error(w, "credential missing", http.StatusBadRequest)
		return
	}
	cred, err := feishu.ParseCredentials(rawCred)
	if err != nil {
		http.Error(w, "invalid credential", http.StatusBadRequest)
		return
	}

	// Signature check when Encrypt Key present
	if cred.EncryptKey != "" {
		ts := r.Header.Get("X-Lark-Request-Timestamp")
		nonce := r.Header.Get("X-Lark-Request-Nonce")
		sig := r.Header.Get("X-Lark-Signature")
		if !feishu.VerifySignature(ts, nonce, cred.EncryptKey, body, sig) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
	}

	env, _, msg, err := feishu.ParseAndNormalize(body, cred)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// URL verification challenge (open platform save request URL)
	if env.Type == "url_verification" || (env.Challenge != "" && env.Type == "url_verification") {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]string{"challenge": env.Challenge})
		return
	}
	if env.Challenge != "" && env.Type == "" && env.Schema == "" {
		// some payloads only have challenge after decrypt
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]string{"challenge": env.Challenge})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	inbound := map[string]any{
		"id": s.Store.ID("cin"), "workspaceId": ws, "deploymentId": deployID,
		"provider": "feishu", "receivedAt": now,
	}
	if msg != nil {
		inbound["eventId"] = msg.EventID
		inbound["eventType"] = msg.EventType
		inbound["chatId"] = msg.ChatID
		inbound["chatType"] = msg.ChatType
		inbound["messageId"] = msg.MessageID
		inbound["messageType"] = msg.MessageType
		inbound["text"] = msg.Text
		inbound["senderOpenId"] = msg.SenderOpenID
		inbound["senderType"] = msg.SenderType
	} else {
		inbound["eventType"] = coalesce(env.Type, "unknown")
	}

	s.Store.Lock()
	s.Store.ChannelInbound = append([]map[string]any{inbound}, s.Store.ChannelInbound...)
	dropped := idsBeyondKeep(s.Store.ChannelInbound, 500)
	if len(s.Store.ChannelInbound) > 500 {
		s.Store.ChannelInbound = s.Store.ChannelInbound[:500]
	}
	action := "接收飞书事件"
	target := name
	if msg != nil && msg.Text != "" {
		action = "接收飞书消息"
		target = truncateRunes(msg.Text, 32)
	}
	s.appendChannelAuditLocked(ws, "feishu-webhook", action, target, "success", str(inbound["eventType"]), str(inbound["eventId"]))
	s.Store.Unlock()
	if len(dropped) > 0 {
		s.durableDeleteSync("channel_inbound", dropped...)
	}
	go s.persistChannel()

	if msg != nil && strings.TrimSpace(msg.Text) != "" && strings.TrimSpace(msg.ChatID) != "" {
		if msg.EventID == "" || !s.inboundEventDuplicate("eventId", msg.EventID) {
			actor := channelInboundIdentity(contract.ChannelFeishu, ws, msg.SenderOpenID)
			employeeID := s.defaultEmployeeIDForWorkspace(ws, deploy)
			if _, _, created := s.bindInboundSession(ws, contract.ChannelFeishu, msg.ChatID, deployID, employeeID, actor); created {
				s.persistChannelSessionIfLocal(true)
			}
			deployCopy := deploy
			go func() {
				defer func() { _ = recover() }()
				s.routeFeishuMessage(context.Background(), ws, deployID, deployCopy, msg)
			}()
		}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{}`))
}

func (s *Server) channelControlInbound(r *http.Request) (any, error) {
	if _, err := s.requireChannelRead(r); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, item := range s.Store.ChannelInbound {
		if str(item["workspaceId"]) == ws {
			out = append(out, item)
		}
	}
	return out, nil
}

// channelPublicBaseURL builds absolute webhook URL hint for UI (optional env QZDA_PUBLIC_BASE_URL).
func channelPublicBaseURL() string {
	return strings.TrimRight(strings.TrimSpace(lookupEnv("QZDA_PUBLIC_BASE_URL")), "/")
}

// enrichFeishuDeployPublicURL kept as alias for older call sites / tests.
func (s *Server) enrichFeishuDeployPublicURL(item map[string]any) {
	s.enrichChannelWebhookURL(item)
}
