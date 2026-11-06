// Package copilot —— 回合叙事中的"思维过程"thought 文案生成模块。
//
// 把路由 / 工具选择 / 工具结果等阶段事件翻译成对用户友好的中文 thought 标题 + 详情。
// 标题用于前端四阶段进度条，详情用于 hover 显示原因。
package copilot

// copilot_thought.go — 思维链:让 LLM 输出可解释的 reasoning steps,便于前端展示
// 思考过程与人工审核。与 cognitive 层配合,但更轻量(仅生成步骤,不决策)。

import (
	"strings"
)

// thoughtUnderstandTask 产出"理解任务"阶段的 thought 标题（截断到 48 rune）。
func thoughtUnderstandTask(userMsg string) (title, detail string) {
	msg := strings.TrimSpace(userMsg)
	if msg == "" {
		return "理解用户请求", ""
	}
	return "理解任务：" + truncateRunes(msg, 48), ""
}

// thoughtForRouteMode 根据路由 mode + 内部 reason 生成"为什么走这条路"的 thought。
func thoughtForRouteMode(mode, reason string) (title, detail string) {
	switch mode {
	case modePlanExec:
		return "先制定方案再执行", humanRouteReason(reason)
	case modeMultiAgent:
		return "需要多位专家协作", humanRouteReason(reason)
	case modeDirect:
		return "直接作答", humanRouteReason(reason)
	default:
		return "分析问题并按需调用能力", humanRouteReason(reason)
	}
}

// humanRouteReason 把 classifyCopilotMode 的内部 reason 翻译成对用户友好的中文短语。
// 未知 reason 一律回落到通用文案，不把内部枚举值（如 client_hint）透给用户。
func humanRouteReason(reason string) string {
	switch strings.TrimSpace(reason) {
	case "reflect_requested":
		return "用户反馈需复核"
	case "plan_hint", "plan_requested":
		return "方案模式"
	case "complex_task", "complex_multi_step":
		return "任务较复杂"
	case "client_hint":
		return "按指定模式处理"
	case "short_chitchat":
		return "简短寒暄"
	case "cross_department":
		return "涉及跨部门协作"
	case "default_react":
		return "默认逐步分析"
	default:
		return ""
	}
}

// thoughtForToolChoice 根据工具名生成"为什么要调它"的 thought：docx/pptx/xlsx/pdf 等按文档类型
// 给出具体话术，未命中预置类型时退到通用"调用能力：X"。
func thoughtForToolChoice(toolName string) (title, detail string) {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return "选择合适能力完成任务", ""
	}
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "docx") || strings.Contains(lower, "word"):
		return "调用生成 Word 文档", "便于转发、存档与正式分发"
	case strings.Contains(lower, "pptx") || strings.Contains(lower, "ppt"):
		return "调用生成演示文稿", "便于汇报与分享"
	case strings.Contains(lower, "xlsx") || strings.Contains(lower, "excel"):
		return "调用生成表格", "便于汇总与二次处理"
	case strings.Contains(lower, "knowledge") || strings.Contains(lower, "retrieve"):
		return "检索相关知识", "查找与问题相关的已发布资料"
	case strings.Contains(lower, "memory"):
		return "查阅相关记忆", "回忆此前对话中记录的个人偏好"
	default:
		return "调用能力：" + name, ""
	}
}

// thoughtForToolResult 把工具调用状态（success / denied / failed）翻译成 thought 标题。
func thoughtForToolResult(status, toolName string) (title, detail string) {
	name := humanToolName(toolName)
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "success", "ok":
		return "完成：" + name, ""
	case "denied", "approval_required", "pending_authorization":
		return "等待审批：" + name, ""
	case "failed", "error":
		return "失败：" + name, ""
	default:
		return "", ""
	}
}

// humanToolName 把工具的技术名翻译成用户可读的能力名。
// knowledge.retrieve / memory.recall 这类内部标识出现在气泡里会让回复像日志。
func humanToolName(toolName string) string {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return "能力"
	}
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "knowledge") || strings.Contains(lower, "retrieve"):
		return "知识检索"
	case strings.Contains(lower, "memory") || strings.Contains(lower, "recall"):
		return "记忆回忆"
	case strings.Contains(lower, "docx") || strings.Contains(lower, "word"):
		return "Word 文档"
	case strings.Contains(lower, "pptx") || strings.Contains(lower, "ppt"):
		return "演示文稿"
	case strings.Contains(lower, "xlsx") || strings.Contains(lower, "excel"):
		return "表格"
	case strings.Contains(lower, "web") || strings.Contains(lower, "browse"):
		return "网页访问"
	case strings.Contains(lower, "shell"):
		return "受控命令"
	case strings.Contains(lower, "mcp"):
		return "MCP 服务"
	case strings.Contains(lower, "chart"):
		return "图表生成"
	case strings.Contains(lower, "artifact"):
		return "产物读取"
	case strings.Contains(lower, "todo"):
		return "待办记录"
	default:
		return name
	}
}
