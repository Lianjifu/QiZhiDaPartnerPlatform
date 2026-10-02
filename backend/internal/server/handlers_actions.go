package server

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/tasks"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) approveAction(r *http.Request) (any, error) {
	return s.approveActionSingle(r)
}

// Deprecated: Use approveActionSingle (single-person authorization). Retained for legacy dual-sign clients; will be removed in v2.
func (s *Server) approveActionLegacy(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.UnauthorizedErr("请先登录后再签发")
	}
	actionID := actionIDFromPath(r.URL.Path)
	if actionID == "" {
		return nil, apperr.NotFoundErr(apperr.NotFound, "行动不存在")
	}
	body, _ := decodeMap(r)
	return s.approveActionLegacyWithBody(r, body, actionID, s.workspaceID(r), id)
}

func (s *Server) approveActionLegacyWithBody(r *http.Request, body map[string]any, actionID, ws string, id *auth.Identity) (any, error) {
	rawConv := strings.TrimSpace(str(body["conversationId"]))
	if rawConv == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	signerIndex, err := strconv.Atoi(fmt.Sprint(body["signerIndex"]))
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, "无效的审批席位")
	}

	s.Store.Lock()

	cid := s.resolveMessageBucketID(ws, rawConv)
	if !s.conversationInWorkspaceLocked(ws, cid, rawConv) {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "当前会话不在您的工作区范围内")
	}

	msg, msgIdx := findMessageLocked(s.Store.Messages[cid], actionID)
	if msg == nil && cid != rawConv {
		msg, msgIdx = findMessageLocked(s.Store.Messages[rawConv], actionID)
		if msg != nil {
			cid = rawConv
		}
	}
	if msg == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "审批消息不存在")
	}

	ar, _ := msg["approvalRequest"].(map[string]any)
	if ar == nil {
		// 兼容历史水合消息：无审批席位时注入默认双签策略（执行复核已签、变更审批待签）
		ar = map[string]any{
			"action": "controlled.execute", "resource": cid, "reason": "受控执行人工审核",
			"required": 1, "signed": 0, "decision": "pending",
			"signers": []map[string]any{
				{"userId": "u1", "name": "平台管理员", "role": "approver", "signed": false},
			},
		}
		msg["approvalRequest"] = ar
	}
	signers := asMapSlice(ar["signers"])
	if signerIndex < 0 || signerIndex >= len(signers) {
		s.Store.Unlock()
		return nil, apperr.BadReq(apperr.BadRequest, "无效的审批席位")
	}
	expected := signers[signerIndex]
	expectedUID := str(expected["userId"])
	expectedRole := signerPlatformRole(str(expected["role"]))
	if expected["signed"] == true {
		s.Store.Unlock()
		return nil, apperr.Conflict(apperr.BadRequest, "当前审批席位已签发")
	}
	if id.ID != expectedUID || id.Role != expectedRole {
		label := coalesce(str(expected["name"]), expectedUID)
		roleLabel := signerRoleLabel(str(expected["role"]))
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.RoleForbidden, fmt.Sprintf("仅待签人 %s（%s）可签发", label, roleLabel))
	}
	if signerIndex > 0 {
		prev := signers[signerIndex-1]
		if prev["signed"] != true {
			s.Store.Unlock()
			return nil, apperr.BadReq(apperr.BadRequest, "请等待上一审批席位完成签发")
		}
	}
	for i, sg := range signers {
		if i == signerIndex {
			continue
		}
		if sg["signed"] == true && str(sg["userId"]) == id.ID {
			s.Store.Unlock()
			return nil, apperr.Forbidden(apperr.SODSelfApproval, "同一用户不得完成多个审批席位")
		}
	}

	signedAt := time.Now().UTC().Format(time.RFC3339)
	signatureHash := fmt.Sprintf("sig_%s_%s_%d", actionID, id.ID, time.Now().UnixMilli())
	expected["signed"] = true
	expected["signedAt"] = signedAt
	expected["signatureHash"] = signatureHash
	signers[signerIndex] = expected

	signedCount := 0
	for _, sg := range signers {
		if sg["signed"] == true {
			signedCount++
		}
	}
	required := intFromAny(ar["required"], len(signers))
	completed := signedCount >= required
	ar["signers"] = signers
	ar["signed"] = signedCount
	if completed {
		ar["decision"] = "approved"
		ar["decidedAt"] = signedAt
	} else {
		ar["decision"] = "pending"
	}
	msg["approvalRequest"] = ar
	s.Store.Messages[cid][msgIdx] = msg

	action := s.Store.Actions[actionID]
	if action == nil {
		action = map[string]any{
			"id": actionID, "conversationId": cid, "workspaceId": ws,
			"approvedSignerIndexes": []any{},
		}
	}
	indexes := asIntSlice(action["approvedSignerIndexes"])
	indexes = append(indexes, signerIndex)
	status := "pending"
	if completed {
		status = "approved"
	}
	action["approvedSignerIndexes"] = indexes
	action["status"] = status
	action["updatedAt"] = signedAt
	s.Store.Actions[actionID] = action
	auditLabel := "人工审核签发"
	if completed {
		auditLabel = "人工审核通过"
	}
	s.Store.AppendAudit(ws, id.Name, auditLabel, actionID, "success", "")
	s.Store.Unlock()

	s.Store.Persist("messages")
	s.Store.Persist("actions")

	return map[string]any{
		"id": actionID, "conversationId": cid, "status": status,
		"approvedSignerIndexes": indexes,
		"signedAt":              signedAt,
		"signatureHash":         signatureHash,
		"completed":             completed,
	}, nil
}

