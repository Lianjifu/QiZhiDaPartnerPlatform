package copilot

import (
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
}

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

func (ls *liveAnswerStream) Active() bool {
	return ls != nil && ls.started && !ls.disabled
}

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

func (ls *liveAnswerStream) OnDelta(chunk string, accumulated string) {
	if ls == nil || ls.disabled || chunk == "" {
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

func (ls *liveAnswerStream) FinishOpenSegment() {
	if ls == nil || !ls.started {
		return
	}
	ls.finishSegment()
}

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

func (ls *liveAnswerStream) emitPlainDelta(text string) {
	ls.emit(contract.StreamDelta, "runtime", map[string]any{"text": text, "modelId": ls.modelID})
}

func (ls *liveAnswerStream) emitSegmentDelta(text string) {
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
