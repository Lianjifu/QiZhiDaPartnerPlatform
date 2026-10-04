package tasks

import (
	"fmt"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// Lifecycle stages aligned with ControlledTask / BuildControlledTask.
// Exported so *Server handlers in internal/server can reference them
// (handlers/handlers_contract.go etc.) without re-declaring constants.
const (
	StagePending     = "pending"
	StageRunning     = "running"
	StageHumanAction = "human_action"
	StageRisk        = "risk"
	StageCompleted   = "completed"
	StageArchived    = "archived"
)

// LifecycleEdges is the 6-stage FSM transition table. Edges mirror
// the legacy taskTransitions map from internal/server/task_fsm.go but
// expressed in the new stage vocabulary (Stage* constants above).
var LifecycleEdges = map[string][]string{
	StagePending:     {StageRunning, StageHumanAction, StageArchived},
	StageRunning:     {StageHumanAction, StageCompleted, StagePending, StageRisk},
	StageHumanAction: {StageRunning, StagePending, StageCompleted, StageRisk},
	StageRisk:        {StageRunning, StageHumanAction}, // retry / takeover only
	StageCompleted:   {StageArchived, StagePending},
	StageArchived:    {StagePending},
}

// NormalizeLifecycleStage folds legacy status names ("in_progress" /
// "review") into the stage vocabulary and trims whitespace. Unknown
// inputs default to StagePending (mirrors legacy normalizeLifecycleStage).
func NormalizeLifecycleStage(stage string) string {
	switch strings.TrimSpace(stage) {
	case StagePending, StageRunning, StageHumanAction, StageRisk, StageCompleted, StageArchived:
		return stage
	case "in_progress":
		return StageRunning
	case "review":
		return StageHumanAction
	default:
		return StagePending
	}
}

// StatusForLifecycle returns the legacy status string for a stage.
// Inverse of MapStatusToStage from internal/server/handlers_contract.go;
// used by ensureTaskShape / applyLifecycleTransition to keep the legacy
// status field populated for the frontend Mock contract.
func StatusForLifecycle(stage string) string {
	switch NormalizeLifecycleStage(stage) {
	case StageRunning:
		return "in_progress"
	case StageHumanAction, StageRisk:
		return "review"
	case StageCompleted:
		return "completed"
	case StageArchived:
		return "archived"
	default:
		return "pending"
	}
}

// AssertLifecycleTransition returns an error iff `from → to` is not a
// legal edge in LifecycleEdges (or vice versa). Mirrors the legacy
// assertLifecycleTransition from internal/server/task_domain.go.
func AssertLifecycleTransition(from, to string) error {
	from = NormalizeLifecycleStage(from)
	to = NormalizeLifecycleStage(to)
	if from == to {
		return nil
	}
	for _, a := range LifecycleEdges[from] {
		if a == to {
			return nil
		}
	}
	return apperr.BadReq(apperr.BadRequest, "非法任务阶段流转: "+from+" → "+to)
}

// TaskAuditEvents returns the audit-events slice of a task, ensuring
// the shape is normalised first. Mirrors the legacy taskAuditEvents.
func TaskAuditEvents(task map[string]any) []map[string]any {
	EnsureTaskShape(task)
	if evs, ok := task["auditEvents"].([]map[string]any); ok {
		return evs
	}
	return nil
}

// AppendTaskAuditLocked prepends a new audit event to the task's audit
// trail, increments the version, and updates updatedAt. The caller MUST
// hold s.Store.Lock() (legacy semantics preserved byte-for-byte).
func AppendTaskAuditLocked(task map[string]any, actor, action, detail, tone string) {
	EnsureTaskShape(task)
	at := time.Now().UTC().Format(time.RFC3339)
	ev := map[string]any{
		"id":     fmt.Sprintf("ta-%d", time.Now().UnixNano()),
		"at":     at,
		"actor":  coalesce(actor, "系统"),
		"action": action,
		"detail": detail,
		"tone":   coalesce(tone, "info"),
	}
	evs := TaskAuditEvents(task)
	task["auditEvents"] = append([]map[string]any{ev}, evs...)
	task["version"] = ToInt(task["version"]) + 1
	task["updatedAt"] = at
}

// BuildControlledTask assembles a fresh task row from the request body.
// Handles dispatchKind=assist/assign + source=conversation shortcuts that
// set approval / stage / currentStep correctly up front. The idGen
// parameter is s.Store.ID in production; tests pass a deterministic
// closure. Mirrors the legacy buildControlledTask.
func BuildControlledTask(idGen func(string) string, ws string, body map[string]any, actor *auth.Identity) map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	title := strings.TrimSpace(str(body["title"]))
	priority := coalesce(str(body["priority"]), "P2")
	source := coalesce(str(body["source"]), "manual")
	dispatchKind := str(body["dispatchKind"])
	stage := StagePending
	status := "pending"
	gov := map[string]any{"approvalRequired": false, "approvalStatus": "not_required"}
	exec := map[string]any{"retryCount": 0, "paused": false, "currentStep": "待开始"}
	assistStatus := str(body["assistStatus"])

	if dispatchKind == "assist" {
		source = "dispatch"
		gov["approvalRequired"] = true
		gov["approvalStatus"] = "pending"
		stage = StageHumanAction
		status = "review"
		exec["currentStep"] = "待跨部门协办确认"
		if assistStatus == "" {
			assistStatus = "pending"
		}
	} else if dispatchKind == "assign" {
		source = "dispatch"
		exec["currentStep"] = "本部门派工待执行"
		if assistStatus == "" {
			assistStatus = "not_required"
		}
	} else if source == "conversation" {
		exec["currentStep"] = "待专家确认"
	}

	if st := str(body["status"]); st != "" && dispatchKind == "" {
		status = st
		stage = MapStatusToStage(st)
	}
	if ls := str(body["lifecycleStage"]); ls != "" && dispatchKind == "" {
		stage = NormalizeLifecycleStage(ls)
		status = StatusForLifecycle(stage)
	}

	links := map[string]any{}
	if incoming, ok := body["links"].(map[string]any); ok {
		for k, v := range incoming {
			links[k] = v
		}
	}
	if cid := str(body["conversationId"]); cid != "" {
		links["conversationId"] = cid
	}

	slaRemaining := 120
	if body["slaRemainingMin"] != nil {
		slaRemaining = ToInt(body["slaRemainingMin"])
	}
	progress := map[string]any{"done": 0, "total": 1}
	if p, ok := body["progress"].(map[string]any); ok {
		progress = p
	}

	tags := []string{}
	if raw, ok := body["tags"].([]any); ok {
		for _, t := range raw {
			if s := str(t); s != "" {
				tags = append(tags, s)
			}
		}
	} else if raw, ok := body["tags"].([]string); ok {
		tags = raw
	}

	item := map[string]any{
		"id":                 idGen("task"),
		"workspaceId":        ws,
		"code":               coalesce(str(body["code"]), ""),
		"title":              title,
		"description":        str(body["description"]),
		"priority":           priority,
		"status":             status,
		"lifecycleStage":     stage,
		"ownerId":            actor.ID,
		"ownerName":          actor.Name,
		"createdBy":          actor.ID,
		"assignee":           coalesce(str(body["assignee"]), actor.Name),
		"digitalPartnerId":   body["digitalPartnerId"],
		"digitalPartnerName": body["digitalPartnerName"],
		"agentId":            body["agentId"],
		"source":             source,
		"dispatchKind":       nilIfEmpty(dispatchKind),
		"coordinatorId":      body["coordinatorId"],
		"coordinatorName":    body["coordinatorName"],
		"collaboratorIds":    body["collaboratorIds"],
		"collaboratorNames":  body["collaboratorNames"],
		"assistStatus":       nilIfEmpty(assistStatus),
		"progress":           progress,
		"tags":               tags,
		"sla":                map[string]any{"remainingMin": slaRemaining, "risk": "none", "escalated": false},
		"execution":          exec,
		"governance":         gov,
		"links":              links,
		"auditEvents":        []map[string]any{},
		"comments":           []map[string]any{},
		"version":            0,
		"environment":        coalesce(str(body["environment"]), "sandbox"),
		"classification":     coalesce(str(body["classification"]), "internal"),
		"createdAt":          now,
		"updatedAt":          now,
	}
	if item["code"] == "" {
		item["code"] = "TSK-PENDING"
	}
	return item
}

