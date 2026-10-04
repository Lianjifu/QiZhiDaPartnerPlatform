// Package copilot —— 路由决策模块。
//
// 决定"这一轮用哪个 harness 图（direct/react/plan_exec/multi_agent）、
// 对应到哪个 routing policy 级别（P0~P3）"。
//
// 决策信号分三层：
//   - 客户端 hint（modeHint 字段直接指定）
//   - 消息特征（长度、关键词、跨部门意图）
//   - 风险等级（riskLevel 抬高 policy 下限）
//
// 输出 routeDecision 会被 runReactTurn / runMultiAgentTurn 等调度器消费，
// 后续 resolveModelByPolicyLevel 据此再选具体模型。
package copilot

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	modeDirect     = "direct"
	modeReact      = "react"
	modePlanExec   = "plan_exec"
	modeMultiAgent = "multi_agent"
)

// routeDecision 是一次路由决策的结果，由 classifyCopilotMode 产出。
//
// Mode 取值：direct / react / plan_exec / multi_agent。
// PolicyLevel：P0（最贵最严）~ P3（最便宜），与 published routing_policies.level 对齐。
type routeDecision struct {
	Mode        string
	Reason      string
	PolicyLevel string // P0 | P1 | P2 | P3 — maps to published routing_policies.level
}

// classifyCopilotMode 是路由决策的核心。
//
// 决策顺序（短路返回）：
//  1. 客户端 modeHint 显式指定 → 直接采用（client_hint）
//  2. 用户要求 reflect → react（reflect_requested）
//  3. 短句寒暄（你好/谢谢 等） → direct P3
//  4. 跨部门/多方协作意图 → multi_agent P0
//  5. 多步骤/清单/方案/对比等关键词 → plan_exec P0
//  6. 兜底 → react P1（默认走 ReAct 循环 + 中等模型）
func classifyCopilotMode(userMsg, modeHint, reflectHint string) routeDecision {
	hint := strings.ToLower(strings.TrimSpace(modeHint))
	switch hint {
	case modeDirect:
		return routeDecision{Mode: modeDirect, Reason: "client_hint", PolicyLevel: "P3"}
	case modeReact:
		return routeDecision{Mode: modeReact, Reason: "client_hint", PolicyLevel: "P1"}
	case modePlanExec:
		return routeDecision{Mode: modePlanExec, Reason: "client_hint", PolicyLevel: "P0"}
	case modeMultiAgent, "multi", "multi-agent":
		return routeDecision{Mode: modeMultiAgent, Reason: "client_hint", PolicyLevel: "P0"}
	}

	msg := strings.TrimSpace(userMsg)
	if reflectHint != "" {
		return routeDecision{Mode: modeReact, Reason: "reflect_requested", PolicyLevel: "P1"}
	}

	lower := strings.ToLower(msg)
	runeLen := utf8.RuneCountInString(msg)

	if runeLen <= 12 && containsAnyFold(msg, lower, "你好", "您好", "在吗", "嗨", "hello", "hi", "你是谁", "谢谢") {
		return routeDecision{Mode: modeDirect, Reason: "short_chitchat", PolicyLevel: "P3"}
	}

	// Cross-department / multi-role collaboration
	if looksLikeMultiAgent(msg, lower) {
		return routeDecision{Mode: modeMultiAgent, Reason: "cross_department", PolicyLevel: "P0"}
	}

	if containsAnyFold(msg, lower,
		"清单", "分步", "步骤", "计划", "方案", "流程", "checklist",
		"入职材料", "办理流程", "先…再", "然后", "并且还要",
		"排查", "分析并", "汇总", "对比", "制定", "规划",
		"一步步", "逐项", "详细列出", "给出计划",
	) || (runeLen >= 80 && containsAnyFold(msg, lower, "以及", "同时", "另外", "还需要")) {
		return routeDecision{Mode: modePlanExec, Reason: "complex_multi_step", PolicyLevel: "P0"}
	}

	return routeDecision{Mode: modeReact, Reason: "default_react", PolicyLevel: "P1"}
}

// multiAgentHandoffRe matches "转给...同时..." style handoff phrases — the
// only regex on the multi-agent hot path. Pre-compiled at package init.
var multiAgentHandoffRe = regexp.MustCompile(`转给.{1,12}同时`)

