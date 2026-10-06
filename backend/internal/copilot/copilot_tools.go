// Package copilot —— 工具注册表(tool registry)+ 解析 + 授权 + 执行模块。
//
// 职责：
//   - 决定当前回合对每个数字伙伴可启用哪些工具（buildToolRegistry）
//   - 从 LLM 输出里解析 <<<TOOL>>> 或 XML 风格工具调用块（parseToolCall / parseXMLToolCall）
//   - 校验工具可执行性（authorizeToolCall）+ 路由到具体执行器（runCopilotTool）
//   - 把执行结果包装成可落库的 toolCall 记录（toolCallToPersist）
//
// 关键约束：
//   - 平台禁止旁路生成 office 产物（docx/pptx/pdf 必须由 skill 脚本产出）
//   - 工具审批是 per-action（skill.open vs skill.run/write），不是全局
//   - 未知 / 未挂执行器的 tool 返回 status=unavailable（不伪造 success）
package copilot

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
)

// 工具执行模式的内部枚举值（与 ToolMode* 导出别名一一对应）。
const (
	toolModeExecute   = "execute"
	toolModeRecommend = "recommend"
	toolModeApproval  = "approval_required"
	toolModeProhibit  = "prohibited"
)

// ToolMode* 是 toolMode* 常量的导出别名，供 internal/server/ 等外部调用方引用。
// Exported aliases for the tool-mode string constants. External callers
// (notably internal/server/builtin_skills.go which assembles the registered
// tool catalog, and internal/server/session_governance.go which checks
// Mode == ToolModeApproval) reference these names.
const (
	ToolModeExecute   = toolModeExecute
	ToolModeRecommend = toolModeRecommend
	ToolModeApproval  = toolModeApproval
	ToolModeProhibit  = toolModeProhibit
)

// registeredTool 是 Copilot Harness 注册表里的一条可执行能力。
// registeredTool is one executable capability in the Copilot Harness registry.
type registeredTool struct {
	Key              string
	Name             string
	Kind             string // builtin | tool | skill | workflow
	Mode             string
	Enabled          bool
	RequiresApproval bool
	Description      string
}

// toolCallRequest 是一次工具调用的最小请求体（name + args）。
type toolCallRequest struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

// toolExecResult 是单次工具执行的统一结果封装。
// Status: success | failed | denied | unavailable；Hits 用来挂 RAG 命中；Permission 用于授权状态。
type toolExecResult struct {
	Status     string // success | failed | denied
	DurationMs int
	Output     string
	Hits       any
	Permission string
	Error      string
	SandboxID  string
}

// toolRunContext 把一次工具执行需要的"周边上下文"打包传给具体执行器。
// 包含会话身份（WorkspaceID/OwnerID/CorrelationID）、Viewer、SessionMode/RiskLevel 授权依据。
type toolRunContext struct {
	Request         *http.Request
	WorkspaceID     string
	OwnerID         string
	DigitalPartner string
	ConversationID  string
	CorrelationID   string
	UserMessage     string
	Viewer          *auth.Identity
	SessionMode     string
	RiskLevel       string
}

// toolCallBlockRE / xmlToolCallBlockRE 预编译的工具调用块匹配正则。
// toolCallBlockRe 匹配 <<<TOOL>>>...<<<END>>>；xmlToolCallBlockRe 匹配 <name>{...}</name> 风格。
var (
	toolCallBlockRe   = regexp.MustCompile(`(?s)<<<TOOL>>>\s*(\{.*?\})\s*<<<END>>>`)
	xmlToolCallBlockRe = regexp.MustCompile(`(?s)<([a-zA-Z][\w.:-]*)>\s*(\{.*?\})\s*</[a-zA-Z][\w.:-]*>`)
)

// slugToolName 把工具名做 slug 化：trimSpace + lowercase + 空格转 -
func slugToolName(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	return s
}

