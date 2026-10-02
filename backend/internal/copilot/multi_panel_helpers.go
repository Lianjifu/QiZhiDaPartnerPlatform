// Package-private helpers used by the multi-agent panel (copilot_multi.go).
// Mirrors the mergeParticipantOpinions / fmtParticipantSkipNote helpers that
// lived in internal/server/session_panel.go before the M02 backend
// consolidation. They use copilot-internal types (participantTurnResult) so
// they belong here, not on server.
package copilot

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
