package copilot

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/qizhida-partner-platform/backend/pkg/contract"
)

// Cognitive framework IDs for conversation thinking model.
const (
	cognitiveLogic    = "logic"
	cognitiveProblem  = "problem"
	cognitiveCreative = "creative"
)

const (
	cognitiveModeQuick    = "quick"
	cognitiveModeStandard = "standard"
	cognitiveModeDeep     = "deep"
)

// Cognitive skill directory names (builtin).
var cognitiveSkillNames = []string{
	"general-logic-thinking-assistant",
	"general-problem-solving-analysis-assistant",
	"general-creative-decision-assistant",
}

var cognitiveSkillByFramework = map[string]string{
	cognitiveLogic:    "general-logic-thinking-assistant",
	cognitiveProblem:  "general-problem-solving-analysis-assistant",
	cognitiveCreative: "general-creative-decision-assistant",
}

var cognitiveFrameworkLabel = map[string]string{
	cognitiveLogic:    "逻辑思考分析",
	cognitiveProblem:  "问题解决分析",
	cognitiveCreative: "创意决策分析",
}

type cognitiveDecision struct {
	Bypass          bool
	BypassReason    string
	Primary         string
	Secondary       string
	Mode            string
	Phases          []string
	Reasons         []string
	Confidence      float64
	DigestText      string
	DigestTokensEst int
	Enabled         bool
	MaxFrameworks   int
}

var cognitiveDigestCache sync.Map // skillName -> string

func cognitiveLabel(id string) string {
	if v := cognitiveFrameworkLabel[id]; v != "" {
		return v
	}
	return id
}

func employeeCognitiveConfig(emp map[string]any) (enabled bool, maxFrameworks int, preferred string) {
	enabled = true
	maxFrameworks = 2
	if emp == nil {
		return enabled, maxFrameworks, ""
	}
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return enabled, maxFrameworks, ""
	}
	cog, _ := caps["cognitive"].(map[string]any)
	if cog == nil {
		return enabled, maxFrameworks, ""
	}
	if v, ok := cog["enabled"].(bool); ok {
		enabled = v
	}
	if n := intFrom(cog["maxFrameworksPerTurn"]); n > 0 {
		maxFrameworks = n
		if maxFrameworks > 2 {
			maxFrameworks = 2
		}
	}
	preferred = strings.TrimSpace(str(cog["preferredFramework"]))
	return enabled, maxFrameworks, preferred
}

func employeeShowNarrative(emp map[string]any) bool {
	if emp == nil {
		return true
	}
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return true
	}
	cog, _ := caps["cognitive"].(map[string]any)
	if cog == nil {
		return true
	}
	if v, ok := cog["showNarrative"].(bool); ok {
		return v
	}
	return true
}

func employeeCognitiveEnabled(emp map[string]any) bool {
	enabled, _, _ := employeeCognitiveConfig(emp)
	return enabled
}

