package server

import (
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

const (
	sessionModeInvestigate = contract.SessionModeInvestigate
	sessionModeExecute     = contract.SessionModeExecute
)

func normalizeSessionMode(v string) string {
	return contract.ParseSessionMode(v)
}

func normalizeRiskLevelSession(v string) string {
	return contract.ParseRiskLevel(v)
}

// normalizeRunMode accepts product-layer modes: ask | plan | agent.
func normalizeRunMode(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "ask", "plan", "agent":
		return strings.ToLower(strings.TrimSpace(v))
	default:
		return ""
	}
}

// resolveRunMode prefers explicit product runMode; falls back from ABI sessionMode.
func resolveRunMode(bodyRun, sessRun, sessionMode string) string {
	if rm := normalizeRunMode(bodyRun); rm != "" {
		return rm
	}
	if rm := normalizeRunMode(sessRun); rm != "" {
		return rm
	}
	if sessionMode == sessionModeExecute {
		return "agent"
	}
	return "plan"
}

// runModePromptClause injects product-facing mode language into the system prompt.
// ABI remains investigate|execute; model-visible copy must match 问答/方案/执行.
func runModePromptClause(runMode string) string {
	switch normalizeRunMode(runMode) {
	case "ask":
		return "\n当前会话为「问答」模式：只回答与解释，禁止宣称已执行写操作或调用写类工具；需要变更时提示用户切换到「方案」或「执行」。对外说明时使用「问答」，不要说「研判模式」。"
	case "agent":
		return "\n当前会话为「执行」模式：可调用工具推进任务；写类 skill.run/write 将进入人工审核队列；仅当工具观察为 pending_authorization 时可告知已进入审核；未获批准前不得声称执行成功或已生成文件。needs_instruction 表示尚未真正执行脚本。对外说明时使用「执行」，不要说「受控执行模式」或「研判模式」。"
	default: // plan
		return "\n当前会话为「方案」模式：先给出可执行计划与风险说明，禁止宣称已完成写操作；技能仅可只读查阅；需要落盘变更时提示用户切换到「执行」并经人工审核。对外说明时使用「方案」，不要说「研判模式」。"
	}
}

func sessionHandoffActive(sess map[string]any) bool {
	if sess == nil {
		return false
	}
	if h, ok := sess["handoff"].(map[string]any); ok {
		return boolFrom(h["active"])
	}
	return boolFrom(sess["handoffActive"])
}

func findSessionForStreamLocked(sessions []map[string]any, ws, rawID, cid string) map[string]any {
	for _, sess := range sessions {
		if str(sess["workspaceId"]) != ws {
			continue
		}
		if str(sess["id"]) == rawID || str(sess["conversationId"]) == cid || str(sess["id"]) == cid {
			return sess
		}
	}
	return nil
}

func sessionOwnerReadable(id *auth.Identity, sess map[string]any) bool {
	if id == nil || sess == nil {
		return false
	}
	if id.Role == "admin" || id.Role == "auditor" {
		return true
	}
	owner := str(sess["ownerId"])
	return owner == "" || owner == id.ID
}

// assertSessionWritableLocked rejects stream when closed or handed off.
func assertSessionWritableLocked(sess map[string]any) error {
	if sess == nil {
		return nil
	}
	st := str(sess["status"])
	if st == "closed" {
		return apperr.Forbidden(apperr.SessionClosed, "会话已结案，仅可查看")
	}
	if sessionHandoffActive(sess) {
		owner := ""
		if h, ok := sess["handoff"].(map[string]any); ok {
			owner = coalesce(str(h["ownerName"]), str(h["ownerId"]))
		}
		msg := "会话处于人工交接中，写操作已暂停"
		if owner != "" {
			msg += "（接管人：" + owner + "）"
		}
		return apperr.Forbidden(apperr.SessionHandoff, msg)
	}
	return nil
}

