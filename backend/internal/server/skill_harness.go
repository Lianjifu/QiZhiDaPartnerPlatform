package server

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
)

const (
	skillActionOpen      = "open"
	skillActionRun       = "run"
	skillActionWrite     = "write"
	skillActionArtifacts = "artifacts"
)

var skillScriptCommandRe = regexp.MustCompile(
	`(?i)^(?:(?:python3?|node|bash|sh)\s+)?(?:\./)?((?:scripts|\.copilot-ws)/[A-Za-z0-9._/-]+\.(?:py|sh|js|mjs|ts))(?:\s+.*)?$`,
)

// normalizeSkillAction maps args.action; empty means "auto" (open vs run inference).
func normalizeSkillAction(args map[string]any) string {
	a := strings.ToLower(strings.TrimSpace(str(args["action"])))
	switch a {
	case "open", "read", "inspect", "describe":
		return skillActionOpen
	case "run", "execute", "exec":
		return skillActionRun
	case "write", "write_file", "put":
		return skillActionWrite
	case "artifacts", "list_artifacts", "list":
		return skillActionArtifacts
	default:
		return ""
	}
}

func looksLikeSkillScriptCommand(cmd string) bool {
	return skillScriptCommandRe.MatchString(strings.TrimSpace(cmd))
}

func skillCommandFromArgs(args map[string]any) string {
	return strings.TrimSpace(coalesce(str(args["command"]), str(args["script"])))
}

// enrichSkillMetadata fills entrypoints / readOnly / producesArtifacts when missing.
func enrichSkillMetadata(sk map[string]any) {
	if sk == nil {
		return
	}
	name := strings.ToLower(str(sk["name"]))
	if sk["producesArtifacts"] == nil {
		sk["producesArtifacts"] = strings.Contains(name, "docx") ||
			strings.Contains(name, "pptx") ||
			strings.Contains(name, "xlsx") ||
			strings.Contains(name, "ppt") ||
			strings.Contains(name, "excel") ||
			strings.Contains(name, "word") ||
			strings.Contains(name, "文档")
	}
	if sk["readOnly"] == nil {
		if boolFrom(sk["hasScripts"]) && !boolFrom(sk["producesArtifacts"]) {
			sk["readOnly"] = true
		} else {
			sk["readOnly"] = !boolFrom(sk["producesArtifacts"]) && !boolFrom(sk["hasScripts"])
		}
	}
	if sk["entrypoints"] == nil {
		scripts := decodeStringSlice(sk["scripts"])
		if len(scripts) > 0 {
			sk["entrypoints"] = scripts
		}
	}
}

func isOfficeSkillName(name string) bool {
	return isDocxSkillName(name) || isPptxSkillName(name) || isPdfSkillName(name)
}

func officeSkillNeedsScriptResult(skillName string, sk map[string]any, started time.Time) toolExecResult {
	name := strings.TrimSpace(skillName)
	if name == "" {
		name = "office"
	}
	scripts := decodeStringSlice(sk["scripts"])
	hint := strings.Join(scripts, ", ")
	if hint == "" {
		hint = strings.Join(decodeStringSlice(sk["entrypoints"]), ", ")
	}
	if hint == "" {
		hint = "(请先 action=open 查看 scripts 列表)"
	}
	kind := "文档"
	switch {
	case isPptxSkillName(name):
		kind = "PPT"
	case isPdfSkillName(name):
		kind = "PDF"
	case isDocxSkillName(name):
		kind = "Word"
	}
	return toolExecResult{
		Status: "needs_instruction", DurationMs: int(time.Since(started).Milliseconds()),
		Error: "须通过 SKILL 脚本生成",
		Output: fmt.Sprintf(
			"【skill.run】%s 技能必须通过 SKILL 包内脚本生成 %s，禁止平台内置快捷生成。\n"+
				"1) action=open 阅读 SKILL.md\n"+
				"2) action=run 且 command 匹配 scripts/... 或 .copilot-ws/...\n"+
				"可用脚本：%s",
			name, kind, hint,
		),
		SandboxID: "skill-run:needs_script",
	}
}

