package server

import (
	"strings"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func employeeCapabilityCount(emp map[string]any) int {
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return 0
	}
	n := 0
	for _, key := range []string{"skills", "tools", "workflows"} {
		n += len(toAnySlice(caps[key]))
	}
	return n
}

func toAnySlice(v any) []any {
	switch t := v.(type) {
	case []any:
		return t
	case []string:
		out := make([]any, len(t))
		for i, s := range t {
			out[i] = s
		}
		return out
	default:
		return nil
	}
}

func responsibilitiesIncomplete(emp map[string]any) bool {
	raw := emp["responsibilities"]
	list := toAnySlice(raw)
	if len(list) == 0 {
		return true
	}
	for _, item := range list {
		if strings.Contains(str(item), "待配置岗位职责") {
			return true
		}
	}
	return false
}

func validateEmployeeReleaseGates(emp map[string]any) error {
	if strings.TrimSpace(str(emp["owner"])) == "" ||
		strings.TrimSpace(str(emp["escalationOwner"])) == "" ||
		str(emp["escalationOwner"]) == "待指定" ||
		strings.TrimSpace(str(emp["serviceObject"])) == "" {
		return apperr.BadReq(apperr.DigitalPartnerProfileIncomplete, "请先完善岗位负责人、接管人与服务对象")
	}
	if responsibilitiesIncomplete(emp) {
		return apperr.BadReq(apperr.DigitalPartnerBoundaryRequired, "请先配置岗位职责边界")
	}
	caps, _ := emp["capabilities"].(map[string]any)
	model := ""
	if caps != nil {
		model = str(caps["model"])
		if model == "" {
			model = str(caps["modelRouteId"])
		}
	}
	if model == "" || employeeCapabilityCount(emp) == 0 {
		return apperr.BadReq(apperr.DigitalPartnerCapabilityRequired, "请先装配已发布模型与至少一项技能/工具/流程技能")
	}
	ev, _ := emp["evaluation"].(map[string]any)
	if ev == nil || str(ev["status"]) != "passed" {
		return apperr.BadReq(apperr.DigitalPartnerEvaluationRequired, "质量评测未通过，无法申请上岗")
	}
	if min := evalScoreMin(); min > 0 {
		if toFloat(ev["score"]) < min {
			return apperr.BadReq(apperr.DigitalPartnerEvaluationRequired, "评测分数未达门禁，无法申请上岗")
		}
	}
	return nil
}

func employeeEvaluateIncomplete(emp map[string]any) bool {
	if responsibilitiesIncomplete(emp) {
		return true
	}
	caps, _ := emp["capabilities"].(map[string]any)
	model := ""
	if caps != nil {
		model = str(caps["model"])
		if model == "" {
			model = str(caps["modelRouteId"])
		}
	}
	return model == "" || employeeCapabilityCount(emp) == 0
}

func validateEmployeeConfigurationBody(body map[string]any) error {
	scope := strings.TrimSpace(str(body["scope"]))
	if scope == "" {
		scope = "role"
	}
	profile, _ := body["profile"].(map[string]any)
	caps, _ := body["capabilities"].(map[string]any)
	if profile == nil {
		return apperr.BadReq(apperr.DigitalPartnerConfigurationRequired, "配置须包含 profile")
	}
	if scope == "capability" && caps == nil {
		return apperr.BadReq(apperr.DigitalPartnerConfigurationRequired, "能力装配须包含 capabilities")
	}
	if strings.TrimSpace(str(profile["name"])) == "" ||
		strings.TrimSpace(str(profile["role"])) == "" ||
		strings.TrimSpace(str(profile["department"])) == "" {
		return apperr.BadReq(apperr.DigitalPartnerConfigurationRequired, "岗位档案为必填")
	}
	if scope == "capability" &&
		(strings.TrimSpace(str(caps["model"])) == "" && strings.TrimSpace(str(caps["modelRouteId"])) == "") {
		return apperr.BadReq(apperr.DigitalPartnerConfigurationRequired, "能力装配须指定已发布模型")
	}
	boundary, _ := body["boundary"].(map[string]any)
	if boundary == nil {
		return apperr.BadReq(apperr.DigitalPartnerBoundaryRequired, "须配置岗位职责边界")
	}
	resp := toAnySlice(boundary["responsibilities"])
	policy, _ := boundary["boundaryPolicy"].(map[string]any)
	if policy == nil {
		policy, _ = boundary["policy"].(map[string]any)
	}
	if len(resp) == 0 {
		return apperr.BadReq(apperr.DigitalPartnerBoundaryRequired, "须配置岗位职责边界")
	}
	if policy != nil {
		polResp := toAnySlice(policy["responsibilities"])
		if len(polResp) == 0 {
			return apperr.BadReq(apperr.DigitalPartnerBoundaryRequired, "须配置岗位职责边界")
		}
		handoff, _ := policy["handoff"].(map[string]any)
		if handoff != nil {
			if len(toAnySlice(handoff["triggers"])) == 0 || len(toAnySlice(handoff["approvers"])) == 0 {
				return apperr.BadReq(apperr.DigitalPartnerBoundaryRequired, "须配置升级触发条件与审批人")
			}
		}
	}
	return nil
}
