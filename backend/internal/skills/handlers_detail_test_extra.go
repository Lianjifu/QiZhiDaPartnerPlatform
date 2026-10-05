package skills

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// skillTest executes a skill test command in the sandbox. Requires
// skill.execute or skill.write capability. Returns the test output
// (stdout/error), the runtime mode (sandbox / policy-sim), retries,
// duration, and the correlation id from the policy gate.
func (s *Service) skillTest(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if !auth.Has(id, "skill.execute") && !auth.Has(id, "skill.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权测试技能")
	}
	body, _ := decodeMap(r)
	command := strings.TrimSpace(str(body["command"]))
	if command == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "请输入测试命令")
	}

	s.Store.Lock()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	dec := s.evaluateSkillSandboxPolicyLocked(ws, skillID, command)
	govPolicy := cloneMap(s.ensureSkillGovernanceLocked(skillID))
	runtimeCfg := cloneMap(s.ensureSkillRuntimeLocked(sk))
	skillName := str(sk["name"])
	skillVersion := str(sk["version"])
	pkgPayload := skillPackagePayload(sk)
	if dec.Blocked {
		ev := s.Store.AppendAudit(ws, id.Name, "策略拦截测试命令", skillName, "failed", dec.Reason)
		s.appendSkillGovEventLocked(ws, skillName, "policy", dec.Reason, id.Name, "blocked")
		corr := coalesce(str(ev["correlationId"]), dec.CorrelationID)
		s.Store.Unlock()
		if dec.RateLimited {
			return nil, errRateLimited(dec.Reason)
		}
		return map[string]any{
			"command": command, "status": "blocked", "output": "⛔ 拒绝执行：" + dec.Reason + "。",
			"durationMs": 5, "correlationId": corr,
			"policy": map[string]any{
				"circuitOpen": dec.CircuitOpen, "egressBlocked": dec.EgressBlocked, "dangerBlocked": dec.DangerBlocked,
			},
		}, nil
	}
	s.Store.Unlock()

	timeoutSec := intFrom(runtimeCfg["timeout"])
	if timeoutSec <= 0 {
		timeoutSec = 30
	}
	retries := intFrom(runtimeCfg["retries"])
	if retries < 0 {
		retries = 0
	}
	if retries > 3 {
		retries = 3
	}

	mergedEgress := resolveSkillEgress(sk, govPolicy)
	token := auth.MintRunToken(skillID, ws, id.ID, mergedEgress, 5*time.Minute)
	payload := map[string]any{
		"skillId": skillID, "command": command, "runToken": token,
		"denyControlPlane": true,
		"correlationId":    dec.CorrelationID, "timeoutSec": timeoutSec,
	}
	if pkgPayload != nil {
		for k, v := range pkgPayload {
			payload[k] = v
		}
	}

	var (
		result     map[string]any
		runtimeErr error
	)
	for attempt := 0; attempt <= retries; attempt++ {
		result, runtimeErr = s.callSandbox(payload)
		if runtimeErr == nil {
			break
		}
	}

	mode := "sandbox"
	output := ""
	duration := 80
	status := "success"
	if runtimeErr != nil {
		if !skillTestSimEnabled() {
			s.Store.Lock()
			s.Store.AppendAudit(ws, id.Name, "沙箱测试失败", skillName, "failed", runtimeErr.Error())
			s.Store.Unlock()
			return nil, apperr.Unavailable(apperr.RuntimeUnavailable, "技能运行时不可用: "+runtimeErr.Error())
		}
		mode = "policy-sim"
		output = "+SIM\n" + skillName + " v" + skillVersion + " 策略校验通过；sandbox 不可达，已使用本地模拟（QZDA_SANDBOX_TEST_SIM=1）。\ncommand=" + command
		if pkgPayload != nil {
			output += "\npackage=" + str(pkgPayload["packagePath"])
			if boolFrom(pkgPayload["hasScripts"]) {
				output += "\nhasScripts=true"
			}
		}
		status = "success"
	} else {
		output = coalesce(str(result["stdout"]), "sandbox execution complete")
		if d := intFrom(result["durationMs"]); d > 0 {
			duration = d
		}
		if b, ok := result["ok"].(bool); ok && !b {
			status = "failed"
			output = coalesce(str(result["error"]), output)
		}
		if rt := str(result["runtime"]); rt != "" {
			mode = rt
		}
	}
	output = maskSkillOutput(output, boolFrom(govPolicy["dataMaskingEnabled"]))
	// 阶段 2:把实际访问过的 egress 域名写进 audit detail,便于检索与告警
	egressAudit := egressUsedString(result, "egressUsed")
	// 阶段 3:Python 沙箱返回的 syscall 计数(写入摘要),便于按 syscall 类型检索
	syscallsMap, _ := result["syscalls"].(map[string]any)

	s.Store.Lock()
	_, skRec := s.findSkillLocked(ws, skillID)
	if skRec != nil {
		s.recordSkillInvocationLocked(ws, skRec, duration, status == "success", id.Name, "沙箱测试 · "+mode)
	} else {
		s.Store.AppendAudit(ws, id.Name, ternary(status == "success", "执行沙箱测试", "沙箱测试失败"), skillName, ternary(status == "success", "success", "failed"), appendSyscallSegment("mode="+mode+";egress="+egressAudit+";corr="+dec.CorrelationID, syscallsMap))
	}
	s.Store.Unlock()
	s.persistSkillHealth()

	return map[string]any{
		"command": command, "status": status, "output": output, "durationMs": duration,
		"correlationId": dec.CorrelationID, "runtime": mode, "retries": retries,
		"sim": mode == "policy-sim",
	}, nil
}

// skillRevalidate resets a skill's health record to healthy + clears
// the "needs revalidation" lifecycleStatus. Used after a manual review
// confirmed the skill is safe to run again.
func (s *Service) skillRevalidate(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	h := s.ensureSkillHealthLocked(sk)
	h["status"] = "healthy"
	h["errorRate"] = 0.1
	h["successRate"] = 99.9
	h["updatedAt"] = "刚刚"
	sk["lifecycleStatus"] = "enabled"
	sk["lastVerifiedAt"] = "刚刚"
	s.appendSkillGovEventLocked(ws, str(sk["name"]), "call", "重新验证通过", id.Name, "success")
	s.Store.AppendAudit(ws, id.Name, "重新验证通过", str(sk["name"]), "success", "")
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	return h, nil
}

// skillIsolate forces a skill into the quarantined lifecycle status,
// preventing any further calls. Used as a kill-switch when a skill is
// suspected of misbehaving and the operator needs to stop the bleeding
// before a fuller investigation finishes.
func (s *Service) skillIsolate(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	sk["lifecycleStatus"] = "quarantined"
	h := s.ensureSkillHealthLocked(sk)
	h["status"] = "quarantined"
	h["updatedAt"] = "刚刚"
	s.appendSkillGovEventLocked(ws, str(sk["name"]), "lifecycle", "隔离能力", id.Name, "success")
	s.Store.AppendAudit(ws, id.Name, "隔离能力", str(sk["name"]), "success", "")
	unlocked = true
	s.Store.Unlock()
	go s.persistSkills()
	return h, nil
}
