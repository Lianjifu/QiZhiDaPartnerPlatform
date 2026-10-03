package settings

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
)

// --- Identity / access gating helpers ---
//
// These wrap the Deps closures as methods on *Service so handler files
// can call `s.identityFrom(ctx)` rather than reaching into the Deps
// field directly. They are nil-safe at the call site.

// identityFrom forwards to the wired Deps.IdentityFrom closure.
func (s *Service) identityFrom(ctx context.Context) *auth.Identity {
	if s.IdentityFrom == nil {
		return nil
	}
	return s.IdentityFrom(ctx)
}

// workspaceID forwards to the wired Deps.WorkspaceID closure.
func (s *Service) workspaceID(r *http.Request) string {
	if s.WorkspaceID == nil {
		return ""
	}
	return s.WorkspaceID(r)
}

// decodeMap forwards to the wired Deps.DecodeMap closure.
func (s *Service) decodeMap(r *http.Request) (map[string]any, error) {
	if s.DecodeMap == nil {
		return map[string]any{}, nil
	}
	return s.DecodeMap(r)
}

// appendAudit forwards to the wired Deps.AppendAudit closure.
func (s *Service) appendAudit(workspaceId, actor, action, target, result, reason string) {
	if s.AppendAudit == nil {
		return
	}
	s.AppendAudit(workspaceId, actor, action, target, result, reason)
}

// persistCollection forwards to the wired Deps.PersistCollection closure.
func (s *Service) persistCollection(name string, v any) {
	if s.PersistCollection == nil {
		return
	}
	s.PersistCollection(name, v)
}

// actorIsAdmin forwards to the wired Deps.ActorIsAdmin closure.
func (s *Service) actorIsAdmin(id *auth.Identity) bool {
	if s.ActorIsAdmin == nil {
		return false
	}
	return s.ActorIsAdmin(id)
}

// evaluateWrite forwards to the wired Deps.EvaluateWrite closure.
func (s *Service) evaluateWrite(r *http.Request, kind, action string, p policy.Input) error {
	if s.EvaluateWrite == nil {
		return nil
	}
	return s.EvaluateWrite(r, kind, action, p)
}

// --- Generic value helpers ---
//
// These mirror the helpers in internal/server (handlers_a.go,
// server.go) so the M09 module can be lifted cleanly without leaking
// those package-private functions through Deps.

// str converts any to string. nil → "". Non-string → fmt.Sprint.
func str(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}

// coalesce returns v if non-empty, otherwise def.
func coalesce(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// toInt coerces any to int. nil → 0. string → strconv.Atoi (0 on error).
// Numbers → cast.
func toInt(v any) int {
	if v == nil {
		return 0
	}
	switch t := v.(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	case string:
		n, _ := strconv.Atoi(t)
		return n
	default:
		return 0
	}
}
