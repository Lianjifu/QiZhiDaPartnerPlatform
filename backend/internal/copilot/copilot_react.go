// Package copilot —— ReAct（Reason→Act→Observe）回合执行器。
//
// 一次 runReactTurn 就是一次有界的多轮"模型决策→工具调用→观察注入"循环，
// 最后产出 finalText + toolCalls + citations + 段片段 + 模型元信息。
//
// 关键能力：
//   - bootstrap retrieve —— 首次自动跑 knowledge.retrieve（不依赖 LLM 主动调用）
//   - 自动续跑 auto-continue —— 写工具成功后自动接一个 run 工具，避免"只写不跑"
//   - maxSteps 兜底 —— 到达步数上限时再喂一次 system 提醒，逼出最终回答
//   - 富化 —— enrichCopilotFinalText 收尾（注入引用、去掉工具标记等）
//   - 段流式 —— runReactTurn 收尾后通过 streamHarnessAnswer 转 SSE 段事件
package copilot

// copilot_react.go — ReAct 主循环:反复 (think → tool → observe) 直到达到目标或
// 耗尽 step 预算。在 cognitive / state 完成阶段之后、reflect 之前。

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

const reactMaxSteps = 10
const reactToolObservationMaxRunes = 800

// reactEmitFunc 是 SSE emit 的统一签名（typ, stage, extra）。
//
// typ 取自 contract.Stream*（thought / tool / stage / delta / reflect / ...），
// stage 是触发阶段的标签（react / harness / plan / bootstrap）。
//
// 注意签名上 emit 不返回 error——SSE 通道断了由调用方（runReactTurn 的循环）自行判断。
type reactEmitFunc func(typ, stage string, extra map[string]any)

// reactTurnInput 是 runReactTurn 的入参。"输入"几乎涵盖了一次 copilot 回合需要的全部上下文。
//
// 字段分组：
//   - 路由相关：ModeHint / ReflectHint / RouteReason / SkipRoute / SkipStream / NoBootstrap
//   - 会话相关：SessionMode / RiskLevel / Channel / RAGPrefetched / SnapshotID / Binding
//   - 上下文注入：MemoryProvenance / SegmentPolicy / ReplyMode / FirstMessageID
//   - 流式相关：StepSegments / LiveStream / BranchFromMessageID（regenerate 入口）
//
// 字段命名约定：所有 ID 类都带 Id 后缀或全大写（Corr / ConversationID）。
type reactTurnInput struct {
	Request          *http.Request
	WorkspaceID      string
	ModelID          string
	System           string
	Messages         []modelprov.ChatMessage
	Registry         []registeredTool
	UserMessage      string
	ConversationID   string
	CorrelationID    string
	DigitalPartner   string
	Viewer           *auth.Identity
	Emit             reactEmitFunc
	ModeHint         string
	ReflectHint      string
	RouteReason      string
	SkipRoute        bool
	SkipStream       bool
	NoBootstrap      bool
	MaxSteps         int
	SessionMode      string
	RiskLevel        string
	Channel          string // inbound channel (feishu/wecom/dingtalk); propagated into participantChannel
	RAGPrefetched    bool   // 主路径已预检索知识并写入 system，跳过 bootstrap retrieve
	SnapshotID       string
	Binding          map[string]any
	MemoryProvenance []map[string]any
	SegmentPolicy    string
	ReplyMode        string
	FirstMessageID   string
	StepSegments     *[]AssistantSegment
	LiveStream       *liveAnswerStream
	Employee         map[string]any
	Cognitive        cognitiveDecision
	// BranchFromMessageID makes the upcoming assistant turn a sibling of
	// the given parent message ID (regenerate-from-here). When empty the
	// new turn is the root of its own variant group.
	BranchFromMessageID string
}

// reactTurnResult 是 runReactTurn 的出参。
//
// 关键字段：
//   - Text          —— 最终中文回答（已剥工具标记 + 富化）
//   - Resolved      —— 实际命中的模型 + 协议 + 级别（给 SSE 计费用）
//   - ToolCalls     —— 本回合所有工具调用记录（包含 bootstrap + auto-continue）
//   - Citations     —— 去重后的引用列表（docId+source+text 三元组去重）
//   - Steps         —— ReAct 实际走了多少步（含 bootstrap 但不含 maxSteps 兜底那次）
//   - Segments      —— 段流式输出（replyMode=segmented 时使用）
type reactTurnResult struct {
	Text          string
	Resolved      ResolvedTurn
	ModelID       string
	ToolCalls     []map[string]any
	Citations     []map[string]any
	Steps         int
	Err           error
	Mode          string
	Plan          planPayload
	ReflectRounds int
	Agents        []map[string]any
	PolicyLevel   string
	PolicyID      string
	StepSegments  []AssistantSegment
	Segments      []AssistantSegment
	ReplyMode     string
	Cognitive     cognitiveDecision
	// Awaiting 表示本回合因人工审核而挂起(P6):工具已进入审批队列,
	// 等审批结果回来后由 resume 续跑。AwaitingActionID 是待审单 ID。
	Awaiting        bool
	AwaitingActionID string
	AwaitingTool    string
}

