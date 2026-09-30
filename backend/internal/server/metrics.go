package server

import (
	"fmt"
	"log"
	"net/http"
	"runtime"
	"runtime/debug"
	"sync/atomic"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/metrics"
)

var processStart = time.Now()
var httpRequestsTotal atomic.Uint64
var httpRequestDurationMS atomic.Uint64
var copilotStreamTotal atomic.Uint64
var copilotStreamErrors atomic.Uint64
var copilotRateLimited atomic.Uint64
var copilotSafetyBlocked atomic.Uint64
var copilotCognitiveApplied atomic.Uint64
var copilotCognitiveBypass atomic.Uint64
var copilotCognitiveLogic atomic.Uint64
var copilotCognitiveProblem atomic.Uint64
var copilotCognitiveCreative atomic.Uint64
var copilotTurnUnderstand atomic.Uint64
var copilotTurnPlan atomic.Uint64
var copilotTurnExecute atomic.Uint64
var copilotTurnReflect atomic.Uint64
var copilotTurnTaskTotal atomic.Uint64
var officeSkillScriptRequiredTotal atomic.Uint64
var officeSkillPackageMissingTotal atomic.Uint64
var officeSkillPreflightFailedTotal atomic.Uint64
var auditWriteFailures atomic.Uint64
var policyDeniesTotal atomic.Uint64
var modelProbeTotal atomic.Uint64
var modelProbeErrors atomic.Uint64
var modelProbeLatencyMS atomic.Uint64
var modelVaultErrors atomic.Uint64
var modelPolicyPublishTotal atomic.Uint64
var modelBudgetDenies atomic.Uint64
var taskCreatedTotal atomic.Uint64
var taskTransitionTotal atomic.Uint64
var taskApproveTotal atomic.Uint64
var taskApproveRejectTotal atomic.Uint64
var taskTakeoverTotal atomic.Uint64
var taskRetryTotal atomic.Uint64
var taskPersistFailTotal atomic.Uint64
var taskVersionConflictTotal atomic.Uint64

func IncTaskCreated()    { taskCreatedTotal.Add(1) }
func IncTaskTransition() { taskTransitionTotal.Add(1) }
func IncTaskApprove(approved bool) {
	if approved {
		taskApproveTotal.Add(1)
	} else {
		taskApproveRejectTotal.Add(1)
	}
}
func IncTaskTakeover()        { taskTakeoverTotal.Add(1) }
func IncTaskRetry()           { taskRetryTotal.Add(1) }
func IncTaskPersistFail()     { taskPersistFailTotal.Add(1) }
func IncTaskVersionConflict() { taskVersionConflictTotal.Add(1) }

// IncModelProbe records a provider connectivity probe.
func IncModelProbe(ok bool, latencyMS int64) {
	modelProbeTotal.Add(1)
	if latencyMS > 0 {
		modelProbeLatencyMS.Add(uint64(latencyMS))
	}
	if !ok {
		modelProbeErrors.Add(1)
	}
}

func IncModelVaultError()    { modelVaultErrors.Add(1) }
func IncModelPolicyPublish() { modelPolicyPublishTotal.Add(1) }
func IncModelBudgetDeny()    { modelBudgetDenies.Add(1) }

// IncCopilotStream records a completed Copilot SSE turn.
func IncCopilotStream(ok bool) {
	copilotStreamTotal.Add(1)
	if !ok {
		copilotStreamErrors.Add(1)
	}
}

func IncCopilotRateLimited()   { copilotRateLimited.Add(1) }
func IncCopilotSafetyBlocked() { copilotSafetyBlocked.Add(1) }

// IncCopilotCognitive records cognitive framework routing outcomes.
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

// IncTurnPhaseStep records a narrative phase thought step.
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

func IncTurnTaskEvent() { copilotTurnTaskTotal.Add(1) }

func IncOfficeSkillScriptRequired() { officeSkillScriptRequiredTotal.Add(1) }
func IncOfficeSkillPackageMissing() { officeSkillPackageMissingTotal.Add(1) }
func IncOfficeSkillPreflightFailed() { officeSkillPreflightFailedTotal.Add(1) }

