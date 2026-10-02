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

type copilotTurnRecord struct {
	ConversationID string
	CorrelationID  string
	ClientMsgID    string
	Status         string
	StartedAt      time.Time
	FinishedAt     time.Time
}

var copilotTurnStates sync.Map // correlationId -> *copilotTurnRecord

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
