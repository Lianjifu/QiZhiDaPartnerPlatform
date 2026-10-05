package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
)

// This file holds small free helpers + a tiny Server method that used to
// live in internal/server/model_helpers.go and model_invoke.go (deleted
// as part of M08 P2 backend extraction into internal/models/). They
// remain here because many non-M08 modules (M01 ops, M02 copilot, M03
// tasks, M05 partners, knowledge, channels, peer-fetch, cap-delegate,
// runtime-loop) reference them directly. Moving them would balloon the
// diff; the cost of keeping them is just ~100 lines of compat shim.

// stringSlice normalises a generic value to []string. Mirrors the
// previously-extracted models.stringSlice but kept package-local so the
// M08 internal/models/ copy doesn't leak across the package boundary.
func stringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// providerModels reads the `models` slice from a provider map, normalising
// the two shapes the store accepts ([]map[string]any and []any). Kept as
// a package-local free helper because peer-fetch.go (M02) uses it
// directly outside any M08 call site.
func providerModels(p map[string]any) []map[string]any {
	if p == nil {
		return nil
	}
	switch m := p["models"].(type) {
	case []map[string]any:
		return m
	case []any:
		out := make([]map[string]any, 0, len(m))
		for _, x := range m {
			if mm, ok := x.(map[string]any); ok {
				out = append(out, mm)
			}
		}
		return out
	default:
		return nil
	}
}

// hasCapability reports whether the capabilities slice contains the named
// capability (case-insensitive). Used by peer_fetch.go to filter chat
// models across workspaces.
func hasCapability(caps []string, want string) bool {
	for _, c := range caps {
		if strings.EqualFold(c, want) {
			return true
		}
	}
	return false
}

// capBaseURL returns the Cap sidecar base URL. Used by the Copilot
// (M02), peer-fetch, cap-delegate, handlers_internal modules — kept here
// because the M08 models package Deps.CapBaseURL callback wants the
// same source of truth. Defaults to localhost:8088 when QZDA_CAP_BASE_URL
// is unset (matches the pre-M08 P2 behaviour).
func capBaseURL() string {
	return capBaseURLFromEnv()
}

// copilotStreamTimeout returns the overall Copilot harness SSE budget
// (multi-step ReAct + tools). Tunable via QZDA_COPILOT_STREAM_TIMEOUT.
// Kept here because peer.go's HTTP client timeout and handlers_c.go's
// runtime-loop SSE consumer both need the same budget.
func copilotStreamTimeout() time.Duration {
	sec := 300
	if v := strings.TrimSpace(os.Getenv("QZDA_COPILOT_STREAM_TIMEOUT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			sec = n
		}
	}
	if sec < 60 {
		sec = 60
	}
	if sec > 900 {
		sec = 900
	}
	return time.Duration(sec) * time.Second
}

// formatModelInvokeUserMessage turns provider/transport errors into
// actionable Chinese copy. Mirrors the previously-extracted copy in
// internal/models/handlers_invoke.go. Used by handlers_c.go's runtime
// loop emit path.
func formatModelInvokeUserMessage(err error) string {
	if err == nil {
		return "模型调用失败"
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "模型调用失败"
	}
	if strings.HasPrefix(msg, "模型调用超时") || strings.HasPrefix(msg, "模型调用失败") || strings.HasPrefix(msg, "无可用模型端点") {
		return msg
	}
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "deadline exceeded"),
		strings.Contains(low, "context canceled"),
		strings.Contains(low, "client.timeout exceeded"),
		strings.Contains(low, "i/o timeout"),
		(strings.Contains(low, "timeout") && !strings.Contains(low, "timed out waiting for lock")):
		return "模型调用超时：供应商在限定时间内未返回。请到「模型中心」探测连通性与密钥，或将 QZDA_MODEL_CANDIDATE_TIMEOUT 调至 45–60 后重启 qzda-app/qzda-cap。"
	case strings.Contains(low, "no model endpoint"),
		strings.Contains(low, "empty model"),
		strings.Contains(low, "model not found"),
		strings.Contains(msg, "未配置"):
		return "无可用模型端点：" + msg
	case strings.Contains(low, "401"), strings.Contains(low, "unauthorized"), strings.Contains(low, "invalid api key"):
		return "模型鉴权失败：" + msg + "。请检查模型中心凭证。"
	default:
		return "模型调用失败：" + msg
	}
}

// checkModelBudgetLocked is the legacy wrapper around the published-budget
// gate. The real implementation now lives in
// internal/models/handlers.go as (s *models.Service).checkModelBudgetLocked;
// this thin wrapper delegates to s.modelSvc.checkModelBudgetLocked so the
// non-M08 handlers_c.go call sites (copilot harness, channel ingress)
// stay byte-compatible. Caller must NOT hold Store.Lock.
func (s *Server) checkModelBudgetLocked(workspaceID string) error {
	if s.modelSvc != nil {
		return s.modelSvc.CheckModelBudgetLocked(workspaceID)
	}
	return nil
}

// modelByIDLocked is the legacy wrapper around the model lookup. The real
// implementation now lives in internal/models/handlers.go as
// (s *models.Service).modelByIDLocked. Used by buildPartnerSvc (M05) to
// resolve model ids when assembling capability-catalog builders.
func (s *Server) modelByIDLocked(modelID string) (map[string]any, map[string]any) {
	if s.modelSvc != nil {
		return s.modelSvc.ModelByIDLocked(modelID)
	}
	return nil, nil
}

