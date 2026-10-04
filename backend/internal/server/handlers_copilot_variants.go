package server

import (
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listConversationVariants — GET /api/copilot/conversations/{cid}/messages/{mid}/variants
//
// Returns the sibling list (including the parent itself) for the variant
// group that `mid` belongs to, plus the currently-active id.
func (s *Server) listConversationVariants(w http.ResponseWriter, r *http.Request) {
	cid, mid, ok := copilotVariantIDs(r.URL.Path, "/variants")
	if !ok {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "path requires /conversations/{cid}/messages/{mid}/variants"))
		return
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	msgs := s.Store.Messages[cid]
	var target map[string]any
	for _, m := range msgs {
		if str(m["id"]) == mid {
			target = m
			break
		}
	}
	if target == nil {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "消息不存在"))
		return
	}
	writeJSON(w, map[string]any{
		"activeId": copilot.ActiveVariantID(msgs, target),
		"variants": copilot.ListVariants(msgs, target),
	})
}

// switchConversationVariant — POST /api/copilot/conversations/{cid}/messages/{mid}/branch-active
//
// Marks one sibling as the visible variant; flips the previously-active
// one to inactive. Atomic under the store write lock.
func (s *Server) switchConversationVariant(w http.ResponseWriter, r *http.Request) {
	cid, mid, ok := copilotVariantIDs(r.URL.Path, "/branch-active")
	if !ok {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "path requires /conversations/{cid}/messages/{mid}/branch-active"))
		return
	}
	body, _ := decodeMap(r)
	targetVariant := str(body["variantId"])
	if targetVariant == "" {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "variantId 必填"))
		return
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	msgs := s.Store.Messages[cid]
	var groupID string
	for _, m := range msgs {
		if str(m["id"]) == mid {
			groupID = copilot.VariantGroupID(m)
			break
		}
	}
	if groupID == "" {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "消息不存在"))
		return
	}
	touched, prev := copilot.SwitchActiveVariant(msgs, groupID, targetVariant)
	s.Store.Persist("messages")
	writeJSON(w, map[string]any{
		"parentMessageId":   groupID,
		"activeId":          targetVariant,
		"previousActiveId":  prev,
		"touched":           touched,
	})
}

// copilotVariantIDs extracts (cid, mid) from a path shaped
// /api/copilot/conversations/{cid}/messages/{mid}{suffix}.
// Returns ok=false if the path doesn't match.
func copilotVariantIDs(path, suffix string) (cid, mid string, ok bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i := 0; i+4 < len(parts); i++ {
		if parts[i] == "conversations" && parts[i+2] == "messages" &&
			strings.HasSuffix(parts[i+3], suffix) {
			return parts[i+1], strings.TrimSuffix(parts[i+3], suffix), true
		}
	}
	return "", "", false
}
