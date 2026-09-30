package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

type rateBucket struct {
	tokens float64
	last   time.Time
}

type copilotRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*rateBucket
	rate    float64
	burst   float64
}

func newCopilotRateLimiter() *copilotRateLimiter {
	rpm := 30
	if v := strings.TrimSpace(os.Getenv("DE_COPILOT_RPM")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			rpm = n
		}
	}
	return &copilotRateLimiter{
		buckets: map[string]*rateBucket{},
		rate:    float64(rpm) / 60.0,
		burst:   float64(rpm),
	}
}

var globalCopilotRL = newCopilotRateLimiter()

func (l *copilotRateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b := l.buckets[key]
	if b == nil {
		b = &rateBucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (s *Server) allowCopilotTurn(ws, userID string) bool {
	key := fmt.Sprintf("%s:%s", ws, userID)
	ok := globalCopilotRL.allow(key)
	if !ok {
		IncCopilotRateLimited()
	}
	return ok
}

type streamCancelEntry struct {
	cancel context.CancelFunc
}

var (
	streamCancels sync.Map
	streamIdempot sync.Map
)

func registerStreamCancel(corr string, cancel context.CancelFunc) {
	if corr == "" {
		return
	}
	streamCancels.Store(corr, &streamCancelEntry{cancel: cancel})
}

func clearStreamCancel(corr string) {
	streamCancels.Delete(corr)
}

func cancelStreamByCorrelation(corr string) bool {
	if v, ok := streamCancels.Load(corr); ok {
		if e, ok := v.(*streamCancelEntry); ok && e.cancel != nil {
			e.cancel()
			return true
		}
	}
	return false
}

func idempotencyKey(cid, clientMsgID string) string {
	return cid + "|" + clientMsgID
}

func rememberIdempotentReply(s *Server, cid, clientMsgID string, assistant map[string]any) {
	rememberIdempotentTurn(s, cid, clientMsgID, []map[string]any{assistant})
}

func rememberIdempotentTurn(s *Server, cid, clientMsgID string, messages []map[string]any) {
	if clientMsgID == "" || len(messages) == 0 {
		return
	}
	key := idempotencyKey(cid, clientMsgID)
	rec := map[string]any{"v": 2, "messages": messages}
	streamIdempot.Store(key, rec)
	if s != nil && s.Store != nil {
		// 并发 wecom webhook 都会走到这里；CopilotIdempotency 是 Store.RWMutex 保护的 map，
		// 写者必须持 Lock 才能避免 DATA RACE。
		s.Store.Lock()
		if s.Store.CopilotIdempotency == nil {
			s.Store.CopilotIdempotency = map[string]map[string]any{}
		}
		cp := map[string]any{}
		for k, v := range rec {
			cp[k] = v
		}
		s.Store.CopilotIdempotency[key] = cp
		s.Store.Unlock()
	}
}

func (s *Server) loadIdempotentTurn(cid, clientMsgID string) []map[string]any {
	if clientMsgID == "" {
		return nil
	}
	key := idempotencyKey(cid, clientMsgID)
	if v, ok := streamIdempot.Load(key); ok {
		if m, ok := v.(map[string]any); ok {
			if msgs := idempotentMessagesFromRecord(m); len(msgs) > 0 {
				return msgs
			}
		}
	}
	if s != nil && s.Store != nil {
		s.Store.RLock()
		if s.Store.CopilotIdempotency != nil {
			if m, ok := s.Store.CopilotIdempotency[key]; ok && m != nil {
				if msgs := idempotentMessagesFromRecord(m); len(msgs) > 0 {
					s.Store.RUnlock()
					return msgs
				}
			}
		}
		msgs := append([]map[string]any{}, s.Store.Messages[cid]...)
		s.Store.RUnlock()
		for i, m := range msgs {
			if str(m["clientMsgId"]) != clientMsgID || str(m["role"]) != "user" {
				continue
			}
			corr := str(m["correlationId"])
			out := make([]map[string]any, 0, 4)
			for j := i + 1; j < len(msgs); j++ {
				if str(msgs[j]["role"]) == "user" {
					break
				}
				if str(msgs[j]["role"]) != "assistant" {
					continue
				}
				if corr != "" && str(msgs[j]["correlationId"]) != corr {
					continue
				}
				cp := map[string]any{}
				for k, v := range msgs[j] {
					cp[k] = v
				}
				out = append(out, cp)
			}
			if len(out) > 0 {
				rememberIdempotentTurn(s, cid, clientMsgID, out)
				return out
			}
		}
	}
	return nil
}

func idempotentMessagesFromRecord(rec map[string]any) []map[string]any {
	if rec == nil {
		return nil
	}
	if raw, ok := rec["messages"].([]map[string]any); ok && len(raw) > 0 {
		out := make([]map[string]any, 0, len(raw))
		for _, m := range raw {
			cp := map[string]any{}
			for k, v := range m {
				cp[k] = v
			}
			out = append(out, cp)
		}
		return out
	}
	if raw, ok := rec["messages"].([]any); ok && len(raw) > 0 {
		out := make([]map[string]any, 0, len(raw))
		for _, item := range raw {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	if str(rec["role"]) == "assistant" {
		return []map[string]any{rec}
	}
	return nil
}

func (s *Server) loadIdempotentReply(cid, clientMsgID string) map[string]any {
	msgs := s.loadIdempotentTurn(cid, clientMsgID)
	if len(msgs) == 0 {
		return nil
	}
	return msgs[len(msgs)-1]
}

func (s *Server) cancelCopilotTurn(r *http.Request) (any, error) {
	body, _ := decodeMap(r)
	corr := coalesce(str(body["correlationId"]), r.Header.Get("x-correlation-id"))
	if corr == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少 correlationId")
	}
	ok := cancelStreamByCorrelation(corr)
	markCopilotTurnCancelled(corr)
	return map[string]any{"ok": ok, "correlationId": corr, "status": turnStatusCancelled}, nil
}
