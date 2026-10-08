// copilot 包的进程级指标计数器（atomic.Uint64），对应 server/ 已有的同名指标。
// 保留独立副本的目的是让 copilot 包不反向依赖 internal/server/，
// 同时 server/ 仍向 /api/metrics 推送自己的版本（双写），dashboard 看到的数字保持一致。
package copilot

// metrics.go — 指标埋点:回合计数、工具成功率、延迟分位、用量与异常计数。
// 导出到 Prometheus / OpenMetrics;埋点粒度按需递增,不要直接在这里做业务判断。

import "sync/atomic"

// copilot 模块的进程内指标计数器（与 server/metrics.go 重复统计）。
var (
	copilotRateLimited          atomic.Uint64
	copilotCognitiveBypass      atomic.Uint64
	copilotCognitiveApplied     atomic.Uint64
	copilotCognitiveLogic       atomic.Uint64
	copilotCognitiveProblem     atomic.Uint64
	copilotCognitiveCreative    atomic.Uint64
	copilotStreamTotal           atomic.Uint64
	copilotStreamErrors         atomic.Uint64
	copilotSafetyBlocked        atomic.Uint64
	copilotTurnUnderstand       atomic.Uint64
	copilotTurnPlan             atomic.Uint64
	copilotTurnExecute          atomic.Uint64
	copilotTurnReflect          atomic.Uint64
	copilotTurnTaskTotal        atomic.Uint64
	copilotBudgetDenied        atomic.Uint64
)

// IncCopilotRateLimited records that a copilot turn was throttled by the
// per-(workspace,user) rate limiter.
func IncCopilotRateLimited() { copilotRateLimited.Add(1) }

// IncCopilotCognitive records cognitive framework routing outcomes —
// bypass vs applied vs the three primary framework labels.
func IncCopilotCognitive(d cognitiveDecision) {
	if d.Bypass || !d.Enabled {
		copilotCognitiveBypass.Add(1)
		return
	}
	copilotCognitiveApplied.Add(1)
	switch d.Primary {
	case cognitiveLogic:
		copilotCognitiveLogic.Add(1)
	case cognitiveProblem:
		copilotCognitiveProblem.Add(1)
	case cognitiveCreative:
		copilotCognitiveCreative.Add(1)
	}
}

// IncCopilotSafetyBlocked records safety gate refusals.
func IncCopilotSafetyBlocked() { copilotSafetyBlocked.Add(1) }

// IncCopilotStream / IncCopilotStreamError record SSE stream lifecycle.
func IncCopilotStream()           { copilotStreamTotal.Add(1) }
func IncCopilotStreamError()      { copilotStreamErrors.Add(1) }

// IncTurnPhaseStep records a narrative phase thought step. Mirrors
// server.IncTurnPhaseStep; the copilot stream emits one of these for every
// `thought` SSE event so dashboards can plot understand/plan/execute/reflect
// density per turn.
func IncTurnPhaseStep(phase string) {
	switch phase {
	case turnPhaseUnderstand:
		copilotTurnUnderstand.Add(1)
	case turnPhasePlan:
		copilotTurnPlan.Add(1)
	case turnPhaseExecute:
		copilotTurnExecute.Add(1)
	case turnPhaseReflect:
		copilotTurnReflect.Add(1)
	}
}

// IncTurnTaskEvent records a `task` SSE event from the copilot stream.
// Mirrors server.IncTurnTaskEvent.
func IncTurnTaskEvent() { copilotTurnTaskTotal.Add(1) }

// IncCopilotBudgetDenied records that a copilot turn was rejected by the
// model-budget gate (Dep.CheckModelBudgetFn 返回 allowed=false)。
// 用于 dashboard 监测按 workspace 的用量告警触发频次。
func IncCopilotBudgetDenied() { copilotBudgetDenied.Add(1) }