func officeSkillName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return strings.Contains(n, "pptx") || strings.Contains(n, "xlsx") ||
		strings.Contains(n, "ppt") || strings.Contains(n, "excel") ||
		strings.Contains(n, "幻灯") || strings.Contains(n, "表格")
}

// isSandboxCopilotWsPath reports whether a relative path/command targets the skill
// workspace (.copilot-ws/...), which only materializes local downloadable artifacts.
func isSandboxCopilotWsPath(pathOrCmd string) bool {
	p := filepathToSlash(strings.TrimSpace(pathOrCmd))
	if p == "" {
		return false
	}
	// Strip optional interpreter prefix: "node .copilot-ws/gen.mjs"
	if looksLikeSkillScriptCommand(p) {
		if m := skillScriptCommandRe.FindStringSubmatch(p); len(m) == 2 {
			p = m[1]
		}
	}
	return strings.HasPrefix(p, ".copilot-ws/")
}

func isSandboxCopilotWsWriteCall(call toolCallRequest) bool {
	path := coalesce(str(call.Args["path"]), coalesce(str(call.Args["file"]), str(call.Args["filename"])))
	if path == "" {
		path = skillWritePathFromArgs(call.Args)
	}
	return isSandboxCopilotWsPath(path)
}

func isSandboxCopilotWsRunCall(call toolCallRequest) bool {
	cmd := skillCommandFromArgs(call.Args)
	if cmd == "" {
		cmd = coalesce(str(call.Args["command"]), str(call.Args["cmd"]))
	}
	return isSandboxCopilotWsPath(cmd)
}

// isSandboxArtifactSkillInvocation identifies skill runs that only materialize downloadable
// artifacts in the skill sandbox (e.g. builtin docx / .copilot-ws pptx scripts).
func isSandboxArtifactSkillInvocation(tool *registeredTool, sk map[string]any, call toolCallRequest, action string) bool {
	if tool == nil || tool.Kind != "skill" {
		return false
	}
	name := coalesce(str(sk["name"]), tool.Name)
	office := isDocxSkillName(tool.Name) || isDocxSkillName(name) || officeSkillName(tool.Name) || officeSkillName(name)
	if action == skillActionWrite {
		return office && isSandboxCopilotWsWriteCall(call)
	}
	if action != skillActionRun {
		return false
	}
	cmd := skillCommandFromArgs(call.Args)
	// PPT/XLS 等：执行 .copilot-ws 下已写入的生成脚本，仅产出沙箱产物，免人工审核。
	if looksLikeSkillScriptCommand(cmd) && isSandboxCopilotWsPath(cmd) {
		if office {
			return true
		}
		if sk != nil {
			enrichSkillMetadata(sk)
			return boolFrom(sk["producesArtifacts"])
		}
		return false
	}
	if looksLikeSkillScriptCommand(cmd) {
		return false
	}
	if isOfficeSkillName(tool.Name) || isOfficeSkillName(name) {
		return false
	}
	if sk != nil {
		enrichSkillMetadata(sk)
		if boolFrom(sk["producesArtifacts"]) && (isDocxSkillName(name) || officeSkillName(name)) {
			return str(call.Args["content"]) != "" || str(call.Args["title"]) != "" || str(call.Args["input"]) != ""
		}
	}
	return false
}