// capabilityMode 查员工 boundaryPolicy 里 (capabilityType, capabilityName) 对应的模式字符串。
func capabilityMode(emp map[string]any, kind, name string) string {
	bp, _ := emp["boundaryPolicy"].(map[string]any)
	if bp == nil {
		return ""
	}
	for _, item := range knowledgeSliceMaps(bp["capabilityModes"]) {
		if str(item["capabilityType"]) == kind && str(item["capabilityName"]) == name {
			return strings.TrimSpace(str(item["mode"]))
		}
	}
	if arr, ok := bp["capabilityModes"].([]any); ok {
		for _, x := range arr {
			m, ok := x.(map[string]any)
			if !ok {
				continue
			}
			if str(m["capabilityType"]) == kind && str(m["capabilityName"]) == name {
				return strings.TrimSpace(str(m["mode"]))
			}
		}
	}
	return ""
}

// enabledToolSet 把 enabledTools 列表转成 set（含 key 多种变体：原名 / 去 builtin: 前缀 / slug）。
// buildToolRegistry 内部用，主要是为了在会话只勾选部分工具时高效判 membership。
func enabledToolSet(enabled []string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, k := range enabled {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		out[k] = struct{}{}
		if i := strings.Index(k, ":"); i > 0 {
			out[k[i+1:]] = struct{}{}
			out[slugToolName(k[i+1:])] = struct{}{}
		}
		out[slugToolName(k)] = struct{}{}
	}
	return out
}

