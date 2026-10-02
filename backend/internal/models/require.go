package models

import (
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// requireModelRead enforces model.read on the caller. Returns a 403 AppError
// when the identity lacks the capability; nil on success.
func requireModelRead(id *auth.Identity) error {
	if id == nil || !auth.Has(id, "model.read") {
		return apperr.Forbidden(apperr.ModelReadForbidden, "缺少 model.read")
	}
	return nil
}

// requireModelWrite enforces model.write on the caller.
func requireModelWrite(id *auth.Identity) error {
	if id == nil || !auth.Has(id, "model.write") {
		return apperr.Forbidden(apperr.ModelWriteForbidden, "缺少 model.write")
	}
	return nil
}

// aliasToRouteLevel maps a free-form model/route alias to its canonical
// risk level (P0+ / P0 / P1 / P2). Returns "" when the alias doesn't map.
func aliasToRouteLevel(alias string) string {
	a := strings.ToLower(strings.TrimSpace(alias))
	switch {
	case strings.Contains(a, "opus"), strings.HasSuffix(a, "p0+"), a == "p0+":
		return "P0+"
	case strings.Contains(a, "sonnet"), a == "p0", strings.HasPrefix(a, "p0"):
		return "P0"
	case strings.Contains(a, "gpt-5"), strings.Contains(a, "deepseek"), a == "p1":
		return "P1"
	case strings.Contains(a, "haiku"), a == "p2":
		return "P2"
	default:
		return ""
	}
}

// hasCapability reports whether the capabilities slice contains the named
// capability (case-insensitive).
func hasCapability(caps []string, want string) bool {
	for _, c := range caps {
		if strings.EqualFold(c, want) {
			return true
		}
	}
	return false
}

// policyInputApprove builds a policy.Input populated with the actor id as
// both ApproverID and SubmitterID. Mirrors the legacy
// `policy.Input{ApproverID: id.ID, SubmitterID: id.ID}` call site.
func policyInputApprove(id *auth.Identity) policy.Input {
	return policy.Input{ApproverID: id.ID, SubmitterID: id.ID}
}

// PolicyInputValue is the canonical policy.Input used inside this package.
// Re-exported as a named type so handlers_aliases.go can build a value
// without importing the policy package directly. (policy.Input is a struct,
// so this is purely a type alias by structural compatibility — EvaluateWrite
// accepts the same shape.)
type PolicyInputValue = policy.Input