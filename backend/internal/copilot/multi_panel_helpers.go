// multi-agent panel (copilot_multi.go) 使用的进程内辅助函数。
// 把原先写在 internal/server/session_panel.go 的 mergeParticipantOpinions / fmtParticipantSkipNote
// 镜像到这里（因为它们消费 copilot-internal 类型 participantTurnResult）。
package copilot

// mergeParticipantOpinions 把 participantTurnResults 列表拼成 supervisor 聚合 prompt 用的字符串切片。
// mergeParticipantOpinions stitches participantTurnResults into the
// supervisor-aggregate prompt. Truncates each opinion to keep the aggregate
// LLM call within budget.
func mergeParticipantOpinions(results []participantTurnResult, perRunes int) []string {
	out := make([]string, 0, len(results))
	for _, r := range results {
		if r.Status != "success" {
			out = append(out, fmtParticipantSkipNote(r))
			continue
		}
		header := r.ParticipantID
		if r.HardNoRefusal != "" {
			header = r.ParticipantID + " (hard-no:" + r.HardNoRefusal + ")"
		}
		body := truncateRunes(r.Text, perRunes)
		out = append(out, "【"+header+"】\n"+body)
	}
	return out
}

// fmtParticipantSkipNote 给"未成功"（拒答 / 超时 / 失败）的子专家生成一行省略说明。
// fmtParticipantSkipNote renders a one-line summary for a participant whose
// turn didn't return a usable success response (refused / timed out /
// failed). Returned string is used as the participant's contribution to the
// supervisor aggregate prompt.
func fmtParticipantSkipNote(r participantTurnResult) string {
	switch r.Status {
	case "refused":
		return "【" + r.ParticipantID + " · 已按硬性设定拒答】原因：" + r.HardNoRefusal
	case "timed_out":
		return "【" + r.ParticipantID + " · 调用超时】"
	case "failed":
		return "【" + r.ParticipantID + " · 调用失败】" + r.Reason
	}
	return "【" + r.ParticipantID + " · 未参与】"
}
