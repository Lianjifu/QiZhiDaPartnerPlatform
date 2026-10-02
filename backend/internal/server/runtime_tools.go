package server

import (
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
)

var runtimeToolNames = map[string]bool{
	"read_file": true, "glob": true, "grep": true, "bash": true, "web_fetch": true,
	"write_file": true, "edit_file": true, "web_search": true, "execute_code": true,
	"edit_notebook": true, "send_attachment": true, "agent": true,
	"task_create": true, "task_list": true, "task_output": true, "task_wait": true, "task_stop": true,
	"list_mcp_resources": true, "read_mcp_resource": true,
}

func isRuntimeTool(name string) bool {
	return runtimeToolNames[strings.ToLower(strings.TrimSpace(name))]
}

func isPlatformPilotdeckTool(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "todo_write", "ask_user_question", "structured_output", "enter_plan_mode", "exit_plan_mode":
		return true
	default:
		return false
	}
}

func (s *Server) runSkillReadTool(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	skillName := coalesce(str(call.Args["skill"]), str(call.Args["skillName"]))
	if skillName == "" {
		skillName = str(call.Args["name"])
	}
	if skillName == "" {
		return toolExecResult{
			Status: "failed", DurationMs: int(time.Since(started).Milliseconds()),
			Error: "缺少 skill 参数", Output: "skill.read 需要 args.skill（技能名）",
		}
	}
	sk := s.CopSvc.FindWorkspaceSkill(ctx.WorkspaceID, "", skillName)
	if sk == nil {
		return toolExecResult{
			Status: "failed", DurationMs: int(time.Since(started).Milliseconds()),
			Error: "技能不存在", Output: "未找到技能「" + skillName + "」",
		}
	}
	pkgPath := str(sk["packagePath"])
	md := ""
	if pkgPath != "" {
		mdPath := filepath.Join(pkgPath, coalesce(str(sk["skillMdPath"]), "SKILL.md"))
		if b, err := os.ReadFile(mdPath); err == nil {
			md = string(b)
		}
	}
	if md == "" {
		md = coalesce(str(sk["description"]), "（无 SKILL.md）")
	}
	return toolExecResult{
		Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【skill.read】%s\n---\n%s", str(sk["name"]), truncateRunes(md, 12000)),
	}
}

func (s *Server) runRuntimeTool(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult {
	switch strings.ToLower(strings.TrimSpace(t.Name)) {
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
	// write_file / edit_file / execute_code / web_search 等实现在 pilotdeck_tools.go
	case "write_file", "edit_file", "web_search", "execute_code", "edit_notebook",
		"send_attachment", "agent", "task_create", "task_list", "task_output",
		"task_wait", "task_stop", "list_mcp_resources", "read_mcp_resource":
		return s.runPilotdeckTool(ctx, t, call, started)
	default:
		return toolExecResult{
			Status: "failed", Error: "未知运行时工具: " + t.Name,
			DurationMs: int(time.Since(started).Milliseconds()),
		}
	}
}

func (s *Server) resolveRuntimeSkill(ctx toolRunContext, call toolCallRequest) map[string]any {
	skillName := coalesce(str(call.Args["skill"]), str(call.Args["skillName"]))
	if skillName != "" {
		if sk := s.CopSvc.FindWorkspaceSkill(ctx.WorkspaceID, "", skillName); sk != nil {
			return sk
		}
	}
	path := filepathToSlash(coalesce(str(call.Args["path"]), coalesce(str(call.Args["file"]), str(call.Args["filename"]))))
	cmd := coalesce(str(call.Args["command"]), str(call.Args["cmd"]))
	hint := strings.ToLower(path + " " + cmd + " " + str(call.Args["content"]))
	prefer := ""
	switch {
	case strings.Contains(hint, "pptx") || strings.Contains(hint, "ppt") || strings.HasSuffix(path, ".mjs") || strings.HasSuffix(path, ".js"):
		prefer = "pptx"
	case strings.Contains(hint, "xlsx") || strings.Contains(hint, "spreadsheet") || strings.Contains(hint, "excel"):
		prefer = "spreadsheets"
	case strings.Contains(hint, "docx") || strings.Contains(hint, "word"):
		prefer = "docx"
	}
	if prefer != "" {
		if sk := s.CopSvc.FindWorkspaceSkill(ctx.WorkspaceID, "", prefer); sk != nil && str(sk["packagePath"]) != "" {
			return sk
		}
	}
	// fallback: first installed skill with packagePath in workspace
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, sk := range s.Store.Skills {
		if str(sk["workspaceId"]) != ctx.WorkspaceID {
			continue
		}
		if str(sk["packagePath"]) != "" && str(sk["kind"]) == "skill" {
			return sk
		}
	}
	return nil
}

func (s *Server) runtimeReadFile(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	sk := s.resolveRuntimeSkill(ctx, call)
	if sk == nil {
		return toolExecResult{Status: "failed", Error: "无可用技能包", Output: "read_file 需要已落盘的技能包", DurationMs: int(time.Since(started).Milliseconds())}
	}
	rel := strings.TrimSpace(coalesce(str(call.Args["path"]), str(call.Args["file"])))
	if rel == "" {
		rel = "SKILL.md"
	}
	rel = filepath.ToSlash(strings.TrimPrefix(rel, "/"))
	if strings.Contains(rel, "..") {
		return toolExecResult{Status: "denied", Permission: "path", Error: "非法路径", DurationMs: int(time.Since(started).Milliseconds())}
	}
	pkgPath := str(sk["packagePath"])
	target := filepath.Join(pkgPath, filepath.FromSlash(rel))
	if !strings.HasPrefix(target, pkgPath+string(os.PathSeparator)) && target != pkgPath {
		return toolExecResult{Status: "denied", Permission: "path", Error: "越界", DurationMs: int(time.Since(started).Milliseconds())}
	}
	b, err := os.ReadFile(target)
	if err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), Output: "读取失败: " + rel, DurationMs: int(time.Since(started).Milliseconds())}
	}
	return toolExecResult{
		Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【read_file】%s (%d bytes)\n%s", rel, len(b), truncateRunes(string(b), 8000)),
	}
}