func (s *Server) executeAction(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.UnauthorizedErr("请先登录")
	}
	actionID := actionIDFromPath(r.URL.Path)
	if actionID == "" {
		return nil, apperr.NotFoundErr(apperr.NotFound, "行动不存在")
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)

	s.Store.Lock()
	action := s.Store.Actions[actionID]
	if action == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "行动不存在")
	}
	continueRun := boolFrom(body["continueRun"])
	st := str(action["status"])
	if st != "approved" {
		if !(continueRun && (st == "executed" || st == "approved") && (str(action["nextRunCommand"]) != "" || skillTurnHasPending(mapFrom(action["authorizationRequest"], "skillTurn")))) {
			s.Store.Unlock()
			return nil, apperr.BadReq(apperr.BadRequest, "行动尚未完成人工审核授权")
		}
	}
	authReq, _ := action["authorizationRequest"].(map[string]any)
	if authReq == nil {
		// Legacy dual-sign / seed actions: mark executed and link task without fake enterprise write.
		taskID := coalesce(str(body["taskId"]), str(action["taskId"]))
		var task map[string]any
		if taskID != "" {
			for i, t := range s.Store.Tasks {
				if str(t["id"]) != taskID {
					continue
				}
				t["status"] = "completed"
				t["lifecycleStage"] = "completed"
				t["updatedAt"] = now
				tasks.EnsureTaskShape(t)
				tasks.AppendTaskAuditLocked(t, id.Name, "受控执行完成", "关联动作已执行", "success")
				s.Store.Tasks[i] = t
				task = t
				break
			}
		}
		action["status"] = "executed"
		action["taskId"] = taskID
		action["updatedAt"] = now
		s.Store.Actions[actionID] = action
		cid := str(action["conversationId"])
		if cid != "" {
			if msg, idx := findMessageLocked(s.Store.Messages[cid], actionID); msg != nil {
				if ar, ok := msg["approvalRequest"].(map[string]any); ok {
					msg["linkedTaskId"] = taskID
					calls := asMapSlice(msg["toolCalls"])
					code := taskID
					if task != nil {
						code = coalesce(str(task["code"]), taskID)
					}
					calls = append(calls, map[string]any{
						"id": s.Store.ID("t"), "name": coalesce(str(ar["action"]), "controlled.execute"),
						"args": map[string]any{"resource": ar["resource"]}, "result": "已授权执行 · 任务 " + code + " 已回链",
						"status": "success", "durationMs": 48,
					})
					msg["toolCalls"] = calls
					s.Store.Messages[cid][idx] = msg
				}
			}
		}
		taskCode := actionID
		if task != nil {
			taskCode = coalesce(str(task["code"]), actionID)
		}
		s.Store.AppendAudit(ws, id.Name, "受控执行完成", taskCode, "success", "legacy")
		s.Store.Unlock()
		s.Store.Persist("messages")
		s.Store.Persist("actions")
		s.Store.Persist("tasks")
		out := map[string]any{}
		for k, v := range action {
			out[k] = v
		}
		if task != nil {
			out["task"] = task
		}
		return out, nil
	}
	cid := coalesce(str(action["conversationId"]), str(body["conversationId"]))
	sess := findSessionForStreamLocked(s.Store.Sessions, ws, cid, cid)
	if sess == nil {
		s.Store.Unlock()
		return nil, apperr.BadReq(apperr.BadRequest, "未找到关联会话，无法执行")
	}
	if err := assertSessionWritableLocked(sess); err != nil {
		s.Store.Unlock()
		return nil, err
	}
	if normalizeSessionMode(str(sess["sessionMode"])) != sessionModeExecute {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.RoleForbidden, "仅受控执行模式可执行已授权动作")
	}
	toolName := coalesce(str(authReq["toolName"]), str(authReq["action"]))
	toolKind := coalesce(str(authReq["toolKind"]), "tool")
	args, _ := authReq["args"].(map[string]any)
	if args == nil {
		args = map[string]any{}
	}
	plan, _ := authReq["skillTurn"].(map[string]any)
	if plan == nil && toolKind == "skill" {
		plan = buildSkillTurnPlan(&registeredTool{Name: toolName, Kind: toolKind, Key: str(authReq["toolKey"])}, toolCallRequest{Name: toolName, Args: args})
		if plan != nil {
			authReq["skillTurn"] = plan
		}
	}
	if continueRun && plan != nil {
		resetFailedRunStepsForContinue(plan)
		if cmd := coalesce(str(body["command"]), coalesce(str(action["nextRunCommand"]), skillTurnRunCommand(plan))); cmd != "" {
			ensureSkillTurnHasRunStep(plan, cmd)
			authReq["skillTurn"] = plan
		}
	}

	if isBlockedEnterpriseWrite(toolName) || (!isAllowlistedExecutableTool(toolName, toolKind) && toolKind != "skill") {
		action["status"] = "approved"
		action["executeError"] = "not_implemented"
		action["updatedAt"] = now
		s.Store.Actions[actionID] = action
		s.Store.AppendAudit(ws, id.Name, "受控执行拒绝", actionID, "failed", "执行器未接入或禁止企业写工具："+toolName)
		s.Store.Unlock()
		s.Store.Persist("actions")
		return nil, apperr.BadReq(apperr.BadRequest, "该动作执行器未接入或禁止直接执行："+toolName)
	}
	deID := str(action["digitalPartnerId"])
	corr := str(authReq["correlationId"])
	risk := str(authReq["riskLevel"])
	toolKey := coalesce(str(authReq["toolKey"]), toolKind+":"+copilot.SlugToolName(toolName))
	userMsg := lastUserMessageLocked(s.Store.Messages[cid])
	s.Store.Unlock()

	runCtx := toolRunContext{
		Request: r, WorkspaceID: ws, OwnerID: id.ID, Viewer: id,
		DigitalPartner: deID, ConversationID: cid, CorrelationID: corr,
		UserMessage: coalesce(userMsg, coalesce(str(args["input"]), coalesce(str(args["content"]), toolName))),
		SessionMode: sessionModeExecute, RiskLevel: risk,
	}
	tool := &registeredTool{
		Key: toolKey, Name: toolName, Kind: toolKind, Mode: copilot.ToolModeExecute, Enabled: true,
	}

	var combined strings.Builder
	var lastRes toolExecResult
	var nextRun string
	executedSteps := 0

	runOne := func(stepArgs map[string]any, stepID string) toolExecResult {
		stepAction := normalizeSkillAction(stepArgs)
		if stepAction == skillActionRun {
			cmd := skillCommandFromArgs(stepArgs)
			sk := s.resolveSkillForTool(ws, tool, coalesce(str(stepArgs["skillId"]), str(args["skillId"])))
			if pf, ok := officeSkillRunPreflight(sk, cmd, runCtx.UserMessage); !ok {
				if plan != nil {
					markSkillTurnStep(plan, stepID, pf.Status, pf.Output)
				}
				return pf
			}
		}
		res := s.CopSvc.RunCopilotTool(runCtx, tool, toolCallRequest{Name: toolName, Args: stepArgs})
		if plan != nil {
			stStatus := "success"
			if res.Status != "success" {
				stStatus = res.Status
			}
			markSkillTurnStep(plan, stepID, stStatus, res.Output)
		}
		return res
	}

	if plan != nil && len(skillTurnSteps(plan)) > 0 {
		for {
			step := nextPendingSkillTurnStep(plan)
			if step == nil {
				break
			}
			stepArgs, _ := step["args"].(map[string]any)
			if stepArgs == nil {
				stepArgs = args
			}
			stepID := coalesce(str(step["id"]), str(step["action"]))
			lastRes = runOne(stepArgs, stepID)
			executedSteps++
			if combined.Len() > 0 {
				combined.WriteString("\n\n")
			}
			combined.WriteString(fmt.Sprintf("—— 步骤 %s ——\n%s", coalesce(str(step["title"]), stepID), lastRes.Output))
			// P1: if a run step failed with a missing-deps message but its declared deps
			// include a write step that has since succeeded, give the run one more shot. The
			// typical cause is the React loop dispatching `bash` directly (bypassing Skill
			// Turn) before the write_file step finished — by the time preflight ran, the
			// file was already on disk.
			if lastRes.Status == "failed" && str(step["action"]) == skillActionRun {
				if canRetryRunAfterDeps(plan, stepID, lastRes) {
					markSkillTurnStep(plan, stepID, "pending", "")
					stepRetry := nextPendingSkillTurnStep(plan)
					if stepRetry != nil && coalesce(str(stepRetry["id"]), str(stepRetry["action"])) == stepID {
						combined.WriteString("\n\n—— 重试步骤（依赖已落盘） ——")
						lastRes = runOne(stepArgs, stepID)
						executedSteps++
						combined.WriteString("\n" + lastRes.Output)
					}
				}
			}
			if lastRes.Status != "success" {
				break
			}
			// P0: write 成功后根据输出补齐 run；nextRun 优先取 run 步脚本，勿把 outline .md 当作续跑命令
			if str(step["action"]) == skillActionWrite {
				if cmd := parseNextRunCommand(lastRes.Output); cmd != "" {
					ensureSkillTurnHasRunStep(plan, cmd)
				}
				if cmd := skillTurnRunCommand(plan); cmd != "" {
					nextRun = cmd
				} else if cmd := parseNextRunCommand(lastRes.Output); looksLikeSkillScriptCommand(cmd) {
					nextRun = cmd
				}
			}
		}
		if nextRun == "" {
			nextRun = preferredNextRunCommand(plan, action, combined.String())
		}
	} else {
		lastRes = s.CopSvc.RunCopilotTool(runCtx, tool, toolCallRequest{Name: toolName, Args: args})
		executedSteps = 1
		combined.WriteString(lastRes.Output)
		if lastRes.Status == "success" {
			if cmd := parseNextRunCommand(lastRes.Output); cmd != "" {
				nextRun = cmd
				// P0 auto-continue single-step write → run
				runArgs := map[string]any{"action": skillActionRun, "command": cmd}
				runRes := s.CopSvc.RunCopilotTool(runCtx, tool, toolCallRequest{Name: toolName, Args: runArgs})
				executedSteps++
				combined.WriteString("\n\n—— 自动续跑 run ——\n")
				combined.WriteString(runRes.Output)
				lastRes = runRes
				if runRes.Status == "success" {
					nextRun = ""
				}
			}
		}
	}

	s.Store.Lock()
	action = s.Store.Actions[actionID]
	authReq, _ = action["authorizationRequest"].(map[string]any)
	if authReq == nil {
		authReq = map[string]any{}
	}
	if plan != nil {
		authReq["skillTurn"] = plan
	}
	output := strings.TrimSpace(combined.String())
	if output == "" {
		output = lastRes.Output
	}
	if lastRes.Status != "success" {
		// 若 write 已成功但 run 失败，保留 nextRun 供 P2「继续执行 run」
		if nextRun == "" {
			nextRun = preferredNextRunCommand(plan, action, output)
		}
		action["status"] = "approved"
		action["executeError"] = coalesce(lastRes.Error, lastRes.Status)
		action["executeResult"] = output
		action["nextRunCommand"] = nextRun
		action["updatedAt"] = now
		authReq["status"] = "approved"
		if plan != nil {
			authReq["skillTurn"] = plan
		}
		action["authorizationRequest"] = authReq
		if cid != "" {
			if msg, idx := findMessageLocked(s.Store.Messages[cid], actionID); msg != nil {
				msg["content"] = appendAuthorizedExecuteResult(str(msg["content"]), output, nextRun)
				if ar, ok := msg["approvalRequest"].(map[string]any); ok {
					ar["skillTurn"] = plan
					if plan != nil {
						ar["planSummary"] = str(plan["summary"])
					}
					msg["approvalRequest"] = ar
				}
				s.Store.Messages[cid][idx] = msg
			}
		}
		s.Store.Actions[actionID] = action
		s.Store.AppendAudit(ws, id.Name, "受控执行失败", actionID, "failed", coalesce(lastRes.Error, lastRes.Output))
		s.Store.Unlock()
		s.Store.Persist("actions")
		s.Store.Persist("messages")
		canContinue := nextRun != "" || skillTurnHasRetryableRun(plan) || skillTurnHasPending(plan)
		if executedSteps > 0 && canContinue {
			out := map[string]any{}
			for k, v := range action {
				out[k] = v
			}
			out["executeResult"] = output
			out["skillTurn"] = plan
			out["nextRunCommand"] = nextRun
			out["canContinueRun"] = true
			out["partial"] = true
			return out, nil
		}
		if executedSteps > 0 {
			out := map[string]any{}
			for k, v := range action {
				out[k] = v
			}
			out["executeResult"] = output
			out["skillTurn"] = plan
			out["executeError"] = coalesce(lastRes.Error, lastRes.Status)
			out["partial"] = true
			return out, nil
		}
		return nil, apperr.BadReq(apperr.BadRequest, coalesce(lastRes.Error, "执行失败"))
	}

	taskID := coalesce(str(body["taskId"]), str(action["taskId"]))
	var task map[string]any
	if taskID != "" {
		for i, t := range s.Store.Tasks {
			if str(t["id"]) != taskID {
				continue
			}
			t["status"] = "completed"
			t["lifecycleStage"] = "completed"
			t["updatedAt"] = now
			tasks.EnsureTaskShape(t)
			tasks.AppendTaskAuditLocked(t, id.Name, "受控执行完成", "关联动作已执行", "success")
			s.Store.Tasks[i] = t
			task = t
			break
		}
	}

	pending := plan != nil && skillTurnHasPending(plan)
	if pending {
		action["status"] = "approved"
		authReq["status"] = "approved"
		action["nextRunCommand"] = nextRun
	} else {
		action["status"] = "executed"
		authReq["status"] = "executed"
		action["nextRunCommand"] = ""
		nextRun = ""
	}
	action["taskId"] = taskID
	action["updatedAt"] = now
	action["executeResult"] = output
	action["executedSteps"] = executedSteps
	action["authorizationRequest"] = authReq
	s.Store.Actions[actionID] = action

	if cid != "" {
		if msg, idx := findMessageLocked(s.Store.Messages[cid], actionID); msg != nil {
			calls := asMapSlice(msg["toolCalls"])
			calls = append(calls, map[string]any{
				"id": s.Store.ID("t"), "name": toolName,
				"args": args, "result": truncateRunes(output, 1200),
				"status": "success", "durationMs": lastRes.DurationMs,
			})
			msg["toolCalls"] = calls
			msg["authorizationRequest"] = authReq
			if ar, ok := msg["approvalRequest"].(map[string]any); ok {
				ar["skillTurn"] = plan
				if plan != nil {
					ar["planSummary"] = str(plan["summary"])
				}
				ar["decision"] = "approved"
				msg["approvalRequest"] = ar
			}
			msg["content"] = appendAuthorizedExecuteResult(str(msg["content"]), output, nextRun)
			s.Store.Messages[cid][idx] = msg
		}
	}
	taskCode := actionID
	if task != nil {
		taskCode = coalesce(str(task["code"]), actionID)
	}
	s.Store.AppendAudit(ws, id.Name, "受控执行完成", taskCode, "success", toolName)
	s.Store.Unlock()

	s.Store.Persist("messages")
	s.Store.Persist("actions")
	s.Store.Persist("tasks")

	out := map[string]any{}
	for k, v := range action {
		out[k] = v
	}
	if task != nil {
		out["task"] = task
	}
	out["result"] = output
	out["executeResult"] = output
	out["skillTurn"] = plan
	out["nextRunCommand"] = nextRun
	out["canContinueRun"] = nextRun != "" || pending
	return out, nil
}

