// Package copilot —— 多智能体(multi-agent)协作模块。
//
// 职责：以 Supervisor（主数字伙伴）+ 多个 Specialist（其他岗位）并行协作的形式
// 处理跨领域问题。每个 specialist 在独立的 participantContext 中跑自己的 ReAct，
// supervisor 拿到所有意见后用主模型统一汇总。
package copilot

// copilot_multi.go — 多专家面板(supervisor panel):同时调度多个 copilot 角色协作,
// 各角色独立 context、并行产出;适合需要多视角的综合判断场景。

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/agentos"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// multiAgentMaxSpecialists 单回合最多调度的子专家数量。
const multiAgentMaxSpecialists = 3

// specialistRef 是选中子专家的轻量引用，用于 picker 输出和 SSE emit。
type specialistRef struct {
	ID         string
	Name       string
	Role       string
	Department string
	Score      int
	Task       string
}

// listActiveSpecialists 取出当前 workspace 下 lifecycle=active/published 的员工；
// excludeID 通常是 supervisor 自己的 id，用于避免"自己选自己"。
func (s *Service) listActiveSpecialists(ws, excludeID string) []map[string]any {
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, e := range s.Store.Employees {
		if str(e["workspaceId"]) != ws {
			continue
		}
		id := str(e["id"])
		if id == "" || id == excludeID {
			continue
		}
		life := str(e["lifecycle"])
		if life != "active" && life != "published" {
			continue
		}
		cp := map[string]any{}
		for k, v := range e {
			cp[k] = v
		}
		out = append(out, cp)
	}
	return out
}

// scoreSpecialist 基于岗位关键词 × 用户关键词的命中数给候选员工打分。
// 命中"运维/人事/质检/财务/法务"等预设组（4 分/命中）累计；返回 0 表示该员工与此问题无关。
func scoreSpecialist(emp map[string]any, userMsg string) int {
	lower := strings.ToLower(userMsg)
	hay := strings.ToLower(strings.Join([]string{
		str(emp["name"]), str(emp["role"]), str(emp["department"]), str(emp["description"]),
		strings.Join(stringSlice(emp["responsibilities"]), " "),
	}, " "))
	score := 0
	hit := func(points int, roleNeedles []string, queryNeedles []string) {
		roleMatch := false
		for _, n := range roleNeedles {
			if strings.Contains(hay, strings.ToLower(n)) {
				roleMatch = true
				break
			}
		}
		if !roleMatch {
			return
		}
		for _, n := range queryNeedles {
			if strings.Contains(userMsg, n) || strings.Contains(lower, strings.ToLower(n)) {
				score += points
			}
		}
	}
	hit(4, []string{"sre", "运维", "信息", "故障", "值班"}, []string{"运维", "故障", "缓存", "发布", "kubectl", "CMDB", "SRE", "延迟", "扩容", "redis"})
	hit(4, []string{"人事", "hr", "招聘"}, []string{"人事", "入职", "年假", "招聘", "薪资", "HR"})
	hit(4, []string{"质检", "客服", "qa", "运营"}, []string{"质检", "客服", "对客", "投诉", "QA"})
	hit(4, []string{"财务", "报销"}, []string{"财务", "报销", "预算", "发票"})
	hit(4, []string{"法务", "合规", "审计"}, []string{"法务", "合规", "合同", "审计"})
	return score
}

