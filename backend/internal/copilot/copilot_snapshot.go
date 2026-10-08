// Package copilot —— 回合上下文快照(context snapshot)模块。
//
// 职责：每个 copilot 回合结束时把 system prompt / 历史消息 / RAG hits / 工具注册表 / SSE events
// 落盘成一份"快照"，供 /replay 端点只读重建（不重新调 LLM / 工具）。
// 存储层先看 Kernel（外部 durable backend），没有时回落到 Store.ContextSnapshots 内存环形缓冲。
package copilot

// copilot_snapshot.go — ContextSnapshot 数据模型与快照生成;持久化到 store 的
// 同时提供 LLM 端引用,使后续回合可以重放上下文。

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// turnEventRecorder 收集一次回合的 SSE 事件并按需压缩 delta 流，给回放端点提供"只读重建"。
type turnEventRecorder struct {
	events   []map[string]any
	deltaBuf strings.Builder
}

// Add 往记录器追加一条 SSE 事件：delta 单独累加到 deltaBuf（400 rune 截断），
// 其他事件按白名单字段（status/decision/modelId/...）压平写入 events。
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

// Events 返回记录器累积的事件切片（拷贝），并在末尾追加一条汇总的 delta 事件，
// 供 replayStoredSegments / snapshotEvents 一类调用方直接消费。
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

// persistContextSnapshot 落盘一份上下文快照：
// 1. 同 ID / (corr, conversationId) 已存在则覆盖；
// 2. 否则头插并裁剪超过 2000 条的尾部；
// 3. 同步落 store + 触发 durable backend 删除越界项（按需）。
func (s *Service) persistContextSnapshot(rec map[string]any) {
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
			s.Deps.Persist.DurableDeleteSyncFn("context_snapshots", dropped...)
		}
	} else {
		s.Store.Unlock()
	}
	if err := s.Store.PersistSync("context_snapshots"); err != nil {
		log.Printf("persist context_snapshots: %v", err)
	}
}

// lookupContextSnapshot 是带 background ctx 的便捷重载，给不需要 cancel 的调用方使用。
func (s *Service) lookupContextSnapshot(ws, conversationID, correlationID string) map[string]any {
	return s.lookupContextSnapshotCtx(context.Background(), ws, conversationID, correlationID)
}

// lookupContextSnapshotCtx 是快照查找的"主干"实现：
// 优先走外部 Kernel，失败时再扫描 Store.ContextSnapshots，按 (corr, ws, conversationId) 三元组匹配。
func (s *Service) lookupContextSnapshotCtx(ctx context.Context, ws, conversationID, correlationID string) map[string]any {
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
	cid := s.Deps.Routing.ResolveMessageBucketIDFn(ws, conversationID)
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

// replayCopilotTurn 处理 POST /api/copilot/conversations/:cid/turns/:corr/replay：
// 只读重建快照 + SSE 事件流，禁止再触发 LLM / Runtime / 工具。
func (s *Service) replayCopilotTurn(r *http.Request) (any, error) {
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
	ws := s.Deps.Workspace.WorkspaceIDFn(r)
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

// snapshotEvents 把快照记录里的 events 字段（any）规范化为 []map[string]any。
func snapshotEvents(rec map[string]any) []map[string]any {
	if rec == nil {
		return nil
	}
	return mapsFromAny(rec["events"])
}

// correlationIDFromReplayPath 从 /api/copilot/conversations/:cid/turns/:corr/replay
// 这类路径里抽出 :corr 段；找不到时返回空串。
func correlationIDFromReplayPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if p == "turns" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

// buildContextSnapshotRecord 把"上层构造的 in map"转成一份可持久化的快照记录；
// 默认值（channel、builtAt、runtimeMode）在这里统一填好，避免落盘记录里缺字段。
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
