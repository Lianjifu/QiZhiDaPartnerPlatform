package server

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// Lifecycle stages aligned with ControlledTask / createTaskDomain.
const (
	stagePending     = "pending"
	stageRunning     = "running"
	stageHumanAction = "human_action"
	stageRisk        = "risk"
	stageCompleted   = "completed"
	stageArchived    = "archived"
)

var lifecycleEdges = map[string][]string{
	stagePending:     {stageRunning, stageHumanAction, stageArchived},
	stageRunning:     {stageHumanAction, stageCompleted, stagePending, stageRisk},
	stageHumanAction: {stageRunning, stagePending, stageCompleted, stageRisk},
	stageRisk:        {stageRunning, stageHumanAction}, // retry / takeover only
	stageCompleted:   {stageArchived, stagePending},
	stageArchived:    {stagePending},
}

func normalizeLifecycleStage(stage string) string {
	switch strings.TrimSpace(stage) {
	case stagePending, stageRunning, stageHumanAction, stageRisk, stageCompleted, stageArchived:
		return stage
	case "in_progress":
		return stageRunning
	case "review":
		return stageHumanAction
	default:
		return stagePending
	}
}

func statusForLifecycle(stage string) string {
	switch normalizeLifecycleStage(stage) {
	case stageRunning:
		return "in_progress"
	case stageHumanAction, stageRisk:
		return "review"
	case stageCompleted:
		return "completed"
	case stageArchived:
		return "archived"
	default:
		return "pending"
	}
}

func assertLifecycleTransition(from, to string) error {
	from = normalizeLifecycleStage(from)
	to = normalizeLifecycleStage(to)
	if from == to {
		return nil
	}
	for _, a := range lifecycleEdges[from] {
		if a == to {
			return nil
		}
	}
	return apperr.BadReq(apperr.BadRequest, "非法任务阶段流转: "+from+" → "+to)
}

func ensureTaskShape(task map[string]any) {
	if task == nil {
		return
	}
	if _, ok := task["links"].(map[string]any); !ok {
		task["links"] = map[string]any{}
	}
	if _, ok := task["auditEvents"].([]map[string]any); !ok {
		if raw, ok := task["auditEvents"].([]any); ok {
			evs := make([]map[string]any, 0, len(raw))
			for _, item := range raw {
				if m, ok := item.(map[string]any); ok {
					evs = append(evs, m)
				}
			}
			task["auditEvents"] = evs
		} else {
			task["auditEvents"] = []map[string]any{}
		}
	}
	if task["version"] == nil {
		task["version"] = 0
	}
	if _, ok := task["sla"].(map[string]any); !ok {
		task["sla"] = map[string]any{"remainingMin": 120, "risk": "none", "escalated": false}
	}
	if _, ok := task["execution"].(map[string]any); !ok {
		task["execution"] = map[string]any{"retryCount": 0, "paused": false}
	}
	if _, ok := task["governance"].(map[string]any); !ok {
		task["governance"] = map[string]any{"approvalRequired": false, "approvalStatus": "not_required"}
	}
	if _, ok := task["progress"].(map[string]any); !ok {
		task["progress"] = map[string]any{"done": 0, "total": 1}
	}
	if str(task["lifecycleStage"]) == "" {
		task["lifecycleStage"] = mapStatusToStage(str(task["status"]))
	}
	if str(task["status"]) == "" {
		task["status"] = statusForLifecycle(str(task["lifecycleStage"]))
	}
}

func taskAuditEvents(task map[string]any) []map[string]any {
	ensureTaskShape(task)
	if evs, ok := task["auditEvents"].([]map[string]any); ok {
		return evs
	}
	return nil
}

func appendTaskAuditLocked(task map[string]any, actor, action, detail, tone string) {
	ensureTaskShape(task)
	at := time.Now().UTC().Format(time.RFC3339)
	ev := map[string]any{
		"id":     fmt.Sprintf("ta-%d", time.Now().UnixNano()),
		"at":     at,
		"actor":  coalesce(actor, "系统"),
		"action": action,
		"detail": detail,
		"tone":   coalesce(tone, "info"),
	}
	evs := taskAuditEvents(task)
	task["auditEvents"] = append([]map[string]any{ev}, evs...)
	task["version"] = toInt(task["version"]) + 1
	task["updatedAt"] = at
}

func checkTaskVersion(task map[string]any, body map[string]any) error {
	if body == nil || body["version"] == nil {
		return nil
	}
	want := toInt(body["version"])
	have := toInt(task["version"])
	if want != have {
		IncTaskVersionConflict()
		return apperr.Conflict(apperr.TaskVersion, fmt.Sprintf("任务版本冲突：期望 %d，当前 %d", want, have))
	}
	return nil
}