// pickSpecialists 从候选员工里按 score 降序挑前 max 个，转成 specialistRef。
// 0 分的员工直接淘汰；score 相同按出现顺序保留。
func pickSpecialists(cands []map[string]any, userMsg string, max int) []specialistRef {
	type scored struct {
		emp   map[string]any
		score int
	}
	var list []scored
	for _, e := range cands {
		sc := scoreSpecialist(e, userMsg)
		if sc <= 0 {
			continue
		}
		list = append(list, scored{emp: e, score: sc})
	}
	// simple sort by score desc
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if list[j].score > list[i].score {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	if max <= 0 {
		max = multiAgentMaxSpecialists
	}
	if len(list) > max {
		list = list[:max]
	}
	out := make([]specialistRef, 0, len(list))
	for _, item := range list {
		e := item.emp
		task := fmt.Sprintf("请从「%s」岗位视角，针对用户问题给出简要专业意见（不超过 8 句）。", coalesce(str(e["role"]), str(e["name"])))
		out = append(out, specialistRef{
			ID: str(e["id"]), Name: str(e["name"]), Role: str(e["role"]),
			Department: str(e["department"]), Score: item.score, Task: task,
		})
	}
	return out
}

// specialistSystemPrompt 给子专家拼一份"只输出本岗位视角的简要意见"的 system prompt，
// 强制不输出 TOOL/PLAN 标记，避免污染 supervisor 聚合 prompt。
func specialistSystemPrompt(emp map[string]any) string {
	name := coalesce(str(emp["name"]), "数字伙伴")
	role := coalesce(str(emp["role"]), str(emp["title"]))
	dept := str(emp["department"])
	var b strings.Builder
	b.WriteString("你是协作子专家「")
	b.WriteString(name)
	b.WriteString("」。\n")
	if role != "" {
		b.WriteString("岗位：")
		b.WriteString(role)
		if dept != "" {
			b.WriteString(" · ")
			b.WriteString(dept)
		}
		b.WriteString("\n")
	}
	if desc := str(emp["description"]); desc != "" {
		b.WriteString("职责：")
		b.WriteString(desc)
		b.WriteString("\n")
	}
	if resp := stringSlice(emp["responsibilities"]); len(resp) > 0 {
		b.WriteString("职责边界：")
		b.WriteString(strings.Join(resp, "、"))
		b.WriteString("\n")
	}
	// 工具/规划标记禁用规则走版本化注册表;子专家只输出意见,不主动调用工具。
	b.WriteString(promptGet("system.multi.worker.tail"))
	return b.String()
}

// runMultiAgentTurn: Supervisor selects specialists → each specialist runs
// in its own participantContext (Phase 1 MVE) → supervisor aggregate.
//
// The participant pipeline gives every specialist its own:
//
//   - identity profile + hard-no guard (Mem5)
//   - memory slice (Mem2/6 BM25+MMR retrieval keyed by specialist DE id)
//   - model selection (modelprov risk-floor policy routing)
//   - skill registry filtered by specialist session mode
//
// Sub-calls run in parallel (errgroup) with a 30s per-participant budget
// and propagate parent ctx cancellation. Aggregation merges the opinions in
// the supervisor's persona.
func (s *Service) runMultiAgentTurn(ctx context.Context, in reactTurnInput) reactTurnResult {
	reg := in.Registry
	supervisorID := in.DigitalPartner
	cands := s.listActiveSpecialists(in.WorkspaceID, supervisorID)
	picks := pickSpecialists(cands, in.UserMessage, multiAgentMaxSpecialists)

	if len(picks) == 0 {
		// Distinguish "workspace has zero active specialists" from "active
		// specialists exist but none scored against this prompt". The former
		// is a deployment/registry gap; the latter is a routing-tuning gap.
		// Conflating them produces misleading readiness metrics.
		fallbackReason := "no_specialists_scored"
		if len(cands) == 0 {
			fallbackReason = "no_active_specialists"
		}
		in.Emit("agent", "multi", map[string]any{
			"status": "fallback", "reason": fallbackReason,
			"candidates": len(cands),
		})
		// Test-only override: when set, return a zero reactTurnResult so
		// tests can observe the emit and reason without exercising the full
		// plan/exec harness.
		if s.testHooks != nil && s.testHooks.runPlanExecuteOverride != nil {
			return s.testHooks.runPlanExecuteOverride(in)
		}
		// Fall back to plan_exec when no peers available
		return s.runPlanExecuteTurn(ctx, in)
	}

	if !in.SkipRoute {
		in.Emit("route", "harness", map[string]any{
			"mode": modeMultiAgent, "reason": coalesce(in.RouteReason, "multi_agent"),
			"enabledTools": enabledToolKeys(reg), "modelId": in.ModelID,
			"specialists": len(picks),
		})
	}

	in.Emit("agent", "multi", map[string]any{
		"status": "supervising", "supervisorId": supervisorID,
		"specialists": specialistMaps(picks),
	})

	empByID := map[string]map[string]any{}
	for _, e := range cands {
		empByID[str(e["id"])] = e
	}

	// Supervisor-side shared retrieve. This is in ADDITION to each
	// participant's own knowledge.retrieve: the supervisor's RAG hits are
	// folded into the aggregate prompt so cross-domain context reaches the
	// final synthesis even when individual specialists didn't surface it.
	var toolCalls []map[string]any
	var opinions []string
	if t := registryLookup(reg, "knowledge.retrieve"); t != nil && t.Enabled {
		runCtx := toolRunContext{
			Request: in.Request, WorkspaceID: in.WorkspaceID,
			DigitalPartner: in.DigitalPartner, ConversationID: in.ConversationID,
			CorrelationID: in.CorrelationID, UserMessage: in.UserMessage, Viewer: in.Viewer,
		}
		if in.Viewer != nil {
			runCtx.OwnerID = in.Viewer.ID
		}
		call := toolCallRequest{Name: "knowledge.retrieve", Args: map[string]any{"query": in.UserMessage}}
		res := s.runCopilotTool(runCtx, t, call)
		tcID := "tc_multi_kr"
		toolCalls = append(toolCalls, toolCallToPersist(tcID, call.Name, call.Args, res))
		in.Emit("tool", "multi", map[string]any{
			"name": call.Name, "status": res.Status, "id": tcID, "durationMs": res.DurationMs, "hits": res.Hits,
		})
		// Supervisor shared retrieve writes to citationlog too, but with a
		// supervisor-scoped turnID (no participant suffix) so an audit can
		// distinguish supervisor-aggregated hits from per-specialist hits.
		if hits := ragHitResults(res.Hits); len(hits) > 0 {
			turnID := in.CorrelationID
			if turnID == "" {
				turnID = in.ConversationID
			}
			turnID += ":supervisor"
			s.Deps.Memory.LogCitationsForRAGFn(in.WorkspaceID, turnID, hits)
		}
		if res.Output != "" {
			opinions = append(opinions, "【共享知识检索】\n"+truncateRunes(res.Output, 800))
		}
	}

	// Build per-participant contexts up front (deterministic, cheap).
	// OwnerID is taken from the viewer once (if available) so we don't
	// retrieve memory with an empty owner ID and then re-retrieve with
	// the real one — the empty-OwnerID pass short-circuits the user-scope
	// filter and runs BM25+MMR over a strictly larger pool.
	ownerID := ""
	if in.Viewer != nil {
		ownerID = in.Viewer.ID
	}
	participants := make([]participantContext, 0, len(picks))
	for _, sp := range picks {
		emp := empByID[sp.ID]
		pc := s.Deps.MultiAgent.BuildParticipantContextFn(participantCtxInput{
			WorkspaceID:     in.WorkspaceID,
			ConversationID:  in.ConversationID,
			CorrelationID:   in.CorrelationID,
			OwnerID:         ownerID,
			UserMessage:     in.UserMessage,
			Channel:         in.Channel,
			EnabledTools:    enabledToolKeys(reg),
			Viewer:          in.Viewer,
			Request:         in.Request,
			Emit:            in.Emit,
			SessionModeHint: s.Deps.Routing.ResolveDefaultSessionModeFn(sp.ID),
			RiskLevelHint:   s.Deps.Routing.ResolveDefaultRiskLevelFn(sp.ID),
		}, emp)
		// Floor the participant's risk level by the inbound turn's risk so
		// a high-risk query is never silently floored to a P1-tier specialist
		// when the specialist's default risk is medium/low.
		if in.RiskLevel != "" && levelRank(riskLevelFloor(in.RiskLevel)) < levelRank(riskLevelFloor(pc.RiskLevel)) {
			pc.RiskLevel = in.RiskLevel
			pc.ModelID, _, _ = s.resolveModelByPolicyLevel(in.WorkspaceID, "", "P1", pc.RiskLevel)
		}
		// Emit pick intent before dispatch.
		in.Emit("agent", "multi", map[string]any{
			"status":        "delegating",
			"participantId": sp.ID,
			"name":          sp.Name,
			"role":          sp.Role,
			"department":    sp.Department,
			"modelId":       pc.ModelID,
			"sessionMode":   pc.SessionMode,
			"riskLevel":     pc.RiskLevel,
			"memoryHits":    len(pc.MemoryHits),
		})
		participants = append(participants, pc)
	}

	// Dispatch participants in parallel. errgroup cancels siblings if any
	// panics, and we propagate parent ctx so client disconnect cancels the
	// whole panel.
	results := s.dispatchParticipants(ctx, participants)

	// Drain per-participant memory budget reports (populated inside
	// buildParticipantContext → retrieveMemoryForTurnLocked) and surface a
	// single consolidated memory.budget event so operators see how each
	// specialist's memory slice was sized/truncated. Without this the
	// single-slot flush in copilotStream races with — and typically loses
	// to — the participant retrievals.
	if len(s.participantMemoryBudgetReports) > 0 {
		s.participantMemoryBudgetMu.Lock()
		reports := s.participantMemoryBudgetReports
		s.participantMemoryBudgetReports = nil
		s.participantMemoryBudgetMu.Unlock()
		ids := make([]string, 0, len(reports))
		for id := range reports {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			rep := reports[id]
			in.Emit("memory", "budget", map[string]any{
				"participantId": id,
				"budgetTokens":   rep.BudgetTokens,
				"usedTokens":     rep.UsedTokens,
				"kept":           rep.Kept,
				"dropped":        rep.Dropped,
				"truncatedItems": rep.TruncatedItems,
				"droppedIds":     rep.DroppedIDs,
			})
		}
	}

	opinions = append(opinions, mergeParticipantOpinions(results, 1200)...)

	// Tool calls: one entry per participant with real timing.
	for _, r := range results {
		// Per-participant inner tool calls (knowledge.retrieve / memory.recall)
		// get threaded through first so the audit trail shows the full panel
		// activity, not just the delegation summary.
		toolCalls = append(toolCalls, r.ToolCalls...)
		toolCalls = append(toolCalls, map[string]any{
			"id":         fmt.Sprintf("tc_agent_%s", r.ParticipantID),
			"name":       "agent.delegate",
			"args":       map[string]any{"partnerId": r.ParticipantID},
			"status":     r.Status,
			"result":     truncateRunes(r.Text, 400),
			"durationMs": r.DurationMs,
			"reason":     r.Reason,
		})
	}

	// Supervisor aggregate under primary employee persona.
	in.Emit("stage", "aggregate", map[string]any{"status": "running", "mode": modeMultiAgent})
	aggSystem := strings.TrimSpace(in.System)
	if aggSystem != "" {
		aggSystem += "\n\n"
	}
	aggSystem += "你是主会话专家（Supervisor）。请综合各子专家意见，给出统一、可执行的中文答复；标明共识与分歧；不要输出 TOOL/PLAN 标记。"
	aggMsgs := append([]modelprov.ChatMessage{}, in.Messages...)
	aggMsgs = append(aggMsgs, modelprov.ChatMessage{
		Role:    "user",
		Content: "用户请求：\n" + in.UserMessage + "\n\n子专家意见：\n" + strings.Join(opinions, "\n\n") + "\n\n请汇总最终答复。",
	})

	resolvedModel := in.ModelID
	var lastRT ResolvedTurn
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
		return reactTurnResult{Err: err2, ToolCalls: toolCalls, Steps: len(picks), ModelID: resolvedModel, Mode: modeMultiAgent}
	}
	if err2 == nil {
		lastRT = rt2
		resolvedModel = coalesce(rt2.ModelID, resolvedModel)
	}
	finalText := stripToolCallMarkers(coalesce(aggText, aggBuf.String()))
	if finalText == "" {
		finalText = "已完成多专家会商，汇总如下：\n" + strings.Join(opinions, "\n\n")
	}
	in.Emit("stage", "aggregate", map[string]any{"status": "ok"})
	in.Emit("agent", "multi", map[string]any{"status": "completed", "specialists": len(picks)})

	if !in.SkipStream {
		streamOpts := &streamAnswerOpts{
			ReplyMode: in.ReplyMode, SegmentPolicy: in.SegmentPolicy, CorrelationID: in.CorrelationID,
			FirstMessageID: in.FirstMessageID, IDGen: defaultSegmentIDGen(s),
			PreSegments: stepSegmentsSlice(in.StepSegments),
		}
		segs := streamHarnessAnswer(in.Emit, finalText, resolvedModel, lastRT, modeMultiAgent, len(picks), streamOpts)
		return reactTurnResult{
			Text: finalText, Resolved: lastRT, ModelID: resolvedModel,
			ToolCalls: toolCalls, Steps: len(picks), Mode: modeMultiAgent,
			Agents: specialistMaps(picks), Segments: segs, ReplyMode: in.ReplyMode,
		}
	}

	return reactTurnResult{
		Text: finalText, Resolved: lastRT, ModelID: resolvedModel,
		ToolCalls: toolCalls, Steps: len(picks), Mode: modeMultiAgent,
		Agents: specialistMaps(picks),
	}
}

