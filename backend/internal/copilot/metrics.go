// Package-private metric counters used by the M02 copilot module. Mirror
// the legacy helpers in internal/server/metrics.go (copilotRateLimited,
// IncCopilotCognitive, etc.). Kept here as independent atomics so the
// copilot package never imports server/; server/ continues to publish its
// own duplicates to /api/metrics so dashboards keep their numbers.
package copilot

import "sync/atomic"

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