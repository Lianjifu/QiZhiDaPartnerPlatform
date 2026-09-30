package server

import (
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
)

// conversationIDFromPath extracts :id from:
//
//	/api/conversations/:id/...
//	/api/copilot/conversations/:id/...
func conversationIDFromPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if p != "conversations" || i+1 >= len(parts) {
			continue
		}
		next := parts[i+1]
		switch next {
		case "", "stream", "messages", "tasks":
			continue
		default:
			return next
		}
	}
	return ""
}

// resolveMessageBucketID maps a session id to its conversationId for Messages storage.
// Caller may hold RLock or Lock.
func (s *Server) resolveMessageBucketID(ws, raw string) string {
	if raw == "" {
		return raw
	}
	for _, c := range s.Store.Conversations {
		if str(c["id"]) != raw {
			continue
		}
		if w := str(c["workspaceId"]); w != "" && w != ws {
			continue
		}
		return raw
	}
	for _, sess := range s.Store.Sessions {
		if str(sess["id"]) != raw {
			continue
		}
		if str(sess["workspaceId"]) != ws {
			continue
		}
		if cid := str(sess["conversationId"]); cid != "" {
			return cid
		}
		return raw
	}
	return raw
}

func (s *Server) resolveConversationDetailLocked(id *auth.Identity, ws, cid string) (map[string]any, bool) {
	findConversation := func(convID string) (map[string]any, bool) {
		for _, c := range s.Store.Conversations {
			if str(c["id"]) != convID {
				continue
			}
			if w := str(c["workspaceId"]); w != "" && w != ws {
				continue
			}
			if ok, forbidden := s.conversationAccessLocked(id, ws, convID); forbidden {
				return nil, true
			} else if !ok {
				return nil, false
			}
			cp := map[string]any{}
			for k, v := range c {
				cp[k] = v
			}
			if msgs, ok := s.Store.Messages[convID]; ok {
				cp["messages"] = msgs
			} else if cp["messages"] == nil {
				cp["messages"] = []map[string]any{}
			}
			return cp, false
		}
		return nil, false
	}

	if cp, forbidden := findConversation(cid); cp != nil || forbidden {
		return cp, forbidden
	}

	for _, sess := range s.Store.Sessions {
		if str(sess["id"]) != cid {
			continue
		}
		if str(sess["workspaceId"]) != ws {
			continue
		}
		if !sessionOwnerReadable(id, sess) {
			return nil, true
		}
		convID := str(sess["conversationId"])
		if convID != "" {
			if cp, forbidden := findConversation(convID); cp != nil || forbidden {
				return cp, forbidden
			}
		}
		messages := s.Store.Messages[cid]
		if messages == nil && convID != "" {
			messages = s.Store.Messages[convID]
		}
		if messages == nil {
			messages = []map[string]any{}
		}
		outID := convID
		if outID == "" {
			outID = cid
		}
		updatedAt := str(sess["updatedAt"])
		if updatedAt == "" {
			updatedAt = str(sess["lastMessageAt"])
		}
		return map[string]any{
			"id":                outID,
			"workspaceId":       str(sess["workspaceId"]),
			"title":             sess["title"],
			"digitalPartnerId": sess["digitalPartnerId"],
			"updatedAt":         updatedAt,
			"messages":          messages,
		}, false
	}
	return nil, false
}

// conversationAccessLocked reports whether a conversation may be read.
// forbidden=true when linked sessions exist but none belong to the caller.
func (s *Server) conversationAccessLocked(id *auth.Identity, ws, convID string) (ok, forbidden bool) {
	if id == nil {
		return false, false
	}
	if id.Role == "admin" || id.Role == "auditor" {
		return true, false
	}
	linked := false
	for _, sess := range s.Store.Sessions {
		if str(sess["workspaceId"]) != ws {
			continue
		}
		if str(sess["conversationId"]) != convID && str(sess["id"]) != convID {
			continue
		}
		linked = true
		if sessionOwnerReadable(id, sess) {
			return true, false
		}
	}
	if linked {
		return false, true
	}
	return true, false
}

func workspaceLookupOrder(id *auth.Identity, headerWS string) []string {
	tryOrder := []string{headerWS}
	for _, alt := range allowedWorkspaceIDs(id) {
		if alt != headerWS {
			tryOrder = append(tryOrder, alt)
		}
	}
	return tryOrder
}

func (s *Server) findSessionInWorkspacesLocked(rawID string, workspaces []string) (map[string]any, string) {
	for _, ws := range workspaces {
		for _, sess := range s.Store.Sessions {
			if str(sess["workspaceId"]) != ws {
				continue
			}
			if str(sess["id"]) == rawID || str(sess["conversationId"]) == rawID {
				return sess, ws
			}
		}
	}
	return nil, ""
}

func (s *Server) findConversationInWorkspacesLocked(convID string, workspaces []string) (map[string]any, string) {
	for _, ws := range workspaces {
		for _, c := range s.Store.Conversations {
			if str(c["id"]) != convID {
				continue
			}
			if w := str(c["workspaceId"]); w != "" && w != ws {
				continue
			}
			return c, ws
		}
	}
	return nil, ""
}

func (s *Server) purgeConversationLocked(ws, convID string) []string {
	if convID == "" {
		return nil
	}
	convs := make([]map[string]any, 0, len(s.Store.Conversations))
	for _, c := range s.Store.Conversations {
		if str(c["id"]) == convID && (str(c["workspaceId"]) == "" || str(c["workspaceId"]) == ws) {
			continue
		}
		convs = append(convs, c)
	}
	s.Store.Conversations = convs
	delete(s.Store.Messages, convID)
	return s.removeMemoryForConversationLocked(ws, convID)
}

func allowedWorkspaceIDs(id *auth.Identity) []string {
	if id == nil {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(id.WorkspaceIDs)+1)
	add := func(ws string) {
		ws = strings.TrimSpace(ws)
		if ws == "" {
			return
		}
		if _, ok := seen[ws]; ok {
			return
		}
		seen[ws] = struct{}{}
		out = append(out, ws)
	}
	for _, ws := range id.WorkspaceIDs {
		add(ws)
	}
	add(id.WorkspaceID)
	return out
}

func actionIDFromPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	// /api/actions/:id/approve|execute
	if len(parts) >= 4 && parts[0] == "api" && parts[1] == "actions" {
		return parts[2]
	}
	return ""
}
