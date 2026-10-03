package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/skills/artifacts"
)

var reOfficeDepFlag = regexp.MustCompile(`(?i)(?:--(?:outline-file|outline|input|spec|patch-file|spec-file))\s+("([^"]+)"|'([^']+)'|(\S+))`)

// copilotWSInputDepsFromCommand extracts input .copilot-ws/ paths (outline/spec); excludes --out targets.
func copilotWSInputDepsFromCommand(cmd string) []string {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, 2)
	add := func(raw string) {
		p := normalizeCopilotWSPath(raw)
		if p == "" {
			return
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	for _, m := range reOfficeDepFlag.FindAllStringSubmatch(cmd, -1) {
		if len(m) < 5 {
			continue
		}
		add(coalesce(m[2], coalesce(m[3], m[4])))
	}
	return out
}

func copilotWSDepsFromCommand(cmd string) []string {
	return copilotWSInputDepsFromCommand(cmd)
}

func normalizeCopilotWSPath(raw string) string {
	p := filepathToSlash(strings.TrimSpace(raw))
	p = strings.Trim(p, `"'`)
	if p == "" || strings.Contains(p, "..") {
		return ""
	}
	if !strings.HasPrefix(p, ".copilot-ws/") {
		return ""
	}
	return p
}

func writeContentFromArgs(args map[string]any) string {
	return strings.TrimSpace(coalesce(str(args["outline"]), coalesce(str(args["content"]), coalesce(str(args["input"]), str(args["body"])))))
}

// inferOfficeOutline produces a real, multi-section outline for an office skill when the model
// did not supply outline/content in args. Replaces the old 3-bullet placeholder which generated
// 1-page stub PPTs. Branched per skill kind so PPT/Word/Excel each get a sensible skeleton.
//
// Why: previously `defaultOutlinePlaceholder(skillName)` always returned the same 3-bullet text
// regardless of skill type, producing a 1-page stub PPT even for legitimate requests like
// "输出 Q3 研发季度汇报模版 PPT". The PPT-specific templates already exist
// (defaultPptxOutlineForMessage); this routes through them and adds docx/xlsx equivalents.
func inferOfficeOutline(tool *registeredTool, userMessage string) string {
	name := ""
	if tool != nil {
		name = strings.ToLower(strings.TrimSpace(tool.Name))
	}
	switch {
	case artifacts.IsPptxSkillName(name):
		title := artifacts.InferPptxTitleFromMessage(userMessage)
		if title == "" && tool != nil {
			title = strings.TrimSpace(tool.Name)
		}
		return artifacts.DefaultPptxOutlineForMessage(title, userMessage)
	case artifacts.IsDocxSkillName(name):
		title := artifacts.InferDocxTitleFromMessage(userMessage)
		if title == "" && tool != nil {
			title = strings.TrimSpace(tool.Name)
		}
		return artifacts.DefaultDocxOutlineForMessage(title, userMessage)
	case artifacts.IsSpreadsheetSkillName(name):
		title := artifacts.InferXlsxTitleFromMessage(userMessage)
		if title == "" && tool != nil {
			title = strings.TrimSpace(tool.Name)
		}
		return artifacts.DefaultXlsxOutlineForMessage(title, userMessage)
	}
	return ""
}

// rescueMissingOfficeDep tries to materialize a missing .copilot-ws/<dep> from user intent.
// Returns true when the file is successfully written so the preflight loop can re-check.
//
// Why: bash calls (and the LLM's first bash in a Skill Turn) can race the write_file
// step. Without this rescue, preflight rejects the run with "缺依赖文件" even though
// the agent clearly meant to generate a real outline. Better to materialize one from
// intent and let quality gates still reject the stub if it's too thin.
//
// Caveat: this only fires for office skills. Other skills don't have outline inference.
func rescueMissingOfficeDep(sk map[string]any, pkgPath, dep, name, userMessage string) bool {
	if userMessage == "" {
		return false
	}
	if !strings.HasPrefix(dep, ".copilot-ws/") {
		return false
	}
	tool := &registeredTool{Name: name, Kind: "skill", Key: "skill:" + copilot.SlugToolName(name)}
	content := inferOfficeOutline(tool, userMessage)
	if content == "" {
		return false
	}
	full := filepath.Join(pkgPath, filepath.FromSlash(dep))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return false
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		return false
	}
	return true
}

func planWritesPath(plan map[string]any, dep string) bool {
	dep = normalizeCopilotWSPath(dep)
	if dep == "" {
		return false
	}
	for _, st := range skillTurnSteps(plan) {
		if str(st["action"]) != skillActionWrite {
			continue
		}
		a, _ := st["args"].(map[string]any)
		if a == nil {
			continue
		}
		if normalizeCopilotWSPath(skillWritePathFromArgs(a)) == dep {
			return true
		}
		if normalizeCopilotWSPath(str(a["path"])) == dep {
			return true
		}
	}
	return false
}