func decideCognitiveFramework(userMsg, harnessMode, policyLevel string, emp map[string]any) cognitiveDecision {
	enabled, maxFW, _ := employeeCognitiveConfig(emp)
	d := cognitiveDecision{
		Enabled:       enabled,
		Mode:          cognitiveModeStandard,
		Confidence:    0.62,
		Phases:        []string{"define", "analyze", "conclude"},
		MaxFrameworks: maxFW,
	}
	if !d.Enabled {
		d.Bypass = true
		d.BypassReason = "cognitive_disabled"
		return d
	}
	msg := strings.TrimSpace(userMsg)
	if msg == "" {
		d.Bypass = true
		d.BypassReason = "empty"
		return d
	}
	lower := strings.ToLower(msg)

	for _, k := range []string{"不要分析框架", "别用框架", "直接答", "只要一句话", "不要分析"} {
		if strings.Contains(msg, k) {
			d.Bypass = true
			d.BypassReason = "user_opt_out"
			return d
		}
	}

	runes := utf8.RuneCountInString(msg)
	if runes <= 8 && !strings.ContainsAny(msg, "？?") {
		d.Bypass = true
		d.BypassReason = "short_chitchat"
		return d
	}
	if isCognitiveBypassTask(msg, lower, runes) {
		d.Bypass = true
		d.BypassReason = "simple_or_artifact"
		return d
	}

	primary, secondary, reasons, conf := routeCognitiveFrameworks(msg, lower, emp)
	d.Primary = primary
	d.Secondary = secondary
	d.Reasons = reasons
	d.Confidence = conf

	switch {
	case harnessMode == modePlanExec || harnessMode == modeMultiAgent || policyLevel == "P0":
		d.Mode = cognitiveModeDeep
	case harnessMode == modeDirect || runes < 40:
		d.Mode = cognitiveModeQuick
	default:
		d.Mode = cognitiveModeStandard
	}
	if d.Mode == cognitiveModeQuick || d.MaxFrameworks < 2 {
		if d.Secondary != "" {
			d.Reasons = append(d.Reasons, "secondary_trimmed")
		}
		d.Secondary = ""
	}
	d.Phases = cognitivePhasesFor(primary, d.Mode)
	d.DigestText = buildCognitiveDigestBlock(d)
	d.DigestTokensEst = estimateCognitiveDigestTokens(d.DigestText)
	return d
}

func isCognitiveBypassTask(msg, lower string, runes int) bool {
	for _, k := range []string{"翻译成", "翻译为", "translate to", "translate into", "改写为", "润色一下", "polish this"} {
		if strings.Contains(lower, k) || strings.Contains(msg, k) {
			return true
		}
	}
	if runes <= 40 && (strings.HasPrefix(msg, "翻译") || strings.HasPrefix(lower, "translate") || strings.HasPrefix(msg, "润色")) {
		return true
	}
	hasArtifact := strings.Contains(lower, "ppt") || strings.Contains(lower, "pptx") ||
		strings.Contains(msg, "幻灯") || strings.Contains(lower, "docx") ||
		strings.Contains(msg, "Word") || strings.Contains(msg, "文档") ||
		strings.Contains(lower, "pdf")
	hasGen := strings.Contains(msg, "生成") || strings.Contains(msg, "制作") || strings.Contains(msg, "导出")
	if hasArtifact && hasGen && !cognitiveHasAnalyzeIntent(msg, lower) {
		return true
	}
	return false
}

func cognitiveHasAnalyzeIntent(msg, lower string) bool {
	for _, k := range []string{
		"分析", "怎么改进", "如何", "为什么", "方案", "决策", "根因", "对比",
		"梳理", "判断", "选型", "利弊", "复盘", "瓶颈", "论证",
	} {
		if strings.Contains(msg, k) || strings.Contains(lower, strings.ToLower(k)) {
			return true
		}
	}
	return false
}

