package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/tasks"
)

func (s *Server) runPilotdeckTool(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult {
	name := strings.ToLower(strings.TrimSpace(t.Name))
	switch name {
	case "write_file":
		return s.runtimeWriteFile(ctx, call, started)
	case "edit_file":
		return s.runtimeEditFile(ctx, call, started)
	case "web_search":
		return s.runtimeWebSearch(ctx, call, started)
	case "todo_write":
		return s.runtimeTodoWrite(ctx, call, started)
	case "ask_user_question":
		return s.runtimeAskUserQuestion(ctx, call, started)
	case "structured_output":
		return s.runtimeStructuredOutput(ctx, call, started)
	case "execute_code":
		return s.runtimeExecuteCode(ctx, t, call, started)
	case "edit_notebook":
		return s.runtimeEditNotebook(ctx, call, started)
	case "send_attachment":
		return s.runtimeSendAttachment(ctx, call, started)
	case "enter_plan_mode":
		return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
			Output: "【enter_plan_mode】已建议切换到「方案」模式（runMode=plan）。请在前端切换，或下轮以只读工具继续。"}
	case "exit_plan_mode":
		return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
			Output: "【exit_plan_mode】已建议切换到「执行」模式（runMode=agent）。写/run 工具需审批。"}
	case "agent":
		return s.runtimeAgent(ctx, call, started)
	case "task_create":
		return s.runtimeTaskCreate(ctx, call, started)
	case "task_list":
		return s.runtimeTaskList(ctx, call, started)
	case "task_output":
		return s.runtimeTaskOutput(ctx, call, started)
	case "task_wait":
		return s.runtimeTaskWait(ctx, call, started)
	case "task_stop":
		return s.runtimeTaskStop(ctx, call, started)
	case "list_mcp_resources":
		return s.runtimeListMCPResources(ctx, started)
	case "read_mcp_resource":
		return s.runtimeReadMCPResource(ctx, call, started)
	case "read_file":
		return s.runtimeReadFile(ctx, call, started)
	case "glob":
		return s.runtimeGlob(ctx, call, started)
	case "grep":
		return s.runtimeGrep(ctx, call, started)
	case "bash":
		return s.runtimeBash(ctx, t, call, started)
	case "web_fetch":
		return s.runtimeWebFetch(ctx, call, started)
	default:
		return toolExecResult{Status: "failed", Error: "未知运行时工具: " + name, DurationMs: int(time.Since(started).Milliseconds())}
	}
}

func (s *Server) runtimeWriteFile(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	sk := s.resolveRuntimeSkill(ctx, call)
	if sk == nil {
		return toolExecResult{Status: "failed", Error: "无技能包", DurationMs: int(time.Since(started).Milliseconds())}
	}
	path := coalesce(str(call.Args["path"]), str(call.Args["file"]))
	content := coalesce(str(call.Args["content"]), str(call.Args["input"]))
	if looksLikeCodeAsDocxBody(content) {
		ms := int(time.Since(started).Milliseconds())
		return toolExecResult{
			Status: "failed", DurationMs: ms,
			Error:  "正文不能是生成脚本",
			Output: "write_file 拒绝写入 docx 生成脚本。请改用 skill:docx，并传入 title 与人话正文 content。",
		}
	}
	writeCall := toolCallRequest{Args: map[string]any{"action": "write", "path": path, "content": content}}
	return s.skillWrite(sk, writeCall, started)
}

func (s *Server) runtimeEditFile(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	sk := s.resolveRuntimeSkill(ctx, call)
	if sk == nil {
		return toolExecResult{Status: "failed", Error: "无技能包", DurationMs: int(time.Since(started).Milliseconds())}
	}
	rel := strings.TrimSpace(coalesce(str(call.Args["path"]), str(call.Args["file"])))
	oldStr := str(call.Args["old_string"])
	newStr := str(call.Args["new_string"])
	if rel == "" || oldStr == "" {
		return toolExecResult{Status: "failed", Error: "需要 path + old_string", DurationMs: int(time.Since(started).Milliseconds())}
	}
	rel = filepath.ToSlash(strings.TrimPrefix(rel, "/"))
	if strings.Contains(rel, "..") {
		return toolExecResult{Status: "denied", Permission: "path", Error: "非法路径", DurationMs: int(time.Since(started).Milliseconds())}
	}
	pkgPath := str(sk["packagePath"])
	target := filepath.Join(pkgPath, filepath.FromSlash(rel))
	if !strings.HasPrefix(target, pkgPath+string(os.PathSeparator)) {
		return toolExecResult{Status: "denied", Permission: "path", Error: "越界", DurationMs: int(time.Since(started).Milliseconds())}
	}
	b, err := os.ReadFile(target)
	if err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), DurationMs: int(time.Since(started).Milliseconds())}
	}
	if !strings.Contains(string(b), oldStr) {
		return toolExecResult{Status: "failed", Error: "old_string 未找到", DurationMs: int(time.Since(started).Milliseconds())}
	}
	updated := strings.Replace(string(b), oldStr, newStr, 1)
	if err := os.WriteFile(target, []byte(updated), 0o644); err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), DurationMs: int(time.Since(started).Milliseconds())}
	}
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【edit_file】已 patch %s（%d → %d bytes）", rel, len(b), len(updated))}
}