// injectWriteStepsForRunDependencies prepends write steps for .copilot-ws files referenced by run command.
// Each injected write step gets a stable id (`write-<sanitized-dep>`); the run step is updated
// with a `deps: [<write-id>]` field so the executor can enforce write → run ordering even if
// the plan was perturbed (skill mismatch, parallel dispatch, retry).
func injectWriteStepsForRunDependencies(steps []map[string]any, args map[string]any, cmd, userMessage string, tool *registeredTool) []map[string]any {
	if tool == nil || !officeSkillName(tool.Name) {
		return steps
	}
	deps := copilotWSDepsFromCommand(cmd)
	if len(deps) == 0 {
		return steps
	}
	plan := map[string]any{"steps": steps}
	prefix := make([]map[string]any, 0, len(deps))
	content := writeContentFromArgs(args)
	writeIDs := make([]string, 0, len(deps))
	for _, dep := range deps {
		if planWritesPath(plan, dep) {
			continue
		}
		already := false
		for _, p := range prefix {
			a, _ := p["args"].(map[string]any)
			if normalizeCopilotWSPath(skillWritePathFromArgs(a)) == dep {
				already = true
				break
			}
		}
		if already {
			continue
		}
		writeArgs := cloneArgs(args)
		writeArgs["action"] = skillActionWrite
		writeArgs["path"] = dep
		if content != "" {
			writeArgs["content"] = content
		} else {
			// Real outline generated from user intent (replaces old 3-bullet placeholder).
			// If inference returns empty (unknown skill), leave content unset so preflight
			// can refuse rather than silently fabricating a stub.
			if inferred := inferOfficeOutline(tool, userMessage); inferred != "" {
				writeArgs["content"] = inferred
			}
		}
		stepID := "write-" + strings.NewReplacer("/", "-", ".", "-").Replace(dep)
		writeIDs = append(writeIDs, stepID)
		prefix = append(prefix, map[string]any{
			"id": stepID, "action": skillActionWrite,
			"title": "写入 " + dep,
			"args":  writeArgs, "status": "pending",
		})
	}
	if len(prefix) == 0 {
		return steps
	}
	// Tag the existing run step(s) with deps pointing at the injected write steps so the
	// Skill Turn executor won't dispatch them until writes land. Without this guard,
	// screenshot 1's `bash` ran in parallel with `write_file` and preflight rejected it.
	for i, st := range steps {
		if str(st["action"]) != skillActionRun {
			continue
		}
		st["deps"] = append([]string{}, writeIDs...)
		steps[i] = st
	}
	return append(prefix, steps...)
}

// officeOutlineQuality returns (minSections, minChars, requireH1) for content quality checks.
func officeOutlineQuality(skillName string) (minSections, minChars int, requireH1 bool) {
	n := strings.ToLower(strings.TrimSpace(skillName))
	switch {
	case artifacts.IsPptxSkillName(n):
		return 3, 200, true
	case artifacts.IsDocxSkillName(n):
		return 3, 200, true
	case artifacts.IsSpreadsheetSkillName(n):
		return 1, 80, false
	}
	return 0, 0, false
}

// keywordFloorForSkill returns a list of "intent" keywords. At least one must appear in
// the outline so we don't accept a generic 9-section template that says nothing specific.
// Why: catches the "Q3 季度汇报" failure mode where the model emits an outline that looks
// detailed but contains no concrete topic markers.
func keywordFloorForSkill(skillName string) []string {
	n := strings.ToLower(strings.TrimSpace(skillName))
	switch {
	case artifacts.IsPptxSkillName(n):
		return []string{"汇报", "季度", "季度", "目标", "进展", "总结", "规划", "%", "完成", "项目", "风险", "计划"}
	case artifacts.IsDocxSkillName(n):
		return []string{"岗位", "职责", "要求", "学历", "经验", "流程", "制度", "说明", "部门", "工作"}
	case artifacts.IsSpreadsheetSkillName(n):
		return []string{"收入", "成本", "利润", "元", "%", "员工", "部门", "考勤", "预算", "数据", "统计"}
	}
	return nil
}

// Placeholder patterns that signal "model didn't bother writing real content".
// Three-or-more underscores, the explicit Chinese/Japanese tags, and template-style braces.
var rePlaceholderPattern = regexp.MustCompile(`_{3,}|\[待填\]|\[TODO\]|\{\{[^}]+\}\}`)

