// copilot_contracts.go —— 数字伙伴的「能力契约」(Capability Contract)。
//
// 产品语义:伙伴装的不再只是"一个能力名字",而是一份可校验的契约 ——
// 它要什么参数、给什么产物、是否需要审批、执行模式是什么。
//
// 这份契约同时喂饱三件事:
//   - P3 原生 tool_use:契约直接转成下发给模型的 JSON Schema
//   - P7 轨迹评估:契约是断言与回归的基准
//   - M05 伙伴详情页:装配了什么能力、各自要什么参数,一眼可见
//
// 与普通 agent 框架把 tool schema 当实现细节不同,在这套系统里契约是
// 岗位交付物的一部分:它随配置版本走审批,并成为上岗闸门的判据。
package copilot

import (
	"fmt"
	"sort"
	"strings"
)

// CapabilityContract 描述一个数字伙伴能力的调用契约。
type CapabilityContract struct {
	// Name 是能力名(与 registeredTool.Name 一致)。
	Name string
	// Kind 是 builtin | tool | skill | workflow | platform。
	Kind string
	// Description 是给人和模型看的用途说明。
	Description string
	// InputSchema 是 JSON Schema 子集(object/properties/required)。
	InputSchema map[string]any
	// Mode 是 execute | recommend | approval_required | prohibited。
	Mode string
	// Artifacts 是该能力可能产出的产物类型(docx / pptx / svg / json …)。
	Artifacts []string
	// Approval 表示执行前是否需要人工授权。
	Approval bool
}

// argSpec 描述契约里的一个参数。
type argSpec struct {
	Type        string
	Description string
	Required    bool
	Enum        []string
	// Aliases 是历史实现里等价的其他参数名(执行器仍兼容这些别名)。
	Aliases []string
}

func (a argSpec) schema() map[string]any {
	m := map[string]any{"type": a.Type}
	if a.Description != "" {
		m["description"] = a.Description
	}
	if len(a.Enum) > 0 {
		m["enum"] = stringsToAny(a.Enum)
	}
	if len(a.Aliases) > 0 {
		m["aliases"] = stringsToAny(a.Aliases)
	}
	return m
}

// stringsToAny 把字符串切片转成 any 切片(供 JSON Schema 装配)。
func stringsToAny(in []string) []any {
	out := make([]any, 0, len(in))
	for _, v := range in {
		out = append(out, v)
	}
	return out
}

// objectSchema 把参数表装配成 JSON Schema。
func objectSchema(specs map[string]argSpec) map[string]any {
	props := map[string]any{}
	var required []any
	for name, spec := range specs {
		props[name] = spec.schema()
		if spec.Required {
			required = append(required, name)
		}
	}
	sort.Slice(required, func(i, j int) bool {
		return required[i].(string) < required[j].(string)
	})
	out := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		out["required"] = required
	}
	return out
}

// capabilityContracts 是内置能力与平台工具的契约表。
//
// 键是能力名;工具在注册表里可能带 "builtin:" / "tool:" 前缀,查表时会归一化。
var capabilityContracts = map[string]CapabilityContract{}

func registerContract(c CapabilityContract) {
	capabilityContracts[c.Name] = c
}

