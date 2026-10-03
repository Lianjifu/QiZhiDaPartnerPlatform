package skills

import (
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
)

// PilotDeck builtin tool alignment registry
type pilotdeckToolDef struct {
	Name             string
	PilotDeckName    string
	Kind             string // platform | runtime
	Phase            string // P0 | P1 | P2 | P3
	Mode             string
	Description      string
	Executor         string
	Availability     string
	Status           string // ready | partial | missing
	PilotDeckSource  string
}

func pilotdeckToolRegistry() []pilotdeckToolDef {
	return []pilotdeckToolDef{
		{Name: "time.now", PilotDeckName: "get_current_time", Kind: "platform", Phase: "P0", Mode: copilot.ToolModeExecute, Description: "当前时间", Status: "ready", PilotDeckSource: "getCurrentTime.ts"},
		{Name: "skill.read", PilotDeckName: "read_skill", Kind: "platform", Phase: "P0", Mode: copilot.ToolModeExecute, Description: "读取 SKILL.md", Status: "ready", PilotDeckSource: "readSkill.ts"},
		{Name: "read_file", PilotDeckName: "read_file", Kind: "runtime", Phase: "P0", Mode: copilot.ToolModeExecute, Description: "读文件", Executor: "skill.open", Status: "ready", PilotDeckSource: "readFile.ts"},
		{Name: "glob", PilotDeckName: "glob", Kind: "runtime", Phase: "P0", Mode: copilot.ToolModeExecute, Description: "列文件", Executor: "skill.open", Status: "ready", PilotDeckSource: "glob.ts"},
		{Name: "grep", PilotDeckName: "grep", Kind: "runtime", Phase: "P0", Mode: copilot.ToolModeExecute, Description: "搜内容", Executor: "skill.open", Status: "ready", PilotDeckSource: "grep.ts"},
		{Name: "bash", PilotDeckName: "bash", Kind: "runtime", Phase: "P0", Mode: copilot.ToolModeApproval, Description: "沙箱命令", Executor: "skill.run", Status: "ready", PilotDeckSource: "bash.ts"},
		{Name: "write_file", PilotDeckName: "write_file", Kind: "runtime", Phase: "P1", Mode: copilot.ToolModeApproval, Description: "写文件", Executor: "skill.write", Status: "ready", PilotDeckSource: "writeFile.ts"},
		{Name: "edit_file", PilotDeckName: "edit_file", Kind: "runtime", Phase: "P1", Mode: copilot.ToolModeApproval, Description: "Patch 编辑", Executor: "patch", Status: "ready", PilotDeckSource: "editFile.ts"},
		{Name: "web_search", PilotDeckName: "web_search", Kind: "runtime", Phase: "P1", Mode: copilot.ToolModeExecute, Description: "Web 搜索", Executor: "http", Availability: "opt_in", Status: "ready", PilotDeckSource: "webSearch.ts"},
		{Name: "web_fetch", PilotDeckName: "web_fetch", Kind: "runtime", Phase: "P2", Mode: copilot.ToolModeExecute, Description: "HTTP GET", Executor: "http", Availability: "opt_in", Status: "ready", PilotDeckSource: "webFetch.ts"},
		{Name: "execute_code", PilotDeckName: "execute_code", Kind: "runtime", Phase: "P2", Mode: copilot.ToolModeApproval, Description: "代码执行", Executor: "skill.run", Status: "ready", PilotDeckSource: "executeCode.ts"},
		{Name: "edit_notebook", PilotDeckName: "edit_notebook", Kind: "runtime", Phase: "P2", Mode: copilot.ToolModeApproval, Description: "Notebook 编辑", Executor: "patch", Status: "partial", PilotDeckSource: "editNotebook.ts"},
		{Name: "send_attachment", PilotDeckName: "send_attachment", Kind: "runtime", Phase: "P2", Mode: copilot.ToolModeExecute, Description: "发送附件", Executor: "attachment", Status: "ready", PilotDeckSource: "sendAttachment.ts"},
		{Name: "todo_write", PilotDeckName: "todo_write", Kind: "platform", Phase: "P2", Mode: copilot.ToolModeExecute, Description: "Todo 列表", Status: "ready", PilotDeckSource: "todoWrite.ts"},
		{Name: "ask_user_question", PilotDeckName: "ask_user_question", Kind: "platform", Phase: "P2", Mode: copilot.ToolModeExecute, Description: "向用户提问", Status: "ready", PilotDeckSource: "askUserQuestion.ts"},
		{Name: "structured_output", PilotDeckName: "structured_output", Kind: "platform", Phase: "P2", Mode: copilot.ToolModeExecute, Description: "JSON 输出", Status: "ready", PilotDeckSource: "structuredOutput.ts"},
		{Name: "enter_plan_mode", PilotDeckName: "enter_plan_mode", Kind: "platform", Phase: "P3", Mode: copilot.ToolModeExecute, Description: "进入计划模式", Status: "ready", PilotDeckSource: "planMode.ts"},
		{Name: "exit_plan_mode", PilotDeckName: "exit_plan_mode", Kind: "platform", Phase: "P3", Mode: copilot.ToolModeExecute, Description: "退出计划模式", Status: "ready", PilotDeckSource: "planMode.ts"},
		{Name: "agent", PilotDeckName: "agent", Kind: "runtime", Phase: "P3", Mode: copilot.ToolModeApproval, Description: "子 Agent", Executor: "agent", Status: "partial", PilotDeckSource: "agent.ts"},
		{Name: "task_create", PilotDeckName: "task_create", Kind: "runtime", Phase: "P3", Mode: copilot.ToolModeExecute, Description: "创建任务", Executor: "task", Status: "ready", PilotDeckSource: "taskTools.ts"},
		{Name: "task_list", PilotDeckName: "task_list", Kind: "runtime", Phase: "P3", Mode: copilot.ToolModeExecute, Description: "列出任务", Executor: "task", Status: "ready", PilotDeckSource: "taskTools.ts"},
		{Name: "task_output", PilotDeckName: "task_output", Kind: "runtime", Phase: "P3", Mode: copilot.ToolModeExecute, Description: "任务输出", Executor: "task", Status: "ready", PilotDeckSource: "taskTools.ts"},
		{Name: "task_wait", PilotDeckName: "task_wait", Kind: "runtime", Phase: "P3", Mode: copilot.ToolModeExecute, Description: "等待任务", Executor: "task", Status: "partial", PilotDeckSource: "taskTools.ts"},
		{Name: "task_stop", PilotDeckName: "task_stop", Kind: "runtime", Phase: "P3", Mode: copilot.ToolModeApproval, Description: "停止任务", Executor: "task", Status: "ready", PilotDeckSource: "taskTools.ts"},
		{Name: "list_mcp_resources", PilotDeckName: "list_mcp_resources", Kind: "runtime", Phase: "P3", Mode: copilot.ToolModeExecute, Description: "MCP 资源列表", Executor: "mcp", Status: "ready", PilotDeckSource: "mcpResources.ts"},
		{Name: "read_mcp_resource", PilotDeckName: "read_mcp_resource", Kind: "runtime", Phase: "P3", Mode: copilot.ToolModeExecute, Description: "读 MCP 资源", Executor: "mcp", Status: "ready", PilotDeckSource: "mcpResources.ts"},
	}
}