// buildToolRegistry 把"员工能力 + 边界策略 + 会话已勾选工具"三路求交集，产出最终可执行工具列表。
func buildToolRegistry(emp map[string]any, enabledTools []string) []registeredTool {
	enabled := enabledToolSet(enabledTools)
	enableAllNonApproval := len(enabledTools) == 0
	hasBuiltinSelector := false
	for _, k := range enabledTools {
		k = strings.TrimSpace(k)
		if strings.HasPrefix(k, "builtin:") || k == "knowledge.retrieve" || k == "memory.recall" {
			hasBuiltinSelector = true
			break
		}
	}

	var out []registeredTool
	seen := map[string]struct{}{}

	add := func(t registeredTool) {
		if t.Key == "" || t.Mode == toolModeProhibit {
			return
		}
		if _, ok := seen[t.Key]; ok {
			return
		}
		seen[t.Key] = struct{}{}
		t.RequiresApproval = t.Mode == toolModeApproval
		if t.Kind == "builtin" {
			if enableAllNonApproval {
				t.Enabled = true
			} else if hasBuiltinSelector {
				_, t.Enabled = enabled[t.Key]
				if !t.Enabled {
					_, t.Enabled = enabled[t.Name]
				}
				if !t.Enabled {
					_, t.Enabled = enabled[slugToolName(t.Name)]
				}
			} else {
				// 会话只勾选了员工装配工具时，平台检索/记忆仍默认可用
				t.Enabled = !t.RequiresApproval
			}
		} else if enableAllNonApproval {
			t.Enabled = !t.RequiresApproval
		} else {
			_, t.Enabled = enabled[t.Key]
			if !t.Enabled {
				_, t.Enabled = enabled[slugToolName(t.Name)]
			}
			if !t.Enabled {
				_, t.Enabled = enabled[t.Name]
			}
		}
		out = append(out, t)
	}

	add(registeredTool{
		Key: "builtin:knowledge.retrieve", Name: "knowledge.retrieve", Kind: "builtin",
		Mode: toolModeExecute, Description: "检索已发布知识库，返回相关片段",
	})
	add(registeredTool{
		Key: "builtin:memory.recall", Name: "memory.recall", Kind: "builtin",
		Mode: toolModeExecute, Description: "检索跨会话工作/长期记忆",
	})
	add(registeredTool{
		Key: "builtin:skill.read", Name: "skill.read", Kind: "builtin",
		Mode: toolModeExecute, Description: "加载已装配技能的 SKILL.md 全文",
	})
	// M14+ 企业 agent shell 工具(读 / 写 / 编辑 / 搜索 / 列目录 / 受控执行),
	// 全部经 workspace 白名单 + exec 白名单 + audit 留痕,数字伙伴可挂载
	// 后即可在受限 shell 里操作 (agent 上下文读取 / 局部代码与配置查阅 /
	// 受控命令执行)。
	add(registeredTool{
		Key: "tool:shell.read_file", Name: "shell.read_file", Kind: "tool",
		Mode: toolModeExecute, Description: "读取白名单内单个文件(workspace + /tmp + /var/qzda, ≤256KB)",
	})
	add(registeredTool{
		Key: "tool:shell.write_file", Name: "shell.write_file", Kind: "tool",
		Mode: toolModeExecute, Description: "写入 / 覆盖白名单内文件(≤256KB)",
	})
	add(registeredTool{
		Key: "tool:shell.edit_file", Name: "shell.edit_file", Kind: "tool",
		Mode: toolModeExecute, Description: "按 search-replace 原子编辑文件(全文唯一匹配)",
	})
	add(registeredTool{
		Key: "tool:shell.search_files", Name: "shell.search_files", Kind: "tool",
		Mode: toolModeExecute, Description: "ripgrep 风格文件搜索(pattern / glob / 上下文)",
	})
	add(registeredTool{
		Key: "tool:shell.list_dir", Name: "shell.list_dir", Kind: "tool",
		Mode: toolModeExecute, Description: "浅列白名单内目录(深度 ≤3)",
	})
	add(registeredTool{
		Key: "tool:shell.exec", Name: "shell.exec", Kind: "tool",
		Mode: toolModeExecute, Description: "执行只读 / 受控白名单命令(2s 超时 + 64KB 输出上限 + audit 留痕;rm/mv/cp/dd/sh 等显式拒绝)",
	})
	// M14+ Chart 渲染:把结构化数据 → SVG(bar / line / pie)/ markdown table。
	// 数字伙伴输出 chart.generate 后,serving 时落 /api/skill-artifacts/ 让前端 inline 嵌入。
	add(registeredTool{
		Key: "tool:chart.generate", Name: "chart.generate", Kind: "tool",
		Mode: toolModeExecute, Description: "渲染结构化数据为 SVG 图表(bar/line/pie/table, ≤32KB)",
	})
	// M14+ MCP 集成:JSON-RPC 2.0 over stdio / http,工具接入外部 MCP server
	// (Notion / Slack / Linear / GitHub 官方 server 等),让数字伙伴挂上就能调。
	add(registeredTool{
		Key: "tool:mcp.list_servers", Name: "mcp.list_servers", Kind: "tool",
		Mode: toolModeExecute, Description: "列出已挂载 MCP server 及其 tools(由 QZDA_MCP_SERVERS 配置)",
	})
	add(registeredTool{
		Key: "tool:mcp.call_tool", Name: "mcp.call_tool", Kind: "tool",
		Mode: toolModeExecute, Description: "在指定 MCP server 上调用 tool(<server>:<tool> args=...)",
	})
	add(registeredTool{
		Key: "builtin:time.now", Name: "time.now", Kind: "builtin",
		Mode: toolModeExecute, Description: "返回当前时间（ISO8601）",
	})
	for _, pt := range pilotdeckToolRegistry() {
		if pt.Kind != "platform" {
			continue
		}
		add(registeredTool{
			Key: "builtin:" + pt.Name, Name: pt.Name, Kind: "builtin",
			Mode: pt.Mode, Description: pt.Description,
		})
	}

	if emp == nil || emp["skipped"] == true {
		return out
	}

	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return out
	}

	pushCaps := func(kind string, names []string) {
		for _, raw := range names {
			name := strings.TrimSpace(raw)
			if name == "" {
				continue
			}
			mode := capabilityMode(emp, kind, name)
			if mode == "" {
				mode = toolModeRecommend
			}
			add(registeredTool{
				Key: kind + ":" + slugToolName(name), Name: name, Kind: kind,
				Mode: mode, Description: "已装配" + kind + " · " + name,
			})
		}
	}

	pushCaps("tool", stringSlice(caps["tools"]))
	pushCaps("skill", stringSlice(caps["skills"]))
	pushCaps("workflow", stringSlice(caps["workflows"]))
	return out
}

// registryLookup 按 name 在注册表里查工具；支持 Key / Name / slug / 去 builtin: 前缀四种匹配。
func registryLookup(reg []registeredTool, name string) *registeredTool {
	name = strings.TrimSpace(name)
	slug := slugToolName(name)
	for i := range reg {
		t := &reg[i]
		if t.Key == name || t.Name == name || slugToolName(t.Name) == slug {
			return t
		}
		if strings.TrimPrefix(t.Key, "builtin:") == name {
			return t
		}
	}
	return nil
}