func skillInvocationNeedsApproval(sessionMode string, tool *registeredTool, sk map[string]any, call toolCallRequest) bool {
	if tool == nil || tool.Kind != "skill" {
		return false
	}
	action := normalizeSkillAction(call.Args)
	cmd := skillCommandFromArgs(call.Args)
	if action == "" {
		if looksLikeSkillScriptCommand(cmd) {
			action = skillActionRun
		} else {
			action = skillActionOpen
		}
	}
	if action == skillActionOpen || action == skillActionArtifacts {
		return false
	}
	if isSandboxArtifactSkillInvocation(tool, sk, call, action) {
		return false
	}
	if normalizeSessionMode(sessionMode) != sessionModeExecute {
		return false
	}
	if tool.RequiresApproval || tool.Mode == toolModeApproval {
		return action == skillActionRun || action == skillActionWrite
	}
	if sk != nil {
		enrichSkillMetadata(sk)
	}
	if action == skillActionWrite {
		return true
	}
	if action == skillActionRun {
		cmd := skillCommandFromArgs(call.Args)
		if !looksLikeSkillScriptCommand(cmd) {
			return false
		}
		if sk != nil && boolFrom(sk["readOnly"]) {
			return false
		}
		if sk != nil && boolFrom(sk["producesArtifacts"]) {
			return true
		}
		if isDocxSkillName(tool.Name) || officeSkillName(tool.Name) {
			return true
		}
	}
	return false
}

func denySkillWriteInInvestigate() toolExecResult {
	return toolExecResult{
		Status: "denied", Permission: "session_mode",
		Error:  "当前模式禁止技能写/执行产出，请切换到「执行」",
		Output: "当前为「问答」或「方案」模式：仅允许 skill action=open / artifacts。写文件或 run 产出请切换到「执行」并经人工审核。",
	}
}

func (s *Server) resolveSkillForTool(ws string, t *registeredTool, skillID string) map[string]any {
	return s.findWorkspaceSkill(ws, skillID, t.Name)
}

