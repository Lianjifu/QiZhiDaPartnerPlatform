package skills

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Service) executeSkill(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "skill.execute") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权执行技能")
	}
	body, _ := decodeMap(r)
	skillID := str(body["skillId"])
	ws := s.WorkspaceID(r)
	commandOrTarget := coalesce(str(body["command"]), coalesce(str(body["endpoint"]), str(body["input"])))

	s.Store.Lock()
	_, sk := s.findSkillLocked(ws, skillID)
	if skillID == "" || sk == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在或不在当前工作区")
	}
	dec := s.evaluateSkillSandboxPolicyLocked(ws, skillID, commandOrTarget)
	govPolicy := s.ensureSkillGovernanceLocked(skillID)
	pkgPayload := skillPackagePayload(sk)
	if dec.Blocked {
		ev := s.Store.AppendAudit(ws, id.Name, "策略拦截技能执行", skillID, "failed", dec.Reason)
		s.appendSkillGovEventLocked(ws, str(sk["name"]), "policy", dec.Reason, id.Name, "blocked")
		s.Store.Unlock()
		if dec.RateLimited {
			return nil, errRateLimited(dec.Reason)
		}
		return nil, apperr.Forbidden(apperr.ZeroTrustDeny, dec.Reason+" (corr="+coalesce(str(ev["correlationId"]), dec.CorrelationID)+")")
	}
	s.Store.Unlock()

	eval, err := s.EvaluateZeroTrust(id, "skill", "run", "internal", false, "")
	if err != nil {
		return nil, err
	}
	if str(eval["decision"]) == "deny" {
		return nil, apperr.Forbidden(apperr.ZeroTrustDeny, str(eval["reason"]))
	}
	if err := s.EvaluateWrite(r, "skill", "run", policy.Input{}); err != nil {
		return nil, err
	}
	mergedEgress := resolveSkillEgress(sk, govPolicy)
	token := auth.MintRunToken(skillID, ws, id.ID, mergedEgress, 5*time.Minute)
	body["runToken"] = token
	body["denyControlPlane"] = true
	body["correlationId"] = dec.CorrelationID
	if pkgPayload != nil {
		for k, v := range pkgPayload {
			body[k] = v
		}
	}
	result, runtimeErr := s.callSandbox(body)
	status := "success"
	// 阶段 2:egressUsed 从 Python 沙箱响应里读,作为"声明 ↔ 实际"双向审计:
	// 运维侧 `grep egress=wttr.in` 即可看到哪些技能真实访问了白名单域名。
	egressAudit := "[]"
	// 阶段 3:从 audit_hooks monkey-patch 收集到的 syscalls 计数一并写进 audit detail,
	// 便于运维按 syscall 类型检索(`grep syscalls=open:`)。
	syscallsMap, _ := result["syscalls"].(map[string]any)
	if result != nil {
		egressAudit = egressUsedString(result, "egressUsed")
	}
	detail := "runtime=skill;runToken=issued;egress=" + egressAudit + ";corr=" + dec.CorrelationID
	durationMs := 0
	if runtimeErr != nil {
		status = "failed"
		detail = runtimeErr.Error()
		s.Store.Lock()
		if _, sk2 := s.findSkillLocked(ws, skillID); sk2 != nil {
			s.recordSkillInvocationLocked(ws, sk2, 0, false, id.Name, "HTTP 执行")
		} else {
			s.Store.AppendAudit(ws, id.Name, "沙箱执行技能", skillID, status, appendSyscallSegment(detail, syscallsMap))
		}
		s.Store.Unlock()
		s.persistSkillHealth()
		return nil, apperr.Unavailable(apperr.RuntimeUnavailable, "技能运行时不可用: "+runtimeErr.Error())
	}
	if b, ok := result["ok"].(bool); ok && !b {
		status = "failed"
		detail = coalesce(str(result["error"]), "skill runtime failed") + ";egress=" + egressAudit
	}
	if d := intFrom(result["durationMs"]); d > 0 {
		durationMs = d
	}
	if stdout := str(result["stdout"]); stdout != "" {
		result["stdout"] = maskSkillOutput(stdout, boolFrom(govPolicy["dataMaskingEnabled"]))
	}
	result["correlationId"] = dec.CorrelationID
	s.Store.Lock()
	if _, sk2 := s.findSkillLocked(ws, skillID); sk2 != nil {
		s.recordSkillInvocationLocked(ws, sk2, durationMs, status == "success", id.Name, "HTTP 执行")
	} else {
		s.Store.AppendAudit(ws, id.Name, "沙箱执行技能", skillID, status, appendSyscallSegment(detail, syscallsMap))
	}
	s.Store.Unlock()
	s.persistSkillHealth()
	return result, nil
}

func (s *Service) callSandbox(body map[string]any) (map[string]any, error) {
	timeoutSec := 3
	if t := intFrom(body["timeoutSec"]); t > 0 && t <= 120 {
		timeoutSec = t
	}
	client := &http.Client{Timeout: time.Duration(timeoutSec) * time.Second}
	payload, _ := json.Marshal(body)
	resp, err := client.Post(envOr("DE_SANDBOX_RUNTIME_URL", "http://127.0.0.1:8093")+"/v1/execute", "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var errBody map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		msg := coalesce(str(errBody["error"]), fmt.Sprintf("sandbox status %d", resp.StatusCode))
		return nil, fmt.Errorf("%s", msg)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

func skillTestSimEnabled() bool {
	if productionLikeEnv() {
		return false
	}
	v := strings.ToLower(strings.TrimSpace(envOr("DE_SANDBOX_TEST_SIM", "1")))
	return v == "1" || v == "true" || v == "yes"
}