func (s *Server) runtimeWebSearch(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	query := strings.TrimSpace(coalesce(str(call.Args["query"]), ctx.UserMessage))
	if query == "" {
		return toolExecResult{Status: "failed", Error: "缺少 query", DurationMs: int(time.Since(started).Milliseconds())}
	}
	apiKey := strings.TrimSpace(os.Getenv("QZDA_WEB_SEARCH_API_KEY"))
	if apiKey == "" {
		return toolExecResult{Status: "unavailable", Error: "未配置 QZDA_WEB_SEARCH_API_KEY",
			Output: "web_search 需要配置 QZDA_WEB_SEARCH_API_KEY（Tavily 或兼容 API）", DurationMs: int(time.Since(started).Milliseconds())}
	}
	endpoint := coalesce(os.Getenv("QZDA_WEB_SEARCH_URL"), "https://api.tavily.com/search")
	body, _ := json.Marshal(map[string]any{"query": query, "max_results": 5})
	req, err := http.NewRequestWithContext(ctx.Request.Context(), http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), DurationMs: int(time.Since(started).Milliseconds())}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), DurationMs: int(time.Since(started).Milliseconds())}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【web_search】query=%q\n%s", query, truncateRunes(string(raw), 6000))}
}

func conversationTodosKey(convID string) string {
	return "copilotTodos:" + convID
}

func (s *Server) runtimeTodoWrite(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	convID := coalesce(ctx.ConversationID, "default")
	s.Store.Lock()
	if s.Store.SkillExtra == nil {
		s.Store.SkillExtra = map[string]any{}
	}
	key := conversationTodosKey(convID)
	var todos []map[string]any
	if existing, ok := s.Store.SkillExtra[key].([]map[string]any); ok {
		todos = existing
	}
	if merge, ok := call.Args["merge"].(bool); ok && !merge {
		todos = nil
	}
	if items, ok := call.Args["todos"].([]any); ok {
		for _, it := range items {
			if m, ok := it.(map[string]any); ok {
				todos = append(todos, m)
			}
		}
	} else if title := str(call.Args["content"]); title != "" {
		todos = append(todos, map[string]any{"id": fmt.Sprintf("todo-%d", len(todos)+1), "content": title, "status": "pending"})
	}
	s.Store.SkillExtra[key] = todos
	s.Store.Unlock()
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【todo_write】%d 项 todo\n%s", len(todos), formatTodos(todos))}
}

func formatTodos(todos []map[string]any) string {
	var b strings.Builder
	for _, t := range todos {
		b.WriteString(fmt.Sprintf("- [%s] %s\n", coalesce(str(t["status"]), "?"), firstNonEmpty(str(t["content"]), str(t["title"]))))
	}
	return strings.TrimSpace(b.String())
}

func (s *Server) runtimeAskUserQuestion(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	q := firstNonEmpty(str(call.Args["question"]), str(call.Args["query"]), ctx.UserMessage)
	return toolExecResult{Status: "needs_elicitation", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【ask_user_question】%s\n（等待用户在会话中回复后继续）", q),
		Permission: "elicitation"}
}

func (s *Server) runtimeStructuredOutput(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	schema := call.Args["schema"]
	payload := call.Args["data"]
	if payload == nil {
		payload = call.Args["output"]
	}
	if payload == nil {
		return toolExecResult{Status: "failed", Error: "缺少 data/output", DurationMs: int(time.Since(started).Milliseconds())}
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), DurationMs: int(time.Since(started).Milliseconds())}
	}
	if !json.Valid(b) {
		return toolExecResult{Status: "failed", Error: "非法 JSON", DurationMs: int(time.Since(started).Milliseconds())}
	}
	out := fmt.Sprintf("【structured_output】\n%s", string(b))
	if schema != nil {
		out = fmt.Sprintf("【structured_output】schema=%v\n%s", schema, string(b))
	}
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()), Output: out}
}

