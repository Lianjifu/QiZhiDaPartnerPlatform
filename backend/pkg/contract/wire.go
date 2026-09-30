// Package contract 冻结 Agent OS 线格式（SSE / JSON）与 proto 枚举的双向映射。
// 短名是对外 ABI；禁止再造同义字符串。
package contract

import (
	"strings"

	commonv1 "github.com/qizhida-partner-platform/backend/gen/qzda/common/v1"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

const (
	SessionModeInvestigate = "investigate"
	SessionModeExecute     = "execute"

	RiskLevelLow    = "low"
	RiskLevelMedium = "medium"
	RiskLevelHigh   = "high"

	PolicyAllow            = "allow"
	PolicyMask             = "mask"
	PolicyApprovalRequired = "approval_required"
	PolicyDeny             = "deny"

	ChannelWeb      = "web"
	ChannelAPI      = "api"
	ChannelFeishu   = "feishu"
	ChannelWecom    = "wecom"
	ChannelDingtalk = "dingtalk"
	// ChannelEmail is reserved for proto round-trip only; not an inbound or delivery channel.
	ChannelEmail = "email"

	StreamStage        = "stage"
	StreamDelta        = "delta"
	StreamMessageStart = "message_start"
	StreamMessageDelta = "message_delta"
	StreamMessageDone  = "message_done"
	StreamTool         = "tool"
	StreamRoute        = "route"
	StreamThought      = "thought"
	StreamTask         = "task"
	StreamEvidence     = "evidence"
	StreamDone         = "done"
	StreamError        = "error"

	ReplyModeSingle    = "single"
	ReplyModeSegmented = "segmented"
	ReplyModeStepwise  = "stepwise"

	LoopDirect     = "direct"
	LoopReact      = "react"
	LoopPlanExec   = "plan_exec"
	LoopMultiAgent = "multi_agent"

	MemoryShortTerm = "short_term"
	MemoryWorking   = "working"
	MemoryLongTerm  = "long_term"
)

// SessionModes 为 sessionMode 合法线格式。
var SessionModes = []string{SessionModeInvestigate, SessionModeExecute}

// PolicyDecisions 为零信任四态，与前端 ZeroTrustDecision 对齐。
var PolicyDecisions = []string{PolicyAllow, PolicyMask, PolicyApprovalRequired, PolicyDeny}

// RiskLevels 为会话风险等级。
var RiskLevels = []string{RiskLevelLow, RiskLevelMedium, RiskLevelHigh}

// InboundChannels 为 Envelope.channel，不是投递目录 ChannelKind 全集。
var InboundChannels = []string{ChannelWeb, ChannelAPI, ChannelFeishu, ChannelWecom, ChannelDingtalk}

// StreamEventTypes 为 SSE / Connect 共用事件词表（Connect/proto 子集）。
// 注意：StreamThought / StreamTask 不在此列表，它们是 Web SSE 专有扩展事件，
// 经 JSON 投递，暂不进 proto 枚举。
var StreamEventTypes = []string{
	StreamStage, StreamDelta, StreamMessageStart, StreamMessageDelta, StreamMessageDone,
	StreamTool, StreamRoute, StreamEvidence, StreamDone, StreamError,
}

// AllStreamEventTypesIncludingExtensions adds StreamThought + StreamTask for
// callers that need the SSE-only set (e.g. /api/copilot/... SSE validator).
var AllStreamEventTypesIncludingExtensions = []string{
	StreamStage, StreamDelta, StreamMessageStart, StreamMessageDelta, StreamMessageDone,
	StreamTool, StreamRoute, StreamThought, StreamTask, StreamEvidence, StreamDone, StreamError,
}

// ReplyModes 为专家协作回复分段模式。
var ReplyModes = []string{ReplyModeSingle, ReplyModeSegmented, ReplyModeStepwise}

// AgentOSErrorCodes 为本阶段冻结的内核错误码。
var AgentOSErrorCodes = []apperr.Code{
	apperr.SessionClosed,
	apperr.SessionHandoff,
	apperr.ReplayNotFound,
	apperr.SnapshotNotFound,
	apperr.ChannelThreadUnbound,
	apperr.RuntimeUnavailable,
	apperr.ContextInvalid,
	apperr.IdentityMockForbidden,
	apperr.ZeroTrustDeny,
	apperr.Unauthorized,
}

func ParseSessionMode(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case SessionModeExecute, "exec", "controlled":
		return SessionModeExecute
	default:
		return SessionModeInvestigate
	}
}

