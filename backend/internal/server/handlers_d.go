package server

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

func (s *Server) listWorkflows(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, w := range s.Store.Workflows {
		if str(w["workspaceId"]) == ws {
			out = append(out, w)
		}
	}
	return out, nil
}

func (s *Server) createWorkflow(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "workflow.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建流程")
	}
	body, _ := decodeMap(r)
	item := map[string]any{
		"id": s.Store.ID("wf"), "workspaceId": s.workspaceID(r),
		"name": coalesce(str(body["name"]), "未命名流程"), "status": "draft", "version": "0.1.0",
		"ownerId": id.ID, "updatedAt": time.Now().UTC().Format(time.RFC3339),
		"graph": body["graph"],
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Workflows = append([]map[string]any{item}, s.Store.Workflows...)
	s.Store.PersistCollection("workflows", s.Store.Workflows)
	s.Store.AppendAudit(s.workspaceID(r), id.Name, "创建工作流", str(item["name"]), "success", "")
	return item, nil
}

func (s *Server) listWorkflowSkills(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.WorkflowSkills, nil
}

func (s *Server) listWorkflowRuns(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.WorkflowRuns, nil
}

func (s *Server) runWorkflow(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "workflow.execute") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权执行流程")
	}
	body, _ := decodeMap(r)
	wfID := str(body["workflowId"])
	runID := s.Store.ID("run")
	engRun, err := s.Workflows.StartTrial(r.Context(), runID, wfID)
	if err != nil {
		return nil, apperr.Unavailable(apperr.RuntimeUnavailable, err.Error())
	}
	run := engRun.ToMap()
	run["workspaceId"] = s.workspaceID(r)
	s.Store.Lock()
	s.Store.WorkflowRuns = append([]map[string]any{run}, s.Store.WorkflowRuns...)
	if body["publishSkill"] == true && str(run["status"]) == "succeeded" {
		var wf map[string]any
		for _, w := range s.Store.Workflows {
			if str(w["id"]) == wfID {
				wf = w
				break
			}
		}
		if skill, err := s.publishWorkflowAsSkillLocked(id, s.workspaceID(r), wf, coalesce(str(body["skillName"]), "流程技能")); err != nil {
			s.Store.Unlock()
			return nil, err
		} else {
			cat, _ := skill["_catalog"].(map[string]any)
			delete(skill, "_catalog")
			s.Store.Unlock()
			s.Store.Persist("workflow_runs")
			s.Store.Persist("workflow_skills")
			s.applyWorkflowSkillCatalog(id, cat, r)
			s.Store.Lock()
		}
	}
	s.Store.AppendAudit(s.workspaceID(r), id.Name, "试运行工作流", wfID, "success", "engine=qzda-workflow")
	s.Store.Unlock()
	s.Store.Persist("workflow_runs")
	s.Store.Persist("workflow_skills")
	s.persistSkills()
	return run, nil
}