// runReactTurn executes a bounded Reason→Act→Observe loop, then optionally streams the final answer.
func (s *Service) runReactTurn(ctx context.Context, in reactTurnInput) reactTurnResult {
	// 子伙伴 / 续跑等内部调用可能不带 emit:给一个空发射器,避免空指针。
	if in.Emit == nil {
		in.Emit = func(typ, stage string, extra map[string]any) {}
	}
	reg := in.Registry
	messages := append([]modelprov.ChatMessage{}, in.Messages...)
	system := strings.TrimSpace(in.System)
	if system != "" {
		system += "\n\n"
	}
	system += toolRegistryPrompt(reg)
	system += s.pendingTodosPrompt(in.ConversationID)

	maxSteps := in.MaxSteps
	if maxSteps <= 0 {
		maxSteps = reactMaxSteps
	}

	if !in.SkipRoute {
		in.Emit("route", "harness", map[string]any{
			"mode": modeReact, "maxSteps": maxSteps,
			"enabledTools": enabledToolKeys(reg), "modelId": in.ModelID,
			"reason": coalesce(in.RouteReason, "react"),
		})
	}

	var toolCalls []map[string]any
	var citations []map[string]any
	resolvedModel := in.ModelID
	var lastRT ResolvedTurn
	runCtx := toolRunContext{
		Request: in.Request, WorkspaceID: in.WorkspaceID, OwnerID: "",
		DigitalPartner: in.DigitalPartner, ConversationID: in.ConversationID,
		CorrelationID: in.CorrelationID, UserMessage: in.UserMessage, Viewer: in.Viewer,
		SessionMode: in.SessionMode, RiskLevel: in.RiskLevel,
		ModelID: in.ModelID,
	}
	if in.Viewer != nil {
		runCtx.OwnerID = in.Viewer.ID
	}

	// Bootstrap: if knowledge.retrieve is enabled, run once so factual turns always have RAG
	// without relying solely on model tool-calling compliance (esp. embedded).
	if !in.NoBootstrap && !in.RAGPrefetched {
		if t := registryLookup(reg, "knowledge.retrieve"); t != nil && t.Enabled {
			in.Emit("stage", "react", map[string]any{"status": "running", "step": 0, "action": "bootstrap_retrieve"})
			call := toolCallRequest{Name: "knowledge.retrieve", Args: map[string]any{"query": in.UserMessage}}
			in.Emit("tool", "react", map[string]any{
				"name": call.Name, "status": "running", "args": call.Args, "id": "tc_bootstrap_kr",
			})
			res := s.runCopilotTool(runCtx, t, call)
			tcID := "tc_bootstrap_kr"
			toolCalls = append(toolCalls, toolCallToPersist(tcID, call.Name, call.Args, res))
			extra := map[string]any{
				"name": call.Name, "status": res.Status, "args": call.Args, "id": tcID,
				"durationMs": res.DurationMs, "permission": res.Permission,
			}
			if res.Hits != nil {
				extra["hits"] = res.Hits
				citations = append(citations, citationsFromRagHits(res.Hits)...)
			}
			if res.Error != "" {
				extra["error"] = res.Error
			}
			in.Emit("tool", "react", extra)
			messages = append(messages,
				modelprov.ChatMessage{Role: "assistant", Content: "<<<TOOL>>>\n{\"name\":\"knowledge.retrieve\",\"args\":{\"query\":" + jsonQuote(in.UserMessage) + "}}\n<<<END>>>"},
				modelprov.ChatMessage{Role: "user", Content: "【工具观察 knowledge.retrieve】\n" + truncateRunes(res.Output, reactToolObservationMaxRunes)},
			)
		}
	}

	finalText := ""
	steps := 0
	failedTools := map[string]int{}

	// P3: 把能力契约(P2)转成工具 schema 下发给模型;provider 不支持时
	// modelprov 会透明降级,此时不会有结构化调用,继续走文本解析路径。
	awaiting := false
	awaitingActionID := ""
	awaitingTool := ""

	toolSchemas := registryToSchemas(reg)
	// CachePoints{0} 标记 system 前缀(跨回合稳定)可做提示缓存(P4)。
	llmOpts := LLMCallOptions{Tools: toolSchemas, CachePoints: []int{0}}
	if len(toolSchemas) > 1 {
		llmOpts.ParallelToolCalls = true
	}

	for step := 1; step <= maxSteps; step++ {
		steps = step
		in.Emit("stage", "react", map[string]any{"status": "running", "step": step})

		var buf strings.Builder
		var structCalls []modelprov.ToolCall
		text, rt, err := withLLMRetry(ctx, func(ctx context.Context) (string, ResolvedTurn, error) {
			reply, calls, resolved, callErr := s.Deps.Routing.StreamLLMForCopilotFn(ctx, in.Request, in.WorkspaceID, in.ModelID, messages, system, llmOpts, func(chunk, mid string) error {
				if mid != "" {
					resolvedModel = mid
				}
				buf.WriteString(chunk)
				if in.LiveStream != nil {
					in.LiveStream.OnDelta(chunk, buf.String())
				}
				return nil
			})
			structCalls = calls
			return reply, resolved, callErr
		})
		if err != nil {
			if finalText == "" && buf.Len() == 0 && text == "" {
				return reactTurnResult{Err: err, ToolCalls: toolCalls, Citations: citations, Steps: steps, ModelID: resolvedModel, Mode: modeReact}
			}
			text = coalesce(text, buf.String())
		} else {
			lastRT = rt
			if text == "" {
				text = buf.String()
			}
			resolvedModel = coalesce(rt.ModelID, resolvedModel)
		}

		// P3: 优先采用结构化工具调用;模型没给结构化调用时回退到文本解析。
		calls := structuredToolCalls(structCalls)
		structured := len(calls) > 0
		if !structured {
			if c, ok := parseToolCall(text); ok {
				calls = []toolCallRequest{c}
			}
		}
		if len(calls) == 0 || maxSteps == 1 {
			finalText = stripToolCallMarkers(text)
			in.Emit("stage", "react", map[string]any{"status": "ok", "step": step, "action": "final"})
			emitThought(in.Emit, "finalize", turnPhasePlan, "准备输出回复", "")
			break
		}

		// 一轮内的多个工具并行执行(治理闸不变,只提吞吐)。
		records := s.executeToolCalls(runCtx, reg, calls, in.SessionMode, in.RiskLevel, in.Emit)
		for i := range records {
			rec := &records[i]
			// P4 上下文卸载:过大的工具输出落成产物,上下文里只留引用。
			full := rec.Res.Output
			if full == "" {
				full = coalesce(rec.Res.Error, rec.Res.Status)
			}
			if ref := s.offloadToolOutput(ArtifactInput{
				WorkspaceID:    in.WorkspaceID,
				ConversationID: in.ConversationID,
				CorrelationID:  in.CorrelationID,
				DigitalPartner: in.DigitalPartner,
				ToolName:       rec.Name,
				Content:        full,
			}); ref != nil {
				rec.ContextObservation = artifactReferenceText(ref)
			}
			toolCalls = append(toolCalls, toolCallToPersist(rec.ID, rec.Name, rec.Args, rec.Res))
			if rec.Res.Hits != nil {
				citations = append(citations, citationsFromRagHits(rec.Res.Hits)...)
			}
			// 自动续跑:写类 skill 成功后自动接一次 run(逐个处理,保持原语义)。
			extra, extraRec := s.autoContinueAfterWrite(runCtx, reg, rec, calls[i], in.SessionMode, in.RiskLevel, in.Emit)
			if extraRec != nil {
				toolCalls = append(toolCalls, toolCallToPersist(extraRec.ID, extraRec.Name, extraRec.Args, extraRec.Res))
			}
			if extra != "" {
				rec.Res.Output = rec.Res.Output + "\n\n" + extra
			}
			if rec.Res.Permission == "prohibited" {
				s.maybeEscalate(in, escalateTriggerProhibited,
					"伙伴尝试执行被边界策略禁止的能力："+rec.Name, rec.Name)
			}
			if rec.Res.Status == "failed" {
				failedTools[rec.Name]++
				if failedTools[rec.Name] >= escalateFailureThreshold {
					s.maybeEscalate(in, escalateTriggerToolFailure,
						"工具「"+rec.Name+"」连续失败 "+itoa(failedTools[rec.Name])+" 次", rec.Name)
				}
			} else {
				delete(failedTools, rec.Name)
			}
			// P6: pending tool authorization suspends this turn; resume continues it.
			if rec.Res.Status == "pending_authorization" {
				awaiting = true
				awaitingActionID = rec.Res.ActionID
				awaitingTool = rec.Name
			}
		}

		if structured {
			messages = append(messages,
				modelprov.ChatMessage{Role: "assistant", Content: strings.TrimSpace(text), ToolCalls: structCalls},
				modelprov.ChatMessage{Role: "user", ToolResults: toolCallsToResults(records, structCalls)},
				modelprov.ChatMessage{Role: "user", Content: "请基于上述工具观察继续：若需再调用工具请直接发起工具调用，否则给出最终中文回答。"},
			)
		} else {
			rec := records[0]
			messages = append(messages,
				modelprov.ChatMessage{Role: "assistant", Content: strings.TrimSpace(text)},
				modelprov.ChatMessage{Role: "user", Content: toolResultContent(rec) + "\n请基于观察继续：若需再调用工具请输出工具块，否则给出最终中文回答。"},
			)
		}

		if awaiting {
			// Suspend: wait for the approval result, then resume this same turn.
			in.Emit("awaiting", "approval", map[string]any{
				"status": "pending_authorization", "actionId": awaitingActionID, "tool": awaitingTool,
			})
			finalText = "工具「" + awaitingTool + "」已进入人工审核队列，等待授权通过后将继续执行。"
			break
		}

		if step == maxSteps {
			systemFinal := system + "\n已达工具步数上限，请不要再调用工具，直接给出最终中文回答。"
			var finalBuf strings.Builder
			ft, rt2, err2 := withLLMRetry(ctx, func(ctx context.Context) (string, ResolvedTurn, error) {
				reply, _, resolved, callErr := s.Deps.Routing.StreamLLMForCopilotFn(ctx, in.Request, in.WorkspaceID, in.ModelID, messages, systemFinal, LLMCallOptions{}, func(chunk, mid string) error {
					if mid != "" {
						resolvedModel = mid
					}
					finalBuf.WriteString(chunk)
					if in.LiveStream != nil {
						in.LiveStream.OnDelta(chunk, finalBuf.String())
					}
					return nil
				})
				return reply, resolved, callErr
			})
			if err2 == nil {
				lastRT = rt2
				finalText = stripToolCallMarkers(coalesce(ft, finalBuf.String()))
			} else {
				finalText = "已完成工具调用，但最终合成失败：" + err2.Error()
			}
			in.Emit("stage", "react", map[string]any{"status": "ok", "step": step, "action": "max_steps_final"})
			break
		}
	}

	if finalText == "" {
		finalText = "（未生成回复）"
	}
	if looksLikeLeakedToolMarkup(finalText) {
		finalText = stripToolCallMarkers(finalText)
	}
	if strings.TrimSpace(finalText) == "" || looksLikeLeakedToolMarkup(finalText) {
		if toolOut := strings.TrimSpace(bestToolArtifactOutput(toolCalls)); toolOut != "" {
			finalText = toolOut
		}
	}
	finalText = enrichCopilotFinalText(finalText, toolCalls, in.UserMessage)

	if !in.SkipStream {
		streamOpts := &streamAnswerOpts{
			ReplyMode: in.ReplyMode, SegmentPolicy: in.SegmentPolicy, CorrelationID: in.CorrelationID,
			FirstMessageID: in.FirstMessageID, IDGen: defaultSegmentIDGen(s),
			PreSegments: stepSegmentsSlice(in.StepSegments),
		}
		segs := streamHarnessAnswer(in.Emit, finalText, resolvedModel, lastRT, modeReact, steps, streamOpts)
		return reactTurnResult{
			Text: finalText, Resolved: lastRT, ModelID: resolvedModel,
			ToolCalls: toolCalls, Citations: dedupeCitations(citations),
			Steps: steps, Mode: modeReact, Segments: segs, ReplyMode: in.ReplyMode,			Awaiting: awaiting, AwaitingActionID: awaitingActionID, AwaitingTool: awaitingTool,
		}
	}

	return reactTurnResult{
		Text: finalText, Resolved: lastRT, ModelID: resolvedModel,
		ToolCalls: toolCalls, Citations: dedupeCitations(citations),
		Steps: steps, Mode: modeReact,
		Awaiting: awaiting, AwaitingActionID: awaitingActionID, AwaitingTool: awaitingTool,
	}
}

func jsonQuote(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return `""`
	}
	return string(b)
}

func dedupeCitations(in []map[string]any) []map[string]any {
	seen := map[string]struct{}{}
	out := make([]map[string]any, 0, len(in))
	for _, c := range in {
		key := str(c["docId"]) + "|" + str(c["source"]) + "|" + str(c["text"])
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, c)
	}
	return out
}