func ParseRiskLevel(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case RiskLevelHigh, RiskLevelMedium, RiskLevelLow:
		return strings.ToLower(strings.TrimSpace(v))
	default:
		return RiskLevelMedium
	}
}

func ParsePolicyDecision(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case PolicyAllow, PolicyMask, PolicyApprovalRequired, PolicyDeny:
		return strings.ToLower(strings.TrimSpace(v))
	default:
		return ""
	}
}

func SessionModeFromProto(m commonv1.SessionMode) string {
	switch m {
	case commonv1.SessionMode_SESSION_MODE_EXECUTE:
		return SessionModeExecute
	case commonv1.SessionMode_SESSION_MODE_INVESTIGATE:
		return SessionModeInvestigate
	default:
		return ""
	}
}

func SessionModeToProto(v string) commonv1.SessionMode {
	switch ParseSessionMode(v) {
	case SessionModeExecute:
		return commonv1.SessionMode_SESSION_MODE_EXECUTE
	default:
		return commonv1.SessionMode_SESSION_MODE_INVESTIGATE
	}
}

func RiskLevelFromProto(m commonv1.RiskLevel) string {
	switch m {
	case commonv1.RiskLevel_RISK_LEVEL_LOW:
		return RiskLevelLow
	case commonv1.RiskLevel_RISK_LEVEL_MEDIUM:
		return RiskLevelMedium
	case commonv1.RiskLevel_RISK_LEVEL_HIGH:
		return RiskLevelHigh
	default:
		return ""
	}
}

func RiskLevelToProto(v string) commonv1.RiskLevel {
	switch ParseRiskLevel(v) {
	case RiskLevelLow:
		return commonv1.RiskLevel_RISK_LEVEL_LOW
	case RiskLevelHigh:
		return commonv1.RiskLevel_RISK_LEVEL_HIGH
	default:
		return commonv1.RiskLevel_RISK_LEVEL_MEDIUM
	}
}

func PolicyDecisionFromProto(d commonv1.PolicyDecision) string {
	switch d {
	case commonv1.PolicyDecision_POLICY_DECISION_ALLOW:
		return PolicyAllow
	case commonv1.PolicyDecision_POLICY_DECISION_MASK:
		return PolicyMask
	case commonv1.PolicyDecision_POLICY_DECISION_APPROVAL_REQUIRED:
		return PolicyApprovalRequired
	case commonv1.PolicyDecision_POLICY_DECISION_DENY:
		return PolicyDeny
	default:
		return ""
	}
}

func PolicyDecisionToProto(v string) commonv1.PolicyDecision {
	switch ParsePolicyDecision(v) {
	case PolicyAllow:
		return commonv1.PolicyDecision_POLICY_DECISION_ALLOW
	case PolicyMask:
		return commonv1.PolicyDecision_POLICY_DECISION_MASK
	case PolicyApprovalRequired:
		return commonv1.PolicyDecision_POLICY_DECISION_APPROVAL_REQUIRED
	case PolicyDeny:
		return commonv1.PolicyDecision_POLICY_DECISION_DENY
	default:
		return commonv1.PolicyDecision_POLICY_DECISION_UNSPECIFIED
	}
}

func ChannelKindFromProto(k commonv1.ChannelKind) string {
	switch k {
	case commonv1.ChannelKind_CHANNEL_KIND_WEB:
		return ChannelWeb
	case commonv1.ChannelKind_CHANNEL_KIND_API:
		return ChannelAPI
	case commonv1.ChannelKind_CHANNEL_KIND_FEISHU:
		return ChannelFeishu
	case commonv1.ChannelKind_CHANNEL_KIND_WECOM:
		return ChannelWecom
	case commonv1.ChannelKind_CHANNEL_KIND_DINGTALK:
		return ChannelDingtalk
	case commonv1.ChannelKind_CHANNEL_KIND_EMAIL:
		return ChannelEmail
	default:
		return ""
	}
}

