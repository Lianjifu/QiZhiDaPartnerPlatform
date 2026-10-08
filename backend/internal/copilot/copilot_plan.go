// Package copilot —— Plan→Execute 回合执行器。
//
// 职责：用 LLM 生成结构化计划（<<<PLAN>>>{...}<<<END>>> 块），
// 按步依次执行（retrieve / memory / tool / answer），最后再聚合成最终中文回答。
// 模型未产出有效 PLAN 块时回退到 heuristicPlan。
package copilot

// copilot_plan.go — 计划阶段:把 thought 转成可执行步骤序列。每个步骤对应一项
// tool call 或最终答复,是 ReAct 循环的输入。

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// planMaxSteps 单回合 plan_exec 模式的最大步骤数。
const planMaxSteps = 6

// planBlockRe 匹配 LLM 输出的 <<<PLAN>>>...<<<END>>> 计划块。
var planBlockRe = regexp.MustCompile(`(?s)<<<PLAN>>>\s*(\{.*?\})\s*<<<END>>>`)

// planStep 是计划里的一个步骤，Action 取值：retrieve | memory | tool | answer。
type planStep struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Action string `json:"action"` // retrieve | memory | tool | answer
	Tool   string `json:"tool"`
	Query  string `json:"query"`
}

// planPayload 是 LLM 一次 PLAN 块反序列化后的完整结构。
type planPayload struct {
	Goal  string     `json:"goal"`
	Steps []planStep `json:"steps"`
}

// parsePlan 从 LLM 文本里抽取并解析 PLAN 块；空计划 / 解析失败 / 步骤数为 0 都返回 false。
// 解析成功时还会把每步的 Action 小写化、补 ID、补默认 title，并按 planMaxSteps 截断。
func parsePlan(text string) (planPayload, bool) {
	m := planBlockRe.FindStringSubmatch(text)
	if len(m) != 2 {
		return planPayload{}, false
	}
	var p planPayload
	if err := json.Unmarshal([]byte(m[1]), &p); err != nil {
		return planPayload{}, false
	}
	if len(p.Steps) == 0 {
		return planPayload{}, false
	}
	for i := range p.Steps {
		if p.Steps[i].ID == "" {
			p.Steps[i].ID = fmt.Sprintf("%d", i+1)
		}
		if p.Steps[i].Title == "" {
			p.Steps[i].Title = "步骤 " + p.Steps[i].ID
		}
		p.Steps[i].Action = strings.ToLower(strings.TrimSpace(p.Steps[i].Action))
		if p.Steps[i].Action == "" {
			p.Steps[i].Action = "answer"
		}
	}
	if len(p.Steps) > planMaxSteps {
		p.Steps = p.Steps[:planMaxSteps]
	}
	return p, true
}

// heuristicPlan 在 LLM 没产出有效 PLAN 块时给出兜底计划：
// 默认 3 步（知识检索 → 偏好回忆 → 综合结论），命中"入职/材料/清单/办理"关键词时
// 切换为分步清单 + 催办要点的变体。
func heuristicPlan(userMsg string) planPayload {
	goal := truncateRunes(userMsg, 80)
	steps := []planStep{
		{ID: "1", Title: "检索相关知识", Action: "retrieve", Tool: "knowledge.retrieve", Query: userMsg},
		{ID: "2", Title: "回忆跨会话偏好", Action: "memory", Tool: "memory.recall", Query: userMsg},
		{ID: "3", Title: "整理可执行结论", Action: "answer"},
	}
	if containsAnyFold(userMsg, strings.ToLower(userMsg), "入职", "材料", "清单", "办理") {
		steps = []planStep{
			{ID: "1", Title: "检索入职/制度知识", Action: "retrieve", Tool: "knowledge.retrieve", Query: userMsg},
			{ID: "2", Title: "回忆历史办理偏好", Action: "memory", Tool: "memory.recall", Query: userMsg},
			{ID: "3", Title: "输出分步清单与催办要点", Action: "answer"},
		}
	}
	return planPayload{Goal: goal, Steps: steps}
}

// planPrompt 注入给 planner LLM 的 system prompt(走版本化注册表)。
// 要求只输出 PLAN 块、不超过 6 步;注册表为空时回退 hardcoded v1。
func planPrompt() string {
	return promptGet("plan.prompt")
}