func mapFrom(v any, key string) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return nil
	}
	out, _ := m[key].(map[string]any)
	return out
}

func (s *Server) conversationInWorkspaceLocked(ws, cid, raw string) bool {
	for _, c := range s.Store.Conversations {
		if str(c["id"]) == cid || str(c["id"]) == raw {
			w := str(c["workspaceId"])
			return w == "" || w == ws
		}
	}
	for _, sess := range s.Store.Sessions {
		if str(sess["id"]) == raw || str(sess["conversationId"]) == cid || str(sess["id"]) == cid {
			return str(sess["workspaceId"]) == ws
		}
	}
	if _, ok := s.Store.Messages[cid]; ok {
		return true
	}
	return false
}

func lastUserMessageLocked(msgs []map[string]any) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if str(msgs[i]["role"]) == "user" {
			return str(msgs[i]["content"])
		}
	}
	return ""
}

const authorizedExecuteResultMarker = "—— 授权后执行结果 ——"

var (
	reExecuteStepLine = regexp.MustCompile(`(?m)^——\s*步骤\s+(.+?)\s*——\s*$`)
	reDocSuccessLine  = regexp.MustCompile(`已生成 Word 文档「([^」]+)」`)
)

func userFacingExecuteSummary(output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return "授权执行已完成。"
	}
	for _, line := range strings.Split(output, "\n") {
		trim := strings.TrimSpace(line)
		if m := reDocSuccessLine.FindStringSubmatch(trim); len(m) == 2 {
			return fmt.Sprintf("已为您生成 Word 文档「%s」，请使用上方卡片预览或下载。", m[1])
		}
	}
	var steps []string
	for _, m := range reExecuteStepLine.FindAllStringSubmatch(output, -1) {
		if len(m) == 2 && strings.TrimSpace(m[1]) != "" {
			steps = append(steps, strings.TrimSpace(m[1]))
		}
	}
	if len(steps) > 0 {
		return "已完成：" + strings.Join(steps, " → ")
	}
	if strings.Contains(output, "success") || strings.Contains(output, "已生成") {
		return "授权执行已完成。"
	}
	return "授权执行已完成。"
}

