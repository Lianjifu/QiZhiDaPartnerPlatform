// Tool classification helpers used by the M02 copilot module. Duplicates
// of helpers in internal/server/ — kept here so copilot never imports
// server/. The originals in server/ continue to exist for the rest of the
// server-side callers (skill_harness.go, runtime_tools.go, cmdb_adapter.go,
// pilotdeck_registry.go).
//
// Names / signatures here MUST match the server originals one-for-one; if
// you change one, change the other.
package copilot

import "strings"

// skillActionOpen mirrors server.skillActionOpen. Drives skill-read vs
// skill-write vs skill-run branch in normalizeSkillAction.
const skillActionOpen = "open"

// normalizeSkillAction maps args.action to a canonical action token. Empty
// string means "auto" (caller infers open vs run from other args). Mirrors
// server.normalizeSkillAction.
func normalizeSkillAction(args map[string]any) string {
	a := strings.ToLower(strings.TrimSpace(str(args["action"])))
	switch a {
	case "open", "read", "inspect", "describe":
		return skillActionOpen
	case "run", "execute", "exec":
		return "run"
	case "write", "write_file", "put":
		return "write"
	case "artifacts", "list_artifacts", "list":
		return "artifacts"
	default:
		return ""
	}
}

// runtimeToolNames is the table of platform-runtime tools (read_file,
// glob, bash, …). Mirrors server.runtimeToolNames.
var runtimeToolNames = map[string]bool{
	"read_file": true, "glob": true, "grep": true, "bash": true, "web_fetch": true,
	"write_file": true, "edit_file": true, "web_search": true, "execute_code": true,
	"edit_notebook": true, "send_attachment": true, "agent": true,
	"task_create": true, "task_list": true, "task_output": true, "task_wait": true, "task_stop": true,
	"list_mcp_resources": true, "read_mcp_resource": true,
}

// isRuntimeTool reports whether name belongs to the platform runtime tool
// set. Mirrors server.isRuntimeTool.
func isRuntimeTool(name string) bool {
	return runtimeToolNames[strings.ToLower(strings.TrimSpace(name))]
}

// isPlatformPilotdeckTool reports whether name is a Pilotdeck-managed
// platform tool (todo_write / ask_user_question / structured_output /
// enter/exit_plan_mode). Mirrors server.isPlatformPilotdeckTool.
func isPlatformPilotdeckTool(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "todo_write", "ask_user_question", "structured_output", "enter_plan_mode", "exit_plan_mode":
		return true
	default:
		return false
	}
}

// isCMDBTool reports whether name matches the CMDB read adapter. Mirrors
// server.isCMDBTool.
func isCMDBTool(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return strings.Contains(n, "cmdb")
}

// pilotdeckToolDef is the row shape in the PilotDeck builtin tool
// alignment registry. Mirrors server.pilotdeckToolDef.
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