func (s *Server) runtimeExecuteCode(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult {
	code := coalesce(str(call.Args["code"]), str(call.Args["command"]))
	if code == "" {
		return toolExecResult{Status: "failed", Error: "缺少 code", DurationMs: int(time.Since(started).Milliseconds())}
	}
	lang := strings.ToLower(coalesce(str(call.Args["language"]), "python"))
	cmd := code
	if lang == "python" || lang == "python3" {
		cmd = "python3 -c " + shellQuote(code)
	}
	bashCall := toolCallRequest{Args: map[string]any{"command": cmd}}
	return s.runtimeBash(ctx, t, bashCall, started)
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func (s *Server) runtimeEditNotebook(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	return s.runtimeEditFile(ctx, call, started)
}

func (s *Server) runtimeSendAttachment(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	path := firstNonEmpty(str(call.Args["path"]), str(call.Args["url"]), str(call.Args["filename"]))
	if path == "" {
		return toolExecResult{Status: "failed", Error: "缺少 path/url", DurationMs: int(time.Since(started).Milliseconds())}
	}
	// .pptx 必须经过内容审计：禁止 SKILL.md 指令文案 / 通用占位 boilerplate
	// 作为 slide 内容泄漏。命中则阻断附件链接，要求 LLM 重生成。
	if strings.EqualFold(filepath.Ext(path), ".pptx") {
		if _, err := os.Stat(path); err == nil {
			if reason, verr := pptxLeakageReason(path); verr != nil {
				return toolExecResult{Status: "failed", Error: "pptx 校验失败：" + verr.Error(), DurationMs: int(time.Since(started).Milliseconds())}
			} else if reason != "" {
				return toolExecResult{Status: "failed", Error: "pptx 内容疑似模板指令/占位泄漏：" + reason + "。请按 SKILL.md 要求重生成（禁止把 SKILL 指令或通用 boilerplate 写入 slide）", DurationMs: int(time.Since(started).Milliseconds())}
			}
		}
	}
	link := path
	if !strings.HasPrefix(link, "http") && !strings.HasPrefix(link, "/") {
		link = "/api/skill-artifacts/" + filepath.Base(path)
	}
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【send_attachment】附件链接：%s", link)}
}

func (s *Server) runtimeAgent(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	prompt := firstNonEmpty(str(call.Args["prompt"]), str(call.Args["task"]), ctx.UserMessage)
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【agent】子 Agent 已接收任务（简化委派）：%s\n提示：完整子循环需 qzda-agent-runtime；当前返回任务摘要供主 Agent 继续。", truncateRunes(prompt, 500))}
}

func (s *Server) runtimeTaskCreate(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	title := firstNonEmpty(str(call.Args["title"]), str(call.Args["name"]), "Copilot 任务")
	body := map[string]any{"title": title, "source": "copilot", "digitalPartnerId": ctx.DigitalPartner}
	viewer := ctx.Viewer
	if viewer == nil {
		viewer = &auth.Identity{ID: ctx.OwnerID, Name: "copilot"}
	}
	s.Store.Lock()
	item := tasks.BuildControlledTask(s.Store.ID, ctx.WorkspaceID, body, viewer)
	item["code"] = tasks.NextTaskCode(s.Store.Tasks)
	s.Store.Tasks = append([]map[string]any{item}, s.Store.Tasks...)
	s.Store.Unlock()
	s.Store.Persist("tasks")
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【task_create】id=%s title=%q", str(item["id"]), title)}
}

func (s *Server) runtimeTaskList(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	s.Store.RLock()
	var lines []string
	for _, t := range s.Store.Tasks {
		if str(t["workspaceId"]) != ctx.WorkspaceID {
			continue
		}
		lines = append(lines, fmt.Sprintf("%s %s [%s]", str(t["id"]), str(t["title"]), str(t["status"])))
	}
	s.Store.RUnlock()
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: "【task_list】\n" + strings.Join(lines, "\n")}
}

func (s *Server) runtimeTaskOutput(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	taskID := str(call.Args["task_id"])
	s.Store.RLock()
	var out string
	for _, t := range s.Store.Tasks {
		if str(t["id"]) == taskID || str(t["ticket"]) == taskID {
			out = fmt.Sprintf("status=%s title=%s", str(t["status"]), str(t["title"]))
			break
		}
	}
	s.Store.RUnlock()
	if out == "" {
		return toolExecResult{Status: "failed", Error: "任务不存在", DurationMs: int(time.Since(started).Milliseconds())}
	}
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()), Output: "【task_output】" + out}
}

func (s *Server) runtimeTaskWait(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	return s.runtimeTaskOutput(ctx, call, started)
}

func (s *Server) runtimeTaskStop(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	taskID := str(call.Args["task_id"])
	s.Store.Lock()
	for _, t := range s.Store.Tasks {
		if str(t["id"]) == taskID {
			t["status"] = "cancelled"
			break
		}
	}
	s.Store.Unlock()
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()), Output: "【task_stop】已取消 " + taskID}
}

func (s *Server) runtimeListMCPResources(ctx toolRunContext, started time.Time) toolExecResult {
	s.Store.RLock()
	var lines []string
	for _, si := range s.Store.SkillIntegrations {
		if str(si["workspaceId"]) != ctx.WorkspaceID {
			continue
		}
		if str(si["type"]) == "mcp" || strings.Contains(str(si["endpoint"]), "mcp") {
			lines = append(lines, fmt.Sprintf("%s (%s)", str(si["name"]), str(si["endpoint"])))
		}
	}
	s.Store.RUnlock()
	if len(lines) == 0 {
		lines = []string{"（无 MCP 连接，请先在技能中心配置）"}
	}
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: "【list_mcp_resources】\n" + strings.Join(lines, "\n")}
}

func (s *Server) runtimeReadMCPResource(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	uri := coalesce(str(call.Args["uri"]), str(call.Args["resource"]))
	return toolExecResult{Status: "unavailable", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【read_mcp_resource】MCP 读资源 %q 需连接具体 MCP server（当前列出可用连接请用 list_mcp_resources）", uri)}
}

func (s *Server) persistTasks() {
	if s.Store != nil {
		s.Store.Persist("tasks")
	}
}