func routeCognitiveFrameworks(msg, lower string, emp map[string]any) (primary, secondary string, reasons []string, conf float64) {
	// Explicit opt-in / force framework
	forceHits := []struct {
		keys []string
		id   string
	}{
		{[]string{"用问题解决", "按问题解决", "用问题分析框架"}, cognitiveProblem},
		{[]string{"用创意决策", "按创意决策", "用决策矩阵"}, cognitiveCreative},
		{[]string{"用逻辑思考", "按逻辑框架", "用逻辑分析"}, cognitiveLogic},
	}
	for _, f := range forceHits {
		for _, k := range f.keys {
			if strings.Contains(msg, k) {
				return f.id, "", []string{"user_force:" + f.id}, 0.9
			}
		}
	}

	creativeHit := scoreCognitiveHints(msg, lower, []string{
		"创意", "点子", "头脑风暴", "选型", "怎么选", "哪个方案", "决策矩阵", "利弊比较",
		"试点", "方案对比", "发散", "scamper", "商业模式", "活动策划",
	})
	problemHit := scoreCognitiveHints(msg, lower, []string{
		"根因", "故障", "异常", "延期", "瓶颈", "怎么推进", "排障", "事故", "复盘",
		"未达成", "阻塞", "修复", "止损", "最短路径", "负责人", "卡点",
	})
	logicHit := scoreCognitiveHints(msg, lower, []string{
		"分析", "判断", "是否成立", "论证", "梳理", "观点", "逻辑", "推理",
		"评价", "怎么看", "利弊", "边界",
	})
	// Soft opt-in for analysis without strong category
	if cognitiveHasAnalyzeIntent(msg, lower) && creativeHit+problemHit+logicHit == 0 {
		logicHit++
		reasons = append(reasons, "soft_analyze")
	}

	if pref := departmentCognitivePref(emp); pref != "" {
		switch pref {
		case cognitiveCreative:
			creativeHit++
		case cognitiveProblem:
			problemHit++
		case cognitiveLogic:
			logicHit++
		}
		reasons = append(reasons, "dept_pref:"+pref)
	}

	type scored struct {
		id string
		n  int
	}
	cands := []scored{
		{cognitiveCreative, creativeHit},
		{cognitiveProblem, problemHit},
		{cognitiveLogic, logicHit},
	}
	for i := 0; i < len(cands); i++ {
		for j := i + 1; j < len(cands); j++ {
			if cands[j].n > cands[i].n {
				cands[i], cands[j] = cands[j], cands[i]
			}
		}
	}
	if cands[0].n == 0 {
		return cognitiveLogic, "", append(reasons, "default_logic"), 0.55
	}
	primary = cands[0].id
	reasons = append(reasons, "signal:"+primary)
	conf = 0.58 + float64(cands[0].n)*0.06
	if conf > 0.92 {
		conf = 0.92
	}
	if cands[1].n > 0 && cands[1].n >= cands[0].n-1 && cands[1].n >= 2 {
		secondary = cands[1].id
		reasons = append(reasons, "secondary:"+secondary)
	}
	if primary == cognitiveProblem && creativeHit > 0 && strings.Contains(msg, "选") {
		secondary = cognitiveCreative
	}
	return primary, secondary, reasons, conf
}

func departmentCognitivePref(emp map[string]any) string {
	if emp == nil {
		return ""
	}
	if caps, _ := emp["capabilities"].(map[string]any); caps != nil {
		if cog, _ := caps["cognitive"].(map[string]any); cog != nil {
			if p := strings.TrimSpace(str(cog["preferredFramework"])); p != "" {
				switch p {
				case cognitiveLogic, cognitiveProblem, cognitiveCreative:
					return p
				}
			}
		}
	}
	dept := strings.ToLower(str(emp["department"]) + " " + str(emp["role"]))
	switch {
	case strings.Contains(dept, "运维") || strings.Contains(dept, "sre") || strings.Contains(dept, "infra"):
		return cognitiveProblem
	case strings.Contains(dept, "产品") || strings.Contains(dept, "市场") || strings.Contains(dept, "设计"):
		return cognitiveCreative
	case strings.Contains(dept, "研究") || strings.Contains(dept, "战略") || strings.Contains(dept, "分析"):
		return cognitiveLogic
	}
	return ""
}

func scoreCognitiveHints(msg, lower string, keys []string) int {
	n := 0
	for _, k := range keys {
		kl := strings.ToLower(k)
		if strings.Contains(msg, k) || strings.Contains(lower, kl) {
			n++
		}
	}
	return n
}

func cognitivePhasesFor(primary, mode string) []string {
	switch primary {
	case cognitiveCreative:
		switch mode {
		case cognitiveModeQuick:
			return []string{"clarify", "diverge", "compare", "recommend"}
		case cognitiveModeDeep:
			return []string{"clarify", "diverge", "cluster", "options", "matrix", "recommend", "pilot"}
		default:
			return []string{"clarify", "diverge", "options", "compare", "recommend"}
		}
	case cognitiveProblem:
		switch mode {
		case cognitiveModeQuick:
			return []string{"define", "action"}
		case cognitiveModeDeep:
			return []string{"define", "scope", "bottleneck", "hypotheses", "action", "verify"}
		default:
			return []string{"define", "bottleneck", "hypotheses", "action"}
		}
	default: // logic
		switch mode {
		case cognitiveModeQuick:
			return []string{"restate", "conclude"}
		case cognitiveModeDeep:
			return []string{"restate", "structure", "reason", "counter", "conclude", "act"}
		default:
			return []string{"restate", "structure", "conclude", "act"}
		}
	}
}