// specialistMaps 把 specialistRef 切片投影成 []map[string]any，
// 用于 SSE emit 和 runMultiAgentTurn 返回结果中的 agents 字段。
func specialistMaps(picks []specialistRef) []map[string]any {
	out := make([]map[string]any, 0, len(picks))
	for _, sp := range picks {
		out = append(out, map[string]any{
			"id": sp.ID, "name": sp.Name, "role": sp.Role, "department": sp.Department, "score": sp.Score,
		})
	}
	return out
}

// dispatchParticipants 通过 agentos.Engine 并行执行每个 participant 的回合，
// 30s 单任务超时、panic 隔离、跟随父 ctx 取消。返回顺序与输入 pcs 保持一致。
func (s *Service) dispatchParticipants(ctx context.Context, pcs []participantContext) []participantTurnResult {
	tasks := make([]agentos.Task, len(pcs))
	for i := range pcs {
		i := i
		tasks[i] = agentos.Task{
			ID: pcs[i].DigitalPartner,
			Fn: func(tctx context.Context) agentos.Result {
				r := s.Deps.MultiAgent.RunParticipantTurnFn(tctx, pcs[i])
				return agentos.Result{
					Status:        r.Status,
					Text:          r.Text,
					Reason:        r.Reason,
					HardNoRefusal: r.HardNoRefusal,
				}
			},
		}
	}
	eng := s.SubAgent
	if eng == nil {
		eng = &agentos.Engine{}
	}
	raw := eng.Run(ctx, tasks)
	results := make([]participantTurnResult, len(raw))
	for i, r := range raw {
		results[i] = participantTurnResult{
			ParticipantID: r.ID,
			Text:          r.Text,
			Status:        r.Status,
			Reason:        r.Reason,
			DurationMs:    int(r.Duration / time.Millisecond),
			HardNoRefusal: r.HardNoRefusal,
		}
	}
	// If any participant panicked, surface the event on its Emit channel
	// so SSE consumers see the same shape as before.
	for i, r := range results {
		if r.Status == "failed" && r.Reason != "" && len(r.Reason) >= 16 && r.Reason[:16] == "panic_recovered" {
			if pcs[i].Emit != nil {
				pcs[i].Emit("agent", "multi", map[string]any{
					"status":        "failed",
					"participantId": pcs[i].DigitalPartner,
					"reason":        r.Reason,
				})
			}
		}
	}
	return results
}
