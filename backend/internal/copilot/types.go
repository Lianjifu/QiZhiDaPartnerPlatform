// Exported type aliases for the copilot-internal types so external callers
// (notably internal/server/) can refer to them without duplicating the
// underlying struct shapes. The lowercase originals are kept because the
// bulk of the M02 module uses them directly and renaming every call site
// would balloon the diff. The exported names here are an alias — not a
// duplicate — so they stay in sync automatically.
//
// Why aliases: server/server.go embeds the same shapes in its struct
// fields (Server.lastMemoryBudgetReport, Server.testHooks), and
// server/session_panel.go declares local helpers that take
// participantTurnResult as a parameter. Both files used to live
// alongside the originals (in the same package), so the types were
// automatically visible. After the M02 P2 deep move the originals live in
// internal/copilot/ and need a stable public surface.
package copilot

import (
	"context"
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citation"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// Public aliases for the lowercase originals.
type (
	ReactTurnInput        = reactTurnInput
	ReactTurnResult       = reactTurnResult
	ReactEmitFunc         = reactEmitFunc
	ToolRunContext        = toolRunContext
	RegisteredTool        = registeredTool
	ToolCallRequest       = toolCallRequest
	ToolExecResult        = toolExecResult
	MemoryHit             = memoryHit
	MemoryBudgetReport    = memoryBudgetReport
	CognitiveDecision     = cognitiveDecision
	ParticipantContext    = participantContext
	ParticipantTurnResult = participantTurnResult
	ParticipantCtxInput   = participantCtxInput
)

// ResolvedTurn is exported at definition site (see service.go).
type ResolvedTurnExport = ResolvedTurn

// RuntimeMemoryInput is exported at definition site (see service.go).
type RuntimeMemoryInputExport = runtimeMemoryInput

// EnsureEmployeeCognitiveSkills / IsCognitiveSkillName / SlugToolName —
// exported thin wrappers for the package-level helpers in
// copilot_cognitive.go and copilot_tools.go. Server's builtin_skills.go
// references these by exported name since the originals are package-private
// to copilot.
func EnsureEmployeeCognitiveSkills(emp map[string]any) { ensureEmployeeCognitiveSkills(emp) }
func IsCognitiveSkillName(name string) bool            { return isCognitiveSkillName(name) }
func SlugToolName(name string) string                  { return slugToolName(name) }

// LookupContextSnapshotCtx / SnapshotEvents — exported thin wrappers for
// the Service method and package-level helper used by
// server/connect_gateway.go and server/connect_services.go to load + render
// context snapshots via the M02 service.
func (s *Service) LookupContextSnapshotCtx(ctx context.Context, ws, conversationID, correlationID string) map[string]any {
	return s.lookupContextSnapshotCtx(ctx, ws, conversationID, correlationID)
}

func SnapshotEvents(rec map[string]any) []map[string]any { return snapshotEvents(rec) }

// RunCopilotTool — exported wrapper around the Service.runCopilotTool
// method so server/handlers_actions.go (which still owns the Skill Turn
// action-run dispatch path) can invoke it via the M02 service.
func (s *Service) RunCopilotTool(ctx toolRunContext, t *registeredTool, call toolCallRequest) toolExecResult {
	return s.runCopilotTool(ctx, t, call)
}

// AllowCopilotTurn — exported wrapper around the Service.allowCopilotTurn
// rate-limit gate so server/handlers_c.go (preflight rate check on the
// non-streaming copilot route) can call into the M02 service.
func (s *Service) AllowCopilotTurn(ws, userID string) bool {
	return s.allowCopilotTurn(ws, userID)
}

// LookupCopilotTurn / CorrelationIDFromTurnSubPath — exported wrappers
// for the package-level helpers in copilot_turn_state.go that
// server/handlers_c.go uses to resolve /api/copilot/turns/:corr/status
// and /api/copilot/turns/:corr/replay requests.
func LookupCopilotTurn(corr string) (CopilotTurnRecord, bool) {
	rec, ok := lookupCopilotTurn(corr)
	return rec, ok
}

func CorrelationIDFromTurnSubPath(path, suffix string) string {
	return correlationIDFromTurnSubPath(path, suffix)
}

// CopilotTurnRecord is the exported alias for the copilotTurnRecord
// struct used by the in-memory turn state tracker. Server-side callers
// that load a record via LookupCopilotTurn need a stable shape.
type CopilotTurnRecord = copilotTurnRecord

// TurnStatusRunning / TurnStatusDone — exported aliases for the
// turn-state string constants. Server/handlers_c.go uses them when
// constructing the response payload for the status endpoint.
const (
	TurnStatusRunning = turnStatusRunning
	TurnStatusDone    = turnStatusDone
)

// ApplyContentSafety / RegisterCopilotTurn / ReplayStoredSegments /
// ModelIDFromStoredMessage / NewTurnNarrativeCollector /
// CloneEmployeeForCognitiveSkills — exported wrappers for the
// package-level helpers across the copilot_*.go files that
// server/handlers_c.go + server/handlers_actions.go reference (rate
// limiting, replay, cognitive skill injection, narrative collection).
func ApplyContentSafety(raw string) SafetyResult {
	res := applyContentSafety(raw)
	return SafetyResult{
		Text:     res.Text,
		Blocked:  res.Blocked,
		Reasons:  res.Reasons,
		Redacted: res.Redacted,
	}
}

func RegisterCopilotTurn(cid, corr, clientMsgID string) {
	registerCopilotTurn(cid, corr, clientMsgID)
}

func ReplayStoredSegments(emit ReactEmitFunc, msgs []map[string]any, modelID, corr string) {
	replayStoredSegments(emit, msgs, modelID, corr)
}

func ModelIDFromStoredMessage(msg map[string]any) string {
	return modelIDFromStoredMessage(msg)
}

func CloneEmployeeForCognitiveSkills(src map[string]any) map[string]any {
	return cloneEmployeeForCognitiveSkills(src)
}

// TurnEventRecorder — exported alias for the snapshot event recorder
// struct used by the copilot turn-state path.
type TurnEventRecorder = turnEventRecorder

// SafetyResult — exported alias so server callers can decode the
// ApplyContentSafety response without importing the lowercase original.
type SafetyResult = safetyResult

// LoadIdempotentTurn / PersistContextSnapshot — exported wrappers
// around Service methods that server/handlers_c.go calls into for
// rate-limit-replay and durable snapshot persistence.
func (s *Service) LoadIdempotentTurn(cid, clientMsgID string) []map[string]any {
	return s.loadIdempotentTurn(cid, clientMsgID)
}

func (s *Service) PersistContextSnapshot(rec map[string]any) {
	s.persistContextSnapshot(rec)
}

// MemoryProvenanceMaps / EmitThought / BuildToolRegistry /
// FilterRegistrySkipMemoryRecall — exported wrappers for the
// package-level helpers in copilot_context.go + copilot_tools.go +
// copilot_turn_meta.go that server/handlers_c.go uses during the
// copilot stream + non-stream preflight.
func MemoryProvenanceMaps(hits []MemoryHit) []map[string]any {
	return memoryProvenanceMaps(hits)
}

func EmitThought(emit ReactEmitFunc, kind, phase, title, detail string) {
	emitThought(emit, kind, phase, title, detail)
}

func BuildToolRegistry(emp map[string]any, enabledTools []string) []RegisteredTool {
	return buildToolRegistry(emp, enabledTools)
}

func FilterRegistrySkipMemoryRecall(registry []RegisteredTool, memoryPrefetched bool) []RegisteredTool {
	return filterRegistrySkipMemoryRecall(registry, memoryPrefetched)
}

// RetrieveMemoryForTurnLocked / ConsumeLastMemoryBudgetReport — exported
// wrappers around Service methods that server/handlers_c.go calls when
// assembling the memory + provenance payload for the copilot stream.
func (s *Service) RetrieveMemoryForTurnLocked(ws, ownerID, deID, excludeSourceID, query string, viewer *auth.Identity) []MemoryHit {
	return s.retrieveMemoryForTurnLocked(ws, ownerID, deID, excludeSourceID, query, viewer)
}

func (s *Service) ConsumeLastMemoryBudgetReport() *MemoryBudgetReport {
	return s.consumeLastMemoryBudgetReport()
}

// LastMemoryBudgetReport returns the current (non-destructive) budget
// report stored by the most recent RetrieveMemoryForTurnLocked call.
// Used by integration tests to assert the report shape without
// consuming it for SSE dispatch.
func (s *Service) LastMemoryBudgetReport() *MemoryBudgetReport {
	if s == nil {
		return nil
	}
	s.participantMemoryBudgetMu.Lock()
	defer s.participantMemoryBudgetMu.Unlock()
	return s.lastMemoryBudgetReport
}

// RegistryHasEnabledTool / RagHitCount / RagDegradeWarning /
// BuildCopilotSystemPromptWithEffort / ResolveReplyMode /
// ResolveSegmentPolicy — exported wrappers for the package-level helpers
// in copilot_context.go + copilot_segments.go that server/handlers_c.go
// uses to build the system prompt + segment policy for the copilot
// stream.
func RegistryHasEnabledTool(registry []RegisteredTool, name string) bool {
	return registryHasEnabledTool(registry, name)
}

func RagHitCount(ragHits any) int { return ragHitCount(ragHits) }

func RagDegradeWarning(ragHits any) string { return ragDegradeWarning(ragHits) }

func BuildCopilotSystemPromptWithEffort(emp map[string]any, ragHits any, memoryHits []MemoryHit, reasoningEffort string) string {
	return buildCopilotSystemPromptWithEffort(emp, ragHits, memoryHits, reasoningEffort)
}

func ResolveReplyMode(body map[string]any, emp map[string]any) string {
	return resolveReplyMode(body, emp)
}

func ResolveSegmentPolicy(body map[string]any, emp map[string]any) string {
	return resolveSegmentPolicy(body, emp)
}

// TurnNarrativeCollector — exported alias for the narrative collector
// type used by the copilot stream.
type TurnNarrativeCollector = turnNarrativeCollector

// NewTurnNarrativeCollector — exported constructor returning the proper
// typed collector (the previous wrapper used `any`, which broke the
// `.Record()` method callsite).
func NewTurnNarrativeCollector() *TurnNarrativeCollector {
	return newTurnNarrativeCollector()
}

// TurnPhaseUnderstand — exported alias for the narrative-phase constant.
const TurnPhaseUnderstand = turnPhaseUnderstand

// ReplyModePromptClause / AssembleCopilotChatMessages /
// BuildContextSnapshotRecord / EnabledToolKeys / DefaultSegmentIDGen /
// BuildAckSegment / NormalizeReplyMode / EmitSegmentStream — exported
// wrappers for the package-level helpers across copilot_segments.go,
// copilot_snapshot.go, copilot_context.go, copilot_tools.go.
func ReplyModePromptClause(replyMode, segmentPolicy string) string {
	return replyModePromptClause(replyMode, segmentPolicy)
}

func AssembleCopilotChatMessages(stored []map[string]any) []modelprov.ChatMessage {
	return assembleCopilotChatMessages(stored)
}

// ChatMessage — re-exported alias for modelprov.ChatMessage so server
// callers can use the typed slice directly without an extra import.
type ChatMessage = modelprov.ChatMessage

// AssistantMessagesFromSegments / RegisterStreamCancel / ClearStreamCancel
// / IsCopilotTurnCancelled / FinishCopilotTurn — exported wrappers for the
// package-level helpers in copilot_segments.go + copilot_ratelimit.go +
// copilot_turn_state.go that server/handlers_c.go uses for the SSE
// stream lifecycle (cancel bookkeeping, segment-to-message flattening,
// terminal status flip).
func AssistantMessagesFromSegments(segments []AssistantSegment, corr, replyMode, now string, shared map[string]any, attachLastMeta bool, toolCalls []map[string]any, citations []map[string]any, indexOffset int) []map[string]any {
	return assistantMessagesFromSegments(segments, corr, replyMode, now, shared, attachLastMeta, toolCalls, citations, indexOffset)
}

func RegisterStreamCancel(corr string, cancel context.CancelFunc) {
	registerStreamCancel(corr, cancel)
}

func ClearStreamCancel(corr string) { clearStreamCancel(corr) }

func IsCopilotTurnCancelled(corr string) bool { return isCopilotTurnCancelled(corr) }

func FinishCopilotTurn(corr, status string) { finishCopilotTurn(corr, status) }

// TurnStatusCancelled — exported alias for the cancelled terminal state.
const TurnStatusCancelled = turnStatusCancelled

// TurnPhasePlan / TurnPhaseExecute / TurnPhaseReflect — additional
// exported aliases for the narrative-phase constants used by the SSE
// stream metric counters in server/metrics.go.
const (
	TurnPhasePlan    = turnPhasePlan
	TurnPhaseExecute = turnPhaseExecute
	TurnPhaseReflect = turnPhaseReflect
)

// CognitiveLogic / CognitiveProblem / CognitiveCreative — exported
// aliases for the cognitive-framework primary-decision constants. The
// metrics counters in server/metrics.go dispatch on these values when
// aggregating per-framework invocation totals.
const (
	CognitiveLogic    = cognitiveLogic
	CognitiveProblem  = cognitiveProblem
	CognitiveCreative = cognitiveCreative
)

// TurnStatusFailed — exported alias for the failed terminal state.
const TurnStatusFailed = turnStatusFailed

// CitationsFromRagHits / DedupeCitations / ToolCallsIncludeName /
// KnowledgeToolCallFromHits / EnrichCopilotFinalText /
// ReconcileSegmentsWithFinalText — exported wrappers for the
// package-level helpers across copilot_context.go + copilot_react.go +
// copilot_segments.go + copilot_answer_enrich.go that server/handlers_c.go
// uses during the stream finalization phase.
func CitationsFromRagHits(ragHits any) []map[string]any {
	return citationsFromRagHits(ragHits)
}

func DedupeCitations(in []map[string]any) []map[string]any {
	return dedupeCitations(in)
}

func ToolCallsIncludeName(toolCalls []map[string]any, name string) bool {
	return toolCallsIncludeName(toolCalls, name)
}

func KnowledgeToolCallFromHits(ragHits any, durationMs int) map[string]any {
	return knowledgeToolCallFromHits(ragHits, durationMs)
}

func EnrichCopilotFinalText(full string, toolCalls []map[string]any, userMsg string) string {
	return enrichCopilotFinalText(full, toolCalls, userMsg)
}

func ReconcileSegmentsWithFinalText(segments []AssistantSegment, full string, reactOut ReactTurnResult, replyMode, segmentPolicy, firstMessageID string, idGen func() string) []AssistantSegment {
	return reconcileSegmentsWithFinalText(segments, full, reactOut, replyMode, segmentPolicy, firstMessageID, idGen)
}

// SegmentKindBody / ModeReact — exported constants for the segment kind
// + react-mode tags.
const (
	SegmentKindBody = segmentKindBody
	ModeReact       = modeReact
)

// SegmentStreamAlreadyDone / CognitiveSnapshot / ShouldIngestTurnMemory /
// RememberIdempotentTurn / SegmentIDsFromMessages / SegmentMessageIDs —
// exported wrappers for the package-level helpers in
// copilot_segments.go + copilot_cognitive.go + copilot_context.go +
// copilot_ratelimit.go that server/handlers_c.go uses for stream
// finalization + idempotency + cognitive-framework snapshots.
func SegmentStreamAlreadyDone(streamed []AssistantSegment, i int, seg AssistantSegment, replyMode string) bool {
	return segmentStreamAlreadyDone(streamed, i, seg, replyMode)
}

func CognitiveSnapshot(d CognitiveDecision) map[string]any {
	return cognitiveSnapshot(d)
}

func ShouldIngestTurnMemory(stored []map[string]any, userMsg, assistantText string, toolCalls []map[string]any) bool {
	return shouldIngestTurnMemory(stored, userMsg, assistantText, toolCalls)
}

func RememberIdempotentTurn(s *Service, cid, clientMsgID string, messages []map[string]any) {
	rememberIdempotentTurn(s, cid, clientMsgID, messages)
}

// LastUserContent — exported wrapper for the modelprov.ChatMessage →
// user-content helper used by server/model_invoke.go.
func LastUserContent(messages []modelprov.ChatMessage) string {
	return lastUserContent(messages)
}

func SegmentIDsFromMessages(msgs []map[string]any) []string {
	return segmentIDsFromMessages(msgs)
}

func SegmentMessageIDs(segments []AssistantSegment) []string {
	return segmentMessageIDs(segments)
}

// RunPostTurnEvolutionLocked / PersistEvolve — exported wrappers around
// Service methods used by server/handlers_c.go for self-evolution.
func (s *Service) RunPostTurnEvolutionLocked(in EvolveTurnInput) []map[string]any {
	return s.runPostTurnEvolutionLocked(in)
}

func (s *Service) PersistEvolve() { s.persistEvolve() }

// RunHarnessTurn / FindWorkspaceSkill — exported wrappers around Service
// methods used by server/runtime_loop.go and server/runtime_tools.go.
func (s *Service) RunHarnessTurn(ctx context.Context, in ReactTurnInput) ReactTurnResult {
	return s.runHarnessTurn(ctx, in)
}

func (s *Service) FindWorkspaceSkill(ws, skillID, toolName string) map[string]any {
	return s.findWorkspaceSkill(ws, skillID, toolName)
}

// StreamHarnessAnswer — exported wrapper around the
// streamHarnessAnswer helper used by server/runtime_loop.go.
func StreamHarnessAnswer(emit ReactEmitFunc, finalText, modelID string, rt ResolvedTurn, mode string, steps int, opts *StreamAnswerOpts) []AssistantSegment {
	return streamHarnessAnswer(emit, finalText, modelID, rt, mode, steps, opts)
}

// StreamAnswerOpts — exported alias for the streamAnswerOpts struct
// used to configure segment streaming options.
type StreamAnswerOpts = streamAnswerOpts

// HTTP-handler exports — the 6 M02 routes whose methods were moved from
// internal/server to internal/copilot.Service during the M02 P2 deep move.
// The dispatch in server.go's route table delegates to these wrappers so
// the package boundary stays real (server never sees the method bodies
// directly).
func (s *Service) ReplayCopilotTurn(r *http.Request) (any, error) {
	return s.replayCopilotTurn(r)
}

func (s *Service) CancelCopilotTurn(r *http.Request) (any, error) {
	return s.cancelCopilotTurn(r)
}

func (s *Service) CopilotMessageFeedback(r *http.Request) (any, error) {
	return s.copilotMessageFeedback(r)
}

func (s *Service) ListEvolveCandidates(r *http.Request) (any, error) {
	return s.listEvolveCandidates(r)
}

func (s *Service) EvolveCandidateAction(r *http.Request) (any, error) {
	return s.evolveCandidateAction(r)
}

func (s *Service) EvolveDreamRun(r *http.Request) (any, error) {
	return s.evolveDreamRun(r)
}

// DispatchParticipants — exported wrapper around Service.dispatchParticipants
// used by server's P0–P2 panel tests.
func (s *Service) DispatchParticipants(ctx context.Context, pcs []ParticipantContext) []ParticipantTurnResult {
	out := s.dispatchParticipants(ctx, pcs)
	res := make([]ParticipantTurnResult, len(out))
	copy(res, out)
	return res
}

// LookupContextSnapshot — exported wrapper around Service.lookupContextSnapshot
// used by server/employee_binding_test.go to verify snapshot persistence
// under published employee bindings.
func (s *Service) LookupContextSnapshot(ws, conversationID, correlationID string) map[string]any {
	return s.lookupContextSnapshot(ws, conversationID, correlationID)
}

// RunMultiAgentTurn — exported wrapper around Service.runMultiAgentTurn
// used by server/session_panel_p0p2_fix_test.go to drive the panel
// fallback path.
func (s *Service) RunMultiAgentTurn(ctx context.Context, in ReactTurnInput) ReactTurnResult {
	return s.runMultiAgentTurn(ctx, in)
}

// LevelRank — exported wrapper for the levelRank helper used by
// server/session_panel_p0p2_fix_test.go to assert routing-level rank
// comparisons.
func LevelRank(level string) int { return levelRank(level) }

// RiskLevelFloor — exported wrapper for the riskLevelFloor helper used by
// server/session_panel_p0p2_fix_test.go to assert risk-floor mapping.
func RiskLevelFloor(risk string) string { return riskLevelFloor(risk) }

// CopilotMemoryBudgetTokens — exported wrapper for the per-turn memory
// budget constant used by server/session_panel_p0p2_fix_test.go to
// assert budget accounting.
func CopilotMemoryBudgetTokens() int { return copilotMemoryBudgetTokens }

// SafetyKeyRe — exported alias for the safety-key redactor regex used
// by server/share session redactor to scrub API keys from outbound
// shared-session exports. Same redaction rules as copilot's own
// redactSecretText helper.
var SafetyKeyRe = safetyKeyRe

// ResolveModelByPolicyLevel — exported wrapper for the Service method
// that resolves the model to use given a routing-policy level + risk
// floor. Used by server/session_panel.go to pick a model for each
// multi-agent participant.
func (s *Service) ResolveModelByPolicyLevel(ws, requested, level, riskLevel string) (modelID, policyID, usedLevel string) {
	return s.resolveModelByPolicyLevel(ws, requested, level, riskLevel)
}

// CitationTierFromDocStatus — exported wrapper for the doc-status →
// citation-tier mapper used by server/logCitationsForRAG.
func CitationTierFromDocStatus(status string) citation.Tier {
	return citationTierFromDocStatus(status)
}

// RagHitResults — exported wrapper for the ragHitResults adapter used by
// server/session_panel.go to flatten a tool exec result into a slice of
// RAG hits.
func RagHitResults(hits any) []map[string]any {
	return ragHitResults(hits)
}

// ReasoningEffortGuidance — exported wrapper for the reasoning-effort
// guidance helper used by server/session_governance_test.go when
// asserting session-mode filtering behavior.
func ReasoningEffortGuidance(effort string) string {
	return reasoningEffortGuidance(effort)
}

// StripToolCallMarkers — exported wrapper for the marker-stripping helper
// used by server/session_panel.go to clean up streamed LLM text before
// the participant supervisor records the final answer.
func StripToolCallMarkers(text string) string {
	return stripToolCallMarkers(text)
}

// AuthorizeToolCall — exported wrapper for the per-tool authorization
// gate used by server/skill_harness.go before invoking a copilot tool.
func AuthorizeToolCall(reg []RegisteredTool, call ToolCallRequest) (*RegisteredTool, *ToolExecResult) {
	return authorizeToolCall(reg, call)
}

// IsPendingAssistantReply — exported wrapper for the "is this a
// pending assistant reply" predicate used by server/skill_artifacts.go
// to gate streaming artifact generation behind an assistant turn.
func IsPendingAssistantReply(text string) bool {
	return isPendingAssistantReply(text)
}

// StripArtifactNoise — exported wrapper for the artifact-text
// noise-stripping helper used by server/skill_artifacts.go to clean up
// streamed PowerPoint / Word output before preview rendering.
func StripArtifactNoise(s string) string {
	return stripArtifactNoise(s)
}

// EvolveTurnInput — exported alias for the evolveTurnInput type used by
// the post-turn evolution pipeline.
type EvolveTurnInput = evolveTurnInput

func BuildContextSnapshotRecord(in map[string]any) map[string]any {
	return buildContextSnapshotRecord(in)
}

func EnabledToolKeys(reg []RegisteredTool) []string {
	return enabledToolKeys(reg)
}

func DefaultSegmentIDGen(s *Service) func() string {
	return defaultSegmentIDGen(s)
}

func BuildAckSegment(userMsg string, hasAttachments bool) (AssistantSegment, bool) {
	return buildAckSegment(userMsg, hasAttachments)
}

func NormalizeReplyMode(v string) string { return normalizeReplyMode(v) }

func EmitSegmentStream(emit ReactEmitFunc, segments []AssistantSegment, modelID, corr, replyMode string) {
	emitSegmentStream(emit, segments, modelID, corr, replyMode)
}

// ReplyMode* — exported constants for the reply-mode string tags.
const (
	ReplyModeSingle    = replyModeSingle
	ReplyModeSegmented = replyModeSegmented
)

// AssistantSegment — re-exported from copilot_segments.go (already
// exported; the alias is kept for symmetry with the other type aliases).
// Note: AssistantSegment is defined as an exported type in
// copilot_segments.go:29 — no local alias needed.
