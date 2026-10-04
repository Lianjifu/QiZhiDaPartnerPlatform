// Package copilot —— copilot 回合的两类进程级限流。
//
// 1. 全局限流器 copilotRateLimiter（令牌桶算法）：
//    按 ws+userID 维度配额，默认 30 req/min（可由 DE_COPILOT_RPM 调整），
//    超额时让 allowCopilotTurn 返回 false 并把计数器 IncCopilotRateLimited 上报。
//
// 2. 流式取消表 streamCancels（sync.Map）：
//    把每个 SSE 流的 ctx.CancelFunc 按 correlationId 登记，
//    cancelStreamByCorrelation 让 POST /cancel 端点能跨 goroutine 终止正在跑的回合。
//
// 3. 幂等表 streamIdempot + Store.CopilotIdempotency：
//    同一 (cid, clientMsgID) 在窗口内重投时直接返回历史 assistant 消息，
//    避免并发 wecom webhook 把同一句用户消息跑两遍。
package copilot

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

// copilotRateLimiter 是"令牌桶"实现的进程内限流器。
//
// 字段：
//   - buckets —— 按 key 维度（ws+userID）分桶，互不影响
//   - rate    —— 每秒补充的 token 数（= RPM/60）
//   - burst   —— 桶容量上限（= RPM），允许短时尖峰
//
// 每次 allow() 先按 elapsed × rate 给桶补 token，封顶 burst，再扣 1；
// 扣完 <1 即视为超限。
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

// allow 是令牌桶的核心动作，调用方需保证 key 维度的合理性（一般用 ws+userID）。
//
// 实现细节：
//   - 用一把 mutex 串行化所有桶的访问——单进程内限流器不需要细粒度锁
//   - 补 token 公式 elapsed × rate 必须先于扣减，避免新桶被超额扣除
//   - 返回 false 时调用方负责把指标 IncCopilotRateLimited 上报
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

func (s *Service) allowCopilotTurn(ws, userID string) bool {
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

func rememberIdempotentReply(s *Service, cid, clientMsgID string, assistant map[string]any) {
	rememberIdempotentTurn(s, cid, clientMsgID, []map[string]any{assistant})
}

func rememberIdempotentTurn(s *Service, cid, clientMsgID string, messages []map[string]any) {
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

func (s *Service) loadIdempotentTurn(cid, clientMsgID string) []map[string]any {
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

func (s *Service) loadIdempotentReply(cid, clientMsgID string) map[string]any {
	msgs := s.loadIdempotentTurn(cid, clientMsgID)
	if len(msgs) == 0 {
		return nil
	}
	return msgs[len(msgs)-1]
}

func (s *Service) cancelCopilotTurn(r *http.Request) (any, error) {
	body, _ := decodeMap(r)
	corr := coalesce(str(body["correlationId"]), r.Header.Get("x-correlation-id"))
	if corr == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少 correlationId")
	}
	ok := cancelStreamByCorrelation(corr)
	markCopilotTurnCancelled(corr)
	return map[string]any{"ok": ok, "correlationId": corr, "status": turnStatusCancelled}, nil
}
