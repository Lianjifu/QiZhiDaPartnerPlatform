package server

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// --- Home ---

func (s *Server) ackAlertPath(r *http.Request) (any, error) {
	// Accept both /acknowledge (Mock) and /ack (legacy). Delegated to the
	// M01 operations package — the legacy server.ackAlert moved into
	// internal/operations/handlers.go during Phase 2 consolidation.
	return s.opsH.AckAlert(r)
}

func toInt(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	default:
		return 0
	}
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return 0
	}
}

func intFrom(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int32:
		return int(t)
	case int64:
		return int(t)
	case float64:
		return int(t)
	case float32:
		return int(t)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(t))
		if err != nil {
			return 0
		}
		return n
	case json.Number:
		n, err := t.Int64()
		if err != nil {
			return 0
		}
		return int(n)
	default:
		return 0
	}
}

// Models handlers live in handlers_models.go

// Channel control handlers live in handlers_channels.go

// --- Copilot sessions / conversations (M02 协作 session/conversation surface) ---

func (s *Server) listSessions(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, sess := range s.Store.Sessions {
		sessWS := str(sess["workspaceId"])
		if sessWS == "" {
			sessWS = store.DefaultWorkspaceID
		}
		if sessWS != ws {
			continue
		}
		// Owner scope: non-admin only sees own sessions (and legacy rows without ownerId).
		owner := str(sess["ownerId"])
		if id.Role != "admin" && owner != "" && owner != id.ID {
			continue
		}
		cp := map[string]any{}
		for k, v := range sess {
			cp[k] = v
		}
		// 兼容精简种子：补齐前端会话列表所需字段，避免 Invalid Date 崩溃
		if str(cp["lastMessageAt"]) == "" {
			if v := str(cp["updatedAt"]); v != "" {
				cp["lastMessageAt"] = v
			} else if v := str(cp["createdAt"]); v != "" {
				cp["lastMessageAt"] = v
			}
		}
		if str(cp["createdAt"]) == "" {
			cp["createdAt"] = cp["lastMessageAt"]
		}
		if str(cp["updatedAt"]) == "" {
			cp["updatedAt"] = cp["lastMessageAt"]
		}
		if str(cp["preview"]) == "" {
			cp["preview"] = "暂无消息"
		}
		if str(cp["status"]) == "" {
			cp["status"] = "active"
		}
		if str(cp["agent"]) == "" {
			if name := str(cp["digitalPartnerName"]); name != "" {
				cp["agent"] = name
			} else {
				cp["agent"] = "助手"
			}
		}
		out = append(out, cp)
	}
	return out, nil
}

func (s *Server) createSession(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)
	deID := body["digitalPartnerId"]
	deName := strings.TrimSpace(coalesce(str(body["digitalPartnerName"]), str(body["agent"])))
	if deName == "" {
		if str(deID) != "" {
			deName = "岗位专家"
		} else {
			deName = "助手"
		}
	}
	title := coalesce(str(body["title"]), "新会话")
	modelID := coalesce(str(body["modelId"]), "sonnet-4")
	convID := coalesce(str(body["conversationId"]), s.Store.ID("conv"))
	sessID := coalesce(str(body["id"]), s.Store.ID("sess"))

	conv := map[string]any{
		"id": convID, "workspaceId": ws, "title": title,
		"digitalPartnerId": deID, "modelId": modelID, "updatedAt": now,
	}
	session := map[string]any{
		"id": sessID, "workspaceId": ws, "ownerId": id.ID, "title": title,
		"preview": coalesce(str(body["preview"]), "暂无消息"), "agent": deName,
		"digitalPartnerId": deID, "digitalPartnerName": deName,
		"conversationId": convID, "status": "active", "modelId": modelID,
		"sessionMode": sessionModeInvestigate, "riskLevel": "medium",
		"handoff":   map[string]any{"active": false},
		"createdAt": now, "updatedAt": now, "lastMessageAt": now,
	}
	defaultGovernanceOnCreate(session)

	s.Store.Lock()
	for _, existing := range s.Store.Sessions {
		if str(existing["id"]) == sessID && str(existing["workspaceId"]) == ws {
			s.Store.Unlock()
			return existing, nil
		}
	}
	s.Store.Conversations = append([]map[string]any{conv}, s.Store.Conversations...)
	s.Store.Sessions = append([]map[string]any{session}, s.Store.Sessions...)
	if s.Store.Messages[convID] == nil {
		s.Store.Messages[convID] = []map[string]any{}
	}
	s.Store.AppendAudit(ws, id.Name, "创建专家会话", title, "success", "")
	s.Store.Unlock()
	s.Store.Persist("conversations")
	s.Store.Persist("sessions")
	s.Store.Persist("messages")
	return session, nil
}

