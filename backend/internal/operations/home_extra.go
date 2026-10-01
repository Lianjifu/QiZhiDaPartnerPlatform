package operations

import (
	"net/http"
	"sort"
	"time"
)

// homeExtraLive builds the ops overview payload exclusively from
// workspace-scoped live collections. Demo seeds in Store.HomeExtra are
// not used for KPIs, cost, activities, or trends — empty durable data
// yields honest zeros / empty lists. Returns the canonical
// /api/home/extra payload (taskCompletion / agentCallSummary /
// operationalMetrics / costMonth / slaAlerts / notifications /
// recentActivities / suggestion / quickLinks / teamMembers).
//
// Same algorithm as the legacy server.homeExtraLive; only the receiver
// + Store access have been repointed (Store via AggregateStore).
func (h *Handler) homeExtraLive(r *http.Request) (any, error) {
	ws := h.workspaceOf(r)
	h.Store.RLock()
	defer h.Store.RUnlock()

	now := time.Now()
	done, doing, review, todo := 0, 0, 0, 0
	var activities []map[string]any
	hourTasks := make([]int, 12)
	hourCollab := make([]int, 12)
	hourAlerts := make([]int, 12)

	for _, t := range h.Store.Tasks {
		if str(t["workspaceId"]) != ws {
			continue
		}
		code := str(t["code"])
		switch str(t["status"]) {
		case "completed", "archived":
			done++
		case "in_progress":
			doing++
		case "review":
			review++
		default:
			todo++
		}
		title := str(t["title"])
		if title == "" {
			title = code
		}
		actor := firstNonEmpty(str(t["digitalPartnerName"]), str(t["assignee"]), "系统")
		tone := "info"
		st := str(t["status"])
		if st == "completed" || st == "archived" {
			tone = "success"
		} else if st == "review" {
			tone = "warn"
		}
		updated := str(t["updatedAt"])
		activities = append(activities, map[string]any{
			"id": "act-task-" + str(t["id"]), "type": "task." + st, "tone": tone,
			"text": title, "actor": actor, "resource": code, "time": updated,
			"to": "/tasks?task=" + code,
		})
		if slot := hourSlot(updated, now, 12); slot >= 0 {
			hourTasks[slot]++
		}
	}

	// Sort activities by time desc when parseable
	sort.SliceStable(activities, func(i, j int) bool {
		return str(activities[i]["time"]) > str(activities[j]["time"])
	})
	if len(activities) > 20 {
		activities = activities[:20]
	}

	healthy, warning, offline, calls := 0, 0, 0, 0
	for _, e := range h.Store.Employees {
		if str(e["workspaceId"]) != ws {
			continue
		}
		switch str(e["lifecycle"]) {
		case "active", "published":
			healthy++
		case "paused", "quarantined":
			warning++
		default:
			offline++
		}
		if rt, ok := e["runtime"].(map[string]any); ok {
			calls += toInt(rt["calls24h"])
		}
	}
	totalAgents := healthy + warning + offline
	healthScore := 0
	if totalAgents > 0 {
		healthScore = int(float64(healthy) / float64(totalAgents) * 100)
	}

	var alerts []map[string]any
	var notifications []map[string]any
	// Alerts are derived from live tasks only (no HomeAlerts demo seed on the overview).
	for _, t := range h.Store.Tasks {
		if str(t["workspaceId"]) != ws {
			continue
		}
		st := str(t["status"])
		risk := ""
		if sla, ok := t["sla"].(map[string]any); ok {
			risk = str(sla["risk"])
		}
		prio := str(t["priority"])
		needsAttention := st == "review" || risk == "critical" || risk == "overdue" || risk == "warning" ||
			(prio == "P0" && st != "completed" && st != "archived")
		if !needsAttention {
			continue
		}
		code := str(t["code"])
		title := str(t["title"])
		if title == "" {
			title = code
		}
		level := firstNonEmpty(prio, risk, "P2")
		updated := str(t["updatedAt"])
		alert := map[string]any{
			"id": "task-alert-" + str(t["id"]), "level": level, "text": title,
			"time": updated, "assignee": firstNonEmpty(str(t["digitalPartnerName"]), str(t["assignee"])),
			"taskCode": code, "workspaceId": ws, "source": "task",
		}
		alerts = append(alerts, alert)
		if slot := hourSlot(updated, now, 12); slot >= 0 {
			hourAlerts[slot]++
		}
		notifications = append(notifications, map[string]any{
			"id": "n-task-" + str(t["id"]), "tone": "warn", "icon": "AlertTriangle",
			"text": title, "detail": code, "time": updated, "unread": true,
		})
	}

	collabToday := 0
	for _, sess := range h.Store.Sessions {
		if str(sess["workspaceId"]) != ws {
			continue
		}
		updated := firstNonEmpty(str(sess["updatedAt"]), str(sess["createdAt"]))
		if isSameLocalDay(updated, now) {
			collabToday++
		}
		if slot := hourSlot(updated, now, 12); slot >= 0 {
			hourCollab[slot]++
		}
	}
	for _, c := range h.Store.Conversations {
		if str(c["workspaceId"]) != ws {
			continue
		}
		updated := firstNonEmpty(str(c["updatedAt"]), str(c["createdAt"]))
		if isSameLocalDay(updated, now) {
			// avoid double-count if session id overlaps conversation id
			if str(c["id"]) != "" {
				dup := false
				for _, sess := range h.Store.Sessions {
					if str(sess["id"]) == str(c["id"]) && str(sess["workspaceId"]) == ws {
						dup = true
						break
					}
				}
				if !dup {
					collabToday++
					if slot := hourSlot(updated, now, 12); slot >= 0 {
						hourCollab[slot]++
					}
				}
			}
		}
	}

	open := doing + review + todo
	var successRate any
	if open+done > 0 {
		successRate = round1(float64(done) / float64(open+done) * 100)
	} else {
		successRate = nil
	}

	trend := make([]map[string]any, 0, 12)
	hasTrendSignal := false
	for i := 0; i < 12; i++ {
		if hourTasks[i]+hourCollab[i]+hourAlerts[i] > 0 {
			hasTrendSignal = true
		}
		label := now.Add(-time.Duration(11-i) * time.Hour).Format("15:04")
		trend = append(trend, map[string]any{
			"time": label, "tasks": hourTasks[i], "collab": hourCollab[i], "alerts": hourAlerts[i],
			"health": healthScore, "taskRate": hourTasks[i], "apiP95": nil,
		})
	}
	if !hasTrendSignal {
		trend = []map[string]any{}
	}

	costUsed, costBudget, daily, costSource := billingCostLocked(h, ws)

	var suggestions []map[string]any
	if review > 0 {
		suggestions = append(suggestions, map[string]any{
			"id": "sg-review", "tone": "warn",
			"text": "有待复核任务，建议尽快完成人工确认。", "action": "打开任务中心", "to": "/tasks?status=review",
		})
	}
	unacked := len(alerts)
	if unacked > 0 {
		suggestions = append(suggestions, map[string]any{
			"id": "sg-alert", "tone": "warn",
			"text": "存在需关注任务（复核/SLA/P0），请进入任务处置。", "action": "查看任务", "to": "/tasks?risk=attention",
		})
	}
	if healthy > 0 {
		suggestions = append(suggestions, map[string]any{
			"id": "sg-collab", "tone": "info",
			"text": "在岗数字伙伴可发起专家协作。", "action": "开始协作", "to": "/copilot",
		})
	} else if totalAgents == 0 {
		suggestions = append(suggestions, map[string]any{
			"id": "sg-onboard", "tone": "info",
			"text": "当前工作区尚未装配数字伙伴。", "action": "打开数字伙伴", "to": "/partners",
		})
	}

	quickLinks := []map[string]any{
		{"label": "数字伙伴", "to": "/partners", "icon": "bot"},
		{"label": "协作", "to": "/copilot", "icon": "message"},
		{"label": "任务", "to": "/tasks", "icon": "list"},
	}

	return map[string]any{
		"workspaceId": ws,
		"generatedAt": now.UTC().Format(time.RFC3339),
		"source":      "live-aggregate",
		"taskCompletion": map[string]any{
			"done": done, "doing": doing, "review": review, "todo": todo,
		},
		"agentCallSummary": map[string]any{
			"total": calls, "healthy": healthy, "warning": warning, "offline": offline,
		},
		"operationalMetrics": map[string]any{
			"taskSuccessRate": successRate,
			"activeAgents":    healthy,
			"healthScore":     healthScore,
			"apiP95":          nil,
			"taskRate":        doing,
			"collabToday":     collabToday,
			"tokenUsage":      map[string]any{"total": "—", "input": "—", "output": "—"},
			"trend24h":        trend,
		},
		"costMonth": map[string]any{
			"used": costUsed, "budget": costBudget, "daily": daily, "source": costSource,
		},
		"slaAlerts":        alerts,
		"notifications":    notifications,
		"recentActivities": activities,
		"suggestion":       suggestions,
		"quickLinks":       quickLinks,
		"teamMembers":      liveTeamMembersLocked(h, ws),
	}, nil
}