func applySessionGovernancePatch(sess map[string]any, body map[string]any, actor *auth.Identity, now string) {
	if v, ok := body["sessionMode"]; ok {
		mode := normalizeSessionMode(str(v))
		sess["sessionMode"] = mode
	}
	if v, ok := body["runMode"]; ok {
		rm := strings.ToLower(strings.TrimSpace(str(v)))
		switch rm {
		case "ask", "plan", "agent":
			sess["runMode"] = rm
		}
	}
	if v, ok := body["reasoningEffort"]; ok {
		re := strings.ToLower(strings.TrimSpace(str(v)))
		switch re {
		case "off", "standard", "deep":
			sess["reasoningEffort"] = re
		}
	}
	if v, ok := body["riskLevel"]; ok {
		sess["riskLevel"] = normalizeRiskLevelSession(str(v))
	}
	if v, ok := body["handoff"]; ok {
		if m, ok := v.(map[string]any); ok {
			active := boolFrom(m["active"])
			h := map[string]any{
				"active":    active,
				"ownerId":   str(m["ownerId"]),
				"ownerName": coalesce(str(m["ownerName"]), str(m["owner"])),
				"note":      str(m["note"]),
			}
			if active {
				h["at"] = coalesce(str(m["at"]), now)
			}
			sess["handoff"] = h
		}
	}
	if v, ok := body["handoffActive"]; ok {
		active := boolFrom(v)
		h, _ := sess["handoff"].(map[string]any)
		if h == nil {
			h = map[string]any{}
		}
		h["active"] = active
		if active {
			h["ownerName"] = coalesce(str(body["handoffOwner"]), coalesce(str(h["ownerName"]), "值班负责人"))
			h["at"] = now
		}
		sess["handoff"] = h
	}
	if v, ok := body["status"]; ok {
		st := strings.TrimSpace(str(v))
		if st == "done" {
			st = "closed"
		}
		switch st {
		case "active", "archived", "closed":
			prev := str(sess["status"])
			sess["status"] = st
			if st == "closed" && prev != "closed" {
				sess["closedAt"] = now
				if actor != nil {
					sess["closedBy"] = actor.ID
					sess["closedByName"] = actor.Name
				}
				if summary := strings.TrimSpace(str(body["closeSummary"])); summary != "" {
					sess["closeSummary"] = summary
				}
			}
		}
	}
	if v, ok := body["closeSummary"]; ok {
		if t := strings.TrimSpace(str(v)); t != "" {
			sess["closeSummary"] = t
		}
	}
}

func filterRegistryBySessionMode(reg []registeredTool, mode string) []registeredTool {
	mode = normalizeSessionMode(mode)
	if mode == sessionModeExecute {
		return reg
	}
	out := make([]registeredTool, 0, len(reg))
	for _, t := range reg {
		// Capture operator intent BEFORE we touch the Enabled flag, otherwise
		// we can't distinguish "disabled because RequiresApproval" from
		// "disabled because operator unchecked this in enabledTools". The
		// allowlist branch below may only re-enable the former, never the
		// latter — the old code unconditionally flipped Enabled=true.
		operatorEnabled := t.Enabled
		if t.RequiresApproval || t.Mode == toolModeApproval {
			t.Enabled = false
		}
		// investigate: keep builtins + recommend/execute non-approval skills
		if t.Kind == "skill" && t.RequiresApproval {
			if isAllowlistedExecutableTool(t.Name, t.Kind) && operatorEnabled {
				t.Enabled = true
				out = append(out, t)
			}
			continue
		}
		out = append(out, t)
	}
	return out
}

func defaultGovernanceOnCreate(session map[string]any) {
	if str(session["sessionMode"]) == "" {
		session["sessionMode"] = sessionModeInvestigate
	}
	if str(session["runMode"]) == "" {
		session["runMode"] = "plan"
	}
	if str(session["reasoningEffort"]) == "" {
		session["reasoningEffort"] = "standard"
	}
	if str(session["riskLevel"]) == "" {
		session["riskLevel"] = "medium"
	}
	if session["handoff"] == nil {
		session["handoff"] = map[string]any{"active": false}
	}
}

func governanceAuditDetail(sess map[string]any) string {
	return "mode=" + coalesce(str(sess["sessionMode"]), sessionModeInvestigate) +
		" risk=" + coalesce(str(sess["riskLevel"]), "medium") +
		" status=" + coalesce(str(sess["status"]), "active")
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