func loadCognitiveDigest(skillName string) string {
	if skillName == "" {
		return ""
	}
	if v, ok := cognitiveDigestCache.Load(skillName); ok {
		if s, _ := v.(string); s != "" {
			return s
		}
	}
	root := filepath.Join(builtinSkillsRoot(), skillName, "references", "digest.md")
	raw, err := os.ReadFile(root)
	if err != nil {
		return ""
	}
	text := strings.TrimSpace(string(raw))
	if utf8.RuneCountInString(text) > 3500 {
		text = string([]rune(text)[:3500]) + "…"
	}
	cognitiveDigestCache.Store(skillName, text)
	return text
}

func estimateCognitiveDigestTokens(text string) int {
	n := utf8.RuneCountInString(text)
	if n <= 0 {
		return 0
	}
	// Rough CJK-aware estimate: ~1.6 runes per token.
	return (n*10 + 15) / 16
}

func buildCognitiveDigestBlock(d cognitiveDecision) string {
	if d.Bypass || d.Primary == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("【认知框架·主】")
	b.WriteString(cognitiveLabel(d.Primary))
	b.WriteString("（")
	b.WriteString(d.Mode)
	b.WriteString("）\n")
	b.WriteString("对用户可见回复须遵循下列骨架；勿输出逐步隐性思维；澄清最多 1–3 问。\n")
	if dig := loadCognitiveDigest(cognitiveSkillByFramework[d.Primary]); dig != "" {
		b.WriteString("\n—— 主框架摘要 ——\n")
		b.WriteString(dig)
		b.WriteString("\n")
	}
	if d.Secondary != "" && d.Mode != cognitiveModeQuick {
		if dig := loadCognitiveDigest(cognitiveSkillByFramework[d.Secondary]); dig != "" {
			b.WriteString("\n【认知框架·辅】")
			b.WriteString(cognitiveLabel(d.Secondary))
			b.WriteString("\n—— 辅框架摘要（补充视角，勿重复提问） ——\n")
			b.WriteString(dig)
			b.WriteString("\n")
		}
	}
	if d.Mode == cognitiveModeDeep {
		if skill := cognitiveSkillByFramework[d.Primary]; skill != "" {
			b.WriteString("\n如需细则，可 skill.open 「")
			b.WriteString(skill)
			b.WriteString("」，勿同时打开多份全文。\n")
		}
	}
	out := b.String()
	// Cap ~2500 tokens ≈ 4000 runes
	if utf8.RuneCountInString(out) > 4000 {
		out = string([]rune(out)[:4000]) + "…"
	}
	return out
}

func emitCognitiveThoughts(emit reactEmitFunc, d cognitiveDecision) {
	if emit == nil {
		return
	}
	if d.Bypass {
		emitThought(emit, "plan", turnPhaseUnderstand, "直接作答（跳过认知框架）", humanCognitiveBypass(d.BypassReason))
		return
	}
	detail := "模式 " + d.Mode
	if len(d.Reasons) > 0 {
		detail += " · " + strings.Join(d.Reasons, ", ")
	}
	emitThoughtCognitive(emit, "framework", turnPhaseUnderstand, "选用框架："+cognitiveLabel(d.Primary)+"（主）", detail, d, "primary", "")
	if d.Secondary != "" {
		sec := d
		sec.Primary = d.Secondary
		emitThoughtCognitive(emit, "framework", turnPhaseUnderstand, "辅框架："+cognitiveLabel(d.Secondary), "与主框架协同，避免重复澄清", sec, "secondary", "")
	}
	if len(d.Phases) > 0 {
		labels := make([]string, 0, len(d.Phases))
		for _, p := range d.Phases {
			labels = append(labels, cognitivePhaseLabel(p))
		}
		emitThoughtCognitive(emit, "plan", turnPhasePlan, "思路阶段："+strings.Join(labels, " → "), "从「"+cognitivePhaseLabel(d.Phases[0])+"」推进", d, "primary", d.Phases[0])
	}
}

