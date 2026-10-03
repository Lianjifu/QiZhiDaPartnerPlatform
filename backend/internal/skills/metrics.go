package skills

import (
	"strings"
	"sync/atomic"
)

// Office-skill metrics (counters). Mirrors the legacy server-side
// metrics.go counters (officeSkillScriptRequiredTotal) so we don't
// import prometheus/client_golang from the M09 package.

// officeSkillScriptRequiredTotal counts the number of times a
// Copilot session asked an office skill (docx/pptx/pdf/xlsx) to
// run without supplying a `command` arg that matches scripts/* or
// .copilot-ws/*. Observable via /api/healthz → metrics payload
// (server health handler reads it back).
var officeSkillScriptRequiredTotal atomic.Int64

// IncOfficeSkillScriptRequired is the M09-mirrored counter increment.
// Exported because the harness.go call site uses it; matches the
// signature server.IncOfficeSkillScriptRequired.
func IncOfficeSkillScriptRequired() {
	officeSkillScriptRequiredTotal.Add(1)
}

var (
	officeSkillPackageMissingTotal    atomic.Int64
	officeSkillPreflightFailedTotal   atomic.Int64
)

// IncOfficeSkillPackageMissing counts turn_office.go preflight hits where
// the requested office skill is missing required package files (scripts,
// spec). Mirrors server-side counter.
func IncOfficeSkillPackageMissing() {
	officeSkillPackageMissingTotal.Add(1)
}

// IncOfficeSkillPreflightFailed counts turn_office.go preflight hits where
// the preflight gate (officeSkillRunPreflight) returned a Deny verdict.
func IncOfficeSkillPreflightFailed() {
	officeSkillPreflightFailedTotal.Add(1)
}

// recordEmployeeRuntime increments a digital employee's runtime
// counters. Mirrors the legacy server.recordEmployeeRuntime — duplicated
// here so the skills package can fire-and-forget a runtime tick without
// bouncing through the parent server.
//
// The full employee mutation surface (recordedCalls24h / p95Ms /
// costToday / …) lives in the partners module; this M09-side stub
// only updates the rolling-window counters needed by the skill harness
// dashboards so the M09 package stays free of partners-package imports.
func (s *Service) recordEmployeeRuntime(deID string, durationMs int, ok bool) {
	if s == nil || s.Store == nil {
		return
	}
	deID = strings.TrimSpace(deID)
	if deID == "" {
		return
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, emp := range s.Store.Employees {
		if str(emp["id"]) != deID {
			continue
		}
		rt, _ := emp["runtime"].(map[string]any)
		if rt == nil {
			rt = map[string]any{}
		}
		calls := intFrom(rt["recordedCalls24h"]) + 1
		succ := intFrom(rt["successCount24h"])
		if ok {
			succ++
		}
		rt["recordedCalls24h"] = calls
		rt["successCount24h"] = succ
		rt["calls24h"] = calls
		if calls > 0 {
			rt["successRate"] = round2(float64(succ) / float64(calls))
		}
		if durationMs > intFrom(rt["p95Ms"]) {
			rt["p95Ms"] = durationMs
		}
		rt["costToday"] = round2(floatFrom(rt["costToday"]) + 0.02)
		emp["runtime"] = rt
		return
	}
}