// runSkillTool implements the Skill Harness: open / write / run / artifacts.
func (s *Server) runSkillTool(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult {
	ws := ctx.WorkspaceID
	skillID := coalesce(str(call.Args["skillId"]), "")
	action := normalizeSkillAction(call.Args)
	cmd := skillCommandFromArgs(call.Args)
	input := coalesce(str(call.Args["input"]), coalesce(str(call.Args["content"]), ctx.UserMessage))

	if action == "" {
		if looksLikeSkillScriptCommand(cmd) {
			action = skillActionRun
		} else {
			action = skillActionOpen
		}
	}

	if (action == skillActionRun || action == skillActionWrite) && normalizeSessionMode(ctx.SessionMode) == sessionModeInvestigate {
		var skProbe map[string]any
		if s.Store != nil {
			skProbe = s.resolveSkillForTool(ws, t, skillID)
		}
		if isSandboxArtifactSkillInvocation(t, skProbe, call, action) {
			// sandbox .copilot-ws / docx builtin：研判模式也可本地产出下载物
		} else if action == skillActionWrite || looksLikeSkillScriptCommand(skillCommandFromArgs(call.Args)) {
			return denySkillWriteInInvestigate()
		} else if !isSandboxArtifactSkillInvocation(t, skProbe, call, action) {
			return denySkillWriteInInvestigate()
		}
	}

	sk := s.resolveSkillForTool(ws, t, skillID)
	if sk == nil {
		ms := int(time.Since(started).Milliseconds())
		if isOfficeSkillName(t.Name) {
			return toolExecResult{
				Status: "failed", DurationMs: ms,
				Error:  "office 技能未装配",
				Output: fmt.Sprintf("当前工作区未装配「%s」技能，无法生成文档。请在数字员工能力中启用对应 skill 后重试。", t.Name),
			}
		}
		return toolExecResult{
			Status: "failed", DurationMs: ms,
			Error:  "技能不存在：" + t.Name,
			Output: "未找到工作区内技能「" + t.Name + "」。请确认已装配并启用。",
		}
	}
	enrichSkillMetadata(sk)
	skillID = str(sk["id"])

	if isCognitiveSkillName(str(sk["name"])) || isCognitiveSkillName(str(sk["builtinSkillName"])) || boolFrom(sk["cognitive"]) {
		sk["cognitive"] = true
		sk["readOnly"] = true
		sk["producesArtifacts"] = false
		if action == skillActionRun || action == skillActionWrite {
			return toolExecResult{
				Status: "failed", DurationMs: int(time.Since(started).Milliseconds()),
				Error:  "认知框架技能不可 run/write",
				Output: "「" + str(sk["name"]) + "」是认知思路模型技能，仅支持 skill.open 阅读细则；请勿 run。平台会在对话中自动注入 digest。",
			}
		}
	}

	switch action {
	case skillActionOpen:
		return s.skillOpen(ctx, t, sk, started)
	case skillActionArtifacts:
		return s.skillListArtifacts(sk, started)
	case skillActionWrite:
		return s.skillWrite(sk, call, started)
	case skillActionRun:
		return s.skillRun(ctx, t, sk, call, input, started)
	default:
		return s.skillOpen(ctx, t, sk, started)
	}
}

func (s *Server) skillOpen(_ toolRunContext, t *registeredTool, sk map[string]any, started time.Time) toolExecResult {
	md := ""
	pkgPath := str(sk["packagePath"])
	if pkgPath != "" {
		mdPath := filepath.Join(pkgPath, coalesce(str(sk["skillMdPath"]), "SKILL.md"))
		if b, err := os.ReadFile(mdPath); err == nil {
			md = string(b)
		}
	}
	if md == "" {
		md = coalesce(str(sk["description"]), "（无 SKILL.md）")
	}
	scripts := decodeStringSlice(sk["scripts"])
	entries := decodeStringSlice(sk["entrypoints"])
	var b strings.Builder
	b.WriteString("【skill.open】" + str(sk["name"]) + " @" + coalesce(str(sk["version"]), "?") + "\n")
	b.WriteString("skillId=" + str(sk["id"]) + "\n")
	b.WriteString(fmt.Sprintf("readOnly=%v producesArtifacts=%v hasScripts=%v\n",
		boolFrom(sk["readOnly"]), boolFrom(sk["producesArtifacts"]), boolFrom(sk["hasScripts"])))
	if len(entries) > 0 {
		b.WriteString("entrypoints:\n")
		for _, e := range entries {
			b.WriteString("  - " + e + "\n")
		}
	}
	if len(scripts) > 0 {
		b.WriteString("scripts（action=run 的 command 必须匹配其一或 .copilot-ws/ 下已 write 的脚本）:\n")
		for _, sc := range scripts {
			b.WriteString("  - " + sc + "\n")
		}
	} else if isOfficeSkillName(str(sk["name"])) {
		b.WriteString("office skill：禁止 title+content 快捷生成；须 action=run command=scripts/...\n")
		if isDocxSkillName(str(sk["name"])) {
			b.WriteString("示例：bash scripts/docx.sh create --title T --spec-file spec.json --out out.docx\n")
		}
		if isPptxSkillName(str(sk["name"])) {
			b.WriteString("示例：bash scripts/pptx.sh node scripts/build_from_outline.mjs --title T --outline-file O --out F.pptx\n")
		}
	} else {
		b.WriteString("本包无 scripts：不可 run；仅可阅读说明。\n")
	}
	b.WriteString("下一步：按 SKILL.md 选择脚本，输出 <<<TOOL>>> ")
	b.WriteString(`{"name":"` + t.Name + `","args":{"action":"run","command":"scripts/...."}}`)
	b.WriteString("；若需先写生成器：action=write path=.copilot-ws/gen.js content=...\n")
	b.WriteString("--- SKILL.md ---\n")
	b.WriteString(truncateRunes(md, 6000))
	return toolExecResult{
		Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: b.String(), SandboxID: "skill-open:" + str(sk["id"]),
	}
}

func (s *Server) skillWrite(sk map[string]any, call toolCallRequest, started time.Time) toolExecResult {
	pkgPath := str(sk["packagePath"])
	if pkgPath == "" {
		return toolExecResult{
			Status: "failed", DurationMs: int(time.Since(started).Milliseconds()),
			Error: "技能无 packagePath", Output: "无法 write：该技能未落盘技能包",
		}
	}
	rel := strings.TrimSpace(str(call.Args["path"]))
	if rel == "" {
		rel = strings.TrimSpace(str(call.Args["filename"]))
	}
	content := str(call.Args["content"])
	if content == "" {
		content = str(call.Args["input"])
	}
	if rel == "" || content == "" {
		return toolExecResult{
			Status: "failed", DurationMs: int(time.Since(started).Milliseconds()),
			Error: "缺少 path/content", Output: "action=write 需要 args.path（如 .copilot-ws/gen.js）与 args.content",
		}
	}
	rel = filepath.ToSlash(rel)
	rel = strings.TrimPrefix(rel, "/")
	if strings.Contains(rel, "..") {
		return toolExecResult{Status: "denied", Permission: "path", Error: "非法路径", Output: "path 不可包含 .."}
	}
	if !strings.HasPrefix(rel, ".copilot-ws/") {
		rel = ".copilot-ws/" + strings.TrimPrefix(rel, "./")
	}
	target := filepath.Join(pkgPath, filepath.FromSlash(rel))
	if !strings.HasPrefix(target, pkgPath+string(os.PathSeparator)) {
		return toolExecResult{Status: "denied", Permission: "path", Error: "越界", Output: "path 越出包目录"}
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), Output: "创建目录失败", DurationMs: int(time.Since(started).Milliseconds())}
	}
	if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
		return toolExecResult{Status: "failed", Error: err.Error(), Output: "写入失败", DurationMs: int(time.Since(started).Milliseconds())}
	}
	if isDocxSkillName(str(sk["name"])) && strings.HasSuffix(strings.ToLower(rel), ".docx") && looksLikeCodeAsDocxBody(content) {
		ms := int(time.Since(started).Milliseconds())
		return toolExecResult{
			Status: "failed", DurationMs: ms,
			Error:  "正文不能是生成脚本",
			Output: "Word 请通过 scripts/docx.sh 生成；可 write .copilot-ws/ 辅助脚本后再 run，勿 write .docx 或 Python 生成器。",
		}
	}
	return toolExecResult{
		Status:     "success",
		DurationMs: int(time.Since(started).Milliseconds()),
		Output:     fmt.Sprintf("【skill.write】已写入 %s（%d bytes）\n下一步可用 action=run command=%s", rel, len(content), rel),
		SandboxID:  "skill-write:" + str(sk["id"]),
	}
}

