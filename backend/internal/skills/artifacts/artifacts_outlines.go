package artifacts

import (
	"fmt"
	"regexp"
	"strings"
)

// Outline templates + title inference for the DOCX / PPTX / XLSX
// generators. Carved out of artifacts_docx.go / artifacts_pptx.go /
// artifacts_xlsx.go to keep each individual format file under the
// 600-line file-size gate while preserving a single source of truth
// for the long Chinese templates.

// InferDocxTitleFromMessage extracts a short document title from the
// user's intent message (《...》, 「...」, "生成 X" patterns + a
// few keyword shortcuts for 招聘岗位 / 岗位说明书).
func InferDocxTitleFromMessage(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return ""
	}
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`《([^》]{2,32})》`),
		regexp.MustCompile(`「([^」]{2,32})」`),
		regexp.MustCompile(`生成[一份张]*[《「"]?([^《」"\s，。！？,]{2,24})`),
	} {
		if m := re.FindStringSubmatch(msg); len(m) == 2 {
			if t := normalizeDocxTitle(m[1]); t != "生成文档" {
				return t
			}
		}
	}
	lower := msg
	if strings.Contains(lower, "招聘") && (strings.Contains(lower, "岗位") || strings.Contains(lower, "模板") || strings.Contains(lower, "JD")) {
		return "招聘岗位模板"
	}
	if strings.Contains(lower, "岗位说明") {
		return "岗位说明书"
	}
	return ""
}

// DefaultDocxOutlineForMessage produces a structured Word outline
// when the model did not supply content. Mirrors
// DefaultPptxOutlineForMessage so Word tasks without explicit body
// still generate multi-section documents instead of 1-page stubs.
//
// Why all branches use real generic descriptions: preflight refuses
// placeholder-heavy outlines (>10% `____` / `（请填写）` / `{{...}}`),
// so these templates provide real paragraphs the agent can later
// replace via clarifying questions.
func DefaultDocxOutlineForMessage(title, userMsg string) string {
	t := coalesce(strings.TrimSpace(title), "生成文档")
	if strings.Contains(userMsg, "招聘") {
		return fmt.Sprintf(`# %s

【指令】禁止使用占位符；每个 H2 必须给出 2-3 句实际描述，不要照抄通用模板。如信息不足，请向用户追问岗位名称、薪资范围、任职要求后再生成。

## 一、岗位基本信息
本节明确岗位的标识信息：岗位名称、所属部门、直接上级、岗位编号，以及汇报关系与协作接口人。草稿阶段先用一段概括性描述，再用列表补充岗位标识的字段，便于 HR 系统化录入。

## 二、岗位职责
本节按重要度展开岗位职责：核心交付职责、流程性职责、跨部门协作职责。建议每条职责用"动词 + 对象 + 衡量标准"的句式表述，便于后续 KPI 拆解。

## 三、任职要求
本节列出胜任本岗位所需的教育背景、工作经验、专业技能与软性能力。学历与专业按硬性要求列出，经验按年限区间拆为"必备 / 优先"两档，技能按"专业 / 工具 / 方法论"分组。

## 四、薪资福利
本节描述岗位的薪资范围、绩效结构与福利体系：基础薪资按区间或带宽表述，绩效与奖金结构按周期与口径说明，福利覆盖法定与补充两类。涉及具体数字时建议先以范围表述，正式发布前由 HR 与用人部门对齐。

## 五、备注与补充
本节用于放置前四节未覆盖但又需要写明的特殊事项：试用期安排、加班与调休规则、保密与竞业要求、晋升路径与转岗通道等。`, t)
	}
	if strings.Contains(userMsg, "岗位说明") {
		return fmt.Sprintf(`# %s

【指令】禁止使用占位符；每个 H2 必须给出 2-3 句实际描述。

## 一、岗位标识
本节给出岗位的基础标识：岗位名称、所属部门、岗位级别、岗位编号，以及直接上级与汇报关系。草稿阶段先描述岗位在组织中的定位，再用列表补充字段值。

## 二、岗位概述
本节说明岗位的目的、核心价值与日常工作关系：岗位解决什么业务问题，与哪些上下游岗位协作，在组织中扮演何种角色。建议用 2-3 句实际描述概括，再以列表补充协作接口。

## 三、岗位职责
本节按重要度列出关键职责：核心交付、流程治理、跨部门协作。建议每条职责给出衡量标准，便于后续在绩效评估时引用。

## 四、任职资格
本节列出教育背景、经验要求与专业技能的硬性条件：学历与专业按"必备 / 优先"拆分，经验按年限区间表达，专业技能按"专业 / 工具 / 方法论"分组。

## 五、发展通道
本节描述岗位的晋升方向与转岗可能：纵向上可以晋升到哪些岗位，横向上可以平移或轮岗到哪些方向。`, t)
	}
	return fmt.Sprintf(`# %s

【指令】禁止使用占位符；每个 H2 必须给出 2-3 句实际描述。

## 一、概述
本节交代文档的业务背景、适用范围与读者对象：本文档用于解决什么问题，适用于哪些业务场景，目标读者是谁。建议先点出文档的核心价值，再以列表补充适用范围。

## 二、核心内容
本节按主题分块展开文档的核心内容：每个主题先给出一段概括性描述，再用列表补充关键事实、流程节点或决策项。建议每个主题段落在 2-3 句实际描述之内。

## 三、流程与标准
本节列出与文档相关的流程节点与验收标准：流程按时间顺序拆解，验收标准按"输入 / 处理 / 输出"三段式表述，便于读者按图索骥。

## 四、附则
本节说明文档的解释权、生效日期、版本变更记录与配套文档引用，确保读者在文档迭代过程中能找到最新版本。`, t)
}

