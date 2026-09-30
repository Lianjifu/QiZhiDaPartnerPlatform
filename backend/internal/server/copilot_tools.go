package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
)

const (
	toolModeExecute   = "execute"
	toolModeRecommend = "recommend"
	toolModeApproval  = "approval_required"
	toolModeProhibit  = "prohibited"
)

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

type toolCallRequest struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

type toolExecResult struct {
	Status     string // success | failed | denied
	DurationMs int
	Output     string
	Hits       any
	Permission string
	Error      string
	SandboxID  string
}

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

var (
	toolCallBlockRe  = regexp.MustCompile(`(?s)<<<TOOL>>>\s*(\{.*?\})\s*<<<END>>>`)
	xmlToolCallBlockRe = regexp.MustCompile(`(?s)<([a-zA-Z][\w.:-]*)>\s*(\{.*?\})\s*</[a-zA-Z][\w.:-]*>`)
)

func slugToolName(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	return s
}

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

// buildToolRegistry intersects employee capabilities, boundary modes, and session enabledTools.
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

func stripToolCallMarkers(text string) string {
	text = toolCallBlockRe.ReplaceAllString(text, "")
	text = xmlToolCallBlockRe.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}

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

func (s *Server) runCopilotTool(ctx toolRunContext, t *registeredTool, call toolCallRequest) toolExecResult {
	if s.testHooks != nil && s.testHooks.runCopilotToolOverride != nil {
		return s.testHooks.runCopilotToolOverride(ctx, t, call)
	}
	started := time.Now()
	switch {
	case t.Name == "knowledge.retrieve" || t.Key == "builtin:knowledge.retrieve":
		query := coalesce(str(call.Args["query"]), ctx.UserMessage)
		hits, err := s.retrievePublished(ctx.Request, map[string]any{"query": query}, ctx.CorrelationID)
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
		return s.runSkillReadTool(ctx, call, started)

	case t.Name == "time.now" || t.Key == "builtin:time.now":
		now := time.Now().Format(time.RFC3339)
		return toolExecResult{
			Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
			Output: fmt.Sprintf("time.now: %s", now),
		}

	case isPlatformPilotdeckTool(t.Name):
		return s.runPilotdeckTool(ctx, t, call, started)

	case isRuntimeTool(t.Name):
		return s.runRuntimeTool(ctx, t, call, started)

	case isCMDBTool(t.Name) || isCMDBTool(t.Key):
		return s.runCMDBLookup(ctx, t, call, started)

	case t.Kind == "skill":
		return s.runSkillTool(ctx, t, call, started)

	case t.Kind == "workflow":
		return toolExecResult{
			Status: "denied", DurationMs: int(time.Since(started).Milliseconds()),
			Permission: "not_implemented",
			Error:      "工作流需在工作流中心执行，会话内暂不直接触发：" + t.Name,
			Output:     "工作流「" + t.Name + "」未在会话 ReAct 中执行（请使用工作流运行入口）。",
		}

	case t.Kind == "tool":
		if isRuntimeTool(t.Name) {
			return s.runRuntimeTool(ctx, t, call, started)
		}
		if isPlatformPilotdeckTool(t.Name) {
			return s.runPilotdeckTool(ctx, t, call, started)
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

func mapStr(v any, key string) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	return str(m[key])
}

func (s *Server) findWorkspaceSkill(ws, skillID, toolName string) map[string]any {
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

func enabledToolKeys(reg []registeredTool) []string {
	var out []string
	for _, t := range reg {
		if t.Enabled {
			out = append(out, t.Key)
		}
	}
	return out
}

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
