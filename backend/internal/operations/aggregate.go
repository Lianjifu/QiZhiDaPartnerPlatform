package operations

import (
	"net/http"
	"time"
)

// opsOverviewLive aggregates real control-plane counters (not static
// seed alone). Returns the canonical /api/operations/overview payload:
//
//	workspaceId, generatedAt, source="live-aggregate",
//	instanceId, replicaRole, digitalPartners, tasks, channels,
//	governance, usage, pending (top 8 attention items),
//	health (postgres / redis / activeAgents / score).
//
// All workspace-scoped reads use the live collections — Employees /
// Tasks / ChannelDLQ / UsageMeters / ReleaseApprovals / Backups /
// RoutingPolicies / KnowledgeExtra / WorkflowSkills. Same algorithm
// as the legacy server.opsOverviewLive; only the receiver + Store
// access have been repointed (Store via AggregateStore interface).
func (h *Handler) opsOverviewLive(r *http.Request) (any, error) {
	ws := h.workspaceOf(r)
	h.Store.RLock()
	defer h.Store.RUnlock()

	activeDE, pendingDE := 0, 0
	for _, e := range h.Store.Employees {
		if str(e["workspaceId"]) != ws {
			continue
		}
		switch str(e["lifecycle"]) {
		case "active", "published":
			activeDE++
		case "pending_approval", "pending_countersign", "draft":
			pendingDE++
		}
	}

	openTasks, riskTasks := 0, 0
	var pending []map[string]any
	for _, t := range h.Store.Tasks {
		if str(t["workspaceId"]) != ws {
			continue
		}
		code := str(t["code"])
		st := str(t["status"])
		if st != "completed" && st != "archived" {
			openTasks++
		}
		risk := ""
		if sla, ok := t["sla"].(map[string]any); ok {
			risk = str(sla["risk"])
			if risk != "none" && risk != "" {
				riskTasks++
			}
		}
		if st == "review" || st == "pending" || risk == "critical" || risk == "overdue" || risk == "warning" {
			title := str(t["title"])
			if title == "" {
				title = code
			}
			pending = append(pending, map[string]any{
				"id":    "task-" + str(t["id"]),
				"title": title,
				"level": firstNonEmpty(str(t["priority"]), risk, "P2"),
				"to":    "/tasks?task=" + code,
			})
		}
	}
	if len(pending) > 8 {
		pending = pending[:8]
	}

	dlq := 0
	for _, d := range h.Store.ChannelDLQ {
		if str(d["workspaceId"]) == ws || str(d["workspaceId"]) == "" {
			dlq++
		}
	}
	usageUnits := 0
	for _, u := range h.Store.UsageMeters {
		if str(u["workspaceId"]) == ws {
			usageUnits += toInt(u["units"])
		}
	}
	pendingApprovals := 0
	for _, a := range h.Store.ReleaseApprovals {
		if str(a["workspaceId"]) == ws && str(a["status"]) == "pending" {
			pendingApprovals++
		}
	}
	pendingBackups := 0
	for _, b := range h.Store.Backups {
		if str(b["workspaceId"]) == ws && str(b["status"]) == "pending_approval" {
			pendingBackups++
		}
	}

	pendingRouting, pendingKnowledge, pendingWFSkills, pendingCountersign := 0, 0, 0, 0
	for _, p := range h.Store.RoutingPolicies {
		if str(p["workspaceId"]) == ws && (str(p["status"]) == "pending_approval" || str(p["status"]) == "pending_countersign") {
			pendingRouting++
			if str(p["status"]) == "pending_countersign" {
				pendingCountersign++
			}
		}
	}
	for _, p := range knowledgeSliceMaps(h.Store.KnowledgeExtra["packages"]) {
		if str(p["workspaceId"]) != "" && str(p["workspaceId"]) != ws {
			continue
		}
		if str(p["status"]) == "pending_approval" || str(p["status"]) == "pending_countersign" {
			pendingKnowledge++
			if str(p["status"]) == "pending_countersign" {
				pendingCountersign++
			}
		}
	}
	for _, e := range h.Store.Employees {
		if str(e["workspaceId"]) == ws && str(e["lifecycle"]) == "pending_countersign" {
			pendingCountersign++
		}
	}
	for _, sk := range h.Store.WorkflowSkills {
		if str(sk["workspaceId"]) == ws && (str(sk["status"]) == "pending_approval" || str(sk["lifecycleStatus"]) == "pending_approval") {
			pendingWFSkills++
		}
	}

	return map[string]any{
		"workspaceId": ws,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
		"source":      "live-aggregate",
		"instanceId":  h.instanceIDOf(),
		"replicaRole": h.replicaRoleOf(),
		"digitalPartners": map[string]any{"active": activeDE, "pending": pendingDE},
		"tasks":            map[string]any{"open": openTasks, "risk": riskTasks},
		"channels":         map[string]any{"deadLetters": dlq},
		"governance": map[string]any{
			"pendingApprovals": pendingApprovals, "pendingBackups": pendingBackups,
			"pendingEmployeeReleases": pendingDE, "pendingRouting": pendingRouting,
			"pendingKnowledge": pendingKnowledge, "pendingWorkflowSkills": pendingWFSkills,
			"pendingCountersign": pendingCountersign,
		},
		"usage":   map[string]any{"recentUnits": usageUnits},
		"pending": pending,
		"health": map[string]any{
			"postgres":     h.hasPostgres(),
			"redis":        h.hasRedis(),
			"activeAgents": activeDE,
			"score":        employeeHealthScore(activeDE, pendingDE),
		},
	}, nil
}

// employeeHealthScore computes the platform health percentage from
// the live digital-partner counts. Returns 0 when there are no digital
// partners at all (avoids division by zero and surfaces an "uninitialized"
// signal to the UI rather than a misleading 100%).
//
// Pure function so it's trivially unit-testable; kept in aggregate.go
// rather than helpers.go because the only caller is opsOverviewLive.
func employeeHealthScore(active, nonActive int) int {
	total := active + nonActive
	if total <= 0 {
		return 0
	}
	return int(float64(active) / float64(total) * 100)
}