func (s *Server) executeSkill(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "skill.execute") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权执行技能")
	}
	body, _ := decodeMap(r)
	skillID := str(body["skillId"])
	ws := s.workspaceID(r)
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

	eval, err := s.evaluateZeroTrust(id, "skill", "run", "internal", false, "")
	if err != nil {
		return nil, err
	}
	if str(eval["decision"]) == "deny" {
		return nil, apperr.Forbidden(apperr.ZeroTrustDeny, str(eval["reason"]))
	}
	if err := s.evaluateWrite(r, "skill", "run", policy.Input{}); err != nil {
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

func (s *Server) callSandbox(body map[string]any) (map[string]any, error) {
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

func (s *Server) memoryOverview(r *http.Request) (any, error) {
	return s.memoryOverviewAligned(r)
}

func (s *Server) listChannels(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "channel.read") && id.Role != "admin" && id.Role != "auditor" {
		// user may lack channel.read
		if !auth.Has(id, "channel.read") {
			return nil, apperr.Forbidden(apperr.ChannelReadForbidden, "缺少 channel.read")
		}
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, c := range s.Store.Channels {
		if str(c["workspaceId"]) == ws {
			out = append(out, c)
		}
	}
	return out, nil
}

func (s *Server) createChannel(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "channel.write") {
		return nil, apperr.Forbidden(apperr.ChannelWriteForbidden, "缺少 channel.write")
	}
	body, _ := decodeMap(r)
	kind := coalesce(str(body["kind"]), "webhook")
	if kind == "email" || kind == "sms" || kind == "phone" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_CHANNEL_DEPLOYMENT_INVALID: 不支持邮件、短信、电话渠道")
	}
	item := map[string]any{
		"id": s.Store.ID("ch"), "workspaceId": s.workspaceID(r),
		"name": coalesce(str(body["name"]), "未命名渠道"), "kind": kind,
		"status": "active",
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.Channels = append([]map[string]any{item}, s.Store.Channels...)
	s.Store.AppendAudit(s.workspaceID(r), id.Name, "接入渠道", str(item["name"]), "success", "")
	return item, nil
}

func (s *Server) listChannelDeploys(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.ChannelDeploys, nil
}

func (s *Server) channelOutbound(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "channel.write") {
		return nil, apperr.Forbidden(apperr.ChannelWriteForbidden, "缺少 channel.write")
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)
	corr := s.Store.ID("delivery_corr")
	delivery := map[string]any{
		"id": s.Store.ID("delivery_attempt"), "workspaceId": ws,
		"policyId": coalesce(str(body["policyId"]), ""), "deploymentId": coalesce(str(body["channelId"]), str(body["deploymentId"])),
		"channelId": body["channelId"], "status": "delivered",
		"targetMasked":   maskTarget(coalesce(str(body["target"]), "unknown")),
		"payloadSummary": truncateRunes(coalesce(str(body["content"]), "outbound"), 48),
		"normalized":     map[string]any{"layer": "L01", "payload": body["payload"]},
		"at":             now, "createdAt": now, "attempts": 1, "replayable": true, "correlationId": corr,
	}
	persistDLQ := false
	s.Store.Lock()
	if body["fail"] == true {
		delivery["status"] = "dead_letter"
		delivery["error"] = coalesce(str(body["error"]), "outbound_failed")
		delivery["attempts"] = 3
		if str(delivery["payloadSummary"]) == "outbound" {
			delivery["payloadSummary"] = str(delivery["error"])
		}
		s.Store.ChannelDLQ = append([]map[string]any{delivery}, s.Store.ChannelDLQ...)
		s.appendChannelAuditLocked(ws, id.Name, "渠道出站失败入DLQ", coalesce(str(body["channelId"]), "channel"), "failed", str(delivery["error"]), corr)
		persistDLQ = true
	} else {
		s.appendChannelAuditLocked(ws, id.Name, "渠道出站", coalesce(str(body["channelId"]), "channel"), "success", "", corr)
	}
	s.Store.Unlock()
	if persistDLQ {
		s.Store.Persist("channel_dlq")
		s.Store.Persist("channel_audit")
	}
	return delivery, nil
}

func (s *Server) listChannelDLQ(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, d := range s.Store.ChannelDLQ {
		if str(d["workspaceId"]) == ws || str(d["workspaceId"]) == "" {
			out = append(out, d)
		}
	}
	return out, nil
}

func (s *Server) replayChannelDLQ(r *http.Request) (any, error) {
	id, err := s.requireChannelWrite(r)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/channel-control/dead-letters/:id/replay  OR api/channels/dlq/:id/replay
	dlqID := ""
	for i, p := range parts {
		if (p == "dead-letters" || p == "dlq") && i+1 < len(parts) {
			dlqID = parts[i+1]
			break
		}
	}
	if dlqID == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少死信 ID")
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)
	s.Store.Lock()
	var replayed map[string]any
	for i, d := range s.Store.ChannelDLQ {
		if str(d["id"]) != dlqID {
			continue
		}
		if str(d["workspaceId"]) != "" && str(d["workspaceId"]) != ws {
			s.Store.Unlock()
			return nil, apperr.Forbidden(apperr.ChannelWriteForbidden, "E_CHANNEL_WORKSPACE_SCOPE: 无权操作其他工作区死信")
		}
		d["status"] = "delivered"
		d["replayedAt"] = now
		d["attempts"] = toInt(d["attempts"]) + 1
		d["replayedBy"] = id.Name
		s.Store.ChannelDLQ = append(s.Store.ChannelDLQ[:i], s.Store.ChannelDLQ[i+1:]...)
		s.appendChannelAuditLocked(ws, id.Name, "死信重投", coalesce(str(d["targetMasked"]), dlqID), "success", "", coalesce(str(d["correlationId"]), ""))
		replayed = normalizeDeliveryAttempt(d)
		break
	}
	s.Store.Unlock()
	if replayed == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "死信不存在")
	}
	go s.persistChannel()
	return replayed, nil
}
