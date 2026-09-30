package server

import (
	"net/http"
	"sort"
	"time"
)

// opsOverviewLive aggregates real control-plane counters (not static seed alone).
func (s *Server) opsOverviewLive(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()

	activeDE, pendingDE := 0, 0
	for _, e := range s.Store.Employees {
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
	for _, t := range s.Store.Tasks {
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
	for _, d := range s.Store.ChannelDLQ {
		if str(d["workspaceId"]) == ws || str(d["workspaceId"]) == "" {
			dlq++
		}
	}
	usageUnits := 0
	for _, u := range s.Store.UsageMeters {
		if str(u["workspaceId"]) == ws {
			usageUnits += toInt(u["units"])
		}
	}
	pendingApprovals := 0
	for _, a := range s.Store.ReleaseApprovals {
		if str(a["workspaceId"]) == ws && str(a["status"]) == "pending" {
			pendingApprovals++
		}
	}
	pendingBackups := 0
	for _, b := range s.Store.Backups {
		if str(b["workspaceId"]) == ws && str(b["status"]) == "pending_approval" {
			pendingBackups++
		}
	}

	pendingRouting, pendingKnowledge, pendingWFSkills, pendingCountersign := 0, 0, 0, 0
	for _, p := range s.Store.RoutingPolicies {
		if str(p["workspaceId"]) == ws && (str(p["status"]) == "pending_approval" || str(p["status"]) == "pending_countersign") {
			pendingRouting++
			if str(p["status"]) == "pending_countersign" {
				pendingCountersign++
			}
		}
	}
	for _, p := range knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"]) {
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
	for _, e := range s.Store.Employees {
		if str(e["workspaceId"]) == ws && str(e["lifecycle"]) == "pending_countersign" {
			pendingCountersign++
		}
	}
	for _, sk := range s.Store.WorkflowSkills {
		if str(sk["workspaceId"]) == ws && (str(sk["status"]) == "pending_approval" || str(sk["lifecycleStatus"]) == "pending_approval") {
			pendingWFSkills++
		}
	}

	return map[string]any{
		"workspaceId":      ws,
		"generatedAt":      time.Now().UTC().Format(time.RFC3339),
		"source":           "live-aggregate",
		"instanceId":       instanceID(),
		"replicaRole":      s.replicaRole(),
		"digitalEmployees": map[string]any{"active": activeDE, "pending": pendingDE},
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
			"postgres":     s.PG != nil,
			"redis":        s.Cache != nil && s.Cache.Available(),
			"activeAgents": activeDE,
			"score":        employeeHealthScore(activeDE, pendingDE),
		},
	}, nil
}

func employeeHealthScore(active, nonActive int) int {
	total := active + nonActive
	if total <= 0 {
		return 0
	}
	return int(float64(active) / float64(total) * 100)
}

func (s *Server) homeKPIsLive(r *http.Request) (any, error) {
	ov, err := s.opsOverviewLive(r)
	if err != nil {
		return nil, err
	}
	m := ov.(map[string]any)
	de := m["digitalEmployees"].(map[string]any)
	tasks := m["tasks"].(map[string]any)
	return map[string]any{
		"activeDigitalEmployees": de["active"],
		"openTasks":              tasks["open"],
		"riskTasks":              tasks["risk"],
		"pendingApprovals":       m["governance"].(map[string]any)["pendingApprovals"],
		"deadLetters":            m["channels"].(map[string]any)["deadLetters"],
		"generatedAt":            m["generatedAt"],
		"source":                 "live-aggregate",
	}, nil
}

// homeExtraLive builds the ops overview payload exclusively from workspace-scoped
// live collections. Demo seeds in Store.HomeExtra are not used for KPIs, cost,
// activities, or trends — empty durable data yields honest zeros / empty lists.
func (s *Server) homeExtraLive(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()

	now := time.Now()
	done, doing, review, todo := 0, 0, 0, 0
	var activities []map[string]any
	hourTasks := make([]int, 12)
	hourCollab := make([]int, 12)
	hourAlerts := make([]int, 12)

	for _, t := range s.Store.Tasks {
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
		actor := firstNonEmpty(str(t["digitalEmployeeName"]), str(t["assignee"]), "系统")
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
	for _, e := range s.Store.Employees {
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
	for _, t := range s.Store.Tasks {
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
			"time": updated, "assignee": firstNonEmpty(str(t["digitalEmployeeName"]), str(t["assignee"])),
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
	for _, sess := range s.Store.Sessions {
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
	for _, c := range s.Store.Conversations {
		if str(c["workspaceId"]) != ws {
			continue
		}
		updated := firstNonEmpty(str(c["updatedAt"]), str(c["createdAt"]))
		if isSameLocalDay(updated, now) {
			// avoid double-count if session id overlaps conversation id
			if str(c["id"]) != "" {
				dup := false
				for _, sess := range s.Store.Sessions {
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

	costUsed, costBudget, daily, costSource := billingCostLocked(s, ws)

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
			"text": "当前工作区尚未装配数字伙伴。", "action": "打开工作伙伴", "to": "/partners",
		})
	}

	quickLinks := []map[string]any{
		{"label": "工作伙伴", "to": "/partners", "icon": "bot"},
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
		"teamMembers":      liveTeamMembersLocked(s, ws),
	}, nil
}

func billingCostLocked(s *Server, ws string) (used, budget float64, daily []int, source string) {
	daily = []int{}
	source = "none"
	// Prefer metered usage; do not treat demo Billing.usage as spent cost.
	for _, m := range s.Store.UsageMeters {
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
	if b := s.Store.Billing; b != nil {
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

func liveTeamMembersLocked(s *Server, ws string) []map[string]any {
	seen := map[string]bool{}
	var out []map[string]any
	for _, m := range s.Store.Members[ws] {
		id := str(m["id"])
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		online, _ := m["online"].(bool)
		out = append(out, map[string]any{
			"id": id, "name": str(m["name"]), "role": str(m["role"]), "online": online,
		})
	}
	return out
}

func hourSlot(raw string, now time.Time, buckets int) int {
	if raw == "" || buckets <= 0 {
		return -1
	}
	t, ok := parseFlexibleTime(raw)
	if !ok {
		return -1
	}
	delta := now.Sub(t)
	if delta < 0 || delta > time.Duration(buckets)*time.Hour {
		return -1
	}
	slot := buckets - 1 - int(delta/time.Hour)
	if slot < 0 {
		slot = 0
	}
	if slot >= buckets {
		slot = buckets - 1
	}
	return slot
}

func isSameLocalDay(raw string, now time.Time) bool {
	t, ok := parseFlexibleTime(raw)
	if !ok {
		return false
	}
	y1, m1, d1 := t.In(now.Location()).Date()
	y2, m2, d2 := now.Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}

func parseFlexibleTime(raw string) (time.Time, bool) {
	layouts := []string{
		time.RFC3339, time.RFC3339Nano,
		"2006-01-02T15:04:05Z", "2006-01-02 15:04:05",
		"15:04", "15:04:05",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, raw); err == nil {
			if layout == "15:04" || layout == "15:04:05" {
				now := time.Now()
				t = time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), t.Second(), 0, now.Location())
			}
			return t, true
		}
	}
	return time.Time{}, false
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}
