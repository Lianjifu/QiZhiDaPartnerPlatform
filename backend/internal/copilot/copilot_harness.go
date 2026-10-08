// Package copilot —— 顶层 harness 调度模块。
//
// 职责：把 classifyCopilotMode 的路由决策、resolveModelByPolicyLevel 的模型选型、
// decideCognitiveFramework 的认知框架、reflection 反思、live stream 等子模块
// 在 runHarnessTurn 里串成一个完整的 copilot 回合。
package copilot

// copilot_harness.go — ReAct harness 入口:串联 route / cognitive / react /
// reflect / answer_enrich / stream 等子阶段,处理整体事务边界与异常回滚。

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// runHarnessTurn routes to direct / react / plan_exec / multi_agent,
// applies routing_policies model tier, optional reflection, then streams once.
func (s *Service) runHarnessTurn(ctx context.Context, in reactTurnInput) reactTurnResult {
	decision := classifyCopilotMode(in.UserMessage, in.ModeHint, in.ReflectHint)
	in.RouteReason = decision.Reason
	in.SkipRoute = false
	in.SkipStream = true

	// Dynamic routing: map difficulty → published routing_policies level → primaryModelId
	resolvedModel, policyID, usedLevel := s.resolveModelByPolicyLevel(in.WorkspaceID, in.ModelID, decision.PolicyLevel, in.RiskLevel)
	if resolvedModel != "" {
		in.ModelID = resolvedModel
	}

	// 模型用量预算闸:per-turn 一次,在 cognitive 决策之前拦截,
	// 避免已无预算的 workspace 还跑昂贵的认知分析。
	var employeeID string
	if in.Viewer != nil {
		employeeID = in.Viewer.ID
	}
	if employeeID != "" {
		proposedModel := coalesce(resolvedModel, in.ModelID)
		allowed, remaining, berr := s.depCheckModelBudget(in.WorkspaceID, employeeID, proposedModel)
		if berr != nil || !allowed {
			IncCopilotBudgetDenied()
			in.Emit("stage", "harness", map[string]any{
				"status":   "budget_denied",
				"remaining": remaining,
				"modelId":   proposedModel,
				"reason":   "model_budget_exceeded",
			})
			msg := fmt.Sprintf("model budget exceeded (remaining=$%.4f, model=%s)", remaining, proposedModel)
			if berr != nil {
				msg = fmt.Sprintf("model budget check error: %v", berr)
			}
			return reactTurnResult{
				Err:         errors.New(msg),
				ModelID:     proposedModel,
				Mode:        decision.Mode,
				PolicyLevel: usedLevel,
				PolicyID:    policyID,
			}
		}
	}

	// Cognitive thinking model: route after harness mode, inject digest before act.
	cog := decideCognitiveFramework(in.UserMessage, decision.Mode, usedLevel, in.Employee)
	in.Cognitive = cog
	IncCopilotCognitive(cog)

	in.Emit("route", "harness", map[string]any{
		"mode": decision.Mode, "reason": decision.Reason,
		"enabledTools": enabledToolKeys(in.Registry), "modelId": in.ModelID,
		"maxSteps":    reactMaxSteps,
		"policyLevel": usedLevel, "policyId": policyID,
		"requestedLevel": decision.PolicyLevel,
		"cognitive":      cognitiveSnapshot(cog),
	})
	if title, detail := thoughtUnderstandTask(in.UserMessage); title != "" {
		emitThought(in.Emit, "plan", turnPhaseUnderstand, title, detail)
	}
	emitCognitiveThoughts(in.Emit, cog)
	if title, detail := thoughtForRouteMode(decision.Mode, decision.Reason); title != "" {
		emitThought(in.Emit, "plan", turnPhasePlan, title, detail)
	}
	if dig := strings.TrimSpace(cog.DigestText); dig != "" {
		if strings.TrimSpace(in.System) != "" {
			in.System += "\n\n"
		}
		in.System += dig
	}
	in.SkipRoute = true

	idGen := defaultSegmentIDGen(s)
	live := newLiveAnswerStream(in.Emit, in.ReplyMode, in.SegmentPolicy, in.CorrelationID, in.FirstMessageID, in.ModelID, idGen).WithContext(ctx)
	in.LiveStream = live

	var out reactTurnResult
	switch decision.Mode {
	case modeMultiAgent:
		out = s.runMultiAgentTurn(ctx, in)
	case modePlanExec:
		out = s.runPlanExecuteTurn(ctx, in)
	case modeDirect:
		in.MaxSteps = 1
		out = s.runReactTurn(ctx, in)
		out.Mode = modeDirect
	default:
		out = s.runReactTurn(ctx, in)
		if out.Mode == "" {
			out.Mode = modeReact
		}
	}

	if out.Err != nil {
		out.Cognitive = cog
		return out
	}

	out = s.applyReflection(ctx, in, out, in.ReflectHint)
	if out.Mode == "" {
		out.Mode = decision.Mode
	}
	out.PolicyLevel = usedLevel
	out.PolicyID = policyID
	out.Cognitive = cog

	out.Text = enrichCopilotFinalText(out.Text, out.ToolCalls, in.UserMessage)

	emitCognitiveFinalize(in.Emit, cog)

	streamOpts := &streamAnswerOpts{
		ReplyMode: in.ReplyMode, SegmentPolicy: in.SegmentPolicy, CorrelationID: in.CorrelationID,
		FirstMessageID: in.FirstMessageID, IDGen: idGen,
		PreSegments: append(stepSegmentsSlice(in.StepSegments), out.StepSegments...),
		LiveStream: live,
	}
	out.Segments = streamHarnessAnswer(in.Emit, out.Text, coalesce(out.ModelID, in.ModelID), out.Resolved, out.Mode, out.Steps, streamOpts)
	out.ReplyMode = in.ReplyMode
	return out
}
