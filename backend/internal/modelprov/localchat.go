package modelprov

import (
	"fmt"
	"strings"
)

// PersonaContext is extracted from the Copilot system prompt for local replies.
type PersonaContext struct {
	Name             string
	Role             string
	Department       string
	Description      string
	Responsibilities []string
	Prohibited       []string
	Tools            []string
	Knowledge        []string
	RawSystem        string
}

// ParsePersonaContext extracts structured fields from Collab/Cap system prompts.
func ParsePersonaContext(system string) PersonaContext {
	p := PersonaContext{RawSystem: strings.TrimSpace(system)}
	for _, line := range strings.Split(p.RawSystem, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "你是「") && strings.Contains(line, "」"):
			start := strings.Index(line, "「")
			end := strings.Index(line, "」")
			if start >= 0 && end > start {
				p.Name = line[start+len("「") : end]
			}
		case strings.HasPrefix(line, "岗位："):
			rest := strings.TrimSpace(strings.TrimPrefix(line, "岗位："))
			if i := strings.Index(rest, "·"); i >= 0 {
				p.Role = strings.TrimSpace(rest[:i])
				p.Department = strings.TrimSpace(rest[i+len("·"):])
			} else {
				p.Role = rest
			}
		case strings.HasPrefix(line, "角色："):
			p.Role = strings.TrimSpace(strings.TrimPrefix(line, "角色："))
		case strings.HasPrefix(line, "职责说明："):
			p.Description = strings.TrimSpace(strings.TrimPrefix(line, "职责说明："))
		case strings.HasPrefix(line, "职责边界："):
			p.Responsibilities = splitCNList(strings.TrimPrefix(line, "职责边界："))
		case strings.HasPrefix(line, "禁止行为："):
			p.Prohibited = splitCNList(strings.TrimPrefix(line, "禁止行为："))
		case strings.HasPrefix(line, "可用工具："):
			p.Tools = splitCNList(strings.TrimPrefix(line, "可用工具："))
		case strings.HasPrefix(line, "- "):
			p.Knowledge = append(p.Knowledge, strings.TrimSpace(strings.TrimPrefix(line, "- ")))
		}
	}
	if p.Name == "" {
		p.Name = extractRoleHint(system)
	}
	if p.Name == "" && p.Role != "" {
		p.Name = p.Role
	}
	return p
}