// ApplyLifecycleTransition validates the FSM edge, enforces the
// approval gate + risk-only-retry rule, and updates lifecycleStage +
// status. Appends an audit event on success. Returns apperr on invalid
// transitions / unmet approval. Caller MUST hold s.Store.Lock().
func ApplyLifecycleTransition(task map[string]any, target string, actor *auth.Identity) error {
	EnsureTaskShape(task)
	stage := NormalizeLifecycleStage(target)
	from := NormalizeLifecycleStage(str(task["lifecycleStage"]))

	gov, _ := task["governance"].(map[string]any)
	if gov == nil {
		gov = map[string]any{}
		task["governance"] = gov
	}
	if boolFrom(gov["approvalRequired"]) && (stage == StageRunning || stage == StageCompleted) {
		ap := str(gov["approvalStatus"])
		if ap == "rejected" {
			return apperr.BadReq(apperr.TaskApproval, "任务审批已拒绝")
		}
		if ap != "approved" {
			return apperr.BadReq(apperr.TaskApproval, "任务等待人工审批")
		}
	}
	sla, _ := task["sla"].(map[string]any)
	risk := "none"
	if sla != nil {
		risk = coalesce(str(sla["risk"]), "none")
	}
	if from == StageRisk || risk != "none" {
		if stage != StageRunning && stage != StageHumanAction {
			return apperr.BadReq(apperr.TaskRisk, "风险或失败任务仅允许重试或人工接管")
		}
	}
	if err := AssertLifecycleTransition(from, stage); err != nil {
		return err
	}
	task["lifecycleStage"] = stage
	task["status"] = StatusForLifecycle(stage)
	tone := "info"
	if stage == StageCompleted {
		tone = "success"
	}
	AppendTaskAuditLocked(task, actor.Name, "状态流转", from+" → "+stage, tone)
	return nil
}