// countPendingAuthorizationsLocked returns Actions still awaiting human approval.
// Caller must hold Store.RLock or Lock.
func (s *Server) countPendingAuthorizationsLocked() int {
	n := 0
	for _, a := range s.Store.Actions {
		if a == nil {
			continue
		}
		st := str(a["status"])
		if st == "pending" {
			n++
			continue
		}
		if ar, _ := a["authorizationRequest"].(map[string]any); ar != nil && str(ar["status"]) == "pending" {
			n++
		}
	}
	return n
}

// IncAuditWriteFailure increments durable audit fanout failures.
func IncAuditWriteFailure() { auditWriteFailures.Add(1) }

// IncPolicyDeny increments policy engine deny decisions on write paths.
func IncPolicyDeny() { policyDeniesTotal.Add(1) }

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

// Flush preserves SSE / streaming when the underlying writer supports it.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *Server) withHTTPMetrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, code: 200}
		next.ServeHTTP(rec, r)
		httpRequestsTotal.Add(1)
		httpRequestDurationMS.Add(uint64(time.Since(start).Milliseconds()))
		_ = rec.code
	})
}

// withRecover catches any panic from downstream handlers and converts
// it into a 500 response + audit row + counter. Wraps the entire
// middleware chain so a panic in any handler (including auth, metrics,
// business logic) does not hang the connection.
//
// Local recover() in handlers (e.g. webhook parsers) runs first and
// suppresses the panic before this layer sees it. This is the intended
// layering: local for "graceful degradation" of optional side-effects,
// global for "the request itself must respond 500".
func (s *Server) withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			stack := debug.Stack()
			log.Printf("handler panic: method=%s path=%s panic=%v\n%s", r.Method, r.URL.Path, rec, stack)
			metrics.Global.HandlerPanics.Inc()
			if s.Store != nil {
				ws, actor := "", ""
				if id := identityFrom(r.Context()); id != nil {
					ws = id.WorkspaceID
					actor = id.Name
				}
				if ws == "" {
					ws = "w1"
				}
				s.Store.AppendAudit(ws, actor, "handler panic", r.URL.Path, "failed", fmt.Sprintf("%v", rec))
			}
			if w.Header().Get("Content-Type") == "" {
				http.Error(w, `{"code":"INTERNAL","message":"内部错误"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// metricsPrometheus exposes Prometheus text exposition (scraped by compose profile obs).
func (s *Server) metricsPrometheus(w http.ResponseWriter, r *http.Request) {
	s.Store.RLock()
	audits := len(s.Store.Audits)
	usage := len(s.Store.UsageMeters)
	dlq := len(s.Store.ChannelDLQ)
	tasks := len(s.Store.Tasks)
	pendingAuth := s.countPendingAuthorizationsLocked()
	s.Store.RUnlock()

	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	svc := s.Mode.String()
	if s.Mode == "" {
		svc = ModeAll.String()
	}
	_, _ = fmt.Fprintf(w, "# HELP qzda_core_up process up (legacy name; see qzda_service)\n# TYPE qzda_core_up gauge\nqzda_core_up{service=%q} 1\n", svc)
	_, _ = fmt.Fprintf(w, "# HELP qzda_service service identity\n# TYPE qzda_service gauge\nqzda_service{service=%q,mode=%q} 1\n", svc, string(s.Mode))
	_, _ = fmt.Fprintf(w, "# HELP qzda_core_uptime_seconds process uptime\n# TYPE qzda_core_uptime_seconds gauge\nqzda_core_uptime_seconds{service=%q} %f\n", svc, time.Since(processStart).Seconds())
	_, _ = fmt.Fprintf(w, "# HELP qzda_http_requests_total HTTP requests served\n# TYPE qzda_http_requests_total counter\nqzda_http_requests_total{service=%q} %d\n", svc, httpRequestsTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_http_request_duration_ms_sum cumulative request duration ms\n# TYPE qzda_http_request_duration_ms_sum counter\nqzda_http_request_duration_ms_sum{service=%q} %d\n", svc, httpRequestDurationMS.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_audit_events_buffered in-memory audit buffer size\n# TYPE qzda_audit_events_buffered gauge\nqzda_audit_events_buffered{service=%q} %d\n", svc, audits)
	_, _ = fmt.Fprintf(w, "# HELP qzda_usage_meters_buffered usage meter buffer\n# TYPE qzda_usage_meters_buffered gauge\nqzda_usage_meters_buffered{service=%q} %d\n", svc, usage)
	_, _ = fmt.Fprintf(w, "# HELP qzda_channel_dlq_size dead letter queue size\n# TYPE qzda_channel_dlq_size gauge\nqzda_channel_dlq_size{service=%q} %d\n", svc, dlq)
	_, _ = fmt.Fprintf(w, "# HELP qzda_tasks_total tasks in store\n# TYPE qzda_tasks_total gauge\nqzda_tasks_total{service=%q} %d\n", svc, tasks)
	_, _ = fmt.Fprintf(w, "# HELP qzda_go_goroutines goroutine count\n# TYPE qzda_go_goroutines gauge\nqzda_go_goroutines{service=%q} %d\n", svc, runtime.NumGoroutine())
	_, _ = fmt.Fprintf(w, "# HELP qzda_go_mem_alloc_bytes allocated heap\n# TYPE qzda_go_mem_alloc_bytes gauge\nqzda_go_mem_alloc_bytes{service=%q} %d\n", svc, ms.Alloc)
	pg, rd := 0, 0
	if s.PG != nil {
		pg = 1
	}
	if s.Cache != nil && s.Cache.Available() {
		rd = 1
	}
	_, _ = fmt.Fprintf(w, "# HELP qzda_postgres_configured postgres pool configured\n# TYPE qzda_postgres_configured gauge\nqzda_postgres_configured{service=%q} %d\n", svc, pg)
	_, _ = fmt.Fprintf(w, "# HELP qzda_redis_configured redis client configured\n# TYPE qzda_redis_configured gauge\nqzda_redis_configured{service=%q} %d\n", svc, rd)
	if s.Workflows != nil && s.Workflows.TemporalConfigured() {
		_, _ = fmt.Fprintf(w, "# HELP qzda_temporal_configured temporal host configured\n# TYPE qzda_temporal_configured gauge\nqzda_temporal_configured{service=%q} 1\n", svc)
	} else {
		_, _ = fmt.Fprintf(w, "# HELP qzda_temporal_configured temporal host configured\n# TYPE qzda_temporal_configured gauge\nqzda_temporal_configured{service=%q} 0\n", svc)
	}
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_stream_total Copilot SSE turns\n# TYPE qzda_copilot_stream_total counter\nqzda_copilot_stream_total{service=%q} %d\n", svc, copilotStreamTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_stream_errors_total Copilot SSE turns that ended in error\n# TYPE qzda_copilot_stream_errors_total counter\nqzda_copilot_stream_errors_total{service=%q} %d\n", svc, copilotStreamErrors.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_rate_limited_total Copilot rate limit hits\n# TYPE qzda_copilot_rate_limited_total counter\nqzda_copilot_rate_limited_total{service=%q} %d\n", svc, copilotRateLimited.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_safety_blocked_total Copilot content-safety blocks\n# TYPE qzda_copilot_safety_blocked_total counter\nqzda_copilot_safety_blocked_total{service=%q} %d\n", svc, copilotSafetyBlocked.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_cognitive_applied_total Copilot turns with cognitive framework applied\n# TYPE qzda_copilot_cognitive_applied_total counter\nqzda_copilot_cognitive_applied_total{service=%q} %d\n", svc, copilotCognitiveApplied.Load())

	// W1-W7 cross-cutting metrics. Sourced from internal/metrics.Global.
	allow, warn, deny := metrics.Global.Vetter.Snapshot()
	_, _ = fmt.Fprintf(w, "# HELP qzda_skill_vetter_total Skill vetter outcomes\n# TYPE qzda_skill_vetter_total counter\n")
	_, _ = fmt.Fprintf(w, "qzda_skill_vetter_total{service=%q,verdict=\"allow\"} %d\n", svc, allow)
	_, _ = fmt.Fprintf(w, "qzda_skill_vetter_total{service=%q,verdict=\"warn\"} %d\n", svc, warn)
	_, _ = fmt.Fprintf(w, "qzda_skill_vetter_total{service=%q,verdict=\"deny\"} %d\n", svc, deny)

	signOK, signInvalid, verifyOK, verifyMiss, verifyBad := metrics.Global.Sign.Snapshot()
	_, _ = fmt.Fprintf(w, "# HELP qzda_skill_sign_total Skill sign / verify outcomes\n# TYPE qzda_skill_sign_total counter\n")
	_, _ = fmt.Fprintf(w, "qzda_skill_sign_total{service=%q,op=\"sign\",result=\"success\"} %d\n", svc, signOK)
	_, _ = fmt.Fprintf(w, "qzda_skill_sign_total{service=%q,op=\"sign\",result=\"invalid\"} %d\n", svc, signInvalid)
	_, _ = fmt.Fprintf(w, "qzda_skill_sign_total{service=%q,op=\"verify\",result=\"ok\"} %d\n", svc, verifyOK)
	_, _ = fmt.Fprintf(w, "qzda_skill_sign_total{service=%q,op=\"verify\",result=\"unknown_key\"} %d\n", svc, verifyMiss)
	_, _ = fmt.Fprintf(w, "qzda_skill_sign_total{service=%q,op=\"verify\",result=\"bad_signature\"} %d\n", svc, verifyBad)

	skillN, skillSumNS, modelN, modelSumNS, otherN, otherSumNS := metrics.Global.Vault.Snapshot()
	_, _ = fmt.Fprintf(w, "# HELP qzda_vault_resolve_seconds_sum Vault Resolve cumulative seconds\n# TYPE qzda_vault_resolve_seconds_sum counter\n")
	_, _ = fmt.Fprintf(w, "qzda_vault_resolve_seconds_sum{service=%q,ref=\"skill-key\"} %f\n", svc, float64(skillSumNS)/1e9)
	_, _ = fmt.Fprintf(w, "qzda_vault_resolve_seconds_sum{service=%q,ref=\"model-credential\"} %f\n", svc, float64(modelSumNS)/1e9)
	_, _ = fmt.Fprintf(w, "qzda_vault_resolve_seconds_sum{service=%q,ref=\"other\"} %f\n", svc, float64(otherSumNS)/1e9)
	_, _ = fmt.Fprintf(w, "# HELP qzda_vault_resolve_total Vault Resolve call count\n# TYPE qzda_vault_resolve_total counter\n")
	_, _ = fmt.Fprintf(w, "qzda_vault_resolve_total{service=%q,ref=\"skill-key\"} %d\n", svc, skillN)
	_, _ = fmt.Fprintf(w, "qzda_vault_resolve_total{service=%q,ref=\"model-credential\"} %d\n", svc, modelN)
	_, _ = fmt.Fprintf(w, "qzda_vault_resolve_total{service=%q,ref=\"other\"} %d\n", svc, otherN)

	// Expert inbox pending is a stub gauge — the W3-D1 store field
	// hasn't been built yet. Publish 0 so dashboards don't 404 and
	// alerts based on absence won't fire false positives during the gap.
	_, _ = fmt.Fprintf(w, "# HELP qzda_expert_inbox_pending Expert inbox items awaiting review\n# TYPE qzda_expert_inbox_pending gauge\n")
	_, _ = fmt.Fprintf(w, "qzda_expert_inbox_pending{service=%q} %d\n", svc, metrics.Global.ExpertInbox.Get())

	// W3-D2 HotReload: per-resource success/fail counters.
	resources, hotOK, hotFail := metrics.Global.HotReload.Snapshot()
	if len(resources) > 0 {
		_, _ = fmt.Fprintf(w, "# HELP qzda_hotreload_reload_total HotReload attempts by resource and result\n# TYPE qzda_hotreload_reload_total counter\n")
		for _, r := range resources {
			_, _ = fmt.Fprintf(w, "qzda_hotreload_reload_total{service=%q,resource=%q,result=\"success\"} %d\n", svc, r, hotOK[r])
			_, _ = fmt.Fprintf(w, "qzda_hotreload_reload_total{service=%q,resource=%q,result=\"fail\"} %d\n", svc, r, hotFail[r])
		}
	}

	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_cognitive_bypass_total Copilot cognitive framework bypasses\n# TYPE qzda_copilot_cognitive_bypass_total counter\nqzda_copilot_cognitive_bypass_total{service=%q} %d\n", svc, copilotCognitiveBypass.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_cognitive_framework_total Copilot cognitive primary framework selections\n# TYPE qzda_copilot_cognitive_framework_total counter\nqzda_copilot_cognitive_framework_total{service=%q,framework=%q} %d\n", svc, "logic", copilotCognitiveLogic.Load())
	_, _ = fmt.Fprintf(w, "qzda_copilot_cognitive_framework_total{service=%q,framework=%q} %d\n", svc, "problem", copilotCognitiveProblem.Load())
	_, _ = fmt.Fprintf(w, "qzda_copilot_cognitive_framework_total{service=%q,framework=%q} %d\n", svc, "creative", copilotCognitiveCreative.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_turn_phase_steps_total Copilot turn narrative phase steps\n# TYPE qzda_copilot_turn_phase_steps_total counter\nqzda_copilot_turn_phase_steps_total{service=%q,phase=%q} %d\n", svc, "understand", copilotTurnUnderstand.Load())
	_, _ = fmt.Fprintf(w, "qzda_copilot_turn_phase_steps_total{service=%q,phase=%q} %d\n", svc, "plan", copilotTurnPlan.Load())
	_, _ = fmt.Fprintf(w, "qzda_copilot_turn_phase_steps_total{service=%q,phase=%q} %d\n", svc, "execute", copilotTurnExecute.Load())
	_, _ = fmt.Fprintf(w, "qzda_copilot_turn_phase_steps_total{service=%q,phase=%q} %d\n", svc, "reflect", copilotTurnReflect.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_turn_task_events_total Copilot turn task SSE events\n# TYPE qzda_copilot_turn_task_events_total counter\nqzda_copilot_turn_task_events_total{service=%q} %d\n", svc, copilotTurnTaskTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_office_skill_script_required_total Office skill runs rejected without scripts/ command\n# TYPE qzda_office_skill_script_required_total counter\nqzda_office_skill_script_required_total{service=%q} %d\n", svc, officeSkillScriptRequiredTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_office_skill_package_missing_total Office skill run blocked: no packagePath\n# TYPE qzda_office_skill_package_missing_total counter\nqzda_office_skill_package_missing_total{service=%q} %d\n", svc, officeSkillPackageMissingTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_office_skill_preflight_failed_total Office skill run blocked: missing deps\n# TYPE qzda_office_skill_preflight_failed_total counter\nqzda_office_skill_preflight_failed_total{service=%q} %d\n", svc, officeSkillPreflightFailedTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_copilot_authorizations_pending Copilot single-approver requests awaiting decision\n# TYPE qzda_copilot_authorizations_pending gauge\nqzda_copilot_authorizations_pending{service=%q} %d\n", svc, pendingAuth)
	_, _ = fmt.Fprintf(w, "# HELP qzda_audit_write_failures_total durable audit fanout failures\n# TYPE qzda_audit_write_failures_total counter\nqzda_audit_write_failures_total{service=%q} %d\n", svc, auditWriteFailures.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_policy_denies_total policy deny on write paths\n# TYPE qzda_policy_denies_total counter\nqzda_policy_denies_total{service=%q} %d\n", svc, policyDeniesTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_model_provider_probe_total model provider probes\n# TYPE qzda_model_provider_probe_total counter\nqzda_model_provider_probe_total{service=%q} %d\n", svc, modelProbeTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_model_provider_probe_errors_total failed model provider probes\n# TYPE qzda_model_provider_probe_errors_total counter\nqzda_model_provider_probe_errors_total{service=%q} %d\n", svc, modelProbeErrors.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_model_provider_probe_latency_ms_sum cumulative probe latency ms\n# TYPE qzda_model_provider_probe_latency_ms_sum counter\nqzda_model_provider_probe_latency_ms_sum{service=%q} %d\n", svc, modelProbeLatencyMS.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_model_vault_errors_total vault errors on model credential paths\n# TYPE qzda_model_vault_errors_total counter\nqzda_model_vault_errors_total{service=%q} %d\n", svc, modelVaultErrors.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_model_policy_publish_total routing policy publishes\n# TYPE qzda_model_policy_publish_total counter\nqzda_model_policy_publish_total{service=%q} %d\n", svc, modelPolicyPublishTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_model_budget_denies_total model budget hard denies\n# TYPE qzda_model_budget_denies_total counter\nqzda_model_budget_denies_total{service=%q} %d\n", svc, modelBudgetDenies.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_task_created_total tasks created\n# TYPE qzda_task_created_total counter\nqzda_task_created_total{service=%q} %d\n", svc, taskCreatedTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_task_transition_total task lifecycle transitions\n# TYPE qzda_task_transition_total counter\nqzda_task_transition_total{service=%q} %d\n", svc, taskTransitionTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_task_approve_total task approvals\n# TYPE qzda_task_approve_total counter\nqzda_task_approve_total{service=%q} %d\n", svc, taskApproveTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_task_approve_reject_total task approval rejects\n# TYPE qzda_task_approve_reject_total counter\nqzda_task_approve_reject_total{service=%q} %d\n", svc, taskApproveRejectTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_task_takeover_total task takeovers\n# TYPE qzda_task_takeover_total counter\nqzda_task_takeover_total{service=%q} %d\n", svc, taskTakeoverTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_task_retry_total task retries\n# TYPE qzda_task_retry_total counter\nqzda_task_retry_total{service=%q} %d\n", svc, taskRetryTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_task_version_conflict_total optimistic lock conflicts\n# TYPE qzda_task_version_conflict_total counter\nqzda_task_version_conflict_total{service=%q} %d\n", svc, taskVersionConflictTotal.Load())
	_, _ = fmt.Fprintf(w, "# HELP qzda_task_persist_fail_total task persist failures\n# TYPE qzda_task_persist_fail_total counter\nqzda_task_persist_fail_total{service=%q} %d\n", svc, taskPersistFailTotal.Load())

	// W4-D1 · Heartbeat / presence
	var hbLagSeconds float64
	var hbOnline map[string]int
	if s.Heartbeat != nil {
		hbLagSeconds = s.Heartbeat.LagSinceLastTouch().Seconds()
		hbOnline = s.Heartbeat.Snapshot()
	}
	_, _ = fmt.Fprintf(w, "# HELP qzda_heartbeat_lag_seconds seconds since most recent authed request\n# TYPE qzda_heartbeat_lag_seconds gauge\nqzda_heartbeat_lag_seconds{service=%q} %f\n", svc, hbLagSeconds)
	_, _ = fmt.Fprintf(w, "# HELP qzda_canvas_clients_online online identities per workspace\n# TYPE qzda_canvas_clients_online gauge\n")
	for ws, n := range hbOnline {
		_, _ = fmt.Fprintf(w, "qzda_canvas_clients_online{service=%q,workspace=%q} %d\n", svc, ws, n)
	}

	// W5-D1 · SelfImproving SOP verdicts
	siCreated, siMerged, siRejected := metrics.Global.SelfImproving.Snapshot()
	_, _ = fmt.Fprintf(w, "# HELP qzda_selfimproving_sop_total SelfImproving SOP generations by verdict\n# TYPE qzda_selfimproving_sop_total counter\n")
	_, _ = fmt.Fprintf(w, "qzda_selfimproving_sop_total{service=%q,verdict=\"created\"} %d\n", svc, siCreated)
	_, _ = fmt.Fprintf(w, "qzda_selfimproving_sop_total{service=%q,verdict=\"merged\"} %d\n", svc, siMerged)
	_, _ = fmt.Fprintf(w, "qzda_selfimproving_sop_total{service=%q,verdict=\"rejected\"} %d\n", svc, siRejected)

	// W6-D1 · PM SOP plan actions
	psCreated, psStarted, psComplete, psBlock, psUnblock, psNote := metrics.Global.PMSop.Snapshot()
	_, _ = fmt.Fprintf(w, "# HELP qzda_pmsop_plan_total PM SOP plan creations and event applications\n# TYPE qzda_pmsop_plan_total counter\n")
	_, _ = fmt.Fprintf(w, "qzda_pmsop_plan_total{service=%q,action=\"created\"} %d\n", svc, psCreated)
	_, _ = fmt.Fprintf(w, "qzda_pmsop_plan_total{service=%q,action=\"task.start\"} %d\n", svc, psStarted)
	_, _ = fmt.Fprintf(w, "qzda_pmsop_plan_total{service=%q,action=\"task.complete\"} %d\n", svc, psComplete)
	_, _ = fmt.Fprintf(w, "qzda_pmsop_plan_total{service=%q,action=\"task.block\"} %d\n", svc, psBlock)
	_, _ = fmt.Fprintf(w, "qzda_pmsop_plan_total{service=%q,action=\"task.unblock\"} %d\n", svc, psUnblock)
	_, _ = fmt.Fprintf(w, "qzda_pmsop_plan_total{service=%q,action=\"task.note\"} %d\n", svc, psNote)

	// W2-D3 · SubAgent dispatch primitive.
	saCount, saSumNS, saSuccess, saRefused, saTimedOut, saFailed := metrics.Global.SubAgent.Snapshot()
	avgSec := 0.0
	if saCount > 0 {
		avgSec = float64(saSumNS) / float64(saCount) / 1e9
	}
	_, _ = fmt.Fprintf(w, "# HELP qzda_subagent_run_seconds total wall-clock seconds across subagent task runs\n# TYPE qzda_subagent_run_seconds counter\n")
	_, _ = fmt.Fprintf(w, "qzda_subagent_run_seconds_sum{service=%q} %f\n", svc, float64(saSumNS)/1e9)
	_, _ = fmt.Fprintf(w, "qzda_subagent_run_seconds_count{service=%q} %d\n", svc, saCount)
	_, _ = fmt.Fprintf(w, "# HELP qzda_subagent_run_avg_seconds average subagent run seconds (derived: sum/count)\n# TYPE qzda_subagent_run_avg_seconds gauge\n")
	_, _ = fmt.Fprintf(w, "qzda_subagent_run_avg_seconds{service=%q} %f\n", svc, avgSec)
	_, _ = fmt.Fprintf(w, "# HELP qzda_subagent_run_total subagent runs by outcome\n# TYPE qzda_subagent_run_total counter\n")
	_, _ = fmt.Fprintf(w, "qzda_subagent_run_total{service=%q,status=\"success\"} %d\n", svc, saSuccess)
	_, _ = fmt.Fprintf(w, "qzda_subagent_run_total{service=%q,status=\"refused\"} %d\n", svc, saRefused)
	_, _ = fmt.Fprintf(w, "qzda_subagent_run_total{service=%q,status=\"timed_out\"} %d\n", svc, saTimedOut)
	_, _ = fmt.Fprintf(w, "qzda_subagent_run_total{service=%q,status=\"failed\"} %d\n", svc, saFailed)

	// P1-2 · Outer-middleware panic counter. Per-request context (path,
	// method, stack) is logged separately; metric stays label-free to
	// bound Prometheus cardinality.
	_, _ = fmt.Fprintf(w, "# HELP qzda_http_handler_panics_total panics caught by the outer withRecover middleware\n# TYPE qzda_http_handler_panics_total counter\n")
	_, _ = fmt.Fprintf(w, "qzda_http_handler_panics_total{service=%q} %d\n", svc, metrics.Global.HandlerPanics.Value())
}