func (s *Server) runtimeGlob(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	sk := s.resolveRuntimeSkill(ctx, call)
	if sk == nil {
		return toolExecResult{Status: "failed", Error: "无可用技能包", DurationMs: int(time.Since(started).Milliseconds())}
	}
	pattern := coalesce(str(call.Args["pattern"]), str(call.Args["glob"]))
	if pattern == "" {
		pattern = "**/*"
	}
	pkgPath := str(sk["packagePath"])
	var matches []string
	_ = filepath.WalkDir(pkgPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(pkgPath, path)
		rel = filepath.ToSlash(rel)
		if pattern == "**/*" || strings.Contains(rel, strings.Trim(pattern, "*")) {
			matches = append(matches, rel)
		}
		return nil
	})
	if len(matches) == 0 {
		files := decodeStringSlice(sk["packageFiles"])
		matches = files
	}
	return toolExecResult{
		Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【glob】%s 匹配 %d 项\n%s", pattern, len(matches), strings.Join(matches, "\n")),
	}
}

func (s *Server) runtimeGrep(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	sk := s.resolveRuntimeSkill(ctx, call)
	if sk == nil {
		return toolExecResult{Status: "failed", Error: "无可用技能包", DurationMs: int(time.Since(started).Milliseconds())}
	}
	query := strings.TrimSpace(coalesce(str(call.Args["pattern"]), str(call.Args["query"])))
	if query == "" {
		return toolExecResult{Status: "failed", Error: "缺少 pattern", DurationMs: int(time.Since(started).Milliseconds())}
	}
	pkgPath := str(sk["packagePath"])
	var hits []string
	_ = filepath.WalkDir(pkgPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := os.ReadFile(path)
		if err != nil || !strings.Contains(string(b), query) {
			return nil
		}
		rel, _ := filepath.Rel(pkgPath, path)
		hits = append(hits, filepath.ToSlash(rel))
		return nil
	})
	return toolExecResult{
		Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【grep】%q 命中 %d 文件\n%s", query, len(hits), strings.Join(hits, "\n")),
	}
}

