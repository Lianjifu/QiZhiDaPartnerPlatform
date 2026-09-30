package server

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

const planMaxSteps = 6

var planBlockRe = regexp.MustCompile(`(?s)<<<PLAN>>>\s*(\{.*?\})\s*<<<END>>>`)

type planStep struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Action string `json:"action"` // retrieve | memory | tool | answer
	Tool   string `json:"tool"`
	Query  string `json:"query"`
}

type planPayload struct {
	Goal  string     `json:"goal"`
	Steps []planStep `json:"steps"`
}

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

func planPrompt() string {
	return `你是任务规划器。请为用户目标产出简洁可执行计划，只输出计划块，不要回答问题本身：
<<<PLAN>>>
{"goal":"一句话目标","steps":[{"id":"1","title":"步骤标题","action":"retrieve|memory|tool|answer","tool":"可选工具名","query":"可选查询"}]}
<<<END>>>
规则：steps 不超过 6；需要查知识用 retrieve；需要回忆偏好用 memory；纯推理用 answer；具体技能用 tool 并填写 tool 名。`
}

// runPlanExecuteTurn: Planner → per-step Act → Aggregator, then optional caller reflection.
func (s *Server) runPlanExecuteTurn(ctx context.Context, in reactTurnInput) reactTurnResult {
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
	var lastRT resolvedTurn
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
	planText, rt, err := s.streamLLMForCopilot(ctx, in.Request, in.WorkspaceID, in.ModelID, planMsgs, system+"\n\n"+planPrompt(), func(chunk, mid string) error {
		if mid != "" {
			resolvedModel = mid
		}
		planBuf.WriteString(chunk)
		return nil
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
				continue
			}
			call := toolCallRequest{Name: toolName, Args: map[string]any{"query": query, "input": query}}
			tcID := fmt.Sprintf("tc_plan_%s", st.ID)
			in.Emit("tool", "plan", map[string]any{"name": toolName, "status": "running", "args": call.Args, "id": tcID})

			tool, res := s.dispatchAuthorizedTool(runCtx, reg, call, in.SessionMode, in.RiskLevel, in.Emit)
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

		default: // answer — defer to aggregator
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
	aggText, rt2, err2 := s.streamLLMForCopilot(ctx, in.Request, in.WorkspaceID, in.ModelID, aggMsgs, aggSystem, func(chunk, mid string) error {
		if mid != "" {
			resolvedModel = mid
		}
		aggBuf.WriteString(chunk)
		return nil
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