func (s *Server) deleteSession(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	headerWS := s.workspaceID(r)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/sessions/:id
	if len(parts) < 3 || parts[2] == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	sessID := parts[2]

	s.Store.Lock()
	tryOrder := workspaceLookupOrder(id, headerWS)
	removed, sessWS := s.findSessionInWorkspacesLocked(sessID, tryOrder)
	if removed == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	if owner := str(removed["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权删除他人会话")
	}
	convID := coalesce(str(removed["conversationId"]), sessID)
	kept := make([]map[string]any, 0, len(s.Store.Sessions))
	for _, sess := range s.Store.Sessions {
		if str(sess["id"]) == sessID && str(sess["workspaceId"]) == sessWS {
			continue
		}
		kept = append(kept, sess)
	}
	s.Store.Sessions = kept
	memDeleted := s.purgeConversationLocked(sessWS, convID)
	s.Store.AppendAudit(sessWS, id.Name, "删除专家会话", coalesce(str(removed["title"]), sessID), "success", "")
	s.Store.Unlock()
	s.Store.Persist("sessions")
	s.Store.Persist("conversations")
	s.Store.Persist("messages")
	s.Store.Persist("memory_records")
	if len(memDeleted) > 0 {
		if err := s.Store.PersistDeleteSync("memory_records", memDeleted...); err != nil {
			log.Printf("persist-delete memory_records: %v", err)
		}
	}
	if err := s.Store.PersistDeleteSync("sessions", sessID); err != nil {
		log.Printf("persist-delete sessions %s: %v", sessID, err)
	}
	if convID != "" {
		if err := s.Store.PersistDeleteSync("conversations", convID); err != nil {
			log.Printf("persist-delete conversations %s: %v", convID, err)
		}
		if err := s.Store.PersistDeleteSync("messages", convID); err != nil {
			log.Printf("persist-delete messages %s: %v", convID, err)
		}
		if err := s.Store.PersistDeleteSync("context_snapshots", convID); err != nil {
			log.Printf("persist-delete context_snapshots %s: %v", convID, err)
		}
	}
	return map[string]any{"ok": true, "id": sessID, "conversationId": convID}, nil
}

