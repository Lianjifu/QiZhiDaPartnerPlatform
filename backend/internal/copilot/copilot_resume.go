// copilot_resume.go —— P6 人机共岗:审批之后把同一个回合续跑起来。
//
// 现状(改造前):工具需要人工授权时,平台把调用挂进审批队列,伙伴收到
// "已进入审核队列" 的观察后**继续往下走** —— 模型会自己想办法绕,或者
// 反复重试。人并没有真正进入回路。
//
// 改造后:
//   - 命中 approval_required → 本回合以 awaiting 状态挂起(SSE 事件 awaiting)
//   - 审批通过 → POST .../turns/{corr}/resume → 平台执行被批准的工具,
//     把结果作为观察喂回模型,让**同一个伙伴、同一个 run** 接着把活干完
//   - 审批驳回 → 驳回理由同样喂回模型,由它决定下一步
package copilot

import (
	"context"
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// PendingAction 是等待人工决策的一条工具审批。
type PendingAction struct {
	// ID 是待审单 ID。
	ID string
	// ToolName / ToolKey 是被审批的工具。
	ToolName string
	ToolKey  string
	// Args 是原始调用参数。
	Args map[string]any
	// Status: approved | rejected
	Status string
	// Note 是审批意见(驳回原因 / 批准备注)。
	Note string
	// DecidedBy 是决策人。
	DecidedBy string
}

// ResumeInput 是续跑的入参。
type ResumeInput struct {
	Request        *http.Request
	WorkspaceID    string
	ConversationID string
	CorrelationID  string
	ModelID        string
	Employee       map[string]any
	EnabledTools   []string
	SessionMode    string
	RiskLevel      string
	Viewer         *auth.Identity
	Emit           reactEmitFunc
	// Actions 是本次要续跑的审批动作。
	Actions []PendingAction
	// History 是会话已有的消息(用于重建上下文)。
	History []map[string]any
}

// ResumeResult 是续跑结果。
type ResumeResult struct {
	Text      string
	ToolCalls []map[string]any
	Steps     int
	Resolved  ResolvedTurn
	// Awaiting 表示续跑过程中又产生了新的待审动作(需要再等一次审批)。
	Awaiting bool
	// Executed 记录被批准并已执行的工具。
	Executed []string
	// Rejected 记录被驳回的工具。
	Rejected []string
}

// ResumeTurn 在审批结果回来后继续同一个回合。
func (s *Service) ResumeTurn(ctx context.Context, in ResumeInput) ResumeResult {
	out := ResumeResult{}
	if len(in.Actions) == 0 {
		out.Text = "没有待续跑的审批动作。"
		return out
	}
	reg := buildToolRegistry(in.Employee, in.EnabledTools)

	runCtx := toolRunContext{
		Request: in.Request, WorkspaceID: in.WorkspaceID, DigitalPartner: partnerIDOf(in.Employee),
		ConversationID: in.ConversationID, CorrelationID: in.CorrelationID,
		Viewer: in.Viewer, SessionMode: in.SessionMode, RiskLevel: in.RiskLevel,
		ModelID: in.ModelID,
	}
	if in.Viewer != nil {
		runCtx.OwnerID = in.Viewer.ID
	}

	var observations []string
	for _, action := range in.Actions {
		if strings.EqualFold(action.Status, "approved") {
			tool := registryLookup(reg, action.ToolName)
			if tool == nil {
				tool = registryLookup(reg, action.ToolKey)
			}
			if tool == nil {
				observations = append(observations,
					"【审批通过 · "+action.ToolName+"】工具已不在当前会话的可执行集合中,无法执行。")
				continue
			}
			call := toolCallRequest{Name: tool.Name, Args: action.Args}
			if call.Args == nil {
				call.Args = map[string]any{}
			}
			res := s.runCopilotTool(runCtx, tool, call)
			if res.Status == "success" {
				out.Executed = append(out.Executed, action.ToolName)
			}
			obs := res.Output
			if obs == "" {
				obs = coalesce(res.Error, res.Status)
			}
			observations = append(observations,
				"【审批通过 · "+action.ToolName+" · "+res.Status+"】\n"+truncateRunes(obs, reactToolObservationMaxRunes))
			continue
		}
		out.Rejected = append(out.Rejected, action.ToolName)
		note := strings.TrimSpace(action.Note)
		if note == "" {
			note = "未填写原因"
		}
		observations = append(observations,
			"【审批驳回 · "+action.ToolName+"】原因:"+note+"。请据此调整方案,不要再重复申请同一操作。")
	}
	if len(observations) == 0 {
		out.Text = "没有可执行的审批结果。"
		return out
	}

	messages := assembleCopilotChatMessages(in.History)
	messages = append(messages,
		modelprov.ChatMessage{Role: "user", Content: strings.Join(observations, "\n\n")},
		modelprov.ChatMessage{Role: "user", Content: "审批结果已到。请基于上述审批结果继续完成任务:如果还需要写操作,请重新发起(会再次进入人工审核)。"},
	)

	res := s.runReactTurn(ctx, reactTurnInput{
		Request:        in.Request,
		WorkspaceID:    in.WorkspaceID,
		ModelID:        in.ModelID,
		System:         "你是数字伙伴,正在人工审批之后继续完成之前被挂起的任务。",
		Messages:       messages,
		Registry:       reg,
		ConversationID: in.ConversationID,
		CorrelationID:  in.CorrelationID,
		DigitalPartner: partnerIDOf(in.Employee),
		Viewer:         in.Viewer,
		Emit:           in.Emit,
		SessionMode:    in.SessionMode,
		RiskLevel:      in.RiskLevel,
		Employee:       in.Employee,
		SkipStream:     true,
		NoBootstrap:    true,
	})
	if res.Err != nil {
		out.Text = "续跑失败：" + res.Err.Error()
		return out
	}
	out.Text = res.Text
	out.ToolCalls = res.ToolCalls
	out.Steps = res.Steps
	out.Resolved = res.Resolved
	out.Awaiting = res.Awaiting
	return out
}

// partnerIDOf 取伙伴 ID。
func partnerIDOf(emp map[string]any) string {
	if emp == nil {
		return ""
	}
	return str(emp["id"])
}