// toolRegistryPrompt 把当前会话可用的工具列表渲染成给 LLM 的 system prompt 片段。
// 包含通用 ReAct 规则、Skill Harness 原语说明、docx/pptx/pdf 工具专属约束、产物协议约束等。
func toolRegistryPrompt(reg []registeredTool) string {
	var enabled []registeredTool
	for _, t := range reg {
		if t.Enabled {
			enabled = append(enabled, t)
		}
	}
	if len(enabled) == 0 {
		return "本回合未启用任何工具。请直接根据对话历史与记忆作答，不要尝试调用工具。"
	}
	var b strings.Builder
	b.WriteString("你可以使用下列工具（ReAct）。需要工具时，先只输出一个工具调用块，不要夹杂最终答案：\n")
	b.WriteString("<<<TOOL>>>\n{\"name\":\"工具名\",\"args\":{...}}\n<<<END>>>\n")
	b.WriteString("禁止输出 <skill.read>、<pptx> 等 XML 标签式工具块；仅使用上述 <<<TOOL>>> 格式。\n")
	b.WriteString("收到工具观察结果后，再决定是否继续调用或给出最终中文回答。最终回答不要包含 <<<TOOL>>> 或 XML 工具标记。\n")
	b.WriteString("【Skill Harness】对 kind=skill 的能力：\n")
	b.WriteString("1) 首次先 action=open 阅读 SKILL.md 与 scripts 列表；\n")
	b.WriteString("2) Office（pptx/docx/pdf）须先 write path=.copilot-ws/*.md 写入大纲，再 run command=scripts/...；run 引用 --outline-file .copilot-ws/... 时系统会自动补 write 步；\n")
	b.WriteString("3) 执行必须 action=run 且 command 匹配 scripts/... 或 .copilot-ws/...；未见到下载链接前勿声称 PPT/Word 已生成；\n")
	b.WriteString("4) 勿把自然语言当 command；观察 status=needs_instruction 表示尚未真正执行；status=failed 且含【预检失败】表示缺 package 或依赖文件；\n")
	b.WriteString("5) 仅当观察为 pending_authorization 时告知用户「已进入人工审核」；禁止在 success/needs_instruction 时声称已提交审核或已生成文件。\n")
	hasDocx := false
	for _, t := range enabled {
		if isDocxSkillName(t.Name) {
			hasDocx = true
			break
		}
	}
	if hasDocx {
		b.WriteString("【Word / docx】须先 action=open 阅读 SKILL.md，再 action=run 且 command 匹配 scripts/docx.sh 或 scripts/...（例：bash scripts/docx.sh create ...）。禁止仅传 title+content 快捷生成；未见到 /api/skill-artifacts/ 链接前勿声称已生成。\n")
	}
	hasPptx := false
	for _, t := range enabled {
		if t.Kind == "skill" && (strings.Contains(strings.ToLower(t.Name), "pptx") || strings.Contains(strings.ToLower(t.Name), "ppt")) {
			hasPptx = true
			break
		}
	}
	if hasPptx {
		b.WriteString("【PPT / pptx】须先 action=open；再 write .copilot-ws/<name>.md 大纲（或依赖系统自动补 write）；最后 action=run command=bash scripts/pptx.sh node scripts/build_from_outline.mjs --title T --outline-file .copilot-ws/O.md --out .copilot-ws/F.pptx。禁止 title+content 快捷生成；未见到 /api/skill-artifacts/ 链接前勿声称已生成。\n")
	}
	hasPdf := false
	for _, t := range enabled {
		if t.Kind == "skill" && strings.Contains(strings.ToLower(t.Name), "pdf") {
			hasPdf = true
			break
		}
	}
	if hasPdf {
		b.WriteString("【PDF】须 action=open 后 action=run command=scripts/...；禁止 title+content 快捷生成。未见到 /api/skill-artifacts/*.pdf 链接前勿声称已生成。\n")
	}
	b.WriteString("【产物协议】docx/pptx/pdf 必须由 skill 脚本产出并以 /api/skill-artifacts/ 链接交付；平台禁止内置旁路生成。\n")
	b.WriteString("可用工具：\n")
	for _, t := range enabled {
		b.WriteString("- ")
		b.WriteString(t.Name)
		b.WriteString("（")
		b.WriteString(t.Key)
		b.WriteString("）：")
		b.WriteString(t.Description)
		if t.Kind == "skill" {
			b.WriteString("；Skill 原语：open|write|run|artifacts")
			if t.RequiresApproval {
				b.WriteString(" [run/write 需审批]")
			}
		} else if t.RequiresApproval {
			b.WriteString(" [需审批，不可直接执行]")
		}
		b.WriteString("\n")
	}
	b.WriteString("常见：查制度/文档用 knowledge.retrieve；回忆用户偏好用 memory.recall；查资产/CI 用名称含 CMDB 的只读工具。\n")
	return b.String()
}