func looksLikeMultiAgent(msg, lower string) bool {
	if containsAnyFold(msg, lower,
		"跨部门", "联合", "会商", "多方", "协作会诊", "拉上", "一起看",
		"运维和", "和人事", "和财务", "和法务", "和客服", "和安全",
		"多专家", "多个数字伙伴",
	) {
		return true
	}
	if multiAgentHandoffRe.MatchString(msg) {
		return true
	}
	// Two distinct domain cues in one utterance
	domains := 0
	if containsAnyFold(msg, lower, "运维", "故障", "SRE", "缓存", "发布", "kubectl", "CMDB") {
		domains++
	}
	if containsAnyFold(msg, lower, "人事", "入职", "年假", "招聘", "薪资", "HR") {
		domains++
	}
	if containsAnyFold(msg, lower, "质检", "客服", "对客", "投诉", "QA") {
		domains++
	}
	if containsAnyFold(msg, lower, "财务", "报销", "预算", "发票") {
		domains++
	}
	if containsAnyFold(msg, lower, "法务", "合规", "合同", "审计") {
		domains++
	}
	return domains >= 2
}

func containsAnyFold(msg, lower string, needles ...string) bool {
	for _, n := range needles {
		if n == "" {
			continue
		}
		if strings.Contains(msg, n) || strings.Contains(lower, strings.ToLower(n)) {
			return true
		}
	}
	return false
}

// resolveModelByPolicyLevel 按 routing policy 级别查具体模型。
//
// 关键策略：
//   - 显式 requested 模型（非 demo alias）始终胜出，不受 risk floor 约束
//   - 按 riskLevel 设下限：高风险→P0，中风险→P1，低风险→P2
//     （保证高风险 prompt 不能被静默降到轻量模型）
//   - 在 [floor, requested] 区间内，按预设降级顺序找第一份已发布的 policy
//     （P0→P0/P1/P2/P3，P1→P1/P2/P3/P0...）保证至少有一个可用模型
//
// Demo model alias（DE_DEMO_MODEL_ALIASES 注册的那些）即使被显式指定，
// 也会被 IsDemoModelAliasFn 拦截、强制走 policy 查找——避免 demo 模型
// 被错用到生产回合。
func (s *Service) resolveModelByPolicyLevel(ws, requested, level, riskLevel string) (modelID, policyID, usedLevel string) {
	requested = strings.TrimSpace(requested)
	if requested != "" {
		// Deps.IsDemoModelAliasFn is wired in production by server.New via
		// buildCopSvc; nil in copilot-internal tests where the service is
		// constructed directly via New(st). Treat nil as "never demo alias"
		// so the explicit-request branch returns immediately and the
		// routing-level lookup below never runs.
		if s.Deps.IsDemoModelAliasFn == nil || !s.Deps.IsDemoModelAliasFn(requested) {
			return requested, "", ""
		}
	}
	level = strings.TrimSpace(level)
	if level == "" {
		level = "P1"
	}
	if floor := riskLevelFloor(strings.TrimSpace(riskLevel)); floor != "" {
		if levelRank(floor) < levelRank(level) {
			level = floor
		}
	}
	s.Store.RLock()
	defer s.Store.RUnlock()

	tryLevel := func(lv string) (string, string, bool) {
		// Deps.PublishedPolicyByLevelFn is wired in production by
		// server.New; nil in copilot-internal tests where no published
		// policy lookup is needed (tryLevel never matches and we fall
		// through to the final return).
		if s.Deps.PublishedPolicyByLevelFn == nil {
			return "", "", false
		}
		pol := s.Deps.PublishedPolicyByLevelFn(ws, lv)
		if pol == nil {
			return "", "", false
		}
		mid := strings.TrimSpace(str(pol["primaryModelId"]))
		if mid == "" {
			return "", "", false
		}
		return mid, str(pol["id"]), true
	}

	// Prefer exact level, then degrade toward lighter tiers for availability.
	order := []string{level}
	switch level {
	case "P0", "P0+":
		order = []string{level, "P0", "P1", "P2", "P3"}
	case "P1":
		order = []string{"P1", "P2", "P3", "P0"}
	case "P2":
		order = []string{"P2", "P3", "P1", "P0"}
	case "P3":
		order = []string{"P3", "P2", "P1", "P0"}
	}
	seen := map[string]struct{}{}
	for _, lv := range order {
		if _, ok := seen[lv]; ok {
			continue
		}
		seen[lv] = struct{}{}
		if mid, pid, ok := tryLevel(lv); ok {
			return mid, pid, lv
		}
	}
	return requested, "", level
}

// riskLevelFloor returns the lowest acceptable policy level for a risk.
// "" means no floor (caller's choice respected).
func riskLevelFloor(risk string) string {
	switch strings.ToLower(strings.TrimSpace(risk)) {
	case "high":
		return "P0"
	case "medium":
		return "P1"
	case "low":
		return "P2"
	}
	return ""
}

func levelRank(level string) int {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "P0", "P0+":
		return 0
	case "P1":
		return 1
	case "P2":
		return 2
	case "P3":
		return 3
	}
	return 4
}
