package server

import (
	"bufio"
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// sessionIDsFromBody is the shared body shape for bulk operations on
// sessions. Both archive, export, and delete expect this.
type sessionIDsFromBody struct {
	IDs    []string `json:"ids"`
	Format string   `json:"format"`
}

// bulkArchiveSessions — POST /api/sessions/bulk-archive
//
// Marks each session as archived (`archivedAt` set) under a single store
// write lock. Returns the IDs that were actually mutated (filtering out
// not-found ones).
func (s *Server) bulkArchiveSessions(w http.ResponseWriter, r *http.Request) {
	body, _ := decodeMap(r)
	ids, err := readSessionIDs(body)
	if err != nil {
		writeErr(w, err)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	mutated := make([]string, 0, len(ids))
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, id := range ids {
		var sess map[string]any
		for _, s := range s.Store.Sessions {
			if str(s["id"]) == id {
				sess = s
				break
			}
		}
		if sess == nil {
			continue
		}
		if archived, _ := sess["archivedAt"].(string); archived == "" {
			sess["archivedAt"] = now
			mutated = append(mutated, id)
		}
	}
	if len(mutated) > 0 {
		s.Store.Persist("sessions")
	}
	writeJSON(w, map[string]any{
		"archivedAt": now,
		"mutated":    mutated,
		"count":      len(mutated),
	})
}

// bulkExportSessions — POST /api/sessions/bulk-export
//
// Streams a JSON or Markdown document containing the requested sessions
// (id, title, messages snapshot, summary). MD format renders as a
// human-readable chat transcript; JSON returns the raw shape.
func (s *Server) bulkExportSessions(w http.ResponseWriter, r *http.Request) {
	body, _ := decodeMap(r)
	ids, err := readSessionIDs(body)
	if err != nil {
		writeErr(w, err)
		return
	}
	format := strings.ToLower(str(body["format"]))
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "md" {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "format 仅支持 json|md"))
		return
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		var sess map[string]any
		for _, s := range s.Store.Sessions {
			if str(s["id"]) == id {
				sess = s
				break
			}
		}
		if sess == nil {
			continue
		}
		convID := str(sess["conversationId"])
		entry := map[string]any{
			"id":             id,
			"title":          str(sess["title"]),
			"conversationId": convID,
			"messages":       s.Store.Messages[convID],
		}
		out = append(out, entry)
	}
	if format == "md" {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		writeMarkdownExport(w, out)
		return
	}
	writeJSON(w, map[string]any{
		"format":    format,
		"sessions":  out,
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

// bulkDeleteSessions — DELETE /api/sessions/bulk
//
// Hard-deletes the listed sessions and their associated conversation
// message slices. Idempotent: missing IDs are skipped silently.
func (s *Server) bulkDeleteSessions(w http.ResponseWriter, r *http.Request) {
	body, _ := decodeMap(r)
	ids, err := readSessionIDs(body)
	if err != nil {
		writeErr(w, err)
		return
	}
	removed := make([]string, 0, len(ids))
	idSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	kept := make([]map[string]any, 0, len(s.Store.Sessions))
	for _, sess := range s.Store.Sessions {
		if sess == nil {
			continue
		}
		sid := str(sess["id"])
		if _, hit := idSet[sid]; hit {
			convID := str(sess["conversationId"])
			if convID != "" {
				delete(s.Store.Messages, convID)
			}
			removed = append(removed, sid)
			continue
		}
		kept = append(kept, sess)
	}
	if len(removed) > 0 {
		s.Store.Sessions = kept
		s.Store.Persist("sessions")
		s.Store.Persist("messages")
	}
	writeJSON(w, map[string]any{
		"removed": removed,
		"count":   len(removed),
	})
}

func readSessionIDs(body map[string]any) ([]string, error) {
	raw, ok := body["ids"]
	if !ok {
		return nil, apperr.BadReq(apperr.BadRequest, "ids 必填")
	}
	switch v := raw.(type) {
	case []string:
		if len(v) == 0 {
			return nil, apperr.BadReq(apperr.BadRequest, "ids 不能为空")
		}
		return v, nil
	case []any:
		out := make([]string, 0, len(v))
		for _, x := range v {
			s, ok := x.(string)
			if !ok || s == "" {
				continue
			}
			out = append(out, s)
		}
		if len(out) == 0 {
			return nil, apperr.BadReq(apperr.BadRequest, "ids 不能为空")
		}
		return out, nil
	default:
		return nil, apperr.BadReq(apperr.BadRequest, "ids 必须是数组")
	}
}

func writeMarkdownExport(w http.ResponseWriter, sessions []map[string]any) {
	bw := bufio.NewWriter(w)
	defer bw.Flush()
	bw.WriteString("# 会话导出\n\n")
	bw.WriteString("导出时间: " + time.Now().UTC().Format(time.RFC3339) + "\n\n")
	for _, sess := range sessions {
		bw.WriteString("## " + str(sess["title"]) + "\n\n")
		bw.WriteString("- 会话 ID: `" + str(sess["id"]) + "`\n")
		bw.WriteString("- 对话 ID: `" + str(sess["conversationId"]) + "`\n\n")
		msgs, _ := sess["messages"].([]map[string]any)
		for _, m := range msgs {
			if m == nil {
				continue
			}
			bw.WriteString("### " + str(m["role"]) + " · " + str(m["createdAt"]) + "\n\n")
			bw.WriteString(str(m["content"]) + "\n\n")
		}
	}
}