// parseToolCall 是工具调用解析的总入口：先尝试 <<<TOOL>>> 块，再 fallback 到 XML 风格。
func parseToolCall(text string) (toolCallRequest, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return toolCallRequest{}, false
	}
	if call, ok := parseCanonicalToolCall(text); ok {
		return normalizeParsedToolCall(call), true
	}
	if call, ok := parseXMLToolCall(text); ok {
		return normalizeParsedToolCall(call), true
	}
	return toolCallRequest{}, false
}

// parseCanonicalToolCall 解析 <<<TOOL>>>{...}<<<END>>> 块为 toolCallRequest；name 为空或 JSON 失败时返回 false。
func parseCanonicalToolCall(text string) (toolCallRequest, bool) {
	m := toolCallBlockRe.FindStringSubmatch(text)
	if len(m) != 2 {
		return toolCallRequest{}, false
	}
	var call toolCallRequest
	if err := json.Unmarshal([]byte(m[1]), &call); err != nil {
		return toolCallRequest{}, false
	}
	call.Name = strings.TrimSpace(call.Name)
	if call.Name == "" {
		return toolCallRequest{}, false
	}
	if call.Args == nil {
		call.Args = map[string]any{}
	}
	return call, true
}

// parseXMLToolCall 解析 <name>{...}</name> 风格的工具调用；标签必须命中"已知工具标签白名单"
// 或包含 pptx/docx 子串，避免误把普通 XML/HTML 当工具调用。
func parseXMLToolCall(text string) (toolCallRequest, bool) {
	m := xmlToolCallBlockRe.FindStringSubmatch(text)
	if len(m) != 3 {
		return toolCallRequest{}, false
	}
	name := strings.TrimSpace(strings.TrimPrefix(m[1], "skill:"))
	lowName := strings.ToLower(name)
	// Only treat known tool-like tags as tool calls (avoid stripping random XML/HTML).
	known := map[string]bool{
		"skill.read": true, "read_skill": true, "write_file": true, "edit_file": true,
		"bash": true, "pptx": true, "docx": true, "pdf": true, "spreadsheets": true,
		"knowledge.retrieve": true, "memory.recall": true, "read_file": true,
		"execute_code": true, "skill": true,
	}
	if !known[lowName] && !strings.Contains(lowName, "pptx") && !strings.Contains(lowName, "docx") {
		return toolCallRequest{}, false
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(m[2]), &payload); err != nil {
		return toolCallRequest{}, false
	}
	args := map[string]any{}
	for k, v := range payload {
		switch strings.ToLower(k) {
		case "name":
			if name == "" {
				name = strings.TrimSpace(str(v))
			}
		case "args":
			if nested, ok := v.(map[string]any); ok {
				for nk, nv := range nested {
					args[nk] = nv
				}
			}
		default:
			args[k] = v
		}
	}
	if name == "" {
		if skill := str(args["skill"]); skill != "" {
			name = skill
		}
	}
	if name == "" {
		return toolCallRequest{}, false
	}
	if args == nil {
		args = map[string]any{}
	}
	return toolCallRequest{Name: name, Args: args}, true
}

