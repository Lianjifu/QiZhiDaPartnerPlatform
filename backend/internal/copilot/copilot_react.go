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
	"fmt"
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
	Request         *http.Request
	WorkspaceID     string
	ModelID         string
	System          string
	Messages        []modelprov.ChatMessage
	Registry        []registeredTool
	UserMessage     string
	ConversationID  string
	CorrelationID   string
	DigitalPartner string
	Viewer          *auth.Identity
	Emit            reactEmitFunc
	ModeHint        string
	ReflectHint     string
	RouteReason     string
	SkipRoute       bool
	SkipStream      bool
	NoBootstrap     bool
	MaxSteps        int
	SessionMode     string
	RiskLevel       string
	Channel         string // inbound channel (feishu/wecom/dingtalk); propagated into participantChannel
	RAGPrefetched   bool   // 主路径已预检索知识并写入 system，跳过 bootstrap retrieve
	SnapshotID      string
	Binding         map[string]any
	MemoryProvenance []map[string]any
	SegmentPolicy   string
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
}

// runReactTurn executes a bounded Reason→Act→Observe loop, then optionally streams the final answer.
func (s *Service) runReactTurn(ctx context.Context, in reactTurnInput) reactTurnResult {
	reg := in.Registry
	messages := append([]modelprov.ChatMessage{}, in.Messages...)
	system := strings.TrimSpace(in.System)
	if system != "" {
		system += "\n\n"
	}
	system += toolRegistryPrompt(reg)

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

	for step := 1; step <= maxSteps; step++ {
		steps = step
		in.Emit("stage", "react", map[string]any{"status": "running", "step": step})

		var buf strings.Builder
		text, rt, err := withLLMRetry(ctx, func(ctx context.Context) (string, ResolvedTurn, error) {
			return s.Deps.Routing.StreamLLMForCopilotFn(ctx, in.Request, in.WorkspaceID, in.ModelID, messages, system, func(chunk, mid string) error {
				if mid != "" {
					resolvedModel = mid
				}
				buf.WriteString(chunk)
				if in.LiveStream != nil {
					in.LiveStream.OnDelta(chunk, buf.String())
				}
				return nil
			})
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

		call, ok := parseToolCall(text)
		if !ok || maxSteps == 1 {
			finalText = stripToolCallMarkers(text)
			in.Emit("stage", "react", map[string]any{"status": "ok", "step": step, "action": "final"})
			emitThought(in.Emit, "finalize", turnPhasePlan, "准备输出回复", "")
			break
		}

		tcID := fmt.Sprintf("tc_react_%d", step)
		if title, detail := thoughtForToolChoice(call.Name); title != "" {
			emitThoughtPhase(in.Emit, "tool_call", turnPhaseExecute, title, detail, map[string]any{
				"toolCallId": tcID,
			})
		}
		in.Emit("tool", "react", map[string]any{
			"name": call.Name, "status": "running", "args": call.Args, "id": tcID,
		})

		tool, res := s.Deps.Tools.DispatchAuthorizedToolFn(runCtx, reg, call, in.SessionMode, in.RiskLevel, in.Emit)

		displayName := call.Name
		if tool != nil {
			displayName = tool.Name
		}
		toolCalls = append(toolCalls, toolCallToPersist(tcID, displayName, call.Args, res))
		extra := map[string]any{
			"name": displayName, "status": res.Status, "args": call.Args, "id": tcID,
			"durationMs": res.DurationMs, "permission": res.Permission,
		}
		if res.Hits != nil {
			extra["hits"] = res.Hits
			citations = append(citations, citationsFromRagHits(res.Hits)...)
		}
		if res.Error != "" {
			extra["error"] = res.Error
		}
		if res.SandboxID != "" {
			extra["sandboxId"] = res.SandboxID
		}
		in.Emit("tool", "react", extra)
		if title, detail := thoughtForToolResult(res.Status, displayName); title != "" {
			emitThoughtPhase(in.Emit, "tool_call", turnPhaseExecute, title, detail, map[string]any{
				"toolCallId": tcID,
			})
		}

		obs := res.Output
		if obs == "" {
			obs = coalesce(res.Error, res.Status)
		}
		if runCmd := s.Deps.Sandbox.ParseNextRunCommandFn(obs); s.Deps.Sandbox.ShouldAutoRunAfterSkillWriteFn(res, runCmd) && s.Deps.Sandbox.IsSkillWorkspaceWriteCallFn(call, tool) {
			runCall := s.Deps.Sandbox.BuildAutoRunToolCallAfterWriteFn(reg, tool, call, runCmd)
			runTcID := tcID + "_autorun"
			runDisplay := runCall.Name
			in.Emit("tool", "react", map[string]any{
				"name": runDisplay, "status": "running", "args": runCall.Args, "id": runTcID, "autoContinue": true,
			})
			runTool, runRes := s.Deps.Tools.DispatchAuthorizedToolFn(runCtx, reg, runCall, in.SessionMode, in.RiskLevel, in.Emit)
			// write 已在本回合成功：若 run 仍被送进审核队列，改为直接执行沙箱脚本（避免卡在「只写不跑」）。
			if runRes.Status == "pending_authorization" && s.Deps.Sandbox.IsSandboxCopilotWsPathFn(runCmd) {
				if runTool == nil {
					runTool = registryLookup(reg, runCall.Name)
				}
				if runTool != nil {
					runRes = s.runCopilotTool(runCtx, runTool, runCall)
				}
			}
			if runTool != nil {
				runDisplay = runTool.Name
			}
			toolCalls = append(toolCalls, toolCallToPersist(runTcID, runDisplay, runCall.Args, runRes))
			runExtra := map[string]any{
				"name": runDisplay, "status": runRes.Status, "args": runCall.Args, "id": runTcID, "autoContinue": true,
				"durationMs": runRes.DurationMs, "permission": runRes.Permission,
			}
			if runRes.Error != "" {
				runExtra["error"] = runRes.Error
			}
			if runRes.SandboxID != "" {
				runExtra["sandboxId"] = runRes.SandboxID
			}
			in.Emit("tool", "react", runExtra)
			runObs := coalesce(runRes.Output, coalesce(runRes.Error, runRes.Status))
			obs = strings.TrimSpace(obs + "\n\n【自动续跑 run · " + runDisplay + " · " + runRes.Status + "】\n" + runObs)
			if runRes.Status == "success" {
				res = runRes
			}
		}
		obs = truncateRunes(obs, reactToolObservationMaxRunes)
		messages = append(messages,
			modelprov.ChatMessage{Role: "assistant", Content: strings.TrimSpace(text)},
			modelprov.ChatMessage{Role: "user", Content: "【工具观察 " + displayName + " · " + res.Status + "】\n" + obs + "\n请基于观察继续：若需再调用工具请输出工具块，否则给出最终中文回答。"},
		)

		if step == maxSteps {
			systemFinal := system + "\n已达工具步数上限，请不要再调用工具，直接给出最终中文回答。"
			var finalBuf strings.Builder
			ft, rt2, err2 := withLLMRetry(ctx, func(ctx context.Context) (string, ResolvedTurn, error) {
				return s.Deps.Routing.StreamLLMForCopilotFn(ctx, in.Request, in.WorkspaceID, in.ModelID, messages, systemFinal, func(chunk, mid string) error {
					if mid != "" {
						resolvedModel = mid
					}
					finalBuf.WriteString(chunk)
					if in.LiveStream != nil {
						in.LiveStream.OnDelta(chunk, finalBuf.String())
					}
					return nil
				})
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
			Steps: steps, Mode: modeReact, Segments: segs, ReplyMode: in.ReplyMode,
		}
	}

	return reactTurnResult{
		Text: finalText, Resolved: lastRT, ModelID: resolvedModel,
		ToolCalls: toolCalls, Citations: dedupeCitations(citations),
		Steps: steps, Mode: modeReact,
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