func (s *Server) runtimeBash(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult {
	cmd := strings.TrimSpace(coalesce(str(call.Args["command"]), str(call.Args["cmd"])))
	if cmd == "" {
		return toolExecResult{Status: "failed", Error: "缺少 command", Output: "bash 需要 args.command", DurationMs: int(time.Since(started).Milliseconds())}
	}
	sk := s.resolveRuntimeSkill(ctx, call)
	if sk == nil {
		return toolExecResult{Status: "failed", Error: "无可用技能包", DurationMs: int(time.Since(started).Milliseconds())}
	}
	// Auto-fill any .copilot-ws files the run command references but hasn't been written yet.
	// Why: the LLM frequently calls `bash` (or `write_file` + `bash`) before its own write_file
	// step lands, so the run sees a missing outline and preflight rejects it. Skill Turn plans
	// already inject these writes via injectWriteStepsForRunDependencies; direct bash calls
	// bypass that machinery, so we replicate the safety net here.
	// P2: pipe the surrounding user message into ensureWSDepsWritten via a transient
	// _userMessage field so direct bash (no Skill Turn) can still infer an outline when
	// the LLM did not include `content` in its tool call args. Without this, screenshot 1's
	// bare `bash scripts/pptx.sh ... --outline-file ...md` would write nothing and the
	// preflight would refuse with "缺依赖文件".
	if call.Args == nil {
		call.Args = map[string]any{}
	}
	if str(call.Args["_userMessage"]) == "" && ctx.UserMessage != "" {
		call.Args["_userMessage"] = ctx.UserMessage
	}
	if wRes, handled := ensureWSDepsWritten(sk, cmd, call); handled {
		if wRes.Status != "success" {
			return wRes
		}
	}
	runCall := toolCallRequest{
		Name: t.Name,
		Args: map[string]any{"action": "run", "command": cmd, "skillId": str(sk["id"])},
	}
	return s.runSkillTool(ctx, &registeredTool{Name: str(sk["name"]), Kind: "skill", Key: "skill:" + copilot.SlugToolName(str(sk["name"]))}, runCall, started)
}

// ensureWSDepsWritten checks every .copilot-ws/<file> referenced by cmd. If the file doesn't
// exist on disk yet, it is written using args.content if provided, otherwise generated from
// inferOfficeOutline(tool=user-supplied skill, userMessage). Returns (res, true) when at
// least one write happened (caller checks res.Status); (zero, false) when there was nothing
// to inject. Errors are reported as toolExecResult so the run caller can return them
// uniformly.
func ensureWSDepsWritten(sk map[string]any, cmd string, call toolCallRequest) (toolExecResult, bool) {
	deps := copilotWSDepsFromCommand(cmd)
	if len(deps) == 0 {
		return toolExecResult{}, false
	}
	pkgPath := strings.TrimSpace(str(sk["packagePath"]))
	if pkgPath == "" {
		return toolExecResult{}, false
	}
	// Build a synthetic tool registry entry so inferOfficeOutline can branch by skill name.
	toolName := strings.TrimSpace(str(sk["name"]))
	userMessage := strings.TrimSpace(coalesce(
		str(call.Args["_userMessage"]),
		coalesce(str(call.Args["input"]), coalesce(str(call.Args["content"]), str(call.Args["outline"]))),
	))
	regTool := &registeredTool{Name: toolName, Kind: "skill", Key: "skill:" + copilot.SlugToolName(toolName)}

	started := time.Now()
	for _, dep := range deps {
		full := filepath.Join(pkgPath, filepath.FromSlash(dep))
		if _, err := os.Stat(full); err == nil {
			continue // already on disk — nothing to do.
		}
		content := strings.TrimSpace(coalesce(str(call.Args["content"]), str(call.Args["outline"])))
		if content == "" {
			if inferred := inferOfficeOutline(regTool, userMessage); inferred != "" {
				content = inferred
			}
		}
		if content == "" {
			// No content available and outline inference produced nothing — refuse rather
			// than write an empty file. Pre-flight would refuse it anyway downstream.
			continue
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return toolExecResult{
				Status: "failed", Error: err.Error(),
				Output:      "自动写入依赖失败：" + dep,
				DurationMs:  int(time.Since(started).Milliseconds()),
				SandboxID:   "skill-run:auto-write",
			}, true
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			return toolExecResult{
				Status: "failed", Error: err.Error(),
				Output:      "自动写入依赖失败：" + dep,
				DurationMs:  int(time.Since(started).Milliseconds()),
				SandboxID:   "skill-run:auto-write",
			}, true
		}
	}
	return toolExecResult{Status: "success", DurationMs: int(time.Since(started).Milliseconds()), SandboxID: "skill-run:auto-write"}, true
}

func (s *Server) runtimeWebFetch(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult {
	url := strings.TrimSpace(coalesce(str(call.Args["url"]), str(call.Args["uri"])))
	if url == "" {
		return toolExecResult{Status: "failed", Error: "缺少 url", DurationMs: int(time.Since(started).Milliseconds())}
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return toolExecResult{Status: "denied", Permission: "url", Error: "仅支持 http(s)", DurationMs: int(time.Since(started).Milliseconds())}
	}
	req, err := http.NewRequestWithContext(ctx.Request.Context(), http.MethodGet, url, nil)
	if err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), DurationMs: int(time.Since(started).Milliseconds())}
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), Output: "web_fetch 失败", DurationMs: int(time.Since(started).Milliseconds())}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return toolExecResult{
		Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: fmt.Sprintf("【web_fetch】%s status=%d (%d bytes)\n%s", url, resp.StatusCode, len(body), truncateRunes(string(body), 4000)),
	}
}