func init() {
	// --- 内置检索类 -------------------------------------------------------
	registerContract(CapabilityContract{
		Name: "knowledge.retrieve", Kind: "builtin", Mode: toolModeExecute,
		Description: "检索已发布知识库,返回相关片段",
		InputSchema: objectSchema(map[string]argSpec{
			"query": {Type: "string", Description: "检索词或问题(留空则用当前提问)"},
		}),
	})
	registerContract(CapabilityContract{
		Name: "memory.recall", Kind: "builtin", Mode: toolModeExecute,
		Description: "检索跨会话工作/长期记忆",
		InputSchema: objectSchema(map[string]argSpec{
			"query": {Type: "string", Description: "要回忆的内容(留空则用当前提问)"},
		}),
	})
	registerContract(CapabilityContract{
		Name: "skill.read", Kind: "builtin", Mode: toolModeExecute,
		Description: "加载已装配技能的 SKILL.md 全文",
		InputSchema: objectSchema(map[string]argSpec{
			"skillId": {Type: "string", Description: "技能 ID 或名称"},
		}),
	})
	registerContract(CapabilityContract{
		Name: "artifact.read", Kind: "builtin", Mode: toolModeExecute,
		Description: "取回此前被卸载的大结果正文(按 artifact id)",
		InputSchema: objectSchema(map[string]argSpec{
			"id": {Type: "string", Description: "产物 ID", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "time.now", Kind: "builtin", Mode: toolModeExecute,
		Description: "返回当前时间(ISO8601)",
		InputSchema: objectSchema(map[string]argSpec{}),
	})

	// --- 受控 shell -------------------------------------------------------
	registerContract(CapabilityContract{
		Name: "shell.read_file", Kind: "tool", Mode: toolModeExecute,
		Description: "读取白名单内单个文件(≤256KB)",
		InputSchema: objectSchema(map[string]argSpec{
			"path": {Type: "string", Description: "文件路径", Required: true, Aliases: []string{"file", "filename"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "shell.write_file", Kind: "tool", Mode: toolModeExecute,
		Description: "写入 / 覆盖白名单内文件(≤256KB)",
		InputSchema: objectSchema(map[string]argSpec{
			"path":    {Type: "string", Description: "文件路径", Required: true, Aliases: []string{"file", "filename"}},
			"content": {Type: "string", Description: "写入内容", Required: true, Aliases: []string{"input"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "shell.edit_file", Kind: "tool", Mode: toolModeExecute,
		Description: "按 search-replace 原子编辑文件(全文唯一匹配)",
		InputSchema: objectSchema(map[string]argSpec{
			"path":       {Type: "string", Description: "文件路径", Required: true, Aliases: []string{"file", "filename"}},
			"old_string": {Type: "string", Description: "被替换的原文", Required: true},
			"new_string": {Type: "string", Description: "替换后的新文", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "shell.search_files", Kind: "tool", Mode: toolModeExecute,
		Description: "文件搜索(pattern / glob / 上下文)",
		InputSchema: objectSchema(map[string]argSpec{
			"pattern": {Type: "string", Description: "搜索模式或 glob", Required: true, Aliases: []string{"query", "regex"}},
			"path":    {Type: "string", Description: "限定搜索目录", Aliases: []string{"dir", "root"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "shell.list_dir", Kind: "tool", Mode: toolModeExecute,
		Description: "浅列白名单内目录(深度 ≤3)",
		InputSchema: objectSchema(map[string]argSpec{
			"path": {Type: "string", Description: "目录路径", Aliases: []string{"dir"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "shell.exec", Kind: "tool", Mode: toolModeExecute,
		Description: "执行只读 / 受控白名单命令(2s 超时 + 64KB 输出上限 + audit 留痕)",
		InputSchema: objectSchema(map[string]argSpec{
			"command": {Type: "string", Description: "要执行的命令", Required: true, Aliases: []string{"cmd"}},
		}),
	})

	// --- 渲染 / Web / MCP --------------------------------------------------
	registerContract(CapabilityContract{
		Name: "chart.generate", Kind: "tool", Mode: toolModeExecute,
		Description: "渲染结构化数据为 SVG 图表(bar/line/pie/table)",
		Artifacts:   []string{"svg", "png"},
		InputSchema: objectSchema(map[string]argSpec{
			"schema": {Type: "string", Description: "图表类型:bar/line/pie/table", Required: true},
			"data":   {Type: "object", Description: "图表数据", Required: true, Aliases: []string{"output", "payload"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web.fetch", Kind: "tool", Mode: toolModeExecute,
		Description: "HTTP GET + 解析(text/json),2s 超时 + 1MB 上限 + 域名白名单",
		InputSchema: objectSchema(map[string]argSpec{
			"url": {Type: "string", Description: "目标 URL", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web.browse", Kind: "tool", Mode: toolModeExecute,
		Description: "Chrome headless 渲染 URL → 提取 text / title / screenshot",
		Artifacts:   []string{"png"},
		InputSchema: objectSchema(map[string]argSpec{
			"url": {Type: "string", Description: "目标 URL", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web.fill", Kind: "tool", Mode: toolModeExecute,
		Description: "在指定 selector 输入框 fill(clear + set)",
		InputSchema: objectSchema(map[string]argSpec{
			"url":      {Type: "string", Description: "目标 URL(留空则用当前页面)"},
			"selector": {Type: "string", Description: "CSS selector", Required: true},
			"value":    {Type: "string", Description: "填入的值", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web.type", Kind: "tool", Mode: toolModeExecute,
		Description: "在指定 selector 输入框 fill value(不清空)",
		InputSchema: objectSchema(map[string]argSpec{
			"url":      {Type: "string", Description: "目标 URL(留空则用当前页面)"},
			"selector": {Type: "string", Description: "CSS selector", Required: true},
			"value":    {Type: "string", Description: "键入的值", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web.click", Kind: "tool", Mode: toolModeExecute,
		Description: "点击 selector 元素(3s 超时)",
		InputSchema: objectSchema(map[string]argSpec{
			"url":      {Type: "string", Description: "目标 URL(留空则用当前页面)"},
			"selector": {Type: "string", Description: "CSS selector", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web.eval", Kind: "tool", Mode: toolModeExecute,
		Description: "在当前页面 evaluate 任意 JS,返回序列化结果",
		InputSchema: objectSchema(map[string]argSpec{
			"url": {Type: "string", Description: "目标 URL(留空则用当前页面)"},
			"js":  {Type: "string", Description: "要执行的 JS 表达式", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web.close", Kind: "tool", Mode: toolModeExecute,
		Description: "关闭浏览器实例(释放内存)",
		InputSchema: objectSchema(map[string]argSpec{}),
	})
	registerContract(CapabilityContract{
		Name: "mcp.list_servers", Kind: "tool", Mode: toolModeExecute,
		Description: "列出已挂载 MCP server 及其 tools",
		InputSchema: objectSchema(map[string]argSpec{}),
	})
	registerContract(CapabilityContract{
		Name: "mcp.call_tool", Kind: "tool", Mode: toolModeExecute,
		Description: "在指定 MCP server 上调用 tool",
		InputSchema: objectSchema(map[string]argSpec{
			"server": {Type: "string", Description: "MCP server 名", Required: true},
			"tool":   {Type: "string", Description: "server 上的 tool 名", Required: true},
			"args":   {Type: "string", Description: "传给 tool 的参数(JSON 字符串)"},
		}),
	})

	// --- 平台工具(Pilotdeck) ----------------------------------------------
	registerContract(CapabilityContract{
		Name: "todo_write", Kind: "platform", Mode: toolModeExecute,
		Description: "写入 / 更新当前会话的待办清单",
		InputSchema: objectSchema(map[string]argSpec{
			"todos":   {Type: "array", Description: "待办条目数组(content/status)"},
			"content": {Type: "string", Description: "单条待办内容"},
			"merge":   {Type: "boolean", Description: "是否与现有待办合并(默认合并)"},
		}),
	})
	registerContract(CapabilityContract{
		Name: "ask_user_question", Kind: "platform", Mode: toolModeExecute,
		Description: "向用户提问以澄清意图",
		InputSchema: objectSchema(map[string]argSpec{
			"question": {Type: "string", Description: "要问的问题", Required: true, Aliases: []string{"query"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "structured_output", Kind: "platform", Mode: toolModeExecute,
		Description: "以结构化 JSON 输出最终结果",
		InputSchema: objectSchema(map[string]argSpec{
			"schema": {Type: "string", Description: "输出结构说明"},
			"data":   {Type: "object", Description: "结构化数据", Required: true, Aliases: []string{"output", "payload"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "execute_code", Kind: "platform", Mode: toolModeApproval, Approval: true,
		Description: "在受控沙箱里执行一段代码",
		InputSchema: objectSchema(map[string]argSpec{
			"code":     {Type: "string", Description: "要执行的代码", Required: true, Aliases: []string{"command"}},
			"language": {Type: "string", Description: "语言:python / bash", Enum: []string{"python", "python3", "bash", "sh"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "send_attachment", Kind: "platform", Mode: toolModeExecute,
		Description: "向用户发送产物附件",
		Artifacts:   []string{"docx", "pptx", "pdf", "xlsx", "svg", "png"},
		InputSchema: objectSchema(map[string]argSpec{
			"path": {Type: "string", Description: "产物路径或 URL", Required: true, Aliases: []string{"url", "filename"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "agent", Kind: "platform", Mode: toolModeApproval, Approval: true,
		Description: "派生一个子智能体执行子任务(受 delegationPolicy 白名单约束)",
		InputSchema: objectSchema(map[string]argSpec{
			"task":   {Type: "string", Description: "子任务描述", Required: true, Aliases: []string{"prompt"}},
			"target": {Type: "string", Description: "目标子伙伴 ID"},
		}),
	})
	registerContract(CapabilityContract{
		Name: "task_create", Kind: "platform", Mode: toolModeExecute,
		Description: "创建一条受控任务",
		InputSchema: objectSchema(map[string]argSpec{
			"title": {Type: "string", Description: "任务标题", Required: true, Aliases: []string{"name"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "task_list", Kind: "platform", Mode: toolModeExecute,
		Description: "列出当前工作区的任务",
		InputSchema: objectSchema(map[string]argSpec{}),
	})
	registerContract(CapabilityContract{
		Name: "task_output", Kind: "platform", Mode: toolModeExecute,
		Description: "读取任务输出",
		InputSchema: objectSchema(map[string]argSpec{
			"task_id": {Type: "string", Description: "任务 ID", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "task_wait", Kind: "platform", Mode: toolModeExecute,
		Description: "等待任务结束",
		InputSchema: objectSchema(map[string]argSpec{
			"task_id": {Type: "string", Description: "任务 ID", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "task_stop", Kind: "platform", Mode: toolModeApproval, Approval: true,
		Description: "停止正在运行的任务",
		InputSchema: objectSchema(map[string]argSpec{
			"task_id": {Type: "string", Description: "任务 ID", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "enter_plan_mode", Kind: "platform", Mode: toolModeExecute,
		Description: "切换到方案(计划)模式",
		InputSchema: objectSchema(map[string]argSpec{}),
	})
	registerContract(CapabilityContract{
		Name: "exit_plan_mode", Kind: "platform", Mode: toolModeExecute,
		Description: "退出方案(计划)模式",
		InputSchema: objectSchema(map[string]argSpec{}),
	})
	registerContract(CapabilityContract{
		Name: "read_file", Kind: "platform", Mode: toolModeExecute,
		Description: "读取工作区文件",
		InputSchema: objectSchema(map[string]argSpec{
			"path": {Type: "string", Description: "文件路径", Required: true, Aliases: []string{"file", "filename"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "glob", Kind: "platform", Mode: toolModeExecute,
		Description: "按 glob 列出文件",
		InputSchema: objectSchema(map[string]argSpec{
			"pattern": {Type: "string", Description: "glob 模式", Required: true, Aliases: []string{"query"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "grep", Kind: "platform", Mode: toolModeExecute,
		Description: "按模式搜索文件内容",
		InputSchema: objectSchema(map[string]argSpec{
			"pattern": {Type: "string", Description: "搜索模式", Required: true, Aliases: []string{"query"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "bash", Kind: "platform", Mode: toolModeApproval, Approval: true,
		Description: "在沙箱里执行命令",
		InputSchema: objectSchema(map[string]argSpec{
			"command": {Type: "string", Description: "命令", Required: true, Aliases: []string{"cmd"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "write_file", Kind: "platform", Mode: toolModeApproval, Approval: true,
		Description: "写入工作区文件",
		InputSchema: objectSchema(map[string]argSpec{
			"path":    {Type: "string", Description: "文件路径", Required: true, Aliases: []string{"file", "filename"}},
			"content": {Type: "string", Description: "写入内容", Required: true, Aliases: []string{"input"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "edit_file", Kind: "platform", Mode: toolModeApproval, Approval: true,
		Description: "按 search-replace 编辑文件",
		InputSchema: objectSchema(map[string]argSpec{
			"path":       {Type: "string", Description: "文件路径", Required: true, Aliases: []string{"file", "filename"}},
			"old_string": {Type: "string", Description: "被替换的原文", Required: true},
			"new_string": {Type: "string", Description: "替换后的新文", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web_search", Kind: "platform", Mode: toolModeExecute,
		Description: "Web 搜索",
		InputSchema: objectSchema(map[string]argSpec{
			"query": {Type: "string", Description: "搜索词", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "web_fetch", Kind: "platform", Mode: toolModeExecute,
		Description: "抓取 URL 内容",
		InputSchema: objectSchema(map[string]argSpec{
			"url": {Type: "string", Description: "目标 URL", Required: true},
		}),
	})
	registerContract(CapabilityContract{
		Name: "edit_notebook", Kind: "platform", Mode: toolModeApproval, Approval: true,
		Description: "编辑 Notebook",
		InputSchema: objectSchema(map[string]argSpec{
			"path": {Type: "string", Description: "Notebook 路径", Required: true, Aliases: []string{"file", "filename"}},
		}),
	})
	registerContract(CapabilityContract{
		Name: "list_mcp_resources", Kind: "platform", Mode: toolModeExecute,
		Description: "列出 MCP 资源",
		InputSchema: objectSchema(map[string]argSpec{}),
	})
	registerContract(CapabilityContract{
		Name: "read_mcp_resource", Kind: "platform", Mode: toolModeExecute,
		Description: "读取 MCP 资源",
		InputSchema: objectSchema(map[string]argSpec{
			"uri": {Type: "string", Description: "资源 URI", Required: true, Aliases: []string{"resource"}},
		}),
	})
}

// skillContractTemplate 是技能 / 工作流类能力的通用契约。
//
// 技能的具体入参由 SKILL.md 决定,平台无法静态获知,因此契约声明
// 「动作原语 + 自由参数」的结构,并明确它比具体契约宽松。
func genericContract(kind, name, description string) CapabilityContract {
	specs := map[string]argSpec{
		"action": {Type: "string", Description: "动作原语", Enum: []string{"open", "write", "run", "artifacts"}},
	}
	switch kind {
	case "skill":
		specs["skillId"] = argSpec{Type: "string", Description: "技能 ID 或名称"}
		specs["command"] = argSpec{Type: "string", Description: "要执行的脚本命令", Aliases: []string{"cmd"}}
		specs["path"] = argSpec{Type: "string", Description: "工作区文件路径", Aliases: []string{"file", "filename"}}
		specs["content"] = argSpec{Type: "string", Description: "写入内容", Aliases: []string{"input"}}
	case "workflow":
		specs["input"] = argSpec{Type: "string", Description: "流程入参", Aliases: []string{"content", "query"}}
	}
	return CapabilityContract{
		Name:        name,
		Kind:        kind,
		Description: description,
		Mode:        toolModeRecommend,
		InputSchema: objectSchema(specs),
	}
}

// lookupContract 按能力名查契约(容忍 "builtin:" / "tool:" 前缀)。
func lookupContract(name string) (CapabilityContract, bool) {
	n := strings.TrimSpace(name)
	if n == "" {
		return CapabilityContract{}, false
	}
	if c, ok := capabilityContracts[n]; ok {
		return c, true
	}
	if i := strings.Index(n, ":"); i > 0 {
		if c, ok := capabilityContracts[n[i+1:]]; ok {
			return c, true
		}
	}
	return CapabilityContract{}, false
}

// contractForTool 为注册表里的工具补上契约。
//
// 已内置的具体契约优先;skill / workflow 这类动态能力退化为通用契约
// (仍然是"有契约",只是入参宽松)。
func contractForTool(t registeredTool) CapabilityContract {
	if c, ok := lookupContract(t.Name); ok {
		if c.Mode == "" {
			c.Mode = t.Mode
		}
		if c.Approval == false && t.RequiresApproval {
			c.Approval = true
		}
		return c
	}
	switch t.Kind {
	case "skill", "workflow":
		return genericContract(t.Kind, t.Name, t.Description)
	}
	return CapabilityContract{
		Name:        t.Name,
		Kind:        t.Kind,
		Description: t.Description,
		Mode:        t.Mode,
		InputSchema: objectSchema(map[string]argSpec{}),
	}
}

// contractArgSpec 取出契约里某个参数的规格(含别名)。
func contractArgSpec(c CapabilityContract, name string) (argSpec, bool) {
	props, _ := c.InputSchema["properties"].(map[string]any)
	if props == nil {
		return argSpec{}, false
	}
	raw, ok := props[name].(map[string]any)
	if !ok {
		return argSpec{}, false
	}
	spec := argSpec{Type: "string"}
	if t, _ := raw["type"].(string); t != "" {
		spec.Type = t
	}
	spec.Description, _ = raw["description"].(string)
	spec.Aliases = stringSlice(raw["aliases"])
	if enum := stringSlice(raw["enum"]); len(enum) > 0 {
		spec.Enum = enum
	}
	return spec, true
}

// contractRequiredArgs 列出契约里声明为必填的参数。
func contractRequiredArgs(c CapabilityContract) []string {
	raw := stringSlice(c.InputSchema["required"])
	return raw
}

// ValidateContractArgs 校验工具调用参数是否符合能力契约。
//
// 校验失败时不执行工具,而是把错误回灌给模型让它自纠 —— 这比执行出一个
// 诡异结果再让模型猜要可靠得多。
//
// 返回空字符串表示校验通过。
func ValidateContractArgs(c CapabilityContract, args map[string]any) string {
	if c.InputSchema == nil {
		return ""
	}
	props, _ := c.InputSchema["properties"].(map[string]any)
	if props == nil {
		return ""
	}
	if args == nil {
		args = map[string]any{}
	}
	for _, required := range contractRequiredArgs(c) {
		spec, ok := contractArgSpec(c, required)
		if !ok {
			continue
		}
		found := false
		for _, key := range append([]string{required}, spec.Aliases...) {
			if v, ok := args[key]; ok && !isEmptyArgValue(v) {
				found = true
				break
			}
		}
		if !found {
			return fmt.Sprintf("参数 %q 缺失(契约要求:%s)", required, c.Name)
		}
	}
	// 类型 / 枚举校验:只看模型明确给出的字段,不额外要求。
	for name, spec := range specsFromSchema(c) {
		v, ok := args[name]
		if !ok {
			continue
		}
		if isEmptyArgValue(v) {
			continue
		}
		if len(spec.Enum) > 0 {
			s := strings.ToLower(strings.TrimSpace(toStringArg(v)))
			match := false
			for _, e := range spec.Enum {
				if strings.EqualFold(e, s) {
					match = true
					break
				}
			}
			if !match {
				return fmt.Sprintf("参数 %q 取值 %q 不在允许范围(%s)", name, toStringArg(v), strings.Join(spec.Enum, "/"))
			}
		}
		switch spec.Type {
		case "object":
			if _, ok := v.(map[string]any); !ok {
				return fmt.Sprintf("参数 %q 应为对象", name)
			}
		case "array":
			if _, ok := v.([]any); !ok {
				return fmt.Sprintf("参数 %q 应为数组", name)
			}
		case "string":
			if _, ok := v.(string); !ok {
				return fmt.Sprintf("参数 %q 应为字符串", name)
			}
		case "boolean":
			if _, ok := v.(bool); !ok {
				return fmt.Sprintf("参数 %q 应为布尔值", name)
			}
		}
	}
	return ""
}

// specsFromSchema 把契约 schema 还原成参数规格表。
func specsFromSchema(c CapabilityContract) map[string]argSpec {
	out := map[string]argSpec{}
	props, _ := c.InputSchema["properties"].(map[string]any)
	for name := range props {
		if spec, ok := contractArgSpec(c, name); ok {
			out[name] = spec
		}
	}
	return out
}

func isEmptyArgValue(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(t) == ""
	case []any:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	}
	return false
}

func toStringArg(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%.2f", t), "0"), ".")
	case bool:
		if t {
			return "true"
		}
		return "false"
	}
	return fmt.Sprintf("%v", v)
}

// contractSummary 把契约转成可序列化的投影(伙伴详情页 / 配置版本用)。
func contractSummary(c CapabilityContract) map[string]any {
	out := map[string]any{
		"name":        c.Name,
		"kind":        c.Kind,
		"description": c.Description,
		"mode":        c.Mode,
		"approval":    c.Approval,
	}
	if len(c.Artifacts) > 0 {
		out["artifacts"] = c.Artifacts
	}
	if c.InputSchema != nil {
		out["inputSchema"] = c.InputSchema
		if req := contractRequiredArgs(c); len(req) > 0 {
			out["required"] = req
		}
	}
	return out
}

// EmployeeCapabilityContracts 返回伙伴已装配能力的契约列表。
//
// 覆盖 capabilities.tools / skills / workflows 三类:工具用具体契约,
// 技能与工作流用通用契约(入参由 SKILL.md / 流程定义决定)。
func EmployeeCapabilityContracts(emp map[string]any) []map[string]any {
	if emp == nil {
		return nil
	}
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return nil
	}
	out := []map[string]any{}
	seen := map[string]bool{}
	add := func(kind string, names []string) {
		for _, raw := range names {
			name := strings.TrimSpace(raw)
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			var c CapabilityContract
			if kind == "tool" {
				if concrete, ok := lookupContract(name); ok {
					c = concrete
				} else {
					c = CapabilityContract{Name: name, Kind: kind, Description: "已装配工具 · " + name,
						InputSchema: objectSchema(map[string]argSpec{})}
				}
			} else {
				c = genericContract(kind, name, "已装配"+kind+" · "+name)
			}
			if mode := capabilityMode(emp, kind, name); mode != "" {
				c.Mode = mode
			}
			c.Approval = c.Approval || c.Mode == toolModeApproval
			out = append(out, contractSummary(c))
		}
	}
	add("tool", stringSlice(caps["tools"]))
	add("skill", stringSlice(caps["skills"]))
	add("workflow", stringSlice(caps["workflows"]))
	return out
}

// EmployeeHasConcreteContract 判断伙伴是否至少装配了一项带具体契约的能力。
// 上岗闸门用它把"配置质量"变成硬门槛(P2)。
func EmployeeHasConcreteContract(emp map[string]any) bool {
	if emp == nil {
		return false
	}
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return false
	}
	for _, name := range stringSlice(caps["tools"]) {
		if _, ok := lookupContract(strings.TrimSpace(name)); ok {
			return true
		}
	}
	return false
}

// EmployeeContractIssues 返回伙伴已装配能力里"疑似拼写错误"的项。
//
// 只对平台内置命名族生效;CMDB / 企业自带的运行时工具不在此列。
func EmployeeContractIssues(emp map[string]any) []string {
	if emp == nil {
		return nil
	}
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return nil
	}
	issues := []string{}
	for _, raw := range stringSlice(caps["tools"]) {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if _, ok := lookupContract(name); ok {
			continue
		}
		if !looksLikePlatformCapability(name) {
			continue
		}
		issues = append(issues, "工具「"+name+"」无对应调用契约（疑似拼写错误）")
	}
	return issues
}

// looksLikePlatformCapability 判断一个能力名是否"像是平台内置能力但拼错了"。
//
// 判定方式:与已知契约名做编辑距离比较(距离 ≤2 视为疑似拼写错误),
// 覆盖 knowlege.retrieve / todo_wirte 这类手误;完全无关的名字(如企业
// 自带的 CMDB 工具)不拦。
func looksLikePlatformCapability(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	if n == "" {
		return false
	}
	for known := range capabilityContracts {
		if known == n {
			return true
		}
		if editDistance(n, known) <= 2 {
			return true
		}
	}
	return false
}

// editDistance 是标准的 Levenshtein 编辑距离(滚动数组实现)。
func editDistance(a, b string) int {
	ar := []rune(a)
	br := []rune(b)
	if len(ar) == 0 {
		return len(br)
	}
	if len(br) == 0 {
		return len(ar)
	}
	prev := make([]int, len(br)+1)
	cur := make([]int, len(br)+1)
	for j := 0; j <= len(br); j++ {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		cur[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			m := prev[j] + 1
			if v := cur[j-1] + 1; v < m {
				m = v
			}
			if v := prev[j-1] + cost; v < m {
				m = v
			}
			cur[j] = m
		}
		prev, cur = cur, prev
	}
	return prev[len(br)]
}
