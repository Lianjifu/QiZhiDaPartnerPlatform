// Package errors 定义与前端 Mock / 架构规划 §11 对齐的 E_* 错误码。
package errors

import "fmt"

// Code 为稳定机器可读错误码。
type Code string

const (
	Unknown                              Code = "E_UNKNOWN"
	Unauthorized                         Code = "E_UNAUTHORIZED"
	AuditorReadOnly                      Code = "E_AUDITOR_READ_ONLY"
	RoleForbidden                        Code = "E_ROLE_FORBIDDEN"
	AdminRequired                        Code = "E_ADMIN_REQUIRED"
	WorkspaceScope                       Code = "E_WORKSPACE_SCOPE"
	WorkspaceNotFound                    Code = "E_WORKSPACE_NOT_FOUND"
	WorkspaceWriteForbidden              Code = "E_WORKSPACE_WRITE_FORBIDDEN"
	WorkspaceNameRequired                Code = "E_WORKSPACE_NAME_REQUIRED"
	WorkspaceInUse                       Code = "E_WORKSPACE_IN_USE"
	WorkspaceOwnerRequired               Code = "E_WORKSPACE_OWNER_REQUIRED"
	AccessReadForbidden                  Code = "E_ACCESS_READ_FORBIDDEN"
	AccessWriteForbidden                 Code = "E_ACCESS_WRITE_FORBIDDEN"
	AccessGrantInvalid                   Code = "E_ACCESS_GRANT_INVALID"
	AccessGrantNotFound                  Code = "E_ACCESS_GRANT_NOT_FOUND"
	AccessSelfEscalation                 Code = "E_ACCESS_SELF_ESCALATION"
	AccessReviewNotFound                 Code = "E_ACCESS_REVIEW_NOT_FOUND"
	SODSelfApproval                      Code = "E_SOD_SELF_APPROVAL"
	ReleaseReadForbidden                 Code = "E_RELEASE_READ_FORBIDDEN"
	ReleaseRequestForbidden              Code = "E_RELEASE_REQUEST_FORBIDDEN"
	ReleaseRequestInvalid                Code = "E_RELEASE_REQUEST_INVALID"
	ReleaseRequestRequired               Code = "E_RELEASE_REQUEST_REQUIRED"
	ReleaseApproveForbidden              Code = "E_RELEASE_APPROVE_FORBIDDEN"
	ReleaseNotFound                      Code = "E_RELEASE_NOT_FOUND"
	ZeroTrustDeny                        Code = "E_ZERO_TRUST_DENY"
	ZeroTrustPolicyInvalid               Code = "E_ZERO_TRUST_POLICY_INVALID"
	ZeroTrustPolicyNotFound              Code = "E_ZERO_TRUST_POLICY_NOT_FOUND"
	ZeroTrustBaselineLocked              Code = "E_ZERO_TRUST_BASELINE_LOCKED"
	ZeroTrustEvalInvalid                 Code = "E_ZERO_TRUST_EVALUATION_INVALID"
	TemporaryAuthInvalid                 Code = "E_TEMPORARY_AUTH_INVALID"
	TemporaryAuthTTLInvalid              Code = "E_TEMPORARY_AUTH_TTL_INVALID"
	TemporaryAuthNotFound                Code = "E_TEMPORARY_AUTH_NOT_FOUND"
	TemporaryAuthProdDual                Code = "E_TEMPORARY_AUTH_PRODUCTION_REQUIRES_DUAL_APPROVAL"
	AuditReadForbidden                   Code = "E_AUDIT_READ_FORBIDDEN"
	AuditExportForbidden                 Code = "E_AUDIT_EXPORT_FORBIDDEN"
	ModelReadForbidden                   Code = "E_MODEL_READ_FORBIDDEN"
	ModelWriteForbidden                  Code = "E_MODEL_WRITE_FORBIDDEN"
	KnowledgeReadForbidden               Code = "E_KNOWLEDGE_READ_FORBIDDEN"
	KnowledgeWriteForbidden              Code = "E_KNOWLEDGE_WRITE_FORBIDDEN"
	ModelUnavailable                     Code = "E_MODEL_UNAVAILABLE"
	ModelScope                           Code = "E_MODEL_SCOPE"
	EgressBlocked                        Code = "E_EGRESS_BLOCKED"
	BudgetExceeded                       Code = "E_BUDGET_EXCEEDED"
	ProviderInvalid                      Code = "E_PROVIDER_INVALID"
	ProviderNotFound                     Code = "E_PROVIDER_NOT_FOUND"
	ProviderInUse                        Code = "E_PROVIDER_IN_USE"
	ProviderCredential                   Code = "E_PROVIDER_CREDENTIAL"
	ProviderAuth                         Code = "E_PROVIDER_AUTH"
	ProviderTimeout                      Code = "E_PROVIDER_TIMEOUT"
	ProviderDiscoverInvalid              Code = "E_PROVIDER_DISCOVER_INVALID"
	ProviderDiscoverAuth                 Code = "E_PROVIDER_DISCOVER_AUTH"
	ProviderUnreachable                  Code = "E_PROVIDER_UNREACHABLE"
	PolicyNotFound                       Code = "E_POLICY_NOT_FOUND"
	PolicyNotReady                       Code = "E_POLICY_NOT_READY"
	PolicyNotPublished                   Code = "E_POLICY_NOT_PUBLISHED"
	VersionNotFound                      Code = "E_VERSION_NOT_FOUND"
	RollbackInvalid                      Code = "E_ROLLBACK_INVALID"
	FallbackInvalid                      Code = "E_FALLBACK_INVALID"
	DrillScopeInvalid                    Code = "E_DRILL_SCOPE_INVALID"
	DrillInvalid                         Code = "E_DRILL_INVALID"
	RateLimited                          Code = "E_RATE_LIMITED"
	ChannelReadForbidden                 Code = "E_CHANNEL_READ_FORBIDDEN"
	ChannelWriteForbidden                Code = "E_CHANNEL_WRITE_FORBIDDEN"
	ChannelInUse                         Code = "E_CHANNEL_IN_USE"
	TaskScope                            Code = "E_TASK_SCOPE"
	TaskOwnerScope                       Code = "E_TASK_OWNER_SCOPE"
	TaskApproval                         Code = "E_TASK_APPROVAL"
	TaskRisk                             Code = "E_TASK_RISK"
	TaskVersion                          Code = "E_TASK_VERSION"
	DigitalPartnerNotFound              Code = "E_DIGITAL_PARTNER_NOT_FOUND"
	DigitalPartnerInvalid               Code = "E_DIGITAL_PARTNER_INVALID"
	DigitalPartnerPublish               Code = "E_DIGITAL_PARTNER_PUBLISH_FORBIDDEN"
	DigitalPartnerBinding               Code = "E_DIGITAL_PARTNER_UNPUBLISHED_CAPABILITY"
	DigitalPartnerConfigurationRequired Code = "E_DIGITAL_PARTNER_CONFIGURATION_REQUIRED"
	DigitalPartnerBoundaryRequired      Code = "E_DIGITAL_PARTNER_BOUNDARY_REQUIRED"
	DigitalPartnerCapabilityRequired    Code = "E_DIGITAL_PARTNER_CAPABILITY_REQUIRED"
	DigitalPartnerProfileIncomplete     Code = "E_DIGITAL_PARTNER_PROFILE_INCOMPLETE"
	DigitalPartnerEvaluationRequired    Code = "E_DIGITAL_PARTNER_EVALUATION_REQUIRED"
	MemoryWriteForbidden                 Code = "E_MEMORY_WRITE_FORBIDDEN"
	HomeAlertNotFound                    Code = "E_HOME_ALERT_NOT_FOUND"
	AckNoteRequired                      Code = "E_ACK_NOTE_REQUIRED"
	CredentialsRequired                  Code = "E_CREDENTIALS_REQUIRED"
	NotFound                             Code = "E_NOT_FOUND"
	BadRequest                           Code = "E_BAD_REQUEST"
	PayloadTooLarge                      Code = "E_PAYLOAD_TOO_LARGE"
	UnsupportedMediaType                 Code = "E_UNSUPPORTED_MEDIA_TYPE"

	// Agent OS 内核（ADR-013）。阶段 1 起用于 Session Routing / Replay / 身份门禁。
	SessionClosed         Code = "E_SESSION_CLOSED"
	SessionHandoff        Code = "E_SESSION_HANDOFF"
	ReplayNotFound        Code = "E_REPLAY_NOT_FOUND"
	SnapshotNotFound      Code = "E_SNAPSHOT_NOT_FOUND"
	ChannelThreadUnbound  Code = "E_CHANNEL_THREAD_UNBOUND"
	RuntimeUnavailable    Code = "E_RUNTIME_UNAVAILABLE"
	ContextInvalid        Code = "E_CONTEXT_INVALID"
	IdentityMockForbidden Code = "E_IDENTITY_MOCK_FORBIDDEN"

	// 阶段 4 · 规模化生产最小闭环
	EvalSetRequired     Code = "E_EVAL_SET_REQUIRED"
	EvalSetFailed       Code = "E_EVAL_SET_FAILED"
	ReplicaStandby      Code = "E_REPLICA_STANDBY"
	CountersignRequired Code = "E_COUNTERSIGN_REQUIRED"

	// W1-D1 · Skill Vetter
	SkillVetDenied  Code = "E_SKILL_VET_DENIED"
	SkillVetInvalid Code = "E_SKILL_VET_INVALID"

	// W1-D2 · Skill 签名
	SkillSignatureInvalid    Code = "E_SKILL_SIGNATURE_INVALID"
	SkillSignatureMissing    Code = "E_SKILL_SIGNATURE_MISSING"
	SkillSignatureUnknownKey Code = "E_SKILL_SIGNATURE_UNKNOWN_KEY"

	// W3-D1 · Expert Inbox
	ExpertInboxForbidden Code = "E_EXPERT_INBOX_FORBIDDEN"
	ExpertInboxNotFound Code = "E_EXPERT_INBOX_NOT_FOUND"
	ExpertInboxInvalid  Code = "E_EXPERT_INBOX_INVALID"

	// Session sync disabled (DE_SESSION_SYNC_ENABLED=false)
	SessionSyncDisabled Code = "E_SESSION_SYNC_DISABLED"
)

// AppError 携带错误码与 HTTP 状态。
type AppError struct {
	Code    Code
	Message string
	Status  int
}

func (e *AppError) Error() string {
	if e.Message == "" {
		return string(e.Code)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func New(code Code, status int, msg string) *AppError {
	return &AppError{Code: code, Status: status, Message: msg}
}

func Forbidden(code Code, msg string) *AppError   { return New(code, 403, msg) }
func NotFoundErr(code Code, msg string) *AppError { return New(code, 404, msg) }
func BadReq(code Code, msg string) *AppError      { return New(code, 400, msg) }
func Conflict(code Code, msg string) *AppError    { return New(code, 409, msg) }
func UnauthorizedErr(msg string) *AppError        { return New(Unauthorized, 401, msg) }
func Unavailable(code Code, msg string) *AppError { return New(code, 503, msg) }
