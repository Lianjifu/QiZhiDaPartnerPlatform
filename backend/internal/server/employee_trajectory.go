package server

import (
	"strings"
	"time"
)

// employeeTrajectoryWindow 是评估时回看的最近助手回合数上限。
const employeeTrajectoryWindow = 200

// computeEmployeeTrajectorySummaryLocked 汇总伙伴最近回合的"行为健康度"。
//
// 用途:把上岗评测从一次性假分数换成**真实轨迹评分** —— 伙伴最近干活
// 干得好不好(工具失败多不多、有没有反复挂起审批、有没有频繁越界),
// 用它自己的轨迹说话。
//
// Caller must hold Store.RLock 或 Lock.
func (s *Server) computeEmployeeTrajectorySummaryLocked(emp map[string]any) map[string]any {
	deID := str(emp["id"])
	ws := str(emp["workspaceId"])
	out := map[string]any{
		"status":      "unknown",
		"score":       0.0,
		"turns":       0,
		"toolCalls":   0,
		"failures":    0,
		"awaiting":    0,
		"escalations": 0,
		"violations":  []map[string]any{},
		"evaluatedAt": time.Now().UTC().Format(time.RFC3339),
	}
	if deID == "" {
		return out
	}

	turns := 0
	toolCalls := 0
	failures := 0
	awaiting := 0
	escalations := 0
	violations := []map[string]any{}

	for cid := range s.conversationIDsForEmployeeLocked(ws, deID) {
		msgs := s.Store.Messages[cid]
		for _, m := range msgs {
			if str(m["role"]) != "assistant" {
				continue
			}
			calls := knowledgeSliceMaps(m["toolCalls"])
			if len(calls) == 0 {
				continue
			}
			turns++
			if turns > employeeTrajectoryWindow {
				break
			}
			for _, tc := range calls {
				toolCalls++
				status := strings.ToLower(str(tc["status"]))
				permission := strings.ToLower(str(tc["permission"]))
				switch {
				case status != "" && status != "success" && status != "ok":
					failures++
					violations = append(violations, map[string]any{
						"kind": "tool_failure", "tool": str(tc["name"]),
						"conversationId": cid, "correlationId": str(m["correlationId"]),
						"detail": str(tc["error"]),
					})
				case permission == "approval_required" || status == "pending_authorization":
					awaiting++
					violations = append(violations, map[string]any{
						"kind": "awaiting_approval", "tool": str(tc["name"]),
						"conversationId": cid, "correlationId": str(m["correlationId"]),
					})
				case permission == "prohibited":
					escalations++
					violations = append(violations, map[string]any{
						"kind": "boundary_violation", "tool": str(tc["name"]),
						"conversationId": cid, "correlationId": str(m["correlationId"]),
					})
				}
			}
		}
	}

	score := 100.0
	score -= float64(failures) * 15
	score -= float64(awaiting) * 10
	score -= float64(escalations) * 20
	if turns > 3 {
		score -= float64(turns-3) * 1
	}
	if score < 0 {
		score = 0
	}
	if turns == 0 {
		// 没有任何真实轨迹 → 无法评估(不能给"通过")。
		out["status"] = "unknown"
		out["score"] = 0.0
		out["violations"] = violations
		out["turns"] = 0
		out["toolCalls"] = toolCalls
		return out
	}
	status := "passed"
	if score < employeeTrajectoryPassScore {
		status = "failed"
	}
	out["status"] = status
	out["score"] = round2(score)
	out["turns"] = turns
	out["toolCalls"] = toolCalls
	out["failures"] = failures
	out["awaiting"] = awaiting
	out["escalations"] = escalations
	out["violations"] = violations
	return out
}

// employeeTrajectoryPassScore 是轨迹评测的通过线。
const employeeTrajectoryPassScore = 85.0

// employeeTrajectoryEvaluationLocked 是 partners.Deps.EvaluateEmployeeTrajectory 的实现。
//
// 命名带 Locked:调用方(partners 的 digitalEmployeeRoute)已经持有 Store.Lock,
// 这里绝不能再加锁 —— Store 的 RWMutex 不可重入,重入即死锁。
func (s *Server) employeeTrajectoryEvaluationLocked(emp map[string]any) map[string]any {
	return s.computeEmployeeTrajectorySummaryLocked(emp)
}