func taskVisibleToUser(task map[string]any, id *auth.Identity) bool {
	if id == nil {
		return false
	}
	if id.Role == "admin" || id.Role == "auditor" {
		return true
	}
	if str(task["ownerId"]) == id.ID || str(task["createdBy"]) == id.ID {
		return true
	}
	if str(task["assignee"]) == id.ID || str(task["assignee"]) == id.Name {
		return true
	}
	if cols, ok := task["collaboratorIds"].([]any); ok {
		for _, c := range cols {
			if str(c) == id.ID {
				return true
			}
		}
	}
	if names, ok := task["collaboratorNames"].([]any); ok {
		for _, n := range names {
			if str(n) == id.Name {
				return true
			}
		}
	}
	return false
}

func nextTaskCode(existing []map[string]any) string {
	day := time.Now().UTC().Format("20060102")
	prefix := "TSK-" + day + "-"
	maxN := 0
	for _, t := range existing {
		code := str(t["code"])
		if !strings.HasPrefix(code, prefix) {
			continue
		}
		n, _ := strconv.Atoi(strings.TrimPrefix(code, prefix))
		if n > maxN {
			maxN = n
		}
	}
	return fmt.Sprintf("%s%03d", prefix, maxN+1)
}

func buildControlledTask(idGen func(string) string, ws string, body map[string]any, actor *auth.Identity) map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	title := strings.TrimSpace(str(body["title"]))
	priority := coalesce(str(body["priority"]), "P2")
	source := coalesce(str(body["source"]), "manual")
	dispatchKind := str(body["dispatchKind"])
	stage := stagePending
	status := "pending"
	gov := map[string]any{"approvalRequired": false, "approvalStatus": "not_required"}
	exec := map[string]any{"retryCount": 0, "paused": false, "currentStep": "待开始"}
	assistStatus := str(body["assistStatus"])

	if dispatchKind == "assist" {
		source = "dispatch"
		gov["approvalRequired"] = true
		gov["approvalStatus"] = "pending"
		stage = stageHumanAction
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
		stage = mapStatusToStage(st)
	}
	if ls := str(body["lifecycleStage"]); ls != "" && dispatchKind == "" {
		stage = normalizeLifecycleStage(ls)
		status = statusForLifecycle(stage)
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
		slaRemaining = toInt(body["slaRemainingMin"])
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
		"id":                  idGen("task"),
		"workspaceId":         ws,
		"code":                coalesce(str(body["code"]), ""),
		"title":               title,
		"description":         str(body["description"]),
		"priority":            priority,
		"status":              status,
		"lifecycleStage":      stage,
		"ownerId":             actor.ID,
		"ownerName":           actor.Name,
		"createdBy":           actor.ID,
		"assignee":            coalesce(str(body["assignee"]), actor.Name),
		"digitalPartnerId":   body["digitalPartnerId"],
		"digitalPartnerName": body["digitalPartnerName"],
		"agentId":             body["agentId"],
		"source":              source,
		"dispatchKind":        nilIfEmpty(dispatchKind),
		"coordinatorId":       body["coordinatorId"],
		"coordinatorName":     body["coordinatorName"],
		"collaboratorIds":     body["collaboratorIds"],
		"collaboratorNames":   body["collaboratorNames"],
		"assistStatus":        nilIfEmpty(assistStatus),
		"progress":            progress,
		"tags":                tags,
		"sla":                 map[string]any{"remainingMin": slaRemaining, "risk": "none", "escalated": false},
		"execution":           exec,
		"governance":          gov,
		"links":               links,
		"auditEvents":         []map[string]any{},
		"version":             0,
		"environment":         coalesce(str(body["environment"]), "sandbox"),
		"classification":      coalesce(str(body["classification"]), "internal"),
		"createdAt":           now,
		"updatedAt":           now,
	}
	if item["code"] == "" {
		item["code"] = "TSK-PENDING"
	}
	return item
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func applyLifecycleTransition(task map[string]any, target string, actor *auth.Identity) error {
	ensureTaskShape(task)
	stage := normalizeLifecycleStage(target)
	from := normalizeLifecycleStage(str(task["lifecycleStage"]))

	gov, _ := task["governance"].(map[string]any)
	if gov == nil {
		gov = map[string]any{}
		task["governance"] = gov
	}
	if boolFrom(gov["approvalRequired"]) && (stage == stageRunning || stage == stageCompleted) {
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
	if from == stageRisk || risk != "none" {
		if stage != stageRunning && stage != stageHumanAction {
			return apperr.BadReq(apperr.TaskRisk, "风险或失败任务仅允许重试或人工接管")
		}
	}
	if err := assertLifecycleTransition(from, stage); err != nil {
		return err
	}
	task["lifecycleStage"] = stage
	task["status"] = statusForLifecycle(stage)
	tone := "info"
	if stage == stageCompleted {
		tone = "success"
	}
	appendTaskAuditLocked(task, actor.Name, "状态流转", from+" → "+stage, tone)
	return nil
}

func applyTaskApprove(task map[string]any, approved bool, reason string, actor *auth.Identity) {
	ensureTaskShape(task)
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
			task["lifecycleStage"] = stagePending
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
	appendTaskAuditLocked(task, actor.Name, action, reason, tone)
}

func applyTaskTakeover(task map[string]any, reason string, actor *auth.Identity) {
	ensureTaskShape(task)
	gov, _ := task["governance"].(map[string]any)
	if gov == nil {
		gov = map[string]any{}
		task["governance"] = gov
	}
	gov["takeoverBy"] = actor.Name
	gov["takeoverReason"] = reason
	task["lifecycleStage"] = stageHumanAction
	task["status"] = "review"
	if ex, ok := task["execution"].(map[string]any); ok {
		ex["paused"] = true
	}
	appendTaskAuditLocked(task, actor.Name, "人工接管", reason, "warn")
}

func applyTaskRetry(task map[string]any, reason string, actor *auth.Identity) error {
	ensureTaskShape(task)
	stage := normalizeLifecycleStage(str(task["lifecycleStage"]))
	sla, _ := task["sla"].(map[string]any)
	risk := "none"
	if sla != nil {
		risk = coalesce(str(sla["risk"]), "none")
	}
	if stage != stageRisk && risk == "none" {
		return apperr.BadReq(apperr.TaskRisk, "仅失败或风险任务可以重试")
	}
	if ex, ok := task["execution"].(map[string]any); ok {
		ex["retryCount"] = toInt(ex["retryCount"]) + 1
		delete(ex, "error")
		ex["paused"] = false
	}
	task["lifecycleStage"] = stageRunning
	task["status"] = "in_progress"
	if sla != nil {
		sla["risk"] = "none"
	}
	appendTaskAuditLocked(task, actor.Name, "重试任务", reason, "info")
	return nil
}

func filterTasksQuery(tasks []map[string]any, q map[string]string) []map[string]any {
	stage := q["stage"]
	risk := q["risk"]
	assignee := q["assignee"]
	search := strings.ToLower(strings.TrimSpace(q["q"]))
	approval := q["approval"]
	source := q["source"]
	priority := q["priority"]
	agent := q["agent"]
	archived := q["archived"]
	blocked := q["blocked"]
	out := make([]map[string]any, 0, len(tasks))
	for _, t := range tasks {
		ensureTaskShape(t)
		ls := str(t["lifecycleStage"])
		if archived != "1" && archived != "true" {
			if ls == stageArchived {
				continue
			}
		} else if archived == "only" && ls != stageArchived {
			continue
		}
		if stage != "" && stage != "all" && ls != stage {
			continue
		}
		if assignee != "" && assignee != "all" && str(t["assignee"]) != assignee {
			continue
		}
		if source != "" && source != "all" && str(t["source"]) != source {
			continue
		}
		if priority != "" && priority != "all" && str(t["priority"]) != priority {
			continue
		}
		if agent != "" && agent != "all" {
			if str(t["digitalPartnerId"]) != agent && str(t["digitalPartnerName"]) != agent {
				continue
			}
		}
		sla, _ := t["sla"].(map[string]any)
		taskRisk := "none"
		if sla != nil {
			taskRisk = coalesce(str(sla["risk"]), "none")
		}
		if risk == "attention" {
			hit := ls == stageRisk || taskRisk != "none"
			gov, _ := t["governance"].(map[string]any)
			approvalHit := gov != nil && str(gov["approvalStatus"]) == "pending"
			if !hit && !approvalHit && ls != stageHumanAction {
				continue
			}
		} else if risk != "" && risk != "all" && taskRisk != risk {
			continue
		}
		if approval != "" && approval != "all" {
			gov, _ := t["governance"].(map[string]any)
			st := "not_required"
			if gov != nil {
				st = coalesce(str(gov["approvalStatus"]), "not_required")
			}
			if st != approval {
				continue
			}
		}
		if blocked == "1" || blocked == "true" {
			links, _ := t["links"].(map[string]any)
			blockedBy := ""
			if links != nil {
				blockedBy = str(links["blockedBy"])
			}
			if blockedBy == "" && taskRisk != "blocked" {
				continue
			}
		}
		if search != "" {
			blob := strings.ToLower(str(t["title"]) + " " + str(t["code"]) + " " + str(t["assignee"]) + " " + str(t["digitalPartnerName"]) + " " + str(t["source"]))
			if !strings.Contains(blob, search) {
				continue
			}
		}
		out = append(out, t)
	}
	return out
}

func paginateTasks(tasks []map[string]any, limit, offset int) (items []map[string]any, total int) {
	total = len(tasks)
	if limit <= 0 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		return []map[string]any{}, total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return tasks[offset:end], total
}