// normalizeParsedToolCall 把模型常见的别名（skill.read / writefile / skill:pptx）映射回注册表里的标准名。
// normalizeParsedToolCall maps common model aliases to registered tool names.
func normalizeParsedToolCall(call toolCallRequest) toolCallRequest {
	if call.Args == nil {
		call.Args = map[string]any{}
	}
	name := strings.TrimSpace(call.Name)
	skill := strings.TrimSpace(coalesce(str(call.Args["skill"]), str(call.Args["skillName"])))
	action := normalizeSkillAction(call.Args)
	switch strings.ToLower(name) {
	case "skill.read", "read_skill":
		if skill != "" && (action == skillActionOpen || action == "") {
			call.Name = skill
			call.Args["action"] = skillActionOpen
			delete(call.Args, "skill")
			delete(call.Args, "skillName")
		} else if skill != "" {
			call.Args["skill"] = skill
		}
	case "writefile", "write-file":
		call.Name = "write_file"
	case "skill:pptx", "skill:docx":
		call.Name = strings.TrimPrefix(strings.ToLower(name), "skill:")
	}
	if strings.HasPrefix(strings.ToLower(call.Name), "skill:") {
		call.Name = strings.TrimPrefix(call.Name, "skill:")
	}
	return call
}

// looksLikeLeakedToolMarkup 检查文本里是否残留 <<<TOOL>>> 或 XML 工具块。
// 用于回合收尾时识别"模型没正确封装"的情况，避免把工具标记直接漏给前端。
func looksLikeLeakedToolMarkup(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	if strings.Contains(text, "<<<TOOL>>>") || xmlToolCallBlockRe.MatchString(text) {
		return true
	}
	_, ok := parseToolCall(text)
	return ok
}

// stripToolCallMarkers 把 <<<TOOL>>> 块和 XML 工具块从文本里全部剥离，并 trim 空白。
func stripToolCallMarkers(text string) string {
	text = toolCallBlockRe.ReplaceAllString(text, "")
	text = xmlToolCallBlockRe.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}

// authorizeToolCall 在执行前校验：工具是否注册、是否被禁止、是否本会话启用、是否需要审批。
// 拒答时返回 (工具, denied 状态结果)；通过时返回 (工具, nil)。
func authorizeToolCall(reg []registeredTool, call toolCallRequest) (*registeredTool, *toolExecResult) {
	t := registryLookup(reg, call.Name)
	if t == nil {
		return nil, &toolExecResult{
			Status: "denied", Error: "工具未注册：" + call.Name, Permission: "deny",
		}
	}
	if t.Mode == toolModeProhibit {
		return t, &toolExecResult{
			Status: "denied", Error: "工具已禁止：" + t.Name, Permission: "prohibited",
		}
	}
	if !t.Enabled {
		return t, &toolExecResult{
			Status: "denied", Error: "工具未在本会话启用：" + t.Name, Permission: "disabled",
		}
	}
	// Skill approval is per-action (open vs run/write) in dispatchAuthorizedTool.
	if t.RequiresApproval && t.Kind != "skill" {
		return t, &toolExecResult{
			Status: "denied", Error: "工具需要人工审核授权后才能执行：" + t.Name, Permission: "approval_required",
		}
	}
	return t, nil
}

