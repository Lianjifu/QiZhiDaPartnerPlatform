package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// evaluateWrite runs policy (DE_POLICY_URL → qzda-sys when set) and audits the decision.
func (s *Server) evaluateWrite(r *http.Request, resource, action string, extra policy.Input) error {
	s.Store.Lock()
	defer s.Store.Unlock()
	return s.evaluateWriteLocked(r, resource, action, extra)
}

// evaluateWriteLocked is for callers that already hold Store.Lock.
func (s *Server) evaluateWriteLocked(r *http.Request, resource, action string, extra policy.Input) error {
	id := identityFrom(r.Context())
	if id == nil {
		return apperr.UnauthorizedErr("未登录")
	}
	in := extra
	in.ActorID = id.ID
	in.ActorRole = id.Role
	in.WorkspaceID = s.workspaceID(r)
	in.Resource = resource
	in.Action = action
	// 仅在「批准」动作下把当前用户视为批准人。
	// 若对 submit/release 也默认填 ApproverID，会与 SubmitterID 相同，误触发「提交人不可自批」。
	if in.ApproverID == "" && strings.EqualFold(action, "approve") {
		in.ApproverID = id.ID
	}
	dec := s.decidePolicy(r.Context(), in)
	result := "allow"
	if !dec.Allow {
		result = "deny"
		IncPolicyDeny()
	}
	s.Store.AppendAudit(in.WorkspaceID, id.Name, "policy:"+action, resource, result, dec.Reason)
	// Durable sink is covered by Store auditHook fanout; avoid duplicate Append under lock.
	if !dec.Allow {
		return apperr.Forbidden(apperr.RoleForbidden, dec.Reason)
	}
	return nil
}

// decidePolicy runs the in-process Engine. qzda-sys always owns policy + audit,
// so no peer call is needed (qzda-policy binary retired).
func (s *Server) decidePolicy(ctx context.Context, in policy.Input) policy.Decision {
	return s.Policy.Evaluate(ctx, in)
}
