package server

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

type routeDecision struct {
	Mode        string
	Reason      string
	PolicyLevel string // P0 | P1 | P2 | P3 — maps to published routing_policies.level
}

// classifyCopilotMode picks harness graph + suggested routing policy level.
// modeHint: auto|react|plan_exec|direct|multi_agent
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

// resolveModelByPolicyLevel returns primaryModelId from a published routing policy at level.
// Explicit non-demo requested model always wins.
//
// riskLevel: low|medium|high (defaults to "medium"). When set, the requested
// level is floored to the minimum level appropriate for the risk:
//   - high   → must run at P0 (most capable) unless user explicitly asked for a model
//   - medium → floor P1
//   - low    → floor P2 (cheapest acceptable tier)
//
// This guarantees that a high-risk prompt cannot be silently downgraded to a
// lightweight model even if no exact-level policy exists. See copilot_route_test.go.
func (s *Server) resolveModelByPolicyLevel(ws, requested, level, riskLevel string) (modelID, policyID, usedLevel string) {
	requested = strings.TrimSpace(requested)
	if requested != "" && !isDemoModelAlias(requested) {
		return requested, "", ""
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
		pol := s.publishedPolicyByLevelLocked(ws, lv)
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