// pilotdeckToolRegistry returns the canonical alignment table. Mirrors
// server.pilotdeckToolRegistry; the bodies of the two must stay in sync so
// the /api/tools/pilotdeck endpoint reports the same numbers from both
// code paths (server.go publishes this from server; copilot reads it when
// building tool selection prompts for the model).
func pilotdeckToolRegistry() []pilotdeckToolDef {
	return []pilotdeckToolDef{
		{Name: "time.now", PilotDeckName: "get_current_time", Kind: "platform", Phase: "P0", Mode: toolModeExecute, Description: "当前时间", Status: "ready", PilotDeckSource: "getCurrentTime.ts"},
		{Name: "skill.read", PilotDeckName: "read_skill", Kind: "platform", Phase: "P0", Mode: toolModeExecute, Description: "读取 SKILL.md", Status: "ready", PilotDeckSource: "readSkill.ts"},
		{Name: "read_file", PilotDeckName: "read_file", Kind: "runtime", Phase: "P0", Mode: toolModeExecute, Description: "读文件", Executor: "skill.open", Status: "ready", PilotDeckSource: "readFile.ts"},
		{Name: "glob", PilotDeckName: "glob", Kind: "runtime", Phase: "P0", Mode: toolModeExecute, Description: "列文件", Executor: "skill.open", Status: "ready", PilotDeckSource: "glob.ts"},
		{Name: "grep", PilotDeckName: "grep", Kind: "runtime", Phase: "P0", Mode: toolModeExecute, Description: "搜内容", Executor: "skill.open", Status: "ready", PilotDeckSource: "grep.ts"},
		{Name: "bash", PilotDeckName: "bash", Kind: "runtime", Phase: "P0", Mode: toolModeApproval, Description: "沙箱命令", Executor: "skill.run", Status: "ready", PilotDeckSource: "bash.ts"},
		{Name: "write_file", PilotDeckName: "write_file", Kind: "runtime", Phase: "P1", Mode: toolModeApproval, Description: "写文件", Executor: "skill.write", Status: "ready", PilotDeckSource: "writeFile.ts"},
		{Name: "edit_file", PilotDeckName: "edit_file", Kind: "runtime", Phase: "P1", Mode: toolModeApproval, Description: "Patch 编辑", Executor: "patch", Status: "ready", PilotDeckSource: "editFile.ts"},
		{Name: "web_search", PilotDeckName: "web_search", Kind: "runtime", Phase: "P1", Mode: toolModeExecute, Description: "Web 搜索", Executor: "http", Availability: "opt_in", Status: "ready", PilotDeckSource: "webSearch.ts"},
		{Name: "web_fetch", PilotDeckName: "web_fetch", Kind: "runtime", Phase: "P2", Mode: toolModeExecute, Description: "HTTP GET", Executor: "http", Availability: "opt_in", Status: "ready", PilotDeckSource: "webFetch.ts"},
		{Name: "execute_code", PilotDeckName: "execute_code", Kind: "runtime", Phase: "P2", Mode: toolModeApproval, Description: "代码执行", Executor: "skill.run", Status: "ready", PilotDeckSource: "executeCode.ts"},
		{Name: "edit_notebook", PilotDeckName: "edit_notebook", Kind: "runtime", Phase: "P2", Mode: toolModeApproval, Description: "Notebook 编辑", Executor: "patch", Status: "partial", PilotDeckSource: "editNotebook.ts"},
		{Name: "send_attachment", PilotDeckName: "send_attachment", Kind: "runtime", Phase: "P2", Mode: toolModeExecute, Description: "发送附件", Executor: "attachment", Status: "ready", PilotDeckSource: "sendAttachment.ts"},
		{Name: "todo_write", PilotDeckName: "todo_write", Kind: "platform", Phase: "P2", Mode: toolModeExecute, Description: "Todo 列表", Status: "ready", PilotDeckSource: "todoWrite.ts"},
		{Name: "ask_user_question", PilotDeckName: "ask_user_question", Kind: "platform", Phase: "P2", Mode: toolModeExecute, Description: "向用户提问", Status: "ready", PilotDeckSource: "askUserQuestion.ts"},
		{Name: "structured_output", PilotDeckName: "structured_output", Kind: "platform", Phase: "P2", Mode: toolModeExecute, Description: "JSON 输出", Status: "ready", PilotDeckSource: "structuredOutput.ts"},
		{Name: "enter_plan_mode", PilotDeckName: "enter_plan_mode", Kind: "platform", Phase: "P3", Mode: toolModeExecute, Description: "进入计划模式", Status: "ready", PilotDeckSource: "planMode.ts"},
		{Name: "exit_plan_mode", PilotDeckName: "exit_plan_mode", Kind: "platform", Phase: "P3", Mode: toolModeExecute, Description: "退出计划模式", Status: "ready", PilotDeckSource: "planMode.ts"},
		{Name: "agent", PilotDeckName: "agent", Kind: "runtime", Phase: "P3", Mode: toolModeApproval, Description: "子 Agent", Executor: "agent", Status: "partial", PilotDeckSource: "agent.ts"},
		{Name: "task_create", PilotDeckName: "task_create", Kind: "runtime", Phase: "P3", Mode: toolModeExecute, Description: "创建任务", Executor: "task", Status: "ready", PilotDeckSource: "taskTools.ts"},
		{Name: "task_list", PilotDeckName: "task_list", Kind: "runtime", Phase: "P3", Mode: toolModeExecute, Description: "列出任务", Executor: "task", Status: "ready", PilotDeckSource: "taskTools.ts"},
		{Name: "task_output", PilotDeckName: "task_output", Kind: "runtime", Phase: "P3", Mode: toolModeExecute, Description: "任务输出", Executor: "task", Status: "ready", PilotDeckSource: "taskTools.ts"},
		{Name: "task_wait", PilotDeckName: "task_wait", Kind: "runtime", Phase: "P3", Mode: toolModeExecute, Description: "等待任务", Executor: "task", Status: "partial", PilotDeckSource: "taskTools.ts"},
		{Name: "task_stop", PilotDeckName: "task_stop", Kind: "runtime", Phase: "P3", Mode: toolModeApproval, Description: "停止任务", Executor: "task", Status: "ready", PilotDeckSource: "taskTools.ts"},
		{Name: "list_mcp_resources", PilotDeckName: "list_mcp_resources", Kind: "runtime", Phase: "P3", Mode: toolModeExecute, Description: "MCP 资源列表", Executor: "mcp", Status: "ready", PilotDeckSource: "mcpResources.ts"},
		{Name: "read_mcp_resource", PilotDeckName: "read_mcp_resource", Kind: "runtime", Phase: "P3", Mode: toolModeExecute, Description: "读 MCP 资源", Executor: "mcp", Status: "ready", PilotDeckSource: "mcpResources.ts"},
	}
}