func (s *Server) skillListArtifacts(sk map[string]any, started time.Time) toolExecResult {
	dir := skillArtifactDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return toolExecResult{
			Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
			Output: "【skill.artifacts】暂无产物目录或为空",
		}
	}
	var lines []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		low := strings.ToLower(n)
		if !strings.HasSuffix(low, ".docx") && !strings.HasSuffix(low, ".pptx") &&
			!strings.HasSuffix(low, ".xlsx") && !strings.HasSuffix(low, ".pdf") &&
			!strings.HasSuffix(low, ".csv") && !strings.HasSuffix(low, ".zip") {
			continue
		}
		_ = sk
		lines = append(lines, fmt.Sprintf("- %s → /api/skill-artifacts/%s", n, n))
		if len(lines) >= 20 {
			break
		}
	}
	if len(lines) == 0 {
		return toolExecResult{
			Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
			Output: "【skill.artifacts】未找到相关产物",
		}
	}
	return toolExecResult{
		Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Output: "【skill.artifacts】\n" + strings.Join(lines, "\n"),
	}
}

func (s *Server) skillRun(ctx toolRunContext, t *registeredTool, sk map[string]any, call toolCallRequest, input string, started time.Time) toolExecResult {
	actor := "助手"
	if ctx.Viewer != nil && ctx.Viewer.Name != "" {
		actor = ctx.Viewer.Name
	}
	cmd := skillCommandFromArgs(call.Args)

	track := func(ms int, ok bool, source string) {
		if s.Store == nil {
			return
		}
		s.recordSkillInvocationWithRequest(ctx.Request, ctx.WorkspaceID, sk, ms, ok, actor, source)
		if ctx.DigitalPartner != "" {
			s.recordEmployeeRuntime(ctx.DigitalPartner, ms, ok)
		}
	}

	officeName := coalesce(str(sk["name"]), t.Name)
	if isOfficeSkillName(officeName) || isOfficeSkillName(t.Name) {
		if !looksLikeSkillScriptCommand(cmd) {
			ms := int(time.Since(started).Milliseconds())
			track(ms, false, "Copilot · office 需脚本")
			IncOfficeSkillScriptRequired()
			return officeSkillNeedsScriptResult(officeName, sk, started)
		}
	}

	if !looksLikeSkillScriptCommand(cmd) {
		entries := decodeStringSlice(sk["entrypoints"])
		scripts := decodeStringSlice(sk["scripts"])
		hint := strings.Join(scripts, ", ")
		if hint == "" {
			hint = strings.Join(entries, ", ")
		}
		return toolExecResult{
			Status: "needs_instruction", DurationMs: int(time.Since(started).Milliseconds()),
			Error: "command 不是可执行脚本路径",
			Output: "【skill.run】拒绝：command 须匹配 scripts/... 或 .copilot-ws/...\n" +
				"可用：" + coalesce(hint, "(无)") + "\n" +
				"请先 action=open 阅读 SKILL.md，再指定脚本。勿将自然语言当作已执行成功。",
			SandboxID: "skill-run:needs_instruction",
		}
	}

	pkgPath := str(sk["packagePath"])
	if pkgPath == "" {
		return toolExecResult{
			Status: "failed", DurationMs: int(time.Since(started).Milliseconds()),
			Error: "无 packagePath", Output: "技能包未落盘，无法 run 脚本",
		}
	}

	id := ctx.Viewer
	if id == nil {
		return toolExecResult{Status: "denied", Permission: "auth", Error: "缺少身份", Output: "拒绝执行技能"}
	}

	skillID := str(sk["id"])
	s.Store.Lock()
	_, sk2 := s.findSkillLocked(ctx.WorkspaceID, skillID)
	if sk2 == nil && str(sk["workspaceId"]) != "" {
		_, sk2 = s.findSkillLocked(str(sk["workspaceId"]), skillID)
	}
	if sk2 == nil {
		s.Store.Unlock()
		return toolExecResult{Status: "failed", Error: "技能不存在", Output: "技能不存在", DurationMs: int(time.Since(started).Milliseconds())}
	}
	sk = sk2
	if pf, ok := officeSkillRunPreflight(sk, cmd, ctx.UserMessage); !ok {
		ms := int(time.Since(started).Milliseconds())
		s.Store.Unlock()
		s.recordSkillInvocationWithRequest(ctx.Request, ctx.WorkspaceID, sk, ms, false, actor, "Copilot · 预检失败")
		pf.DurationMs = ms
		return pf
	}
	dec := s.evaluateSkillSandboxPolicyLocked(ctx.WorkspaceID, skillID, cmd)
	govPolicy := s.ensureSkillGovernanceLocked(skillID)
	pkgPayload := skillPackagePayload(sk2)
	if dec.Blocked {
		ms := int(time.Since(started).Milliseconds())
		s.Store.Unlock()
		s.recordSkillInvocationWithRequest(ctx.Request, ctx.WorkspaceID, sk2, ms, false, actor, "Copilot · 策略拦截")
		return toolExecResult{
			Status: "denied", Permission: "policy", Error: dec.Reason,
			Output: "策略拦截：" + dec.Reason, DurationMs: ms,
		}
	}
	s.Store.Unlock()

	body := map[string]any{
		"skillId": skillID, "command": cmd, "action": skillActionRun,
		"correlationId": ctx.CorrelationID, "timeoutSec": 90,
	}
	if trimmed := strings.TrimSpace(input); trimmed != "" && !looksLikeCodeAsDocxBody(trimmed) {
		body["input"] = trimmed
	}
	token := auth.MintRunToken(skillID, ctx.WorkspaceID, id.ID, 5*time.Minute)
	body["runToken"] = token
	body["denyControlPlane"] = true
	body["allowedEgress"] = govPolicy["allowedEgress"]
	if pkgPayload != nil {
		for k, v := range pkgPayload {
			body[k] = v
		}
	}
	result, runtimeErr := s.callSkillRuntime(body)
	ms := int(time.Since(started).Milliseconds())
	if runtimeErr != nil {
		track(ms, false, "Copilot · 运行时失败")
		return toolExecResult{
			Status: "failed", DurationMs: ms, Error: runtimeErr.Error(),
			Output: "技能运行时不可用：" + runtimeErr.Error(), SandboxID: "skill-runtime",
		}
	}
	out := coalesce(str(result["stdout"]), coalesce(str(result["preview"]), fmt.Sprintf("%v", result)))
	if dl := str(result["downloadPath"]); dl != "" && !strings.Contains(out, dl) {
		out = strings.TrimSpace(out + "\n下载链接：" + dl)
	}
	// 包脚本成功但未登记 downloadPath 时，从 package 目录收割最近产物。
	status := "success"
	rtStatus := str(result["status"])
	if rtStatus == "needs_instruction" {
		status = "needs_instruction"
	} else if ok, isBool := result["ok"].(bool); isBool && !ok {
		status = "failed"
	}
	if status == "success" && !strings.Contains(out, "/api/skill-artifacts/") {
		if storage, download, _, herr := harvestOfficeArtifactsFromDir(pkgPath); herr == nil && download != "" {
			out = strings.TrimSpace(out + "\n文件名：" + storage + "\n下载链接：" + download)
			result["downloadPath"] = download
		}
	}
	if d := intFrom(result["durationMs"]); d > 0 {
		ms = d
	}
	track(ms, status == "success", "Copilot · skill.run")
	errMsg := ""
	if status != "success" {
		errMsg = coalesce(str(result["error"]), status)
	}
	return toolExecResult{
		Status: status, DurationMs: ms, Output: truncateRunes(out, 4000),
		Error: errMsg, SandboxID: "skill-runtime:" + skillID,
	}
}

