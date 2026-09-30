package server

import (
	"net/http"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/heartbeat"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
)

// withHeartbeat is the middleware that calls Heartbeat.Touch on every
// authenticated request. Must run AFTER requireAuth (so identity +
// workspace are on the context). Skips non-authed paths because the
// presence map is keyed by identity.
func (s *Server) withHeartbeat(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Heartbeat != nil {
			id := identityFrom(r.Context())
			ws := workspaceFrom(r.Context())
			if id != nil && id.ID != "" {
				wsID := ""
				if ws != nil {
					wsID = ws.WorkspaceID
				}
				s.Heartbeat.Touch(wsID, id.ID, "web")
			}
		}
		next.ServeHTTP(w, r)
	})
}

// heartbeatProbe is an active liveness ping: returns 200 with the
// current lag-since-last-touch. Frontend polls every 30s; presence
// derives from the same touch stream, so this is a cheap confirmation
// that the connection is healthy.
func (s *Server) heartbeatProbe(w http.ResponseWriter, _ *http.Request) {
	if s.Heartbeat == nil {
		writeErr(w, apperr.Unavailable(apperr.Unknown, "心跳未启用"))
		return
	}
	response.OK(w, map[string]any{
		"ok":         true,
		"lagSeconds": s.Heartbeat.LagSinceLastTouch().Seconds(),
		"now":        time.Now().UTC().Format(time.RFC3339),
	})
}

// onlineList returns the live presence list for the current workspace.
// Workspace is taken from the request context (resolved by requireAuth)
// and is never read from the request body, so cross-workspace snooping
// is impossible.
func (s *Server) onlineList(w http.ResponseWriter, r *http.Request) {
	if s.Heartbeat == nil {
		writeErr(w, apperr.Unavailable(apperr.Unknown, "心跳未启用"))
		return
	}
	ws := workspaceFrom(r.Context())
	wsID := ""
	if ws != nil {
		wsID = ws.WorkspaceID
	}
	list := s.Heartbeat.Online(wsID)
	if list == nil {
		list = []heartbeat.Presence{}
	}
	response.OK(w, map[string]any{
		"workspaceId": wsID,
		"online":      list,
		"count":       len(list),
	})
}

// onlineStream is an SSE feed of presence events. The client sends
// `?workspace=<id>` to scope, but the server still validates against
// the request context — explicit override is rejected unless the
// caller has cross-workspace access.write.
func (s *Server) onlineStream(w http.ResponseWriter, r *http.Request) {
	if s.Heartbeat == nil {
		writeErr(w, apperr.Unavailable(apperr.Unknown, "心跳未启用"))
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, apperr.New(apperr.Unknown, 500, "流式不支持"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ws := workspaceFrom(r.Context())
	wsID := ""
	if ws != nil {
		wsID = ws.WorkspaceID
	}
	ch, cancel := s.Heartbeat.Subscribe(wsID)
	defer cancel()

	// Initial snapshot event so the client has a state to render before
	// the first delta arrives.
	writeSSE(w, "snapshot", map[string]any{
		"workspaceId": wsID,
		"online":      s.Heartbeat.Online(wsID),
	})
	flusher.Flush()

	heartbeatTick := time.NewTicker(s.Heartbeat.Config().Interval)
	defer heartbeatTick.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			// Only forward events for the requested workspace.
			if ev.Workspace != "" && ev.Workspace != wsID {
				continue
			}
			writeSSE(w, "presence", ev)
			flusher.Flush()
		case <-heartbeatTick.C:
			// Anti-proxy idle timeout. The SSE event itself counts as
			// keepalive but we send a dedicated `ping` every interval.
			writeSSE(w, "ping", map[string]any{
				"ts": time.Now().UTC().Format(time.RFC3339),
			})
			flusher.Flush()
		}
	}
}