func emitCognitiveFinalize(emit reactEmitFunc, d cognitiveDecision) {
	if emit == nil || d.Bypass || d.Primary == "" {
		return
	}
	title := "输出：按" + cognitiveLabel(d.Primary) + "骨架收束"
	detail := ""
	switch d.Primary {
	case cognitiveProblem:
		detail = "问题定义 → 结论 → 行动（负责人/期限）"
	case cognitiveCreative:
		detail = "候选方案 → 比较 → 有条件推荐 → 最小验证"
	default:
		detail = "结论 → 关键依据 → 下一步"
	}
	emitThoughtCognitive(emit, "finalize", turnPhasePlan, title, detail, d, "primary", "")
}

func emitThoughtCognitive(emit reactEmitFunc, kind, narrativePhase, title, detail string, d cognitiveDecision, role, phaseStep string) {
	if emit == nil {
		return
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return
	}
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = "plan"
	}
	extra := map[string]any{
		"type": contract.StreamThought, "kind": kind, "title": title,
		"phase": narrativePhase,
		"framework": d.Primary, "frameworkLabel": cognitiveLabel(d.Primary),
		"mode": d.Mode, "role": role, "confidence": d.Confidence,
	}
	if dtl := strings.TrimSpace(detail); dtl != "" {
		extra["detail"] = dtl
	}
	if phaseStep != "" {
		extra["phaseStep"] = phaseStep
	}
	if len(d.Phases) > 0 {
		extra["phases"] = d.Phases
	}
	emit(contract.StreamThought, "thought", extra)
}

func humanCognitiveBypass(reason string) string {
	switch reason {
	case "user_opt_out":
		return "用户要求直接回答"
	case "short_chitchat":
		return "短对话/寒暄"
	case "simple_or_artifact":
		return "简单任务或纯文档生成"
	case "cognitive_disabled":
		return "已关闭认知思路模型"
	default:
		return reason
	}
}

func cognitivePhaseLabel(p string) string {
	m := map[string]string{
		"define": "问题定义", "scope": "缩小范围", "bottleneck": "瓶颈定位",
		"hypotheses": "假设", "action": "行动", "verify": "验证",
		"restate": "重述", "structure": "拆解", "reason": "推理",
		"counter": "反方", "conclude": "结论", "act": "行动",
		"clarify": "澄清", "diverge": "发散", "cluster": "聚类",
		"options": "方案", "compare": "比较", "matrix": "矩阵",
		"recommend": "推荐", "pilot": "试点", "analyze": "分析",
	}
	if v := m[p]; v != "" {
		return v
	}
	return p
}

func cognitiveSnapshot(d cognitiveDecision) map[string]any {
	if d.Bypass {
		return map[string]any{
			"bypass": true, "bypassReason": d.BypassReason, "enabled": d.Enabled,
		}
	}
	return map[string]any{
		"bypass": false, "enabled": d.Enabled,
		"primary": d.Primary, "primaryLabel": cognitiveLabel(d.Primary),
		"secondary": d.Secondary, "secondaryLabel": cognitiveLabel(d.Secondary),
		"mode": d.Mode, "phases": append([]string{}, d.Phases...),
		"confidence": d.Confidence, "reasons": append([]string{}, d.Reasons...),
		"digestTokensEst": d.DigestTokensEst,
	}
}