// runPlanExecuteTurn: Planner → per-step Act → Aggregator, then optional caller reflection.
func (s *Service) runPlanExecuteTurn(ctx context.Context, in reactTurnInput) reactTurnResult {
	reg := in.Registry
	messages := append([]modelprov.ChatMessage{}, in.Messages...)
	system := strings.TrimSpace(in.System)
	if system != "" {
		system += "\n\n"
	}
	system += toolRegistryPrompt(reg)

	if !in.SkipRoute {
		in.Emit("route", "harness", map[string]any{
			"mode": modePlanExec, "maxSteps": planMaxSteps,
			"enabledTools": enabledToolKeys(reg), "modelId": in.ModelID,
			"reason": coalesce(in.RouteReason, "plan_exec"),
		})
	}

	var toolCalls []map[string]any
	var citations []map[string]any
	resolvedModel := in.ModelID
	var lastRT ResolvedTurn
	runCtx := toolRunContext{
		Request: in.Request, WorkspaceID: in.WorkspaceID,
		DigitalPartner: in.DigitalPartner, ConversationID: in.ConversationID,
		CorrelationID: in.CorrelationID, UserMessage: in.UserMessage, Viewer: in.Viewer,
		SessionMode: in.SessionMode, RiskLevel: in.RiskLevel,
	}
	if in.Viewer != nil {
		runCtx.OwnerID = in.Viewer.ID
	}

	// --- Plan ---
	in.Emit("stage", "plan", map[string]any{"status": "running"})
	planMsgs := append([]modelprov.ChatMessage{}, messages...)
	planMsgs = append(planMsgs, modelprov.ChatMessage{
		Role: "user", Content: "请为以下请求制定计划（只输出 PLAN 块）：\n" + in.UserMessage,
	})
	var planBuf strings.Builder
	planText, rt, err := withLLMRetry(ctx, func(ctx context.Context) (string, ResolvedTurn, error) {
		return s.Deps.Routing.StreamLLMForCopilotFn(ctx, in.Request, in.WorkspaceID, in.ModelID, planMsgs, system+"\n\n"+planPrompt(), func(chunk, mid string) error {
			if mid != "" {
				resolvedModel = mid
			}
			planBuf.WriteString(chunk)
			return nil
		})
	})
	if err == nil {
		lastRT = rt
		resolvedModel = coalesce(rt.ModelID, resolvedModel)
	}
	planText = coalesce(planText, planBuf.String())
	plan, ok := parsePlan(planText)
	if !ok {
		plan = heuristicPlan(in.UserMessage)
		in.Emit("stage", "plan", map[string]any{"status": "ok", "source": "heuristic"})
	} else {
		in.Emit("stage", "plan", map[string]any{"status": "ok", "source": "model"})
	}

	stepMaps := make([]map[string]any, 0, len(plan.Steps))
	for _, st := range plan.Steps {
		stepMaps = append(stepMaps, map[string]any{
			"id": st.ID, "title": st.Title, "action": st.Action, "tool": st.Tool, "query": st.Query, "status": "pending",
		})
	}
	in.Emit("plan", "plan", map[string]any{
		"goal": plan.Goal, "steps": stepMaps, "status": "ready",
	})
	emitThought(in.Emit, "plan", turnPhasePlan,
		"计划："+truncateRunes(coalesce(plan.Goal, in.UserMessage), 48),
		fmt.Sprintf("共 %d 步", len(plan.Steps)),
	)
	for i, st := range plan.Steps {
		emitTurnTask(in.Emit, "added", fmt.Sprintf("plan_%s", st.ID), st.Title, st.Action, i+1, len(plan.Steps))
	}
	if normalizeReplyMode(in.ReplyMode) == replyModeStepwise {
		appendStepSegment(in.StepSegments, defaultSegmentIDGen(s), segmentKindStep, "计划就绪",
			fmt.Sprintf("已制定 %d 步计划：%s", len(plan.Steps), coalesce(plan.Goal, in.UserMessage)))
	}

	var observations []string
	observations = append(observations, "目标："+coalesce(plan.Goal, in.UserMessage))

	// --- Execute steps ---
	for i, st := range plan.Steps {
		in.Emit("plan", "plan", map[string]any{
			"status": "step_running", "stepId": st.ID, "title": st.Title, "index": i + 1, "total": len(plan.Steps),
		})
		emitTurnTask(in.Emit, "started", fmt.Sprintf("plan_%s", st.ID), st.Title, "", i+1, len(plan.Steps))
		in.Emit("stage", "execute", map[string]any{"status": "running", "step": i + 1, "title": st.Title})

		query := coalesce(st.Query, in.UserMessage)
		switch st.Action {
		case "retrieve", "memory", "tool":
			toolName := st.Tool
			if st.Action == "retrieve" {
				toolName = coalesce(toolName, "knowledge.retrieve")
			}
			if st.Action == "memory" {
				toolName = coalesce(toolName, "memory.recall")
			}
			if toolName == "" {
				observations = append(observations, fmt.Sprintf("步骤%s「%s」：未指定工具，跳过", st.ID, st.Title))
				in.Emit("plan", "plan", map[string]any{"status": "step_skipped", "stepId": st.ID})
				emitTurnTask(in.Emit, "cancelled", fmt.Sprintf("plan_%s", st.ID), st.Title, "skipped", i+1, len(plan.Steps))
				continue
			}
			call := toolCallRequest{Name: toolName, Args: map[string]any{"query": query, "input": query}}
			tcID := fmt.Sprintf("tc_plan_%s", st.ID)
			in.Emit("tool", "plan", map[string]any{"name": toolName, "status": "running", "args": call.Args, "id": tcID})

			tool, res := s.Deps.Tools.DispatchAuthorizedToolFn(runCtx, reg, call, in.SessionMode, in.RiskLevel, in.Emit)
			display := toolName
			if tool != nil {
				display = tool.Name
			}
			toolCalls = append(toolCalls, toolCallToPersist(tcID, display, call.Args, res))
			extra := map[string]any{
				"name": display, "status": res.Status, "args": call.Args, "id": tcID,
				"durationMs": res.DurationMs, "permission": res.Permission,
			}
			if res.Hits != nil {
				extra["hits"] = res.Hits
				citations = append(citations, citationsFromRagHits(res.Hits)...)
			}
			if res.Error != "" {
				extra["error"] = res.Error
			}
			in.Emit("tool", "plan", extra)
			obs := coalesce(res.Output, coalesce(res.Error, res.Status))
			observations = append(observations, fmt.Sprintf("步骤%s「%s」·%s：\n%s", st.ID, st.Title, res.Status, obs))
			in.Emit("plan", "plan", map[string]any{"status": "step_done", "stepId": st.ID, "toolStatus": res.Status})
			emitTurnTask(in.Emit, "completed", fmt.Sprintf("plan_%s", st.ID), st.Title, res.Status, i+1, len(plan.Steps))
			if normalizeReplyMode(in.ReplyMode) == replyModeStepwise {
				appendStepSegment(in.StepSegments, defaultSegmentIDGen(s), segmentKindStep, st.Title,
					truncateRunes(obs, 280))
			}

		default: // answer — defer to aggregator; keep running until final text is ready
			observations = append(observations, fmt.Sprintf("步骤%s「%s」：待综合回答", st.ID, st.Title))
			in.Emit("plan", "plan", map[string]any{"status": "step_done", "stepId": st.ID, "toolStatus": "defer"})
		}
	}

	in.Emit("stage", "execute", map[string]any{"status": "ok", "steps": len(plan.Steps)})

	// --- Aggregate ---
	in.Emit("stage", "aggregate", map[string]any{"status": "running"})
	aggSystem := system + "\n你是执行汇总器。请根据「计划观察」给出面向用户的最终中文回答：结构清晰、可执行，不要输出 PLAN/TOOL 标记。"
	aggMsgs := append([]modelprov.ChatMessage{}, messages...)
	aggMsgs = append(aggMsgs, modelprov.ChatMessage{
		Role:    "user",
		Content: "用户请求：\n" + in.UserMessage + "\n\n计划观察：\n" + strings.Join(observations, "\n\n") + "\n\n请给出最终回答。",
	})
	var aggBuf strings.Builder
	aggText, rt2, err2 := withLLMRetry(ctx, func(ctx context.Context) (string, ResolvedTurn, error) {
		return s.Deps.Routing.StreamLLMForCopilotFn(ctx, in.Request, in.WorkspaceID, in.ModelID, aggMsgs, aggSystem, func(chunk, mid string) error {
			if mid != "" {
				resolvedModel = mid
			}
			aggBuf.WriteString(chunk)
			return nil
		})
	})
	if err2 != nil && aggBuf.Len() == 0 && aggText == "" {
		return reactTurnResult{Err: err2, ToolCalls: toolCalls, Citations: citations, Steps: len(plan.Steps), ModelID: resolvedModel, Mode: modePlanExec, Plan: plan}
	}
	if err2 == nil {
		lastRT = rt2
		resolvedModel = coalesce(rt2.ModelID, resolvedModel)
	}
	finalText := stripToolCallMarkers(coalesce(aggText, aggBuf.String()))
	if finalText == "" {
		finalText = "已完成计划执行，但汇总为空。观察摘要：\n" + strings.Join(observations, "\n")
	}
	in.Emit("stage", "aggregate", map[string]any{"status": "ok"})
	in.Emit("plan", "plan", map[string]any{"status": "completed", "goal": plan.Goal})
	for i, st := range plan.Steps {
		if st.Action == "retrieve" || st.Action == "memory" || st.Action == "tool" {
			continue
		}
		emitTurnTask(in.Emit, "completed", fmt.Sprintf("plan_%s", st.ID), st.Title, "done", i+1, len(plan.Steps))
	}

	if !in.SkipStream {
		streamOpts := &streamAnswerOpts{
			ReplyMode: in.ReplyMode, SegmentPolicy: in.SegmentPolicy, CorrelationID: in.CorrelationID,
			FirstMessageID: in.FirstMessageID, IDGen: defaultSegmentIDGen(s),
			PreSegments: stepSegmentsSlice(in.StepSegments),
		}
		segs := streamHarnessAnswer(in.Emit, finalText, resolvedModel, lastRT, modePlanExec, len(plan.Steps), streamOpts)
		return reactTurnResult{
			Text: finalText, Resolved: lastRT, ModelID: resolvedModel,
			ToolCalls: toolCalls, Citations: dedupeCitations(citations),
			Steps: len(plan.Steps), Mode: modePlanExec, Plan: plan, Segments: segs, ReplyMode: in.ReplyMode,
		}
	}

	return reactTurnResult{
		Text: finalText, Resolved: lastRT, ModelID: resolvedModel,
		ToolCalls: toolCalls, Citations: dedupeCitations(citations),
		Steps: len(plan.Steps), Mode: modePlanExec, Plan: plan,
	}
}
