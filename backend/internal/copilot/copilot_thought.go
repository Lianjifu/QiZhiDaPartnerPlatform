// Package copilot —— 回合叙事中的"思维过程"thought 文案生成模块。
//
// 把路由 / 工具选择 / 工具结果等阶段事件翻译成对用户友好的中文 thought 标题 + 详情。
// 标题用于前端四阶段进度条，详情用于 hover 显示原因。
package copilot

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
func humanRouteReason(reason string) string {
	switch strings.TrimSpace(reason) {
	case "reflect_requested":
		return "用户反馈需复核"
	case "plan_hint", "plan_requested":
		return "方案模式"
	case "complex_task":
		return "任务较复杂"
	default:
		if reason == "" {
			return ""
		}
		return reason
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
		return "检索相关知识", name
	case strings.Contains(lower, "memory"):
		return "查阅相关记忆", name
	default:
		return "调用能力：" + name, ""
	}
}

// thoughtForToolResult 把工具调用状态（success / denied / failed）翻译成 thought 标题。
func thoughtForToolResult(status, toolName string) (title, detail string) {
	name := strings.TrimSpace(toolName)
	if name == "" {
		name = "能力"
	}
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