// billingCostLocked projects the month-to-date billing usage from
// metered usage (NOT the demo Billing.usage seed — see store.go line
// 823). Returns:
//
//   - used:    float64 USD accumulated; 0 when no metered entries exist
//   - budget:  float64 USD from Billing.quota.usd (0 when quota absent)
//   - daily:   int slice placeholder (always empty — daily breakdown
//     isn't computed in the locked path)
//   - source:  "usage-meters" when at least one meter contributed,
//     "none" when only the demo seed is present
//
// The "lock" in the name signals that we never project from the demo
// Billing.usage value — only real UsageMeters rows are trusted. Same
// semantics as the legacy server.billingCostLocked.
func billingCostLocked(h *Handler, ws string) (used, budget float64, daily []int, source string) {
	daily = []int{}
	source = "none"
	// Prefer metered usage; do not treat demo Billing.usage as spent cost.
	for _, m := range h.Store.UsageMeters {
		if str(m["workspaceId"]) != ws {
			continue
		}
		part := toFloat(m["usd"])
		if part == 0 {
			part = float64(toInt(m["units"])) * 0.001
		}
		if part > 0 {
			used += part
			source = "usage-meters"
		}
	}
	if b := h.Store.Billing; b != nil {
		if str(b["workspaceId"]) == ws || str(b["workspaceId"]) == "" {
			if q, ok := b["quota"].(map[string]any); ok {
				budget = toFloat(q["usd"])
			}
		}
	}
	// Without meters, expose honest zeros (ignore demo Billing.usage / quota seed).
	if source == "none" {
		used = 0
		budget = 0
	}
	return used, budget, daily, source
}