// countPlaceholderLines returns the number of non-empty lines that contain at least one
// placeholder token, plus the total non-empty line count for ratio calculation.
func countPlaceholderLines(body string) (placeholderLines, totalLines int) {
	for _, raw := range strings.Split(body, "\n") {
		trim := strings.TrimSpace(raw)
		if trim == "" {
			continue
		}
		totalLines++
		if rePlaceholderPattern.MatchString(trim) {
			placeholderLines++
		}
	}
	return placeholderLines, totalLines
}

// clarifyingQuestionsForSkill returns a short list of questions the agent should ask the
// user when their original message lacks enough specifics to generate a meaningful artifact.
// Surfaced in the preflight error so the next agent turn (or a human copilot operator) can
// elicit the missing facts instead of looping with another generic template.
func clarifyingQuestionsForSkill(skillName string) []string {
	n := strings.ToLower(strings.TrimSpace(skillName))
	switch {
	case artifacts.IsPptxSkillName(n):
		return []string{
			"汇报对象与场景（如部门季度汇报 / 项目复盘 / 客户提案）？",
			"覆盖的时间范围与核心 KPI 指标？",
			"重点项目 / 关键里程碑清单？",
		}
	case artifacts.IsDocxSkillName(n):
		return []string{
			"文档主题与目标读者（招聘 JD / 制度说明 / 流程指南）？",
			"必须包含的关键事实（岗位 / 部门 / 薪资范围 / 流程节点）？",
		}
	case artifacts.IsSpreadsheetSkillName(n):
		return []string{
			"数据维度与口径（按部门 / 按项目 / 按月份）？",
			"字段清单与单位（金额单位 / 数量 / 日期格式）？",
			"汇总行 / 合计公式的边界？",
		}
	}
	return nil
}

// containsAnyKeyword returns true if body contains at least one keyword from the floor
// list. Uses a word-boundary-ish check for short CJK keywords (substring is fine since
// CJK has no whitespace between words).
func containsAnyKeyword(body string, keywords []string) (matched string, ok bool) {
	low := strings.ToLower(body)
	for _, kw := range keywords {
		if kw == "" {
			continue
		}
		if strings.Contains(low, strings.ToLower(kw)) {
			return kw, true
		}
	}
	return "", false
}

