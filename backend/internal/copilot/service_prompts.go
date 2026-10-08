// service_prompts.go — 版本化 prompt 注册表 + env 切换。
//
// 设计目标:
//   - 让 hardcoded 的"人格 / 推理强度 / 兜底文案"成为可版本化的模板
//   - 全局切换:QZDA_PROMPT_VERSION=v2(覆盖所有已注册 prompt)
//   - 单名切换:QZDA_PROMPT_<NAME>_VERSION=v2(只覆盖某条)
//   - 缺版本时回退到 hardcoded fallback(向后兼容)
//
// 命名约定:系统 prompt 块用 "system.<role>.<part>",例如:
//   - system.identity.active.tail
//   - system.identity.fallback
//   - reasoning.off | reasoning.deep | reasoning.standard
//
// 后续如需 A/B 测试,在 call site 读 turnWithRequest.PromptVersionHint,
// 通过 GetWithHint(name, hint) 解析;不在本文件内预留。
package copilot

import (
	"os"
	"strings"
	"sync"
)

// PromptRegistry 持有版本化的 prompt 模板。
//
// 字段:
//   - prompts: name → version → content
//   - active : name → 当前激活版本(由 env / 显式 SetActive 决定)
type PromptRegistry struct {
	mu      sync.RWMutex
	prompts map[string]map[string]string
	active  map[string]string
}

var (
	registryOnce sync.Once
	globalReg    *PromptRegistry
)

// prompts 返回全局 prompt 注册表(单例)。
// 首次调用时注册 v1 默认值并应用 env 覆盖;之后纯读。
func prompts() *PromptRegistry {
	registryOnce.Do(func() {
		globalReg = newPromptRegistry()
		registerDefaultPrompts(globalReg)
		applyEnvOverrides(globalReg)
	})
	return globalReg
}

// ResetPromptsForTest 把全局注册表重置为空,允许测试自己塞值。
// 生产 nil 调用方绝不要调用。
func ResetPromptsForTest() {
	registryOnce = sync.Once{}
	globalReg = nil
}

func newPromptRegistry() *PromptRegistry {
	return &PromptRegistry{
		prompts: make(map[string]map[string]string),
		active:  make(map[string]string),
	}
}

// Register 注册一条 prompt 的某个版本。
// 同名同版本重复注册时,后者覆盖前者(便于测试注入)。
func (r *PromptRegistry) Register(name, version, content string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.prompts[name] == nil {
		r.prompts[name] = make(map[string]string)
	}
	r.prompts[name][version] = content
}

// SetActive 把某 name 切到指定 version(必须是已注册的 version)。
// 未注册的 version 会被忽略(读时仍按上一激活版本)。
func (r *PromptRegistry) SetActive(name, version string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.active[name] = version
}

// Get 返回某 name 当前激活版本的 content;未注册或激活版本缺失时返回空串。
// 调用方负责在空串时回退到 hardcoded 默认值(向后兼容)。
func (r *PromptRegistry) Get(name string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if v, ok := r.active[name]; ok {
		if content, ok := r.prompts[name][v]; ok {
			return content
		}
	}
	return ""
}

// Snapshot 返回当前所有 (name, active_version) 对,用于可观测性 / 调试。
func (r *PromptRegistry) Snapshot() map[string]string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]string, len(r.active))
	for k, v := range r.active {
		out[k] = v
	}
	return out
}