// dispatchAuthorizedTool runs authorize → skill approval gate → queue or execute.
func (s *Server) dispatchAuthorizedTool(
	runCtx toolRunContext,
	reg []registeredTool,
	call toolCallRequest,
	sessionMode, risk string,
	emit reactEmitFunc,
) (tool *registeredTool, res toolExecResult) {
	tool, deny := authorizeToolCall(reg, call)
	// .copilot-ws 沙箱写脚本：与 skill.write 对齐，免非 skill 的 RequiresApproval 拦截。
	if deny != nil && deny.Permission == "approval_required" && tool != nil &&
		(strings.EqualFold(tool.Name, "write_file") || strings.EqualFold(tool.Name, "edit_file")) &&
		isSandboxCopilotWsWriteCall(call) {
		deny = nil
	}
	if deny == nil && tool != nil && tool.Kind == "skill" {
		sk := s.resolveSkillForTool(runCtx.WorkspaceID, tool, str(call.Args["skillId"]))
		if skillInvocationNeedsApproval(sessionMode, tool, sk, call) {
			deny = &toolExecResult{
				Status: "denied", Permission: "approval_required",
				Error:  "工具需要人工审核授权后才能执行：" + tool.Name,
				Output: "写类 skill.run/write 需人工审核。请等待授权卡，勿声称已执行。",
			}
		}
	}
	if deny != nil {
		if deny.Permission == "approval_required" && tool != nil && normalizeSessionMode(sessionMode) == sessionModeExecute {
			if tool.Kind == "skill" {
				if call.Args == nil {
					call.Args = map[string]any{}
				}
				if normalizeSkillAction(call.Args) == "" {
					call.Args["action"] = skillActionRun
				}
			}
			return tool, s.queueToolAuthorization(runCtx, tool, call, coalesce(risk, "medium"), emit)
		}
		res = *deny
		return tool, res
	}
	return tool, s.runCopilotTool(runCtx, tool, call)
}