// officeSkillRunPreflight validates package and run dependencies before sandbox execution.
// Beyond file existence, it now checks content quality (min sections / chars) to refuse
// fabricated placeholders and trivially-thin outlines.
//
// userMessage: when a missing dep can be auto-rescued by inferring an outline from
// user intent, preflight will write it on the spot and re-check rather than failing.
// Empty userMessage skips the rescue (callers that don't have conversation context
// pass "" and preflight falls back to the original "缺依赖文件" refusal).
func officeSkillRunPreflight(sk map[string]any, cmd, userMessage string) (fail toolExecResult, ok bool) {
	if sk == nil {
		return toolExecResult{}, true
	}
	name := coalesce(str(sk["name"]), "")
	if !isOfficeSkillName(name) && !officeSkillName(name) {
		return toolExecResult{}, true
	}
	if !looksLikeSkillScriptCommand(cmd) {
		return toolExecResult{}, true
	}
	pkgPath := strings.TrimSpace(str(sk["packagePath"]))
	if pkgPath == "" {
		IncOfficeSkillPackageMissing()
		msg := fmt.Sprintf("技能包未落盘（packagePath 为空），请先在技能中心安装并启用「%s」", coalesce(name, "office"))
		return toolExecResult{
			Status: "failed", Error: msg,
			Output: "【预检失败】" + msg + "\n提示：安装内置 pptx/docx 技能包后重试。",
		}, false
	}
	if _, err := os.Stat(pkgPath); err != nil {
		IncOfficeSkillPackageMissing()
		msg := fmt.Sprintf("技能包目录不存在：%s", pkgPath)
		return toolExecResult{
			Status: "failed", Error: msg,
			Output: "【预检失败】" + msg,
		}, false
	}
	minSec, minChars, requireH1 := officeOutlineQuality(name)
	for _, dep := range copilotWSDepsFromCommand(cmd) {
		full := filepath.Join(pkgPath, filepath.FromSlash(dep))
		st, err := os.Stat(full)
		if err != nil {
			// P0 rescue: if the missing dep is a .copilot-ws outline and we can infer
			// one from user intent, write it on the spot and re-check instead of failing.
			// Why: the React loop can dispatch `bash scripts/...sh --outline-file ...md`
			// before the agent has emitted its own write_file call. Without this rescue,
			// the user sees a red "缺依赖文件" step (screenshot of the latest audit).
			if rescueOK := rescueMissingOfficeDep(sk, pkgPath, dep, name, userMessage); rescueOK {
				st, err = os.Stat(full)
				if err == nil {
					goto haveFile
				}
			}
			IncOfficeSkillPreflightFailed()
			msg := fmt.Sprintf("缺少依赖文件 %s（须先 action=write 写入或等待 Skill Turn write 步骤完成）", dep)
			return toolExecResult{
				Status: "failed", Error: msg,
				Output: "【预检失败】" + msg,
			}, false
		}
	haveFile:
		if minSec == 0 && minChars == 0 {
			continue
		}
		raw, rerr := os.ReadFile(full)
		if rerr != nil {
			IncOfficeSkillPreflightFailed()
			msg := fmt.Sprintf("无法读取依赖文件 %s：%v", dep, rerr)
			return toolExecResult{
				Status: "failed", Error: msg,
				Output: "【预检失败】" + msg,
			}, false
		}
		if st.Size() == 0 || strings.TrimSpace(string(raw)) == "" {
			IncOfficeSkillPreflightFailed()
			msg := fmt.Sprintf("依赖文件 %s 内容为空，请在 write 步骤补充大纲或正文", dep)
			return toolExecResult{
				Status: "failed", Error: msg,
				Output: "【预检失败】" + msg,
			}, false
		}
		body := string(raw)
		// count markdown sections (# ... ignoring #!/shebangs)
		h1 := 0
		sec := 0
		for _, line := range strings.Split(body, "\n") {
			trim := strings.TrimSpace(line)
			if strings.HasPrefix(trim, "# ") {
				h1++
				sec++
			} else if strings.HasPrefix(trim, "## ") {
				sec++
			}
		}
		runes := len([]rune(body))
		if requireH1 && h1 < 1 {
			IncOfficeSkillPreflightFailed()
			msg := fmt.Sprintf("依赖文件 %s 缺少一级标题（# 标题），无法渲染为 %s 产物", dep, name)
			return toolExecResult{
				Status: "failed", Error: msg,
				Output: "【预检失败】" + msg,
			}, false
		}
		if sec < minSec || runes < minChars {
			IncOfficeSkillPreflightFailed()
			msg := fmt.Sprintf("依赖文件 %s 内容不足：至少需要 %d 个章节、%d 个字符（当前 %d 章节 / %d 字符）", dep, minSec, minChars, sec, runes)
			return toolExecResult{
				Status: "failed", Error: msg,
				Output: "【预检失败】" + msg + "\n提示：在 write 步骤补充内容后再执行。",
			}, false
		}
		// Gate 3: refuse placeholder-heavy outlines (e.g. `_____` fill-ins, `[待填]`, `{{...}}`).
		// Why: a 9-section outline stuffed with blanks still passed the size gate but produced
		// a useless "fill-in-the-form" PPT — the user's original complaint.
		phLines, totLines := countPlaceholderLines(body)
		if totLines > 0 && phLines*10 > totLines {
			IncOfficeSkillPreflightFailed()
			msg := fmt.Sprintf("依赖文件 %s 含占位符比例过高（%d/%d 行）：禁止大量 `____`/`[待填]`/`{{...}}` 等占位符，请补写实际内容", dep, phLines, totLines)
			out := "【预检失败】" + msg + "\n提示：每个 H2 段必须给出 2-3 句实际描述，不要输出占位符。"
			if qs := clarifyingQuestionsForSkill(name); len(qs) > 0 {
				out += "\n如信息不足，可先向用户追问：\n- " + strings.Join(qs, "\n- ")
			}
			return toolExecResult{
				Status: "failed", Error: msg,
				Output: out,
			}, false
		}
		// Gate 4: keyword floor — for office skills, require at least one topic-specific
		// keyword so we don't accept a generic template that ignores the user's intent.
		if floor := keywordFloorForSkill(name); len(floor) > 0 {
			if _, ok := containsAnyKeyword(body, floor); !ok {
				IncOfficeSkillPreflightFailed()
				msg := fmt.Sprintf("依赖文件 %s 缺少主题关键词：需要在正文中体现实际内容（关键词如 %s 等）", dep, strings.Join(floor[:min(6, len(floor))], "/"))
				out := "【预检失败】" + msg + "\n提示：请按用户原始诉求补写具体内容（项目、数据、关键节点），不要照抄通用模板。"
				if qs := clarifyingQuestionsForSkill(name); len(qs) > 0 {
					out += "\n如信息不足，可先向用户追问：\n- " + strings.Join(qs, "\n- ")
				}
				return toolExecResult{
					Status: "failed", Error: msg,
					Output: out,
				}, false
			}
		}
	}
	return toolExecResult{}, true
}