// InferPptxTitleFromMessage extracts a short slide-deck title from
// the user's intent message. Handles 《...》, 「...」, "生成 X" patterns
// + a few keyword shortcuts for 季度考评 / 述职.
func InferPptxTitleFromMessage(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return ""
	}
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`《([^》]{2,32})》`),
		regexp.MustCompile(`「([^」]{2,32})」`),
		regexp.MustCompile(`生成[一份套]*[《「"]?([^《」"\s，。！？,]{2,28})`),
	} {
		if m := re.FindStringSubmatch(msg); len(m) == 2 {
			t := normalizePptxTitle(m[1])
			t = strings.TrimSuffix(t, "PPT")
			t = strings.TrimSuffix(t, "ppt")
			t = strings.TrimSpace(t)
			if t != "" && t != "演示文稿" {
				return t
			}
		}
	}
	if strings.Contains(msg, "季度考评") || strings.Contains(msg, "季度考核") {
		return "团队季度考评"
	}
	if strings.Contains(msg, "述职") {
		return "述职汇报"
	}
	return ""
}

// DefaultPptxOutlineForMessage produces a structured slide outline
// when the model did not supply content. Two branches: 季度考评
// (8-section detailed) + generic (5-section). All branches use real
// generic descriptions because preflight refuses placeholder-heavy
// outlines.
func DefaultPptxOutlineForMessage(title, userMsg string) string {
	t := coalesce(normalizePptxTitle(title), "演示文稿")
	if strings.Contains(userMsg, "季度考评") || strings.Contains(userMsg, "季度考核") {
		return fmt.Sprintf(`# %s汇报

【指令】禁止使用占位符；每个 H2 必须给出 2-3 句实际描述，不要照抄通用模板。如信息不足，请向用户追问团队、季度、关键指标后再生成。

汇报人：（请填写）
考评周期：（请填写）年第（请填写）季度
汇报日期：（请填写）年（请填写）月（请填写）日

## 一、团队概况
本节描述团队规模与人员构成：本季度核心岗位的到岗与变动情况，跨部门协作的接口人与分工变化，以及对考评周期内有突出贡献成员的简要标注。建议在草稿阶段先用一段概括性描述，再以列表补充关键人员。

## 二、KPI 指标总览
本节按指标维度列出本季度的关键量化目标与实际达成：核心交付指标、质量与稳定性指标、客户与营收指标，按"目标 / 实际 / 完成率"三列展示。综合完成率建议按加权方式汇总，并附上同比环比变化情况。

## 三、KPI 达成分析
本节针对每个指标的达成差异给出原因分析：已达成指标的关键动作复盘，未达成指标的根因拆解，以及跨季度的连续性趋势。结尾段提出本季度最值得讨论的一到两个偏差，以及下一周期内的纠偏思路。

## 四、重点项目进展
本节按项目维度展开：每个项目的当前阶段、关键里程碑达成情况、主要风险与下一步计划。建议使用"项目名 / 进度 / 风险 / 下一步"的固定结构，方便横向比较。

## 五、亮点与问题
本节归纳本季度值得沉淀的最佳实践与需要优先解决的阻塞项。亮点侧重可复制的方法论与流程改进，问题侧重影响面与责任分工。

## 六、改进措施
本节针对上一节列出的问题给出具体改进动作：每项措施明确负责人、截止时间与验证标准。建议按优先级排序，并在草稿中先列出已确认的措施，未确认的留待与负责人对齐后再补充。

## 七、下季度工作计划
本节展望下一季度的目标、关键里程碑与所需资源：目标承接本季度的差距项与组织战略，里程碑按月度分布，资源需求覆盖人力、预算与跨部门支持。

## 八、总结
本节用一段话收束全文：本季度的整体判断、需要管理层支持的关键决策项、以及下一周期内值得重点关注的指标或项目。`, t)
	}
	return fmt.Sprintf(`# %s

【指令】禁止使用占位符；每个 H2 必须给出 2-3 句实际描述。

## 一、背景与目标
本节交代本次汇报的业务背景与战略目标，承接组织当前的优先事项与本次汇报希望达成的具体结论。建议先点出本次汇报的核心受众与决策诉求。

## 二、核心内容
本节按主题分块展开，每块先给出一段概括，再以列表形式补充关键事实与数据。建议每个主题段落在 2-3 句实际描述之内，避免堆砌术语。

## 三、关键指标与达成
本节列出本次汇报涉及的关键指标、目标值与实际达成情况，附上同比环比变化与差异原因。指标选取应与第一段的战略目标一一对应。

## 四、风险与下一步
本节归纳当前可见的风险点、责任人与缓解动作。建议将风险按"已发生 / 可能发生"两类拆开，给出可执行的缓解路径与所需的资源支持。

## 五、总结
本节用一段话收束全文：核心结论、需要管理层支持的关键决策项、以及下一周期内的跟踪重点。`, t)
}