func appendAuthorizedExecuteResult(existing, output, nextRun string) string {
	existing = coalesce(existing, "")
	if strings.Contains(existing, authorizedExecuteResultMarker) {
		return existing
	}
	out := strings.TrimSpace(userFacingExecuteSummary(output))
	if out == "" {
		return existing
	}
	existing += "\n\n" + authorizedExecuteResultMarker + "\n" + out
	if nextRun != "" {
		existing += "\n\n待续跑：action=run command=" + nextRun + "（可点「继续执行 run」）"
	}
	return existing
}

func findMessageLocked(msgs []map[string]any, id string) (map[string]any, int) {
	for i, m := range msgs {
		if str(m["id"]) == id {
			return m, i
		}
	}
	return nil, -1
}

func asMapSlice(v any) []map[string]any {
	switch x := v.(type) {
	case []map[string]any:
		return x
	case []any:
		out := make([]map[string]any, 0, len(x))
		for _, item := range x {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func asIntSlice(v any) []any {
	switch x := v.(type) {
	case []any:
		return append([]any{}, x...)
	case []int:
		out := make([]any, len(x))
		for i, n := range x {
			out[i] = n
		}
		return out
	default:
		return []any{}
	}
}

func intFromAny(v any, def int) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case string:
		n, err := strconv.Atoi(x)
		if err == nil {
			return n
		}
	}
	return def
}

func signerPlatformRole(role string) string {
	switch role {
	case "approver":
		return "admin"
	case "auditor":
		return "auditor"
	default:
		return "user"
	}
}

func signerRoleLabel(role string) string {
	switch role {
	case "auditor":
		return "审计复核"
	case "operator":
		return "执行复核"
	default:
		return "变更审批"
	}
}