// runCopilotTool 是工具执行分发器：按 builtin/runtime/pilotdeck/cmdb/skill/workflow/tool
// 等类型路由到 Deps 上对应的执行器；未挂执行器的 tool 走 status=unavailable（不伪造）。
func (s *Service) runCopilotTool(ctx toolRunContext, t *registeredTool, call toolCallRequest) toolExecResult {
	if s.testHooks != nil && s.testHooks.runCopilotToolOverride != nil {
		return s.testHooks.runCopilotToolOverride(ctx, t, call)
	}
	started := time.Now()
	switch {
	case t.Name == "knowledge.retrieve" || t.Key == "builtin:knowledge.retrieve":
		query := coalesce(str(call.Args["query"]), ctx.UserMessage)
		var hits []memoryHit
		var err error
		if s.Deps.RetrievePublishedFn != nil {
			var raw any
			raw, err = s.Deps.RetrievePublishedFn(ctx.Request, map[string]any{"query": query}, ctx.CorrelationID)
			if raw != nil {
				if h, ok := raw.([]memoryHit); ok {
					hits = h
				}
			}
		}
		res := toolExecResult{DurationMs: int(time.Since(started).Milliseconds()), Hits: hits}
		if err != nil {
			res.Status = "failed"
			res.Error = err.Error()
			res.Output = "检索失败：" + err.Error()
			return res
		}
		res.Status = "success"
		n := len(ragHitResults(hits))
		res.Output = fmt.Sprintf("knowledge.retrieve 完成：query=%q hits=%d backend=%s", query, n, coalesce(str(mapStr(hits, "backend")), "published-memory"))
		if n > 0 {
			res.Output += "\n" + strings.Join(ragSnippetsForPrompt(hits), "\n")
		} else {
			res.Output += "\n无命中"
		}
		return res

	case t.Name == "memory.recall" || t.Key == "builtin:memory.recall":
		query := coalesce(str(call.Args["query"]), ctx.UserMessage)
		s.Store.RLock()
		hits := s.retrieveMemoryForTurnLocked(ctx.WorkspaceID, ctx.OwnerID, ctx.DigitalPartner, ctx.ConversationID, query, ctx.Viewer)
		s.Store.RUnlock()
		res := toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds())}
		if len(hits) == 0 {
			res.Output = "memory.recall：无相关跨会话记忆"
			return res
		}
		var b strings.Builder
		b.WriteString(fmt.Sprintf("memory.recall：命中 %d 条\n", len(hits)))
		for _, h := range hits {
			b.WriteString("- [")
			b.WriteString(h.Layer)
			b.WriteString("] ")
			if h.Title != "" {
				b.WriteString(h.Title)
				b.WriteString("：")
			}
			b.WriteString(h.Content)
			b.WriteString("\n")
		}
		res.Output = strings.TrimSpace(b.String())
		return res

	case t.Name == "skill.read" || t.Key == "builtin:skill.read":
		return s.Deps.RunSkillReadToolFn(ctx, call, started)

	case t.Name == "time.now" || t.Key == "builtin:time.now":
		now := time.Now().Format(time.RFC3339)
		return toolExecResult{
			Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
			Output: fmt.Sprintf("time.now: %s", now),
		}

	case isPlatformPilotdeckTool(t.Name):
		return s.Deps.RunPilotdeckToolFn(ctx, t, call, started)

	case isRuntimeTool(t.Name):
		return s.Deps.RunRuntimeToolFn(ctx, t, call, started)

	case isCMDBTool(t.Name) || isCMDBTool(t.Key):
		return s.Deps.RunCMDBLookupFn(ctx, t, call, started)

	case t.Kind == "skill":
		return s.Deps.RunSkillToolFn(ctx, t, call, started)

	case t.Kind == "workflow":
		return toolExecResult{
			Status: "denied", DurationMs: int(time.Since(started).Milliseconds()),
			Permission: "not_implemented",
			Error:      "工作流需在工作流中心执行，会话内暂不直接触发：" + t.Name,
			Output:     "工作流「" + t.Name + "」未在会话 ReAct 中执行（请使用工作流运行入口）。",
		}

	case t.Kind == "tool":
		// M14+ shell 工具族:workspace 白名单 + exec 白名单 + audit 留痕。
		switch call.Name {
		case "shell.read_file":
			path, _ := call.Args["path"].(string)
			return s.shellReadFile(path)
		case "shell.write_file":
			path, _ := call.Args["path"].(string)
			content, _ := call.Args["content"].(string)
			return s.shellWriteFile(path, content)
		case "shell.edit_file":
			path, _ := call.Args["path"].(string)
			search, _ := call.Args["search"].(string)
			replace, _ := call.Args["replace"].(string)
			return s.shellEditFile(path, search, replace)
		case "shell.search_files":
			root, _ := call.Args["root"].(string)
			pattern, _ := call.Args["pattern"].(string)
			inc, _ := call.Args["include_glob"].(string)
			ctxL, _ := call.Args["context_lines"].(float64)
			if ctxL <= 0 {
				ctxL = 2
			}
			return s.shellSearchFiles(root, pattern, inc, int(ctxL))
		case "shell.list_dir":
			path, _ := call.Args["path"].(string)
			depth, _ := call.Args["depth"].(float64)
			return s.shellListDir(path, int(depth))
		case "shell.exec":
			cmd, _ := call.Args["command"].(string)
			argsAny, _ := call.Args["args"].([]any)
			args := make([]string, 0, len(argsAny))
			for _, a := range argsAny {
				if s, ok := a.(string); ok {
					args = append(args, s)
				}
			}
			return s.shellExec(ctx.WorkspaceID, ctx.OwnerID, cmd, args)
		case "chart.generate":
			payload, _ := call.Args["payload"].(string)
			if payload == "" {
				// 兼容 payload 在 params 字段
				payload, _ = call.Args["params"].(string)
			}
			return renderChartSVG(payload)
		case "mcp.list_servers":
			return mcpListServers()
		case "mcp.call_tool":
			server, _ := call.Args["server"].(string)
			tool, _ := call.Args["tool"].(string)
			args, _ := call.Args["args"].(string)
			return mcpCallTool(server, tool, args)
		}
		if isRuntimeTool(t.Name) {
			return s.Deps.RunRuntimeToolFn(ctx, t, call, started)
		}
		if isPlatformPilotdeckTool(t.Name) {
			return s.Deps.RunPilotdeckToolFn(ctx, t, call, started)
		}
		// Display-name enterprise tools without a concrete executor: honest failure, not fake success.
		return toolExecResult{
			Status: "unavailable", DurationMs: int(time.Since(started).Milliseconds()),
			Permission: "unavailable",
			Error:      "工具执行器未接入：" + t.Name,
			Output:     "工具「" + t.Name + "」已装配但运行时执行器尚未接入（当前支持 knowledge.retrieve / memory.recall / CMDB 只读 / skill）。",
		}

	default:
		return toolExecResult{
			Status: "failed", DurationMs: int(time.Since(started).Milliseconds()),
			Error:  "未知工具类型",
			Output: "无法执行：" + t.Key,
		}
	}
}

