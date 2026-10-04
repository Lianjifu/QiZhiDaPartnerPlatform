// Package copilot —— 回合叙事(turn narrative)收集器。
//
// 职责：把一次 copilot 回合期间 SSE 流上发出的 thought / task 事件
// 收集成结构化的"叙事面板"快照，给前端展示 4 阶段（理解/计划/执行/反思）
// 的进度、任务列表、汇总文本。
//
// 数据流：
//   SSE emit → turnNarrativeCollector.Record(typ, _, extra)
//   回合结束 → .Snapshot(cog, harnessMode, durationMs) → map[string]any 给 turnMeta
//
// 同时维护一个全局 thoughtDedupLast 表，避免"同一阶段 + 同一标题在 2s 内重复推送"
// （并发 wecom webhook + 重试触发的常见噪声源）。
package copilot

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

const (
	turnPhaseUnderstand = "understand"
	turnPhasePlan       = "plan"
	turnPhaseExecute    = "execute"
	turnPhaseReflect    = "reflect"
)

var turnPhaseLabels = map[string]string{
	turnPhaseUnderstand: "意图理解",
	turnPhasePlan:       "任务规划",
	turnPhaseExecute:    "工具执行",
	turnPhaseReflect:    "质量复核",
}

// turnNarrativeCollector 累积一次 copilot 回合的 thought / task 事件，
// 回合结束时被 Snapshot() 序列化成给前端的 turnMeta 块。
//
// 4 个 phase bucket（understand / plan / execute / reflect）初始为 pending，
// 任一 phase 收到 thought 事件后置为 done 并累加 stepCount；
// task 事件单独切片，去重按 taskId 合并（同一任务多次状态变更只保留最新）。
type turnNarrativeCollector struct {
	phases    map[string]*turnPhaseBucket
	tasks     []map[string]any
	startedAt time.Time
}

type turnPhaseBucket struct {
	phase     string
	stepCount int
	status    string
}

func newTurnNarrativeCollector() *turnNarrativeCollector {
	return &turnNarrativeCollector{
		phases: map[string]*turnPhaseBucket{
			turnPhaseUnderstand: {phase: turnPhaseUnderstand, status: "pending"},
			turnPhasePlan:       {phase: turnPhasePlan, status: "pending"},
			turnPhaseExecute:    {phase: turnPhaseExecute, status: "pending"},
			turnPhaseReflect:    {phase: turnPhaseReflect, status: "pending"},
		},
		startedAt: time.Now(),
	}
}

// Record 是收集器的入口：每条 SSE thought/task 事件被 emit 出来的同时也会调到这。
//
// 关键行为：
//   - thought 事件 → 按 phase 增 stepCount 并标 done；phase 缺失时按 kind/title 推断
//   - task 事件 → 按 taskId 去重合并；多次"started → completed"只保留最终状态
func (c *turnNarrativeCollector) Record(typ, _ string, extra map[string]any) {
	if c == nil || extra == nil {
		return
	}
	switch typ {
	case contract.StreamThought:
		phase := str(extra["phase"])
		if phase == "" {
			phase = inferNarrativePhase(str(extra["kind"]), str(extra["title"]))
		}
		if b := c.phases[phase]; b != nil {
			b.stepCount++
			b.status = "done"
		}
	case contract.StreamTask:
		id := strings.TrimSpace(str(extra["taskId"]))
		title := strings.TrimSpace(str(extra["title"]))
		if id == "" && title == "" {
			return
		}
		if id == "" {
			id = "task_" + title
		}
		item := map[string]any{
			"id":     id,
			"title":  title,
			"status": taskStatusFromAction(str(extra["action"])),
			"detail": str(extra["detail"]),
		}
		for i, existing := range c.tasks {
			if str(existing["id"]) != id {
				continue
			}
			if title == "" {
				item["title"] = existing["title"]
			}
			if str(item["detail"]) == "" {
				item["detail"] = existing["detail"]
			}
			c.tasks[i] = item
			return
		}
		c.tasks = append(c.tasks, item)
	}
}

func taskStatusFromAction(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "started":
		return "running"
	case "completed":
		return "done"
	case "failed", "cancelled":
		return action
	default:
		return "pending"
	}
}

func inferNarrativePhase(kind, title string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	title = strings.TrimSpace(title)
	switch kind {
	case "framework", "search":
		return turnPhaseUnderstand
	case "plan", "finalize":
		return turnPhasePlan
	case "tool_call":
		return turnPhaseExecute
	case "reflect":
		return turnPhaseReflect
	case "analyze":
		if strings.Contains(title, "调用") || strings.Contains(title, "能力") {
			return turnPhaseExecute
		}
		return turnPhaseUnderstand
	default:
		return turnPhasePlan
	}
}

