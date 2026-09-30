package server

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

type turnEventRecorder struct {
	events   []map[string]any
	deltaBuf strings.Builder
}

func (r *turnEventRecorder) Add(typ, stage string, extra map[string]any) {
	if r == nil {
		return
	}
	if typ == contract.StreamDelta {
		if t := str(extra["text"]); t != "" {
			r.deltaBuf.WriteString(t)
		}
		return
	}
	ev := map[string]any{"type": typ, "stage": stage}
	if extra != nil {
		for _, k := range []string{"status", "decision", "modelId", "mode", "reason", "message", "snapshotId", "runtimeMode"} {
			if v, ok := extra[k]; ok && v != nil && str(v) != "" {
				ev[k] = v
			}
		}
		if t := str(extra["text"]); t != "" {
			ev["text"] = truncateRunes(t, 240)
		}
		if n, ok := extra["ragHits"]; ok {
			ev["ragHits"] = n
		}
		if n, ok := extra["memoryHits"]; ok {
			ev["memoryHits"] = n
		}
		if n, ok := extra["hitCount"]; ok {
			ev["hitCount"] = n
		}
	}
	r.events = append(r.events, ev)
}

func (r *turnEventRecorder) Events() []map[string]any {
	if r == nil {
		return nil
	}
	out := append([]map[string]any{}, r.events...)
	if r.deltaBuf.Len() > 0 {
		out = append(out, map[string]any{
			"type": contract.StreamDelta, "stage": "runtime",
			"text": truncateRunes(r.deltaBuf.String(), 400),
		})
	}
	return out
}

func (s *Server) persistContextSnapshot(rec map[string]any) {
	if rec == nil {
		return
	}
	id := str(rec["id"])
	corr := str(rec["correlationId"])
	if id == "" || corr == "" {
		return
	}
	s.Store.Lock()
	replaced := false
	for i, existing := range s.Store.ContextSnapshots {
		if str(existing["id"]) == id || (str(existing["correlationId"]) == corr && str(existing["conversationId"]) == str(rec["conversationId"])) {
			s.Store.ContextSnapshots[i] = rec
			replaced = true
			break
		}
	}
	if !replaced {
		s.Store.ContextSnapshots = append([]map[string]any{rec}, s.Store.ContextSnapshots...)
		dropped := idsBeyondKeep(s.Store.ContextSnapshots, 2000)
		if len(s.Store.ContextSnapshots) > 2000 {
			s.Store.ContextSnapshots = s.Store.ContextSnapshots[:2000]
		}
		s.Store.Unlock()
		if len(dropped) > 0 {
			s.durableDeleteSync("context_snapshots", dropped...)
		}
	} else {
		s.Store.Unlock()
	}
	if err := s.Store.PersistSync("context_snapshots"); err != nil {
		log.Printf("persist context_snapshots: %v", err)
	}
}

func (s *Server) lookupContextSnapshot(ws, conversationID, correlationID string) map[string]any {
	return s.lookupContextSnapshotCtx(context.Background(), ws, conversationID, correlationID)
}

func (s *Server) lookupContextSnapshotCtx(ctx context.Context, ws, conversationID, correlationID string) map[string]any {
	correlationID = strings.TrimSpace(correlationID)
	if correlationID == "" {
		return nil
	}
	if s != nil && s.Kernel != nil && s.Kernel.Available() {
		rec, err := s.Kernel.GetSnapshot(ctx, ws, conversationID, correlationID)
		if err != nil {
			return nil
		}
		return rec
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	cid := s.resolveMessageBucketID(ws, conversationID)
	for _, rec := range s.Store.ContextSnapshots {
		if str(rec["correlationId"]) != correlationID {
			continue
		}
		if w := str(rec["workspaceId"]); w != "" && w != ws {
			continue
		}
		if cid != "" {
			if recCID := str(rec["conversationId"]); recCID != "" && recCID != cid && recCID != conversationID {
				continue
			}
		}
		return rec
	}
	return nil
}

func (s *Server) replayCopilotTurn(r *http.Request) (any, error) {
	// 只读：从已落盘 snapshot/events 重建，禁止再调 Runtime / LLM / 工具。
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.UnauthorizedErr("请先登录")
	}
	rawID := conversationIDFromPath(r.URL.Path)
	corr := correlationIDFromReplayPath(r.URL.Path)
	if rawID == "" || corr == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话或 correlationId")
	}
	ws := s.workspaceID(r)
	rec := s.lookupContextSnapshotCtx(r.Context(), ws, rawID, corr)
	if rec == nil {
		return nil, apperr.NotFoundErr(apperr.ReplayNotFound, "回合快照不存在")
	}
	snapshot := map[string]any{
		"id": rec["id"], "correlationId": rec["correlationId"],
		"system": rec["system"], "historyTurns": rec["historyTurns"],
		"memoryProvenance": rec["memoryProvenance"], "ragHits": rec["ragHits"],
		"toolRegistry": rec["toolRegistry"], "builtAt": rec["builtAt"],
		"partnerId": rec["partnerId"], "sessionMode": rec["sessionMode"],
		"riskLevel": rec["riskLevel"], "channel": rec["channel"],
		"channelThreadId": rec["channelThreadId"], "envelope": rec["envelope"],
		"runtimeMode": rec["runtimeMode"], "employeeBinding": rec["employeeBinding"],
	}
	return map[string]any{
		"snapshot":      snapshot,
		"events":        snapshotEvents(rec),
		"correlationId": corr,
		"replay":        true,
		"runtimeMode":   rec["runtimeMode"],
	}, nil
}

func snapshotEvents(rec map[string]any) []map[string]any {
	if rec == nil {
		return nil
	}
	return mapsFromAny(rec["events"])
}

func correlationIDFromReplayPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if p == "turns" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func buildContextSnapshotRecord(in map[string]any) map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	rec := map[string]any{
		"id":               str(in["id"]),
		"workspaceId":      str(in["workspaceId"]),
		"conversationId":   str(in["conversationId"]),
		"sessionId":        str(in["sessionId"]),
		"correlationId":    str(in["correlationId"]),
		"system":           str(in["system"]),
		"historyTurns":     in["historyTurns"],
		"memoryProvenance": in["memoryProvenance"],
		"ragHits":          in["ragHits"],
		"toolRegistry":     in["toolRegistry"],
		"builtAt":          coalesce(str(in["builtAt"]), now),
		"partnerId":       str(in["partnerId"]),
		"sessionMode":      str(in["sessionMode"]),
		"riskLevel":        str(in["riskLevel"]),
		"channel":          coalesce(str(in["channel"]), contract.ChannelWeb),
		"channelThreadId":  str(in["channelThreadId"]),
		"runtimeMode":      coalesce(str(in["runtimeMode"]), runtimeMode()),
		"envelope":         in["envelope"],
		"events":           in["events"],
		"employeeBinding":  in["employeeBinding"],
	}
	return rec
}