func splitCNList(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.FieldsFunc(s, func(r rune) bool {
		return r == '、' || r == ',' || r == '，' || r == ';' || r == '；' || r == '|'
	})
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func (p PersonaContext) displayName() string {
	if p.Name != "" {
		return p.Name
	}
	if p.Role != "" {
		return p.Role
	}
	return "协作助手"
}

func (p PersonaContext) titleLine() string {
	name := p.displayName()
	if p.Role != "" && p.Role != name {
		if p.Department != "" {
			return fmt.Sprintf("%s（%s · %s）", name, p.Role, p.Department)
		}
		return fmt.Sprintf("%s（%s）", name, p.Role)
	}
	if p.Department != "" {
		return fmt.Sprintf("%s（%s）", name, p.Department)
	}
	return name
}

// BuildLocalChatReply produces a persona-aware answer without calling external LLMs.
// Used by embedded protocol and qzda-local-llm so Copilot can converse when no cloud key is set.
func BuildLocalChatReply(system, user string) string {
	user = strings.TrimSpace(user)
	p := ParsePersonaContext(system)
	lower := strings.ToLower(user)

	switch {
	case user == "":
		return fmt.Sprintf("我是%s。请告诉我你需要协助的具体事项。", p.titleLine())

	case containsAny(user, "什么大模型", "哪个模型", "用的什么模型") ||
		containsAny(lower, "which model", "what model"):
		return fmt.Sprintf("我是%s。本回合由平台模型路由调度；当前环境走的是本地对话通道（local-chat）。若要切换 DeepSeek / OpenAI / Azure 等旗舰模型，在「模型中心」配置供应商并完成探测后，在会话「运行配置」里选用即可。", p.titleLine())

	case containsAny(user, "你是谁", "介绍一下", "你叫什么"):
		return buildIntro(p)

	case containsAny(user, "你都可以做什么", "能做什么", "你会什么", "能力范围", "职责是什么", "可以帮我什么", "做什么的"):
		return buildCapabilities(p)

	case containsAny(user, "不能做什么", "禁止", "边界", "权限"):
		return buildBoundaries(p)

	case looksLikeHRLeave(user, p):
		return buildHRLeaveReply(p, user)

	case looksLikeHROnboard(user, p):
		return buildHROnboardReply(p, user)

	case looksLikeFollowUp(user):
		return buildFollowUpReply(p, user)

	default:
		return buildGeneralReply(p, user)
	}
}

func containsAny(s string, needles ...string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}

func looksLikeHR(p PersonaContext) bool {
	hay := strings.ToLower(p.Name + p.Role + p.Department + p.Description + strings.Join(p.Responsibilities, ""))
	return strings.Contains(hay, "人事") || strings.Contains(hay, "hr") || strings.Contains(hay, "招聘") || strings.Contains(hay, "入职")
}

func looksLikeHRLeave(user string, p PersonaContext) bool {
	if !looksLikeHR(p) && !containsAny(user, "年假", "请假", "调休", "产假", "婚假") {
		return containsAny(user, "年假", "请假", "假期", "休假")
	}
	return containsAny(user, "年假", "请假", "假期", "休假", "调休", "产假", "婚假")
}

func looksLikeHROnboard(user string, p PersonaContext) bool {
	return containsAny(user, "入职", "报到", "onboard", "新人材料", "入职材料")
}

func looksLikeFollowUp(user string) bool {
	return strings.Contains(user, "对话上文：") && containsAny(user,
		"刚才", "上面", "之前", "继续", "按这个", "按刚才", "那个方案", "上述", "同上",
	)
}

func buildFollowUpReply(p PersonaContext, user string) string {
	priorAssistant := extractLastAssistantFromHistory(user)
	current := user
	if idx := strings.LastIndex(user, "当前用户："); idx >= 0 {
		current = strings.TrimSpace(user[idx+len("当前用户："):])
	}
	var b strings.Builder
	b.WriteString("好的，我结合上一轮结论继续。")
	if priorAssistant != "" {
		b.WriteString("\n\n**承接上文：** ")
		b.WriteString(clipRunes(priorAssistant, 180))
	}
	b.WriteString("\n\n**本轮诉求：** ")
	b.WriteString(clipRunes(current, 120))
	b.WriteString("\n\n我会在既有方案上补齐可执行细节；若需改方向，请直接说明变更点。")
	_ = p
	return b.String()
}

func extractLastAssistantFromHistory(user string) string {
	const marker = "助手："
	idx := strings.LastIndex(user, marker)
	if idx < 0 {
		return ""
	}
	rest := user[idx+len(marker):]
	if cut := strings.Index(rest, "\n当前用户："); cut >= 0 {
		rest = rest[:cut]
	}
	if cut := strings.Index(rest, "\n用户："); cut >= 0 {
		rest = rest[:cut]
	}
	return strings.TrimSpace(rest)
}

func buildIntro(p PersonaContext) string {
	var b strings.Builder
	b.WriteString("你好，我是")
	b.WriteString(p.titleLine())
	b.WriteString("。")
	if p.Description != "" {
		b.WriteString(p.Description)
		if !strings.HasSuffix(p.Description, "。") {
			b.WriteString("。")
		}
	} else if len(p.Responsibilities) > 0 {
		b.WriteString("主要负责")
		b.WriteString(strings.Join(clipList(p.Responsibilities, 4), "、"))
		b.WriteString("。")
	} else {
		b.WriteString("可以协助你处理岗位职责范围内的协作问题。")
	}
	b.WriteString("\n\n你可以直接问我具体事项；涉及审批、写操作或敏感数据时，我会提示需要人工接管。")
	return b.String()
}

func buildCapabilities(p PersonaContext) string {
	var b strings.Builder
	b.WriteString("我是")
	b.WriteString(p.titleLine())
	b.WriteString("，可以协助你做这些事：\n")
	items := p.Responsibilities
	if len(items) == 0 && p.Description != "" {
		items = []string{p.Description}
	}
	if len(items) == 0 {
		if looksLikeHR(p) {
			items = []string{"人事政策与假期制度问答", "入职材料与流程核对", "招聘进度简报", "试用期节点提醒"}
		} else {
			items = []string{"按岗位边界解答问题", "结合已发布知识给出建议", "整理可执行下一步与升级人工建议"}
		}
	}
	for i, item := range clipList(items, 6) {
		b.WriteString(fmt.Sprintf("%d. %s\n", i+1, item))
	}
	if len(p.Tools) > 0 {
		b.WriteString("\n本会话可用工具：")
		b.WriteString(strings.Join(clipList(p.Tools, 8), "、"))
		b.WriteString("。\n")
	}
	if len(p.Prohibited) > 0 {
		b.WriteString("\n我不会越权处理：")
		b.WriteString(strings.Join(clipList(p.Prohibited, 4), "、"))
		b.WriteString("。")
	} else {
		b.WriteString("\n涉及审批、签署或系统写操作时，我会先提示人工确认。")
	}
	if len(p.Knowledge) > 0 {
		b.WriteString("\n\n已关联知识参考：")
		b.WriteString(strings.Join(clipList(p.Knowledge, 3), "；"))
		b.WriteString("。")
	}
	b.WriteString("\n\n你可以继续问，例如：年假怎么算、入职材料要准备什么、某岗位招聘进度。")
	return strings.TrimSpace(b.String())
}

func buildBoundaries(p PersonaContext) string {
	var b strings.Builder
	b.WriteString("我的协作边界如下：\n")
	if len(p.Responsibilities) > 0 {
		b.WriteString("· 可做：")
		b.WriteString(strings.Join(clipList(p.Responsibilities, 5), "、"))
		b.WriteString("\n")
	}
	if len(p.Prohibited) > 0 {
		b.WriteString("· 不可做：")
		b.WriteString(strings.Join(clipList(p.Prohibited, 5), "、"))
		b.WriteString("\n")
	} else {
		b.WriteString("· 不可做：未经审批的写操作、代替人工签署/放行、越权查询敏感薪酬明细\n")
	}
	b.WriteString("若事项超出边界，我会给出升级路径（岗位负责人 / 审批流）。")
	return b.String()
}

func buildHRLeaveReply(p PersonaContext, user string) string {
	var b strings.Builder
	b.WriteString("关于假期/请假，我可以按人事制度帮你梳理：\n")
	b.WriteString("1. 先确认员工类型（正式/试用/实习）与司龄，这决定年假额度。\n")
	b.WriteString("2. 请假需走系统申请：事由、起止时间、代理人；跨部门时同步直属上级。\n")
	b.WriteString("3. 病假/婚假/产假等专项假请附制度要求材料。\n")
	if len(p.Knowledge) > 0 {
		b.WriteString("\n知识库提示：")
		b.WriteString(strings.Join(clipList(p.Knowledge, 3), "；"))
		b.WriteString("\n")
	}
	b.WriteString("\n请补充：员工姓名/工号、假种、起止日期，我帮你列核对清单。")
	_ = user
	_ = p
	return b.String()
}

func buildHROnboardReply(p PersonaContext, user string) string {
	var b strings.Builder
	b.WriteString("入职办理可按下面清单推进：\n")
	b.WriteString("1. 身份与学历材料（身份证、学历证、离职证明）\n")
	b.WriteString("2. 合同与保密/竞业等签署件\n")
	b.WriteString("3. 银行卡、紧急联系人、体检报告（如制度要求）\n")
	b.WriteString("4. 账号开通：邮箱、门禁、业务系统权限申请\n")
	if len(p.Tools) > 0 {
		b.WriteString("\n可用工具：")
		b.WriteString(strings.Join(clipList(p.Tools, 6), "、"))
		b.WriteString("\n")
	}
	b.WriteString("\n告诉我入职日期与岗位，我可以生成一份给用人部门的材料催办话术。")
	_ = user
	_ = p
	return b.String()
}

func buildGeneralReply(p PersonaContext, user string) string {
	display := user
	if idx := strings.LastIndex(user, "当前用户："); idx >= 0 {
		display = strings.TrimSpace(user[idx+len("当前用户："):])
	}
	var b strings.Builder
	b.WriteString("好的，我以")
	b.WriteString(p.titleLine())
	b.WriteString("的身份来处理这个问题。\n\n")
	if strings.Contains(user, "对话上文：") {
		b.WriteString("（已参考本会话上文）\n\n")
	}
	b.WriteString("**你的问题：** ")
	b.WriteString(clipRunes(display, 160))
	b.WriteString("\n\n")
	b.WriteString("**建议下一步：**\n")
	if len(p.Responsibilities) > 0 {
		b.WriteString("1. 对照岗位职责「")
		b.WriteString(p.Responsibilities[0])
		b.WriteString("」确认目标与约束（时间、对象、合规要求）。\n")
	} else {
		b.WriteString("1. 先澄清目标、约束（时间/对象/合规）与期望产出。\n")
	}
	b.WriteString("2. 给出可执行步骤，并标明哪些需要人工审批。\n")
	if len(p.Knowledge) > 0 {
		b.WriteString("3. 参考已检索知识：")
		b.WriteString(strings.Join(clipList(p.Knowledge, 2), "；"))
		b.WriteString("。\n")
	} else {
		b.WriteString("3. 若有制度/文档编号，发给我后我可以按条文帮你核对。\n")
	}
	if len(p.Tools) > 0 {
		b.WriteString("\n本会话可调用：")
		b.WriteString(strings.Join(clipList(p.Tools, 5), "、"))
		b.WriteString("。")
	}
	b.WriteString("\n\n请再补充关键细节（对象、时间、已有材料），我继续给出更具体的清单或话术。")
	return b.String()
}

func clipList(items []string, n int) []string {
	if len(items) <= n {
		return items
	}
	return items[:n]
}

func extractRoleHint(system string) string {
	for _, line := range strings.Split(system, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "岗位：") || strings.HasPrefix(line, "角色：") {
			return strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(line, "岗位："), "角色："))
		}
		if strings.Contains(line, "你是「") && strings.Contains(line, "」") {
			start := strings.Index(line, "「")
			end := strings.Index(line, "」")
			if start >= 0 && end > start {
				return line[start+len("「") : end]
			}
		}
	}
	return ""
}

func clipRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}
