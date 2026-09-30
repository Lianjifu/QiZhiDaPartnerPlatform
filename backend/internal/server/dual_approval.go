package server

import (
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func actorIsAdmin(actor *auth.Identity) bool {
	return actor != nil && actor.Role == "admin"
}

// requiresPeerApprovalGate is true when a non-admin must wait for admin approval.
// Admin applicants skip pending peer gates and may complete their own publish/release.
func requiresPeerApprovalGate(actor *auth.Identity) bool {
	return productionLikeEnv() && !actorIsAdmin(actor)
}

// requireProductionDualApproval enforces peer approval on production writes
// (上岗/路由/知识/流程技能/自进化等).
// Rule: only non-admin applicants need a distinct approver; admins may approve
// any request including their own (no second admin required).
func requireProductionDualApproval(submitterID, submitterName string, actor *auth.Identity, verb string) error {
	if !productionLikeEnv() {
		return nil
	}
	if actor == nil {
		return apperr.UnauthorizedErr("未登录")
	}
	if actorIsAdmin(actor) {
		return nil
	}
	if submitterID == "" && submitterName == "" {
		return nil
	}
	if submitterID != "" && submitterID == actor.ID {
		return apperr.Forbidden(apperr.SODSelfApproval, "生产"+verb+"须管理员审批，申请人不能自批")
	}
	if submitterName != "" && submitterName == actor.Name {
		return apperr.Forbidden(apperr.SODSelfApproval, "生产"+verb+"须管理员审批，申请人不能自批")
	}
	return nil
}

func highRiskNeedsCountersign(riskOrClass string) bool {
	if !productionLikeEnv() {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(riskOrClass)) {
	case "high", "restricted", "confidential", "secret":
		return true
	default:
		return false
	}
}

// maybeHoldForCountersign records the first high-risk approver and returns hold=true
// until a second distinct signer arrives. entity is a release/package/policy map.
// Admin completing their own / direct publish skips countersign (no second admin).
// Admin approving a non-admin high-risk request still requires a second signer.
func maybeHoldForCountersign(entity map[string]any, actor *auth.Identity, risk, verb string) (hold bool, err error) {
	if entity == nil || actor == nil || !highRiskNeedsCountersign(risk) {
		return false, nil
	}
	submitterID := str(entity["requestedById"])
	if actorIsAdmin(actor) && (submitterID == "" || submitterID == actor.ID) {
		return false, nil
	}
	if str(entity["status"]) == "pending_countersign" {
		firstID, firstName := str(entity["firstApproverId"]), str(entity["firstApprover"])
		if firstID != "" && firstID == actor.ID {
			return false, apperr.Forbidden(apperr.SODSelfApproval, "生产"+verb+"会签须另一人副署")
		}
		if firstID == "" && firstName != "" && firstName == actor.Name {
			return false, apperr.Forbidden(apperr.SODSelfApproval, "生产"+verb+"会签须另一人副署")
		}
		entity["countersigner"] = actor.Name
		entity["countersignerId"] = actor.ID
		entity["countersignedAt"] = time.Now().UTC().Format(time.RFC3339)
		return false, nil
	}
	entity["status"] = "pending_countersign"
	entity["firstApprover"] = actor.Name
	entity["firstApproverId"] = actor.ID
	entity["firstApprovedAt"] = time.Now().UTC().Format(time.RFC3339)
	return true, nil
}
