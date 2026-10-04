// Package copilot —— copilot 回合(copilotTurn)的内存状态机。
//
// 状态值：running → done / cancelled / failed。
//
// 存放在进程级 sync.Map（copilotTurnStates）里，按 correlationId 索引。
// 给 HTTP 端点（status / replay / cancel）提供查询与终态翻转能力，
// 同时被 SSE 流的取消逻辑（cancelStreamByCorrelation）复用。
package copilot

import (
	"strings"
	"sync"
	"time"
)

const (
	turnStatusRunning   = "running"
	turnStatusDone      = "done"
	turnStatusCancelled = "cancelled"
	turnStatusFailed    = "failed"
)

// copilotTurnRecord 是 correlationId 维度的回合状态记录。
//
// 生命周期：
//   - registerCopilotTurn     → status=running
//   - finishCopilotTurn       → status=done | failed
//   - markCopilotTurnCancelled→ status=cancelled（可被后续 register 继承，见 registerCopilotTurn）
//
// 同时缓存 clientMsgId 给幂等去重（同一客户端消息重投时直接 replay）。
type copilotTurnRecord struct {
	ConversationID string
	CorrelationID  string
	ClientMsgID    string
	Status         string
	StartedAt      time.Time
	FinishedAt     time.Time
}

var copilotTurnStates sync.Map // correlationId -> *copilotTurnRecord

// registerCopilotTurn 把一个 correlationId 标记为 running。
//
// 继承语义：如果该 corr 之前已被 markCopilotTurnCancelled（用户先点取消、
// 后端又收到消息），新记录会直接以 cancelled 状态落盘，FinishedAt 也保留
// 原取消时刻——避免 UI 上"刚显示已取消又被 running 覆盖"的闪动。
func registerCopilotTurn(cid, corr, clientMsgID string) {
	if corr == "" {
		return
	}
	rec := &copilotTurnRecord{
		ConversationID: cid,
		CorrelationID:  corr,
		ClientMsgID:    clientMsgID,
		Status:         turnStatusRunning,
		StartedAt:      time.Now().UTC(),
	}
	if existing, ok := loadCopilotTurn(corr); ok && existing.Status == turnStatusCancelled {
		rec.Status = turnStatusCancelled
		rec.FinishedAt = existing.FinishedAt
	}
	copilotTurnStates.Store(corr, rec)
}

func markCopilotTurnCancelled(corr string) {
	if corr == "" {
		return
	}
	if rec, ok := loadCopilotTurn(corr); ok {
		rec.Status = turnStatusCancelled
		rec.FinishedAt = time.Now().UTC()
		copilotTurnStates.Store(corr, rec)
		return
	}
	copilotTurnStates.Store(corr, &copilotTurnRecord{
		CorrelationID: corr,
		Status:        turnStatusCancelled,
		FinishedAt:    time.Now().UTC(),
	})
}

func isCopilotTurnCancelled(corr string) bool {
	rec, ok := loadCopilotTurn(corr)
	return ok && rec.Status == turnStatusCancelled
}

func finishCopilotTurn(corr, status string) {
	if corr == "" || status == "" {
		return
	}
	if rec, ok := loadCopilotTurn(corr); ok {
		if rec.Status == turnStatusCancelled {
			return
		}
		rec.Status = status
		rec.FinishedAt = time.Now().UTC()
		copilotTurnStates.Store(corr, rec)
	}
}

func lookupCopilotTurn(corr string) (copilotTurnRecord, bool) {
	rec, ok := loadCopilotTurn(corr)
	if !ok {
		return copilotTurnRecord{}, false
	}
	return *rec, true
}

func loadCopilotTurn(corr string) (*copilotTurnRecord, bool) {
	v, ok := copilotTurnStates.Load(corr)
	if !ok {
		return nil, false
	}
	rec, ok := v.(*copilotTurnRecord)
	return rec, ok
}

func correlationIDFromTurnSubPath(path, suffix string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if p == "turns" && i+2 < len(parts) && parts[i+2] == suffix {
			return parts[i+1]
		}
	}
	return ""
}