// persistEmployeesLocked snapshots employees to durable storage; caller
// must hold Store.Lock. Moved verbatim from model_helpers.go during the
// M08 P2 backend extraction (buildPartnerSvc still binds it via Deps).
func (s *Server) persistEmployeesLocked() {
	if !runtimeenv.FromEnv().PersistEnabled() {
		return
	}
	empSnap := make([]map[string]any, len(s.Store.Employees))
	copy(empSnap, s.Store.Employees)
	s.Store.PersistCollection("employees", empSnap)
}

// resolveProviderCredential fetches the plaintext credential for a
// `credentialRef`. Moved from handlers_models.go during the M08 P2
// backend extraction. Tests (model_secrets_test.go) still call this on
// *Server. Reads s.Vault directly (not s.modelSvc.Vault) so that tests
// that override srv.Vault after New() still see their override.
func (s *Server) resolveProviderCredential(ctx context.Context, credRef string) string {
	if credRef == "" {
		return ""
	}
	if s.Vault != nil {
		if v, err := s.Vault.Resolve(ctx, credRef); err == nil && v != "" {
			return v
		}
	}
	if vaultRequiredForCredentials() {
		return ""
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	if s.Store.ModelSecrets != nil {
		return s.Store.ModelSecrets[credRef]
	}
	return ""
}

// listResolvedTurns is the legacy wrapper around the LLM candidate
// resolution. The real implementation now lives in
// internal/models/handlers_invoke.go as (s *models.Service).ListResolvedTurns.
// Used by model_invoke_test.go.
func (s *Server) listResolvedTurns(ctx context.Context, ws, requested string) []copilot.ResolvedTurn {
	if s.modelSvc != nil {
		return s.modelSvc.ListResolvedTurns(ctx, ws, requested)
	}
	return nil
}

// resolveModelForTurn is the legacy wrapper around the first-candidate
// resolver. Used by model_invoke_test.go. Delegates to s.modelSvc.
func (s *Server) resolveModelForTurn(ctx context.Context, ws, requested string) (copilot.ResolvedTurn, error) {
	if s.modelSvc == nil {
		return copilot.ResolvedTurn{}, nil
	}
	turns := s.modelSvc.ListResolvedTurns(ctx, ws, requested)
	if len(turns) == 0 {
		return copilot.ResolvedTurn{}, fmt.Errorf("no usable chat model in workspace %s", ws)
	}
	return turns[0], nil
}

// candidateAttemptTimeout is the package-local free helper used by
// model_invoke_timeout_test.go. Mirrors
// (s *models.Service).streamLocalCandidates internal default; exported
// here so the test can drive the env-var path.
func candidateAttemptTimeout() time.Duration {
	return candidateAttemptTimeoutFromEnv()
}

// candidateAttemptTimeoutFromEnv reads QZDA_MODEL_CANDIDATE_TIMEOUT (default
// 45s) — the implementation backing both candidateAttemptTimeout and the
// models.streamLocalCandidates internal default.
func candidateAttemptTimeoutFromEnv() time.Duration {
	sec := 45
	if v := strings.TrimSpace(os.Getenv("QZDA_MODEL_CANDIDATE_TIMEOUT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			sec = n
		}
	}
	if sec < 5 {
		sec = 5
	}
	if sec > 180 {
		sec = 180
	}
	return time.Duration(sec) * time.Second
}

// clampAttemptToParent is the package-local free helper used by
// model_invoke_timeout_test.go.
func clampAttemptToParent(ctx context.Context, budget time.Duration) time.Duration {
	if dl, ok := ctx.Deadline(); ok {
		remain := time.Until(dl)
		if remain <= 0 {
			return 0
		}
		remain -= 500 * time.Millisecond
		if remain < budget {
			return remain
		}
	}
	return budget
}

// vaultRequiredForCredentials reports whether Vault is mandatory for
// provider credentials in the current runtime. Used by server.go
// (New()) and the legacy hydrateVaultFromSecrets helper. Mirrors the
// previously-extracted models.vaultRequiredForCredentials.
func vaultRequiredForCredentials() bool {
	return runtimeenv.FromEnv().RequiresVault()
}

// resolvedTurn is a local alias for copilot.ResolvedTurn — the previous
// (lowercase, server-private) type name was kept by runtime_loop.go when
// it was refactored into M02 P2; the actual definition now lives in
// internal/copilot/service.go. This alias keeps the call site readable
// without dragging copilot.X noise into runtime_loop.go.
type resolvedTurn = copilot.ResolvedTurn

// streamLLMForCopilot is the legacy wrapper around the cross-module LLM
// bridge consumed by session_panel.go. The real implementation now lives
// in internal/models/handlers_stream.go as
// (s *models.Service).StreamLLMForCopilot. This thin wrapper delegates
// so the runtime_loop/session_panel call sites stay byte-compatible.
func (s *Server) streamLLMForCopilot(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (string, copilot.ResolvedTurn, error) {
	if s.modelSvc != nil {
		return s.modelSvc.StreamLLMForCopilot(ctx, r, ws, modelID, messages, system, onDelta)
	}
	return "", copilot.ResolvedTurn{}, nil
}