// mapStr 把任意 v 强转 map[string]any 再取 key；非 map 类型返回空串。
func mapStr(v any, key string) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	return str(m[key])
}

// findWorkspaceSkill 在 workspace 的 Skill 注册表里按 (id / name / slug / docx 别名) 找匹配项。
// 用于把 toolCall 名字映射回 Store.Skills 里的具体 skill 元数据。
func (s *Service) findWorkspaceSkill(ws, skillID, toolName string) map[string]any {
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, item := range s.Store.Skills {
		if str(item["workspaceId"]) != ws {
			continue
		}
		name := str(item["name"])
		id := str(item["id"])
		if skillID != "" && id == skillID {
			return item
		}
		if strings.EqualFold(name, toolName) || slugToolName(name) == slugToolName(toolName) {
			return item
		}
		if isDocxSkillName(toolName) && isDocxSkillName(name) {
			return item
		}
	}
	return nil
}

// enabledToolKeys 从注册表里取出所有 Enabled=true 的 Key 列表（用于 SSE emit "enabledTools"）。
func enabledToolKeys(reg []registeredTool) []string {
	var out []string
	for _, t := range reg {
		if t.Enabled {
			out = append(out, t.Key)
		}
	}
	return out
}

// toolCallToPersist 把一次工具调用及其结果打包成可落库的 map 结构。
// 字段：id/name/args/status/durationMs/permission/sandboxId/error/result（result 截到 500 rune）。
func toolCallToPersist(id, name string, args map[string]any, res toolExecResult) map[string]any {
	status := res.Status
	if status == "" {
		status = "success"
	}
	item := map[string]any{
		"id": id, "name": name, "args": args, "status": status,
		"durationMs": res.DurationMs,
	}
	if res.Permission != "" {
		item["permission"] = res.Permission
	}
	if res.SandboxID != "" {
		item["sandboxId"] = res.SandboxID
	}
	if res.Error != "" {
		item["error"] = res.Error
	}
	if res.Output != "" {
		item["result"] = truncateRunes(res.Output, 500)
	}
	return item
}
