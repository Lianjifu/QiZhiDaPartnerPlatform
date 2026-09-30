package server

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func randomShareToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Server) createSessionShare(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/sessions/:id/share
	if len(parts) < 4 {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	sessID := parts[2]
	now := time.Now().UTC().Format(time.RFC3339)
	token := randomShareToken()

	s.Store.Lock()
	var found map[string]any
	for _, sess := range s.Store.Sessions {
		if str(sess["id"]) != sessID || str(sess["workspaceId"]) != ws {
			continue
		}
		if owner := str(sess["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
			s.Store.Unlock()
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权分享他人会话")
		}
		sess["shareToken"] = token
		sess["shareCreatedAt"] = now
		sess["updatedAt"] = now
		found = sess
		break
	}
	s.Store.Unlock()
	if found == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	s.Store.Persist("sessions")
	s.Store.Lock()
	s.Store.AppendAudit(ws, id.Name, "创建会话分享", sessID, "success", "")
	s.Store.Unlock()
	return map[string]any{"token": token, "sessionId": sessID, "createdAt": now}, nil
}

func (s *Server) revokeSessionShare(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	sessID := parts[2]
	s.Store.Lock()
	ok := false
	for _, sess := range s.Store.Sessions {
		if str(sess["id"]) != sessID || str(sess["workspaceId"]) != ws {
			continue
		}
		if owner := str(sess["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
			s.Store.Unlock()
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权撤销他人分享")
		}
		delete(sess, "shareToken")
		delete(sess, "shareCreatedAt")
		sess["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		ok = true
		break
	}
	s.Store.Unlock()
	if !ok {
		return nil, apperr.NotFoundErr(apperr.NotFound, "会话不存在")
	}
	s.Store.Persist("sessions")
	s.Store.Lock()
	s.Store.AppendAudit(ws, id.Name, "撤销会话分享", sessID, "success", "")
	s.Store.Unlock()
	return map[string]any{"ok": true, "id": sessID}, nil
}

func (s *Server) getSharedSession(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/share/:token
	if len(parts) < 3 || parts[2] == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少分享令牌")
	}
	token := parts[2]
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, sess := range s.Store.Sessions {
		if str(sess["shareToken"]) != token {
			continue
		}
		cid := coalesce(str(sess["conversationId"]), str(sess["id"]))
		msgs := s.Store.Messages[cid]
		safe := make([]map[string]any, 0, len(msgs))
		for _, m := range msgs {
			role := str(m["role"])
			if role != "user" && role != "assistant" {
				continue
			}
			content := str(m["content"])
			content = safetyKeyRe.ReplaceAllString(content, "[已脱敏]")
			safe = append(safe, map[string]any{
				"id": m["id"], "role": role, "content": content, "createdAt": m["createdAt"],
			})
		}
		return map[string]any{
			"title":               coalesce(str(sess["title"]), "共享会话"),
			"digitalPartnerName": coalesce(str(sess["digitalPartnerName"]), str(sess["agent"])),
			"messages":            safe,
			"readonly":            true,
		}, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "分享不存在或已撤销")
}
