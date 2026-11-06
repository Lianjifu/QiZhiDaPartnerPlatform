package copilot

import (
	"github.com/qizhida-partner-platform/backend/internal/copilot/trajectory"
)

// BuildTrajectoryFromMessages 从已落库的会话消息里组装一条轨迹。
//
// 数据来源全是既有记录(助手消息上的 toolCalls),不需要新的采集通道。
// 关联键是 correlationId —— 一个回合的消息与它的工具调用靠它对齐。
func BuildTrajectoryFromMessages(conversationID, correlationID, partnerID string, messages []map[string]any) trajectory.Trajectory {
	t := trajectory.New(conversationID, correlationID)
	t.DigitalPartnerID = partnerID
	for _, m := range messages {
		if correlationID != "" {
			if c := str(m["correlationId"]); c != "" && c != correlationID {
				continue
			}
		}
		if str(m["role"]) != "assistant" {
			continue
		}
		for _, tc := range knowledgeSliceMaps(m["toolCalls"]) {
			t.AddStep(str(tc["name"]), mapArgAny(tc["args"]), str(tc["status"]), intFromAny(tc["durationMs"], 0))
			steps := t.Steps
			steps[len(steps)-1].Permission = str(tc["permission"])
		}
		if t.FinalText == "" {
			if c := str(m["content"]); c != "" {
				t.FinalText = c
			}
		}
		if id := str(m["modelId"]); id != "" {
			t.ModelID = id
		}
	}
	return t
}

// mapArgAny 把任意值转成 map[string]any。
func mapArgAny(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}