func ChannelKindToProto(v string) commonv1.ChannelKind {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case ChannelWeb:
		return commonv1.ChannelKind_CHANNEL_KIND_WEB
	case ChannelAPI:
		return commonv1.ChannelKind_CHANNEL_KIND_API
	case ChannelFeishu:
		return commonv1.ChannelKind_CHANNEL_KIND_FEISHU
	case ChannelWecom:
		return commonv1.ChannelKind_CHANNEL_KIND_WECOM
	case ChannelDingtalk:
		return commonv1.ChannelKind_CHANNEL_KIND_DINGTALK
	case ChannelEmail:
		return commonv1.ChannelKind_CHANNEL_KIND_EMAIL
	default:
		return commonv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED
	}
}

func StreamEventTypeFromProto(t commonv1.StreamEventType) string {
	switch t {
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_STAGE:
		return StreamStage
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_DELTA:
		return StreamDelta
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_MESSAGE_START:
		return StreamMessageStart
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_MESSAGE_DELTA:
		return StreamMessageDelta
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_MESSAGE_DONE:
		return StreamMessageDone
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_TOOL:
		return StreamTool
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_ROUTE:
		return StreamRoute
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_EVIDENCE:
		return StreamEvidence
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_DONE:
		return StreamDone
	case commonv1.StreamEventType_STREAM_EVENT_TYPE_ERROR:
		return StreamError
	default:
		return ""
	}
}

func StreamEventTypeToProto(v string) commonv1.StreamEventType {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case StreamStage:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_STAGE
	case StreamDelta:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_DELTA
	case StreamMessageStart:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_MESSAGE_START
	case StreamMessageDelta:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_MESSAGE_DELTA
	case StreamMessageDone:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_MESSAGE_DONE
	case StreamTool:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_TOOL
	case StreamRoute:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_ROUTE
	case StreamEvidence:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_EVIDENCE
	case StreamDone:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_DONE
	case StreamError:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_ERROR
	default:
		return commonv1.StreamEventType_STREAM_EVENT_TYPE_UNSPECIFIED
	}
}

func LoopModeFromProto(m commonv1.LoopMode) string {
	switch m {
	case commonv1.LoopMode_LOOP_MODE_DIRECT:
		return LoopDirect
	case commonv1.LoopMode_LOOP_MODE_REACT:
		return LoopReact
	case commonv1.LoopMode_LOOP_MODE_PLAN_EXEC:
		return LoopPlanExec
	case commonv1.LoopMode_LOOP_MODE_MULTI_AGENT:
		return LoopMultiAgent
	default:
		return ""
	}
}

func LoopModeToProto(v string) commonv1.LoopMode {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case LoopDirect:
		return commonv1.LoopMode_LOOP_MODE_DIRECT
	case LoopReact:
		return commonv1.LoopMode_LOOP_MODE_REACT
	case LoopPlanExec:
		return commonv1.LoopMode_LOOP_MODE_PLAN_EXEC
	case LoopMultiAgent:
		return commonv1.LoopMode_LOOP_MODE_MULTI_AGENT
	default:
		return commonv1.LoopMode_LOOP_MODE_UNSPECIFIED
	}
}

func MemoryLayerFromProto(m commonv1.MemoryLayer) string {
	switch m {
	case commonv1.MemoryLayer_MEMORY_LAYER_SHORT_TERM:
		return MemoryShortTerm
	case commonv1.MemoryLayer_MEMORY_LAYER_WORKING:
		return MemoryWorking
	case commonv1.MemoryLayer_MEMORY_LAYER_LONG_TERM:
		return MemoryLongTerm
	default:
		return ""
	}
}

func MemoryLayerToProto(v string) commonv1.MemoryLayer {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case MemoryShortTerm:
		return commonv1.MemoryLayer_MEMORY_LAYER_SHORT_TERM
	case MemoryWorking:
		return commonv1.MemoryLayer_MEMORY_LAYER_WORKING
	case MemoryLongTerm:
		return commonv1.MemoryLayer_MEMORY_LAYER_LONG_TERM
	default:
		return commonv1.MemoryLayer_MEMORY_LAYER_UNSPECIFIED
	}
}