// ApplyTaskApprove records the approval decision on the task and (for
// dispatchKind=assist) advances the lifecycle to StagePending so the
// 协办 can start. Always appends an audit event. Caller MUST hold
// s.Store.Lock().
func ApplyTaskApprove(task map[string]any, approved bool, reason string, actor *auth.Identity) {
	EnsureTaskShape(task)
	gov, _ := task["governance"].(map[string]any)
	if gov == nil {
		gov = map[string]any{}
		task["governance"] = gov
	}
	if approved {
		gov["approvalStatus"] = "approved"
		gov["approvalRequired"] = false
	} else {
		gov["approvalStatus"] = "rejected"
	}
	action := "审批通过"
	tone := "success"
	if !approved {
		action = "审批拒绝"
		tone = "error"
	}
	if str(task["dispatchKind"]) == "assist" {
		if approved {
			task["assistStatus"] = "accepted"
			task["lifecycleStage"] = StagePending
			task["status"] = "pending"
			if ex, ok := task["execution"].(map[string]any); ok {
				ex["currentStep"] = "协办已接受，待开始协同"
			}
			action = "接受协办"
		} else {
			task["assistStatus"] = "rejected"
			action = "拒绝协办"
		}
	}
	AppendTaskAuditLocked(task, actor.Name, action, reason, tone)
}

// ApplyTaskTakeover marks the task as paused under human control, sets
// lifecycleStage to StageHumanAction, and records takeover metadata on
// governance. Caller MUST hold s.Store.Lock().
func ApplyTaskTakeover(task map[string]any, reason string, actor *auth.Identity) {
	EnsureTaskShape(task)
	gov, _ := task["governance"].(map[string]any)
	if gov == nil {
		gov = map[string]any{}
		task["governance"] = gov
	}
	gov["takeoverBy"] = actor.Name
	gov["takeoverReason"] = reason
	task["lifecycleStage"] = StageHumanAction
	task["status"] = "review"
	if ex, ok := task["execution"].(map[string]any); ok {
		ex["paused"] = true
	}
	AppendTaskAuditLocked(task, actor.Name, "人工接管", reason, "warn")
}

// ApplyTaskRetry clears the SLA risk flag, bumps retryCount, and
// transitions the task back to StageRunning. Returns apperr.TaskRisk
// when the task is neither in StageRisk nor flagged as at-risk.
// Caller MUST hold s.Store.Lock().
func ApplyTaskRetry(task map[string]any, reason string, actor *auth.Identity) error {
	EnsureTaskShape(task)
	stage := NormalizeLifecycleStage(str(task["lifecycleStage"]))
	sla, _ := task["sla"].(map[string]any)
	risk := "none"
	if sla != nil {
		risk = coalesce(str(sla["risk"]), "none")
	}
	if stage != StageRisk && risk == "none" {
		return apperr.BadReq(apperr.TaskRisk, "仅失败或风险任务可以重试")
	}
	if ex, ok := task["execution"].(map[string]any); ok {
		ex["retryCount"] = ToInt(ex["retryCount"]) + 1
		delete(ex, "error")
		ex["paused"] = false
	}
	task["lifecycleStage"] = StageRunning
	task["status"] = "in_progress"
	if sla != nil {
		sla["risk"] = "none"
	}
	AppendTaskAuditLocked(task, actor.Name, "重试任务", reason, "info")
	return nil
}