func (c *turnNarrativeCollector) Snapshot(cog cognitiveDecision, harnessMode string, durationMs int) map[string]any {
	if c == nil {
		return nil
	}
	narrative := "standard"
	if cog.Bypass {
		narrative = "bypass"
	} else if harnessMode == modePlanExec {
		narrative = "plan"
	} else if harnessMode == modeDirect {
		narrative = "direct"
	}
	phases := make([]map[string]any, 0, 4)
	order := []string{turnPhaseUnderstand, turnPhasePlan, turnPhaseExecute, turnPhaseReflect}
	for _, p := range order {
		b := c.phases[p]
		if b == nil {
			continue
		}
		status := b.status
		if cog.Bypass && p == turnPhasePlan && b.stepCount == 0 {
			status = "skipped"
		}
		if b.stepCount == 0 && status == "pending" {
			if p == turnPhaseReflect {
				continue
			}
			if cog.Bypass && p == turnPhasePlan {
				status = "skipped"
			}
		}
		phases = append(phases, map[string]any{
			"phase":     p,
			"label":     turnPhaseLabels[p],
			"status":    status,
			"stepCount": b.stepCount,
		})
	}
	summary := buildTurnSummary(narrative, phases, cog, durationMs)
	out := map[string]any{
		"narrative": narrative,
		"phases":    phases,
		"summary":   summary,
	}
	if len(c.tasks) > 0 {
		out["tasks"] = finalizeTurnTasks(c.tasks)
	}
	return out
}

func finalizeTurnTasks(tasks []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(tasks))
	for _, t := range tasks {
		item := make(map[string]any, len(t)+1)
		for k, v := range t {
			item[k] = v
		}
		switch str(item["status"]) {
		case "pending", "running", "":
			item["status"] = "done"
		}
		out = append(out, item)
	}
	return out
}

func buildTurnSummary(narrative string, phases []map[string]any, cog cognitiveDecision, durationMs int) string {
	parts := []string{"已思考"}
	if durationMs > 0 {
		parts = append(parts, fmt.Sprintf("%ds", (durationMs+999)/1000))
	}
	active := 0
	for _, p := range phases {
		if str(p["status"]) != "skipped" && countFromAny(p["stepCount"]) > 0 {
			active++
		}
	}
	if active > 0 {
		parts = append(parts, fmt.Sprintf("%d 阶段", active))
	}
	if !cog.Bypass && cog.Primary != "" {
		parts = append(parts, cognitiveLabel(cog.Primary))
	} else if narrative == "bypass" {
		parts = append(parts, "直接作答")
	}
	return strings.Join(parts, " · ")
}

// countFromAny coerces numeric values for turn meta snapshots.
func countFromAny(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	default:
		return 0
	}
}

// thought dedup: same phase+title within 2s
var thoughtDedupWindow = 2 * time.Second

type thoughtDedupKey struct {
	phase string
	title string
}

var (
	thoughtDedupMu      sync.Mutex
	thoughtDedupLast    = make(map[thoughtDedupKey]time.Time)
)

func shouldEmitThought(phase, title string) bool {
	key := thoughtDedupKey{phase: phase, title: title}
	now := time.Now()
	// 并发 wecom webhook 会同时调这里，必须加锁保护全局 dedup map。
	thoughtDedupMu.Lock()
	defer thoughtDedupMu.Unlock()
	if last, ok := thoughtDedupLast[key]; ok && now.Sub(last) < thoughtDedupWindow {
		return false
	}
	thoughtDedupLast[key] = now
	return true
}

func emitThoughtPhase(emit reactEmitFunc, kind, phase, title, detail string, extra map[string]any) {
	if emit == nil {
		return
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return
	}
	phase = strings.TrimSpace(phase)
	if phase == "" {
		phase = inferNarrativePhase(kind, title)
	}
	if !shouldEmitThought(phase, title) {
		return
	}
	IncTurnPhaseStep(phase)
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = "analyze"
	}
	payload := map[string]any{
		"type": contract.StreamThought, "kind": kind, "phase": phase, "title": title,
	}
	if d := strings.TrimSpace(detail); d != "" {
		payload["detail"] = d
	}
	for k, v := range extra {
		if v != nil && str(v) != "" {
			payload[k] = v
		}
	}
	emit(contract.StreamThought, "thought", payload)
}

func emitThought(emit reactEmitFunc, kind, phase, title, detail string) {
	emitThoughtPhase(emit, kind, phase, title, detail, nil)
}

func emitTurnTask(emit reactEmitFunc, action, taskID, title, detail string, index, total int) {
	if emit == nil {
		return
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return
	}
	action = strings.TrimSpace(action)
	if action == "" {
		action = "added"
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		taskID = "task_" + action
	}
	payload := map[string]any{
		"type": contract.StreamTask, "action": action,
		"taskId": taskID, "title": title, "status": taskStatusFromAction(action),
	}
	if d := strings.TrimSpace(detail); d != "" {
		payload["detail"] = d
	}
	if index > 0 {
		payload["index"] = index
	}
	if total > 0 {
		payload["total"] = total
	}
	emit(contract.StreamTask, "task", payload)
	IncTurnTaskEvent()
	if action == "added" {
		emitThoughtPhase(emit, "plan", turnPhasePlan, "已添加任务："+truncateRunes(title, 48), detail, map[string]any{
			"taskId": taskID,
		})
	}
}