// registerDefaultPrompts 注册 v1 默认值,与历史 hardcoded 字符串保持一致。
//
// 升级方式:增加 v2 / v3,通过 SetActive 切换。
func registerDefaultPrompts(r *PromptRegistry) {
	// system.identity.fallback:无员工身份时的兜底人格
	r.Register("system.identity.fallback", "v1",
		"你是企业企智搭 · 数字伙伴平台的协作助手。请用中文简洁、可执行地回答。\n"+
			"若用户使用「刚才/上面/之前」等指代，请结合对话历史与跨会话记忆作答。\n")

	// system.identity.active.tail:有员工身份时,身份段落之后的尾段(职责边界 + 接管提示)
	r.Register("system.identity.active.tail", "v1",
		"请用中文简洁、可执行地回答，严格遵守岗位边界；涉及审批、写操作或敏感数据时提示人工接管。\n"+
			"若用户使用「刚才/上面/之前」等指代，请结合对话历史与跨会话记忆作答，不要假装遗忘。\n")

	// reasoning.off / deep:推理强度提示
	r.Register("reasoning.off", "v1",
		"推理强度：直接给出结论，不要展开冗长链式思考；必要时用一两句说明依据即可。\n")
	r.Register("reasoning.deep", "v1",
		"推理强度：请深入分析，必要时分步说明假设、证据与权衡，再给出可执行结论。\n")
	// reasoning.standard 故意不注册:空字符串时不做提示(与历史行为一致)

	// section header:跨会话记忆段
	r.Register("section.memory.header", "v1",
		"\n跨会话记忆（按相关性，可修正；括号内为记忆 ID，便于审计追溯）：\n")

	// section header:已检索已发布知识段
	r.Register("section.rag.header", "v1",
		"\n已检索已发布知识（仅供参考，与记忆分栏）：\n")

	// cognitive.framework.primary.intro:主框架身份段后的行为约束
	r.Register("cognitive.framework.primary.intro", "v1",
		"对用户可见回复须遵循下列骨架；勿输出逐步隐性思维；澄清最多 1–3 问。\n")

	// cognitive.framework.primary.divider:主框架摘要段的分隔行
	r.Register("cognitive.framework.primary.divider", "v1",
		"\n—— 主框架摘要 ——\n")

	// cognitive.framework.secondary.divider:辅框架摘要段的分隔行
	r.Register("cognitive.framework.secondary.divider", "v1",
		"\n—— 辅框架摘要（补充视角，勿重复提问）——\n")

	// cognitive.framework.skill_hint:deep 模式下推荐按 skill.open 展开细则。
	// 占位符 {skill} 由调用方在运行时替换为具体技能名。
	r.Register("cognitive.framework.skill_hint", "v1",
		"\n如需细则，可 skill.open 「{skill}」，勿同时打开多份全文。\n")

	// system.multi.worker.tail:子专家身份段后的行为约束(只输出本岗位视角)
	r.Register("system.multi.worker.tail", "v1",
		"只输出本岗位视角的简要意见，不要扮演其他岗位，不要输出 TOOL/PLAN 标记。\n")

	// system.part.tool_plan_rule:子专家工具/规划标记禁用规则(同上)
	// 拆为独立条目便于 partial 覆盖;默认同主规则。
	r.Register("system.part.tool_plan_rule", "v1",
		"不要输出 TOOL/PLAN 标记。\n")

	// system.reflect.critique:反思主指令(自我批评 + 修订)
	r.Register("system.reflect.critique", "v1",
		"请对助手回答做简短自我批评（3 条以内），指出事实缺口、步骤遗漏或工具失败未处理处，然后给出修订后的最终中文回答。\n")

	// system.reflect.cognitive_structure_weak:认知结构弱的修订引导
	r.Register("system.reflect.cognitive_structure_weak", "v1",
		"请按当前认知框架补齐：结论/依据或问题定义/行动或候选方案/有条件推荐等可见结构。\n")

	// tool.registry.empty:无可用工具时的兜底
	r.Register("tool.registry.empty", "v1",
		"本回合未启用任何工具。请直接根据对话历史与记忆作答，不要尝试调用工具。")

	// tool.registry.react_header:ReAct 入口说明
	r.Register("tool.registry.react_header", "v1",
		"你可以使用下列工具（ReAct）。需要工具时，先只输出一个工具调用块，不要夹杂最终答案：\n")

	// tool.registry.format:<<<TOOL>>> 块格式
	r.Register("tool.registry.format", "v1",
		"<<<TOOL>>>\n{\"name\":\"工具名\",\"args\":{...}}\n<<<END>>>\n")

	// tool.registry.xml_forbidden:禁用 XML 风格工具块
	r.Register("tool.registry.xml_forbidden", "v1",
		"禁止输出 <skill.read>、<pptx> 等 XML 标签式工具块；仅使用上述 <<<TOOL>>> 格式。\n")

	// tool.registry.finalize:工具观察后的收尾规则
	r.Register("tool.registry.finalize", "v1",
		"收到工具观察结果后，再决定是否继续调用或给出最终中文回答。最终回答不要包含 <<<TOOL>>> 或 XML 工具标记。\n")

	// tool.registry.skill_harness:Skill Harness 五条铁律
	r.Register("tool.registry.skill_harness", "v1",
		"【Skill Harness】对 kind=skill 的能力：\n"+
			"1) 首次先 action=open 阅读 SKILL.md 与 scripts 列表；\n"+
			"2) Office（pptx/docx/pdf）须先 write path=.copilot-ws/*.md 写入大纲，再 run command=scripts/...；run 引用 --outline-file .copilot-ws/... 时系统会自动补 write 步；\n"+
			"3) 执行必须 action=run 且 command 匹配 scripts/... 或 .copilot-ws/...；未见到下载链接前勿声称 PPT/Word 已生成；\n"+
			"4) 勿把自然语言当 command；观察 status=needs_instruction 表示尚未真正执行；status=failed 且含【预检失败】表示缺 package 或依赖文件；\n"+
			"5) 仅当观察为 pending_authorization 时告知用户「已进入人工审核」；禁止在 success/needs_instruction 时声称已提交审核或已生成文件。\n")

	// tool.registry.artifact_protocol:产物附件交付规则
	r.Register("tool.registry.artifact_protocol", "v1",
		"【产物协议】docx/pptx/pdf 必须由 skill 脚本产出并以 /api/skill-artifacts/ 链接交付；平台禁止内置旁路生成。\n")

	// plan.prompt:planner LLM 的指令
	r.Register("plan.prompt", "v1",
		"你是任务规划器。请为用户目标产出简洁可执行计划，只输出计划块，不要回答问题本身：\n"+
			"<<<PLAN>>>\n"+
			"{\"goal\":\"一句话目标\",\"steps\":[{\"id\":\"1\",\"title\":\"步骤标题\",\"action\":\"retrieve|memory|tool|answer\",\"tool\":\"可选工具名\",\"query\":\"可选查询\"}]}\n"+
			"<<<END>>>\n"+
			"规则：steps 不超过 6；需要查知识用 retrieve；需要回忆偏好用 memory；纯推理用 answer；具体技能用 tool 并填写 tool 名。")

	// 默认激活 v1
	for _, name := range []string{
		"system.identity.fallback",
		"system.identity.active.tail",
		"reasoning.off",
		"reasoning.deep",
		"section.memory.header",
		"section.rag.header",
		"cognitive.framework.primary.intro",
		"cognitive.framework.primary.divider",
		"cognitive.framework.secondary.divider",
		"cognitive.framework.skill_hint",
		"system.multi.worker.tail",
		"system.part.tool_plan_rule",
		"system.reflect.critique",
		"system.reflect.cognitive_structure_weak",
		"tool.registry.empty",
		"tool.registry.react_header",
		"tool.registry.format",
		"tool.registry.xml_forbidden",
		"tool.registry.finalize",
		"tool.registry.skill_harness",
		"tool.registry.artifact_protocol",
		"plan.prompt",
	} {
		r.SetActive(name, "v1")
	}
}