func pilotdeckToolNamesSet() map[string]bool {
	out := map[string]bool{}
	for _, t := range pilotdeckToolRegistry() {
		out[t.Name] = true
		out[t.PilotDeckName] = true
	}
	return out
}

func isPilotdeckAlignedTool(name string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	// Treat built-in skill kinds as aligned (the original isRuntimeTool
	// check in internal/server took a *RegisteredTool; we only need a
	// string-name check here, so duplicate the heuristic inline).
	if name == "skill" || name == "tool" || name == "runtime" {
		return true
	}
	set := pilotdeckToolNamesSet()
	return set[name]
}

func alignmentScore() map[string]any {
	reg := pilotdeckToolRegistry()
	ready, partial, missing := 0, 0, 0
	for _, t := range reg {
		switch t.Status {
		case "ready":
			ready++
		case "partial":
			partial++
		default:
			missing++
		}
	}
	return map[string]any{
		"ready": ready, "partial": partial, "missing": missing, "total": len(reg),
	}
}

func pilotdeckToolsForAPI() []map[string]any {
	out := make([]map[string]any, 0, len(pilotdeckToolRegistry()))
	for _, t := range pilotdeckToolRegistry() {
		out = append(out, map[string]any{
			"name": t.Name, "pilotdeckName": t.PilotDeckName, "kind": t.Kind,
			"phase": t.Phase, "mode": t.Mode, "description": t.Description,
			"executor": t.Executor, "availability": t.Availability,
			"status": t.Status, "pilotdeckSource": t.PilotDeckSource,
		})
	}
	return out
}