func (s *Server) patchSession(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[2] == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	sessID := parts[2]
	body, _ := decodeMap(r)

	s.Store.Lock()
	var cp map[string]any
	for i, sess := range s.Store.Sessions {
		if str(sess["id"]) != sessID || str(sess["workspaceId"]) != ws {
			continue
		}
		if owner := str(sess["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
			s.Store.Unlock()
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权修改他人会话")
		}
		if v, ok := body["title"]; ok {
			if t := strings.TrimSpace(str(v)); t != "" {
				sess["title"] = t
			}
		}
		if v, ok := body["pinned"]; ok {
			sess["pinned"] = boolFrom(v)
		}
		if v, ok := body["starred"]; ok {
			sess["starred"] = boolFrom(v)
		}
		if v, ok := body["status"]; ok {
			st := strings.TrimSpace(str(v))
			switch st {
			case "active", "archived", "closed":
				sess["status"] = st
			}
		}
		if v, ok := body["digitalPartnerId"]; ok {
			deID := strings.TrimSpace(str(v))
			sess["digitalPartnerId"] = deID
			if deID == "" {
				sess["digitalPartnerName"] = "助手"
				sess["agent"] = "助手"
			} else {
				for _, emp := range s.Store.Employees {
					if str(emp["id"]) == deID && str(emp["workspaceId"]) == ws {
						name := coalesce(str(emp["role"]), str(emp["name"]))
						sess["digitalPartnerName"] = name
						sess["agent"] = name
						break
					}
				}
			}
		}
		if v, ok := body["modelId"]; ok {
			sess["modelId"] = str(v)
		}
		if v, ok := body["enabledTools"]; ok {
			sess["enabledTools"] = v
		}
		applySessionGovernancePatch(sess, body, id, time.Now().UTC().Format(time.RFC3339))
		sess["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		s.Store.Sessions[i] = sess
		cp = map[string]any{}
		for k, val := range sess {
			cp[k] = val
		}
		s.Store.AppendAudit(ws, id.Name, "更新专家会话", sessID, "success", governanceAuditDetail(sess))
		break
	}
	s.Store.Unlock()
	if cp == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	s.Store.Persist("sessions")
	return cp, nil
}

func (s *Server) deleteConversation(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	headerWS := s.workspaceID(r)
	cid := conversationIDFromPath(r.URL.Path)
	if cid == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	s.Store.Lock()
	tryOrder := workspaceLookupOrder(id, headerWS)
	foundWS := ""
	if _, ws := s.findConversationInWorkspacesLocked(cid, tryOrder); ws != "" {
		foundWS = ws
	} else if sess, ws := s.findSessionInWorkspacesLocked(cid, tryOrder); sess != nil {
		foundWS = ws
		if owner := str(sess["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
			s.Store.Unlock()
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权删除他人会话")
		}
	} else if _, ok := s.Store.Messages[cid]; ok {
		foundWS = headerWS
	} else {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	memDeleted := s.purgeConversationLocked(foundWS, cid)
	kept := make([]map[string]any, 0, len(s.Store.Sessions))
	var removedSess []string
	for _, sess := range s.Store.Sessions {
		if str(sess["conversationId"]) == cid || str(sess["id"]) == cid {
			if owner := str(sess["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
				continue
			}
			removedSess = append(removedSess, str(sess["id"]))
			continue
		}
		kept = append(kept, sess)
	}
	s.Store.Sessions = kept
	s.Store.AppendAudit(foundWS, id.Name, "删除协作会话", cid, "success", "")
	s.Store.Unlock()
	s.Store.Persist("conversations")
	s.Store.Persist("messages")
	s.Store.Persist("sessions")
	s.Store.Persist("memory_records")
	if len(memDeleted) > 0 {
		if err := s.Store.PersistDeleteSync("memory_records", memDeleted...); err != nil {
			log.Printf("persist-delete memory_records: %v", err)
		}
	}
	if err := s.Store.PersistDeleteSync("conversations", cid); err != nil {
		log.Printf("persist-delete conversations %s: %v", cid, err)
	}
	if err := s.Store.PersistDeleteSync("messages", cid); err != nil {
		log.Printf("persist-delete messages %s: %v", cid, err)
	}
	if err := s.Store.PersistDeleteSync("context_snapshots", cid); err != nil {
		log.Printf("persist-delete context_snapshots %s: %v", cid, err)
	}
	if len(removedSess) > 0 {
		if err := s.Store.PersistDeleteSync("sessions", removedSess...); err != nil {
			log.Printf("persist-delete sessions: %v", err)
		}
	}
	return map[string]any{"ok": true, "id": cid}, nil
}

func (s *Server) listSlashCommands(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.SlashCommands, nil
}

func (s *Server) getConversation(r *http.Request) (any, error) {
	cid := conversationIDFromPath(r.URL.Path)
	if cid == "" {
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()

	if cp, forbidden := s.resolveConversationDetailLocked(id, ws, cid); forbidden {
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权查看他人会话")
	} else if cp != nil {
		return cp, nil
	}

	return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
}

func (s *Server) conversationStream(w http.ResponseWriter, r *http.Request) {
	// Rewrite path to reuse copilotStream internals by temporarily adjusting URL.
	// /api/conversations/:id/stream → same logic
	s.copilotStream(w, r)
}