// applyEnvOverrides 在启动时读两个开关:
//   - QZDA_PROMPT_VERSION=v2            → 所有已注册 prompt 切到 v2
//   - QZDA_PROMPT_<NAME>_VERSION=v2     → 只切某 name(优先级高于全局)
//
// 注意:env 只覆盖"激活版本",不修改已注册的 content。
// 也就是说"v2"必须在 registerDefaultPrompts 或显式 Register 后才生效。
func applyEnvOverrides(r *PromptRegistry) {
	// 全局版本
	if globalVer := strings.TrimSpace(os.Getenv("QZDA_PROMPT_VERSION")); globalVer != "" {
		r.mu.Lock()
		for name := range r.prompts {
			r.active[name] = globalVer
		}
		r.mu.Unlock()
	}
	// 单名覆盖
	for _, kv := range os.Environ() {
		eq := strings.IndexByte(kv, '=')
		if eq < 0 {
			continue
		}
		k, v := kv[:eq], kv[eq+1:]
		const prefix = "QZDA_PROMPT_"
		if !strings.HasPrefix(k, prefix) || k == "QZDA_PROMPT_VERSION" {
			continue
		}
		name := strings.TrimSuffix(strings.TrimPrefix(k, prefix), "_VERSION")
		name = strings.ToLower(name)
		if v != "" {
			r.SetActive(name, v)
		}
	}
}

