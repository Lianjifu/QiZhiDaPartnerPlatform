// Package copilot —— 实时流式(live streaming)模块。
//
// 职责：LLM 生成过程中以 delta 形式实时推送给前端，避免等全文完成后再回放。
// 支持单气泡（plain delta）和分段（segment start/delta/done）两种流式形态，
// 触发分段由 replyMode + segmentDelimiter("<<<NEXT>>>") 共同决定。
package copilot

// copilot_live_stream.go — SSE 实时流:把回合事件流式推给前端,处理 backpressure
// 与断开重连。flush 策略与前端 EventSource 协商,避免单包过大被截断。

import (
	"context"
	"strings"

	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

// liveAnswerStream 在 LLM 生成过程中实时向客户端推送 delta，避免等全文完成后再回放。
type liveAnswerStream struct {
	emit           reactEmitFunc
	modelID        string
	corr           string
	replyMode      string
	segmentPolicy  string
	firstMessageID string
	idGen          func() string
	segmented      bool
	started        bool
	disabled       bool
	currentID      string
	segmentIndex   int
	emittedRunes   int
	// ctx 用于 SSE 客户端断开检测:ctx 取消时所有 emit* 方法立即返回,
	// 不再向 emit channel 推任何事件,避免无效工作与 goroutine 累积。
	// nil 时视为"无取消源"(向后兼容)。
	ctx context.Context
}

// newLiveAnswerStream 构造一个 liveAnswerStream；emit 为 nil 时直接返回 nil，
// 表示上层调用方选择不走实时流式（一次性发全文）。
func newLiveAnswerStream(emit reactEmitFunc, replyMode, segmentPolicy, corr, firstMessageID, modelID string, idGen func() string) *liveAnswerStream {
	if emit == nil {
		return nil
	}
	rm := normalizeReplyMode(replyMode)
	return &liveAnswerStream{
		emit:           emit,
		replyMode:      rm,
		segmentPolicy:  normalizeSegmentPolicy(segmentPolicy),
		corr:           corr,
		firstMessageID: firstMessageID,
		modelID:        modelID,
		idGen:          idGen,
		segmented:      rm != replyModeSingle,
	}
}

// Active 报告流式是否已启动且未被禁用，且底层 ctx 未取消。
// 客户端断开(SSE ctx 取消)时返回 false,调用方可据此跳过 emit。
func (ls *liveAnswerStream) Active() bool {
	if ls == nil || !ls.started || ls.disabled {
		return false
	}
	if ls.ctx != nil && ls.ctx.Err() != nil {
		return false
	}
	return true
}

// WithContext 注入 ctx,用于 SSE 客户端断开检测。
// 链式返回 ls,便于构造后立即挂在调用链上。
// ctx == nil 时清除(等价于"无取消源")。
func (ls *liveAnswerStream) WithContext(ctx context.Context) *liveAnswerStream {
	if ls != nil {
		ls.ctx = ctx
	}
	return ls
}

// isCtxDone 在所有 emit* 路径前调用:nil ctx 视为未取消,非 nil 时查 ctx.Err()。
// 返回 true 时调用方应立即放弃后续工作。
func (ls *liveAnswerStream) isCtxDone() bool {
	return ls != nil && ls.ctx != nil && ls.ctx.Err() != nil
}

// StreamedSegmentCount 返回已下发过的段数量（包含正在流的那一段），
// 用于 reconcile 时把已发送段和新段对齐。
func (ls *liveAnswerStream) StreamedSegmentCount() int {
	if ls == nil || !ls.started {
		return 0
	}
	n := ls.segmentIndex
	if ls.currentID != "" {
		n++
	}
	return n
}

// OnDelta 接收 LLM 流式产出的 chunk，并把它转成对应的 SSE delta 事件。
// 一旦检测到 <<<TOOL>>> 标记（说明模型要转 ReAct 工具调用），立刻禁用流式避免泄露给前端。
func (ls *liveAnswerStream) OnDelta(chunk string, accumulated string) {
	if ls == nil || ls.disabled || chunk == "" || ls.isCtxDone() {
		return
	}
	if strings.Contains(accumulated, "<<<TOOL>>>") {
		ls.disabled = true
		return
	}
	trim := strings.TrimSpace(accumulated)
	if !ls.started {
		if trim == "" {
			return
		}
		ls.beginSegment(ls.firstMessageID)
	}
	ls.pushDelta(chunk, accumulated)
}

// beginSegment 开启一个新段；已有打开段会先 finish。
// 分段模式（replyMode != single）下会先发 StreamMessageStart，附 messageId / segmentIndex。
func (ls *liveAnswerStream) beginSegment(messageID string) {
	if ls.started && ls.currentID != "" {
		ls.finishSegment()
	}
	ls.started = true
	ls.currentID = coalesce(messageID, ls.firstMessageID)
	if ls.currentID == "" && ls.idGen != nil {
		ls.currentID = ls.idGen()
	}
	if ls.segmented && ls.currentID != "" {
		ls.emit(contract.StreamMessageStart, "runtime", map[string]any{
			"type":          contract.StreamMessageStart,
			"messageId":     ls.currentID,
			"segmentIndex":  ls.segmentIndex,
			"correlationId": ls.corr,
			"replyMode":     ls.replyMode,
		})
	}
}

// finishSegment 关闭当前段：发 StreamMessageDone 并自增 segmentIndex、清空 currentID。
func (ls *liveAnswerStream) finishSegment() {
	if ls == nil || !ls.started || !ls.segmented || ls.currentID == "" {
		return
	}
	ls.emit(contract.StreamMessageDone, "runtime", map[string]any{
		"type":         contract.StreamMessageDone,
		"messageId":    ls.currentID,
		"segmentIndex": ls.segmentIndex,
	})
	ls.segmentIndex++
	ls.currentID = ""
}

// FinishOpenSegment 在回合末尾关闭可能仍处于"打开"状态的段，
// 由 streamHarnessAnswer 在 reconcile 阶段调用，避免最后一段被丢失。
func (ls *liveAnswerStream) FinishOpenSegment() {
	if ls == nil || !ls.started || ls.isCtxDone() {
		return
	}
	ls.finishSegment()
}

// pushDelta 把新累积文本中尚未发出的部分转成 SSE delta。
// 分段模式下遇到 <<<NEXT>>> 自动关闭当前段并开下一个；document 策略则不分段。
func (ls *liveAnswerStream) pushDelta(_ string, accumulated string) {
	accRunes := []rune(accumulated)
	if ls.emittedRunes > len(accRunes) {
		ls.emittedRunes = 0
	}
	pending := string(accRunes[ls.emittedRunes:])
	if !ls.segmented {
		if pending != "" {
			ls.emitPlainDelta(pending)
			ls.emittedRunes = len(accRunes)
		}
		return
	}
	if ls.segmentPolicy == segmentPolicyDocument {
		if pending != "" {
			ls.emitSegmentDelta(pending)
			ls.emittedRunes = len(accRunes)
		}
		return
	}
	for {
		idx := strings.Index(pending, segmentDelimiter)
		if idx < 0 {
			if pending != "" {
				ls.emitSegmentDelta(pending)
				ls.emittedRunes += len([]rune(pending))
			}
			return
		}
		head := pending[:idx]
		if strings.TrimSpace(head) != "" {
			ls.emitSegmentDelta(head)
		}
		ls.emittedRunes += len([]rune(pending[:idx+len(segmentDelimiter)]))
		ls.finishSegment()
		nextID := ""
		if ls.idGen != nil {
			nextID = ls.idGen()
		}
		ls.beginSegment(nextID)
		pending = pending[idx+len(segmentDelimiter):]
	}
}

// emitPlainDelta 在单气泡模式（不分段）下发出普通 StreamDelta 事件。
func (ls *liveAnswerStream) emitPlainDelta(text string) {
	if ls == nil || ls.isCtxDone() {
		return
	}
	ls.emit(contract.StreamDelta, "runtime", map[string]any{"text": text, "modelId": ls.modelID})
}

// emitSegmentDelta 在分段模式下发出 StreamMessageDelta，绑定到当前 currentID。
// 若还没 beginSegment 就先开一段，避免空段。
func (ls *liveAnswerStream) emitSegmentDelta(text string) {
	if ls == nil || ls.isCtxDone() {
		return
	}
	if ls.currentID == "" {
		ls.beginSegment(ls.firstMessageID)
	}
	ls.emit(contract.StreamMessageDelta, "runtime", map[string]any{
		"type":      contract.StreamMessageDelta,
		"messageId": ls.currentID,
		"text":      text,
		"modelId":   ls.modelID,
	})
}