// cloneEmployeeForCognitiveSkills 返回 emp 的浅拷贝 + 仅 capabilities / boundaryPolicy 两个嵌套 map 的深拷贝。
// 目的：让 ensureEmployeeCognitiveSkills 可以就地修改而不污染 Store.Employees 里的共享对象。
// 修复 copilotStream wecom webhook 并发触发的 DATA RACE（两个 goroutine 同时拿到同一员工引用）。
func cloneEmployeeForCognitiveSkills(src map[string]any) map[string]any {
	if src == nil {
		return nil
	}
	dst := make(map[string]any, len(src)+4)
	for k, v := range src {
		switch k {
		case "capabilities", "boundaryPolicy":
			if inner, ok := v.(map[string]any); ok {
				cp := make(map[string]any, len(inner)+4)
				for ik, iv := range inner {
					cp[ik] = iv
				}
				dst[k] = cp
				continue
			}
		}
		dst[k] = v
	}
	return dst
}

// ensureEmployeeCognitiveSkills merges base cognitive skills into employee capabilities.
func ensureEmployeeCognitiveSkills(emp map[string]any) {
	if emp == nil {
		return
	}
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		caps = map[string]any{}
		emp["capabilities"] = caps
	}
	skills := decodeStringSlice(caps["skills"])
	seen := map[string]bool{}
	for _, s := range skills {
		seen[strings.ToLower(s)] = true
	}
	for _, name := range cognitiveSkillNames {
		if !seen[strings.ToLower(name)] {
			skills = append(skills, name)
			seen[strings.ToLower(name)] = true
		}
	}
	caps["skills"] = skills
	cog, _ := caps["cognitive"].(map[string]any)
	if cog == nil {
		caps["cognitive"] = map[string]any{
			"enabled": true, "defaultPack": "base-cognitive-v1",
			"allowOverride": true, "maxFrameworksPerTurn": 2,
		}
	} else {
		if _, ok := cog["allowOverride"]; !ok {
			cog["allowOverride"] = true
		}
		if _, ok := cog["defaultPack"]; !ok {
			cog["defaultPack"] = "base-cognitive-v1"
		}
		if intFrom(cog["maxFrameworksPerTurn"]) <= 0 {
			cog["maxFrameworksPerTurn"] = 2
		}
	}
	ensureCognitiveCapabilityModes(emp)
}

func ensureCognitiveCapabilityModes(emp map[string]any) {
	if emp == nil {
		return
	}
	bp, _ := emp["boundaryPolicy"].(map[string]any)
	if bp == nil {
		bp = map[string]any{}
		emp["boundaryPolicy"] = bp
	}
	var modes []map[string]any
	switch v := bp["capabilityModes"].(type) {
	case []map[string]any:
		modes = append([]map[string]any{}, v...)
	case []any:
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				modes = append(modes, m)
			}
		}
	}
	setMode := func(name, mode string) {
		for _, m := range modes {
			if str(m["capabilityType"]) == "skill" && strings.EqualFold(str(m["capabilityName"]), name) {
				m["mode"] = mode
				bp["capabilityModes"] = modes
				return
			}
		}
		modes = append(modes, map[string]any{
			"capabilityType": "skill", "capabilityName": name, "mode": mode,
		})
		bp["capabilityModes"] = modes
	}
	for _, name := range cognitiveSkillNames {
		setMode(name, "execute")
	}
}

func isCognitiveSkillName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	for _, s := range cognitiveSkillNames {
		if n == strings.ToLower(s) {
			return true
		}
	}
	return false
}

func lookslikeCognitiveAnswerWeak(text string, d cognitiveDecision) bool {
	if d.Bypass || strings.TrimSpace(text) == "" {
		return false
	}
	// Only enforce structure on deep cognitive turns to avoid extra LLM cost.
	if d.Mode != cognitiveModeDeep {
		return false
	}
	t := text
	if utf8.RuneCountInString(t) < 120 {
		return false
	}
	switch d.Primary {
	case cognitiveProblem:
		return !strings.Contains(t, "行动") && !strings.Contains(t, "下一步") && !strings.Contains(t, "建议")
	case cognitiveCreative:
		return !strings.Contains(t, "推荐") && !strings.Contains(t, "方案") && !strings.Contains(t, "候选")
	case cognitiveLogic:
		return !strings.Contains(t, "结论") && !strings.Contains(t, "依据")
	}
	return false
}