// hardcodedFallbacks 集中存放"v1 默认值",作为注册表 Get 返回空串时的兜底。
// 让 copilot_context.go 等调用点保持"读注册表 → 失败用 hardcoded"的语义,
// 即使注册表完全清空也能跑通(向后兼容)。
var hardcodedFallbacks = map[string]string{
	"system.identity.fallback": "你是企业企智搭 · 数字伙伴平台的协作助手。请用中文简洁、可执行地回答。\n" +
		"若用户使用「刚才/上面/之前」等指代，请结合对话历史与跨会话记忆作答。\n",
	"system.identity.active.tail": "请用中文简洁、可执行地回答，严格遵守岗位边界；涉及审批、写操作或敏感数据时提示人工接管。\n" +
		"若用户使用「刚才/上面/之前」等指代，请结合对话历史与跨会话记忆作答，不要假装遗忘。\n",
	"reasoning.off": "推理强度：直接给出结论，不要展开冗长链式思考；必要时用一两句说明依据即可。\n",
	"reasoning.deep": "推理强度：请深入分析，必要时分步说明假设、证据与权衡，再给出可执行结论。\n",
	"section.memory.header":                  "\n跨会话记忆（按相关性，可修正；括号内为记忆 ID，便于审计追溯）：\n",
	"section.rag.header":                     "\n已检索已发布知识（仅供参考，与记忆分栏）：\n",
	"cognitive.framework.primary.intro":      "对用户可见回复须遵循下列骨架；勿输出逐步隐性思维；澄清最多 1–3 问。\n",
	"cognitive.framework.primary.divider":    "\n—— 主框架摘要 ——\n",
	"cognitive.framework.secondary.divider":  "\n—— 辅框架摘要（补充视角，勿重复提问）——\n",
	"cognitive.framework.skill_hint":          "\n如需细则，可 skill.open 「{skill}」，勿同时打开多份全文。\n",
	"system.multi.worker.tail":               "只输出本岗位视角的简要意见，不要扮演其他岗位，不要输出 TOOL/PLAN 标记。\n",
	"system.part.tool_plan_rule":             "不要输出 TOOL/PLAN 标记。\n",
	"system.reflect.critique":                "请对助手回答做简短自我批评（3 条以内），指出事实缺口、步骤遗漏或工具失败未处理处，然后给出修订后的最终中文回答。\n",
	"system.reflect.cognitive_structure_weak": "请按当前认知框架补齐：结论/依据或问题定义/行动或候选方案/有条件推荐等可见结构。\n",
	"tool.registry.empty":                "本回合未启用任何工具。请直接根据对话历史与记忆作答，不要尝试调用工具。",
	"tool.registry.react_header":        "你可以使用下列工具（ReAct）。需要工具时，先只输出一个工具调用块，不要夹杂最终答案：\n",
	"tool.registry.format":              "<<<TOOL>>>\n{\"name\":\"工具名\",\"args\":{...}}\n<<<END>>>\n",
	"tool.registry.xml_forbidden":        "禁止输出 <skill.read>、<pptx> 等 XML 标签式工具块；仅使用上述 <<<TOOL>>> 格式。\n",
	"tool.registry.finalize":            "收到工具观察结果后，再决定是否继续调用或给出最终中文回答。最终回答不要包含 <<<TOOL>>> 或 XML 工具标记。\n",
	"tool.registry.skill_harness": "【Skill Harness】对 kind=skill 的能力：\n" +
		"1) 首次先 action=open 阅读 SKILL.md 与 scripts 列表；\n" +
		"2) Office（pptx/docx/pdf）须先 write path=.copilot-ws/*.md 写入大纲，再 run command=scripts/...；run 引用 --outline-file .copilot-ws/... 时系统会自动补 write 步；\n" +
		"3) 执行必须 action=run 且 command 匹配 scripts/... 或 .copilot-ws/...；未见到下载链接前勿声称 PPT/Word 已生成；\n" +
		"4) 勿把自然语言当 command；观察 status=needs_instruction 表示尚未真正执行；status=failed 且含【预检失败】表示缺 package 或依赖文件；\n" +
		"5) 仅当观察为 pending_authorization 时告知用户「已进入人工审核」；禁止在 success/needs_instruction 时声称已提交审核或已生成文件。\n",
	"tool.registry.artifact_protocol": "【产物协议】docx/pptx/pdf 必须由 skill 脚本产出并以 /api/skill-artifacts/ 链接交付；平台禁止内置旁路生成。\n",
	"plan.prompt": "你是任务规划器。请为用户目标产出简洁可执行计划，只输出计划块，不要回答问题本身：\n" +
		"<<<PLAN>>>\n" +
		"{\"goal\":\"一句话目标\",\"steps\":[{\"id\":\"1\",\"title\":\"步骤标题\",\"action\":\"retrieve|memory|tool|answer\",\"tool\":\"可选工具名\",\"query\":\"可选查询\"}]}\n" +
		"<<<END>>>\n" +
		"规则：steps 不超过 6；需要查知识用 retrieve；需要回忆偏好用 memory；纯推理用 answer；具体技能用 tool 并填写 tool 名。",
}

// promptGet 安全读取:注册表优先,空串时回退 hardcoded。
// 这是给调用方用的便捷函数,避免每个调用点都写 if-else。
func promptGet(name string) string {
	if p := prompts().Get(name); p != "" {
		return p
	}
	return hardcodedFallbacks[name]
}