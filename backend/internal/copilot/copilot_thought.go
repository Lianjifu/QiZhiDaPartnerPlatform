package copilot

import (
	"strings"
)

func thoughtUnderstandTask(userMsg string) (title, detail string) {
	msg := strings.TrimSpace(userMsg)
	if msg == "" {
		return "理解用户请求", ""
	}
	return "理解任务：" + truncateRunes(msg, 48), ""
}

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
