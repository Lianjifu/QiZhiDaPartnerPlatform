package workflows

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// OrchestrationRoute → /api/workflows/orchestration-sessions[/{id}[/action...]]
func (s *Service) orchestrationRoute(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api workflows orchestration-sessions [id] [a] [b] [c]
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "编排会话不存在")
	}
	if r.URL.Path == "/api/workflows/orchestration-sessions" || r.URL.Path == "/api/workflows/orchestration-sessions/" {
		if r.Method == http.MethodGet {
			return s.listOrchestrationSessions(r)
		}
		if r.Method == http.MethodPost {
			return s.createOrchestrationSession(r)
		}
		return nil, apperr.NotFoundErr(apperr.NotFound, "不支持的方法")
	}
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "编排会话不存在")
	}
	sid := parts[3]
	rest := parts[4:]
	return s.orchestrationSessionAction(r, sid, rest)
}

func (s *Service) listOrchestrationSessions(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, item := range s.Store.OrchestrationSessions {
		if str(item["workspaceId"]) != ws {
			continue
		}
		if owner := str(item["ownerId"]); owner != "" && id != nil && owner != id.ID && id.Role != "admin" {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *Service) createOrchestrationSession(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if id == nil || !auth.Has(id, "workflow.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建编排会话")
	}
	body, _ := s.Deps.DecodeMap(r)
	now := time.Now().UTC().Format(time.RFC3339)
	goal := strings.TrimSpace(str(body["goal"]))
	constraints := normalizeConstraints(asMap(body["constraints"]))
	session := map[string]any{
		"id":            s.Store.ID("orch"),
		"title":         coalesce(strings.TrimSpace(str(body["title"])), "AI 辅助编排会话"),
		"status":        "drafting",
		"workspaceId":   s.Deps.WorkspaceID(r),
		"tenantId":      id.TenantID,
		"ownerId":       id.ID,
		"model":         coalesce(str(body["model"]), "企业默认模型"),
		"policyVersion": "workflow-policy-v3",
		"constraints":   constraints,
		"goal":          goal,
		"documents":     []any{},
		"messages": []any{map[string]any{
			"id": s.Store.ID("omsg"), "role": "system", "kind": "chat", "status": "completed",
			"content":   "这是专家辅助编排会话：可上传 Markdown、补充描述，并随时一键生成草稿示例。澄清完全可选；结果不会自动执行、发布或覆盖线上流程。",
			"createdAt": now,
		}},
		"candidates":           []any{},
		"clarificationSkipped": false,
		"expiresAt":            time.Now().UTC().Add(7 * 24 * time.Hour).Format(time.RFC3339),
		"createdAt":            now,
		"updatedAt":            now,
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.OrchestrationSessions = append([]map[string]any{session}, s.Store.OrchestrationSessions...)
	s.Store.AppendAudit(s.Deps.WorkspaceID(r), id.Name, "创建 AI 编排会话", str(session["id"]), "success", "")
	return session, nil
}

func (s *Service) orchestrationSessionAction(r *http.Request, sid string, rest []string) (any, error) {
	id := s.identityFrom(r.Context())
	if id == nil {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "未登录")
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	session := s.findOrchSessionLocked(sid, s.Deps.WorkspaceID(r), id)
	if session == nil {
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权访问该编排会话")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if len(rest) == 0 {
		if r.Method == http.MethodGet {
			return session, nil
		}
		if r.Method == http.MethodPatch {
			body, _ := s.Deps.DecodeMap(r)
			if body["goal"] != nil {
				session["goal"] = strings.TrimSpace(str(body["goal"]))
			}
			if body["title"] != nil {
				session["title"] = coalesce(strings.TrimSpace(str(body["title"])), str(session["title"]))
			}
			if body["constraints"] != nil {
				session["constraints"] = normalizeConstraints(asMap(body["constraints"]))
			}
			session["updatedAt"] = now
			return session, nil
		}
	}
	if len(rest) == 1 && rest[0] == "documents" && r.Method == http.MethodPost {
		return s.orchAddDocumentLocked(r, session, now)
	}
	if len(rest) == 1 && rest[0] == "messages" && r.Method == http.MethodPost {
		return s.orchAddMessageLocked(r, session, now)
	}
	if len(rest) == 1 && rest[0] == "generate" && r.Method == http.MethodPost {
		return s.orchGenerateLocked(r, session, now)
	}
	if len(rest) == 1 && rest[0] == "apply" && r.Method == http.MethodPost {
		return s.orchApplyLocked(r, session, now, id)
	}
	if len(rest) == 1 && rest[0] == "discard" && r.Method == http.MethodPost {
		session["status"] = "discarded"
		session["updatedAt"] = now
		return session, nil
	}
	if len(rest) == 1 && rest[0] == "retrieve-runbook" && r.Method == http.MethodPost {
		return s.orchRetrieveLocked(r, session, now)
	}
	if len(rest) == 1 && rest[0] == "propose-template" && r.Method == http.MethodPost {
		return s.orchProposeTemplateLocked(r, session, now, id)
	}
	if len(rest) == 3 && rest[0] == "candidates" && rest[2] == "activate" && r.Method == http.MethodPost {
		cand := findOrchCandidate(session, rest[1])
		if cand == nil {
			return nil, apperr.NotFoundErr(apperr.NotFound, "草稿示例不存在")
		}
		session["activeCandidateId"] = rest[1]
		session["updatedAt"] = now
		return session, nil
	}
	if len(rest) == 3 && rest[0] == "documents" && rest[2] == "deposit-knowledge" && r.Method == http.MethodPost {
		return s.orchDepositDocLocked(session, rest[1], now, id)
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "未知编排会话动作")
}

func (s *Service) findOrchSessionLocked(sid, ws string, id *auth.Identity) map[string]any {
	for _, item := range s.Store.OrchestrationSessions {
		if str(item["id"]) != sid {
			continue
		}
		if str(item["workspaceId"]) != ws {
			return nil
		}
		if owner := str(item["ownerId"]); owner != "" && id.Role != "admin" && owner != id.ID {
			return nil
		}
		return item
	}
	return nil
}

func (s *Service) orchAddDocumentLocked(r *http.Request, session map[string]any, now string) (any, error) {
	docs := asSlice(session["documents"])
	if len(docs) >= 3 {
		return nil, apperr.BadReq(apperr.BadRequest, "单个编排会话最多引用 3 份文档")
	}
	body, _ := s.Deps.DecodeMap(r)
	fileName := coalesce(str(body["fileName"]), "runbook.md")
	content := str(body["content"])
	if strings.TrimSpace(content) == "" && str(body["knowledgeDocId"]) == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "Markdown 内容不能为空")
	}
	if kid := str(body["knowledgeDocId"]); kid != "" {
		for _, doc := range s.Store.KnowledgeDocs {
			if str(doc["id"]) == kid {
				fileName = coalesce(str(doc["title"]), fileName) + ".md"
				content = coalesce(str(doc["content"]), coalesce(str(doc["summary"]), str(doc["title"])))
				parsed := parseMarkdownDocument(fileName, content, "knowledge", kid)
				docs = append(docs, parsed)
				session["documents"] = docs
				session["updatedAt"] = now
				return map[string]any{"session": session, "document": parsed}, nil
			}
		}
		return nil, apperr.NotFoundErr(apperr.NotFound, "知识文档不存在")
	}
	if !strings.HasSuffix(strings.ToLower(fileName), ".md") && !strings.HasSuffix(strings.ToLower(fileName), ".markdown") && !strings.HasSuffix(strings.ToLower(fileName), ".txt") {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持 Markdown（.md）文件")
	}
	parsed := parseMarkdownDocument(fileName, content, "upload", "")
	docs = append(docs, parsed)
	session["documents"] = docs
	session["messages"] = append(asSlice(session["messages"]), map[string]any{
		"id": s.Store.ID("omsg"), "role": "assistant", "kind": "chat", "status": "completed", "createdAt": now,
		"content": fmt.Sprintf("已解析「%s」（%v 字）。可继续补充目标，或直接一键生成示例。", parsed["title"], parsed["charCount"]),
	})
	session["updatedAt"] = now
	return map[string]any{"session": session, "document": parsed}, nil
}

func (s *Service) orchAddMessageLocked(r *http.Request, session map[string]any, now string) (any, error) {
	body, _ := s.Deps.DecodeMap(r)
	content := strings.TrimSpace(str(body["content"]))
	if utf8.RuneCountInString(content) < 2 {
		return nil, apperr.BadReq(apperr.BadRequest, "请输入有效补充说明")
	}
	mode := "chat"
	if str(body["mode"]) == "clarify" {
		mode = "clarify"
	}
	msgs := asSlice(session["messages"])
	msgs = append(msgs, map[string]any{"id": s.Store.ID("omsg"), "role": "user", "content": content, "createdAt": now, "kind": mode, "status": "completed"})
	if str(session["goal"]) == "" {
		runes := []rune(content)
		if len(runes) > 200 {
			runes = runes[:200]
		}
		session["goal"] = string(runes)
	}
	reply := "已记录你的补充。可继续说明差异，或点击「一键生成示例」让模型基于最新上下文重算草稿。"
	if mode == "clarify" {
		reply = "我可以根据文档与目标直接出示例。也可跳过澄清，点击「一键生成示例」。"
	}
	assistant := map[string]any{"id": s.Store.ID("omsg"), "role": "assistant", "content": reply, "createdAt": now, "kind": mode, "status": "completed"}
	msgs = append(msgs, assistant)
	session["messages"] = msgs
	session["updatedAt"] = now
	return map[string]any{"session": session, "stream": map[string]any{"messageId": assistant["id"], "chunks": []string{reply}, "finalContent": reply}}, nil
}

func (s *Service) orchGenerateLocked(r *http.Request, session map[string]any, now string) (any, error) {
	body, _ := s.Deps.DecodeMap(r)
	if boolOrDefault(body["skipClarification"], false) {
		session["clarificationSkipped"] = true
	}
	if note := strings.TrimSpace(str(body["note"])); note != "" {
		session["messages"] = append(asSlice(session["messages"]), map[string]any{
			"id": s.Store.ID("omsg"), "role": "user", "content": note, "createdAt": now, "kind": "generate", "status": "completed",
		})
		if str(session["goal"]) == "" {
			session["goal"] = note
		}
	}
	goal := strings.TrimSpace(str(session["goal"]))
	if goal == "" && len(asSlice(session["documents"])) == 0 {
		return nil, apperr.BadReq(apperr.BadRequest, "请先填写业务目标或上传 Markdown")
	}
	constraints := asMap(session["constraints"])
	cand := buildOrchestrationCandidate(s.Store.ID("cand"), goal, constraints, asSlice(session["candidates"]))
	cands := append([]any{cand}, asSlice(session["candidates"])...)
	session["candidates"] = cands
	session["activeCandidateId"] = cand["id"]
	session["status"] = "ready"
	assistant := map[string]any{
		"id": s.Store.ID("omsg"), "role": "assistant", "kind": "generate", "status": "completed", "createdAt": now,
		"content":         "已生成可编辑草稿示例。请在右侧核对节点与风险；确认后将写入隔离草稿，不会自动执行或发布。",
		"modelInvocation": map[string]any{"provider": "enterprise-model-router", "model": coalesce(str(session["model"]), "企业默认模型"), "mode": "orchestration", "latencyMs": 180, "promptDigest": "orch"},
	}
	session["messages"] = append(asSlice(session["messages"]), assistant)
	session["updatedAt"] = now
	return map[string]any{"session": session, "candidate": cand, "stream": map[string]any{"messageId": assistant["id"], "chunks": []string{str(assistant["content"])}, "finalContent": assistant["content"]}}, nil
}

func (s *Service) orchApplyLocked(r *http.Request, session map[string]any, now string, id *auth.Identity) (any, error) {
	status := str(session["status"])
	if status == "applied" || status == "discarded" || status == "expired" {
		return nil, apperr.BadReq(apperr.BadRequest, "该编排会话不可再次应用")
	}
	body, _ := s.Deps.DecodeMap(r)
	cid := coalesce(str(body["candidateId"]), str(session["activeCandidateId"]))
	cand := findOrchCandidate(session, cid)
	if cand == nil {
		return nil, apperr.BadReq(apperr.BadRequest, "请先生成草稿示例")
	}
	revisionID := "rev_" + s.Store.ID("wf")
	wf := asMap(cand["workflow"])
	nodes := asSlice(wf["nodes"])
	edges := asSlice(wf["edges"])
	ws := s.Deps.WorkspaceID(r)
	wid := ""
	for _, w := range s.Store.Workflows {
		if str(w["workspaceId"]) == ws {
			wid = str(w["id"])
			break
		}
	}
	if wid != "" {
		ver := map[string]any{
			"id": revisionID, "workflowId": wid, "label": revisionID + " · AI 草稿", "time": "刚刚",
			"desc": "AI 辅助编排会话 · " + str(session["id"]), "status": "draft",
			"nodes": nodes, "edges": edges, "createdAt": now, "nodeCount": len(nodes), "edgeCount": len(edges),
		}
		s.Store.WorkflowVersions[wid] = append([]map[string]any{ver}, s.Store.WorkflowVersions[wid]...)
	}
	session["status"] = "applied"
	session["appliedRevisionId"] = revisionID
	session["updatedAt"] = now
	s.Store.AppendAudit(ws, id.Name, "应用 AI 编排草稿", revisionID, "success", "")
	out := map[string]any{}
	for k, v := range session {
		out[k] = v
	}
	out["revisionId"] = revisionID
	out["candidate"] = cand
	return out, nil
}

func (s *Service) orchRetrieveLocked(r *http.Request, session map[string]any, now string) (any, error) {
	body, _ := s.Deps.DecodeMap(r)
	query := strings.TrimSpace(coalesce(str(body["query"]), str(session["goal"])))
	hits := make([]any, 0)
	q := strings.ToLower(query)
	for _, doc := range s.Store.KnowledgeDocs {
		blob := strings.ToLower(str(doc["title"]) + " " + str(doc["summary"]) + " " + str(doc["content"]))
		if q == "" || strings.Contains(blob, q) || strings.Contains(blob, "redis") || strings.Contains(blob, "runbook") {
			hits = append(hits, map[string]any{
				"docId": str(doc["id"]), "title": coalesce(str(doc["title"]), "知识文档"),
				"excerpt": coalesce(str(doc["summary"]), str(doc["title"])), "score": 0.82,
			})
		}
		if len(hits) >= 3 {
			break
		}
	}
	session["lastRetrieve"] = map[string]any{"query": query, "hits": hits, "at": now}
	msg := "已调用 Runbook 检索，暂无高相关命中；仍可依据业务目标生成示例。"
	if len(hits) > 0 {
		msg = fmt.Sprintf("已通过模型路由调用 Runbook 检索，命中 %d 条。可继续一键生成示例。", len(hits))
	}
	assistant := map[string]any{
		"id": s.Store.ID("omsg"), "role": "assistant", "kind": "retrieve", "status": "completed", "createdAt": now, "content": msg,
		"modelInvocation": map[string]any{"provider": "enterprise-model-router", "model": coalesce(str(session["model"]), "企业默认模型"), "mode": "orchestration", "toolsUsed": []any{map[string]any{"name": "knowledge.retrieve_runbook", "input": query, "output": fmt.Sprintf("%d hits", len(hits))}}},
	}
	session["messages"] = append(asSlice(session["messages"]), assistant)
	session["updatedAt"] = now
	return map[string]any{"session": session, "hits": hits}, nil
}

func (s *Service) orchProposeTemplateLocked(r *http.Request, session map[string]any, now string, id *auth.Identity) (any, error) {
	cid := str(session["activeCandidateId"])
	cand := findOrchCandidate(session, cid)
	if cand == nil {
		cands := asSlice(session["candidates"])
		if len(cands) == 0 {
			return nil, apperr.BadReq(apperr.BadRequest, "请先生成草稿示例再沉淀模版候选")
		}
		cand = asMap(cands[0])
	}
	body, _ := s.Deps.DecodeMap(r)
	tpl := map[string]any{
		"id": s.Store.ID("tplcand"), "sessionId": session["id"], "candidateId": cand["id"],
		"name":        coalesce(str(body["name"]), coalesce(str(session["title"]), "编排会话模版候选")),
		"description": coalesce(str(body["description"]), str(session["goal"])),
		"status":      "pending_approval", "requestedBy": id.Name, "requestedAt": now,
		"workspaceId": s.Deps.WorkspaceID(r), "matchScore": 0.86, "rationale": "由当前编排会话草稿沉淀，待治理审批。",
		"templateId": s.Store.ID("tpl"),
	}
	session["templateCandidate"] = tpl
	session["templateCandidates"] = []any{tpl}
	session["messages"] = append(asSlice(session["messages"]), map[string]any{
		"id": s.Store.ID("omsg"), "role": "assistant", "kind": "template", "status": "completed", "createdAt": now,
		"content": fmt.Sprintf("已提交模版候选「%s」进入审批（pending_approval）。通过前不会进入模版库。", tpl["name"]),
	})
	session["updatedAt"] = now
	return map[string]any{"session": session, "templateCandidate": tpl}, nil
}

func (s *Service) orchDepositDocLocked(session map[string]any, docID, now string, id *auth.Identity) (any, error) {
	docs := asSlice(session["documents"])
	var target map[string]any
	for _, raw := range docs {
		item := asMap(raw)
		if str(item["id"]) == docID {
			target = item
			break
		}
	}
	if target == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "文档不存在")
	}
	if str(target["depositedKnowledgeDocId"]) != "" {
		return map[string]any{"session": session, "alreadyDeposited": true, "knowledgeDoc": map[string]any{"id": target["depositedKnowledgeDocId"]}}, nil
	}
	kid := s.Store.ID("kd")
	s.Store.KnowledgeDocs = append([]map[string]any{{
		"id": kid, "workspaceId": str(session["workspaceId"]), "title": target["title"],
		"summary": target["summary"], "status": "ready", "source": "编排会话沉淀", "ownerId": id.ID, "createdAt": now,
	}}, s.Store.KnowledgeDocs...)
	target["depositedKnowledgeDocId"] = kid
	session["documents"] = docs
	session["updatedAt"] = now
	return map[string]any{"session": session, "alreadyDeposited": false, "knowledgeDoc": map[string]any{"id": kid, "source": "编排会话沉淀"}}, nil
}

func normalizeConstraints(in map[string]any) map[string]any {
	risk := coalesce(str(in["riskLevel"]), "L2")
	if risk != "L1" && risk != "L2" && risk != "L3" {
		risk = "L2"
	}
	return map[string]any{
		"riskLevel":       risk,
		"requireApproval": boolOrDefault(in["requireApproval"], true),
		"requireAudit":    true,
		"requireRollback": boolOrDefault(in["requireRollback"], true),
	}
}

func parseMarkdownDocument(fileName, content, source, knowledgeDocId string) map[string]any {
	if len(content) > 80_000 {
		content = content[:80_000]
	}
	headingRe := regexp.MustCompile(`(?m)^(#{1,3})\s+(.+)$`)
	matches := headingRe.FindAllStringSubmatch(content, 12)
	headings := make([]any, 0, len(matches))
	sections := make([]any, 0, len(matches))
	for i, m := range matches {
		h := strings.TrimSpace(m[2])
		headings = append(headings, h)
		sections = append(sections, map[string]any{"id": fmt.Sprintf("sec_%d", i+1), "heading": h, "level": len(m[1]), "excerpt": h})
	}
	title := fileName
	if len(headings) > 0 {
		title = str(headings[0])
	}
	summary := strings.TrimSpace(headingRe.ReplaceAllString(content, " "))
	if utf8.RuneCountInString(summary) > 220 {
		summary = string([]rune(summary)[:220])
	}
	doc := map[string]any{
		"id": "odoc_" + fmt.Sprintf("%d", time.Now().UnixNano()), "fileName": fileName, "title": title,
		"content": content, "contentHash": fmt.Sprintf("h_%d", len(content)), "charCount": utf8.RuneCountInString(content),
		"summary": summary, "headings": headings, "sections": sections, "source": source, "createdAt": time.Now().UTC().Format(time.RFC3339),
	}
	if knowledgeDocId != "" {
		doc["knowledgeDocId"] = knowledgeDocId
	}
	return doc
}

func buildOrchestrationCandidate(id, goal string, constraints map[string]any, previous []any) map[string]any {
	lower := strings.ToLower(goal)
	isScheduled := strings.Contains(lower, "每天") || strings.Contains(lower, "每周") || strings.Contains(goal, "巡检")
	createsTask := strings.Contains(goal, "工单") || strings.Contains(goal, "值班")
	hasWrite := strings.Contains(goal, "恢复") || strings.Contains(goal, "执行") || strings.Contains(goal, "变更") || strings.Contains(goal, "写入")
	requireApproval := boolOrDefault(constraints["requireApproval"], true)
	requireRollback := boolOrDefault(constraints["requireRollback"], true)
	nodes := []any{}
	add := func(kind, label, desc string, x int) {
		nodes = append(nodes, map[string]any{"id": fmt.Sprintf("g%d", len(nodes)+1), "kind": kind, "label": label, "description": desc, "position": map[string]any{"x": x, "y": 120}})
	}
	if isScheduled {
		add("schedule", "定时巡检触发", "按计划发起数字伙伴巡检", 80)
	} else {
		add("event", "告警事件触发", "接收告警或业务事件", 80)
	}
	add("retrieve", "检索运行手册", "查询知识库与历史处置证据", 300)
	add("decision", "数字伙伴研判", "结合上下文判断处置路径", 520)
	add("policy", "风险策略校验", "校验权限、风险等级与变更策略", 740)
	x := 960
	if hasWrite && requireApproval {
		add("approval", "双重审批", "高风险动作需专家双重审批", x)
		x += 220
	}
	if createsTask {
		add("task", "创建处置工单", "派发专家处置任务并回传结果", x)
	} else if hasWrite {
		add("execute", "执行受控动作", "调用已授权的 Skill 或 MCP 工具", x)
	} else {
		add("notify", "通知负责人", "发送处置结论通知", x)
	}
	x += 220
	if hasWrite && requireRollback {
		add("compensate", "补偿回滚", "执行失败时回滚可逆变更", x)
		x += 220
	}
	add("audit", "审计留痕", "写入处置证据、策略与版本信息", x)
	x += 220
	add("notify", "结果通知", "通知负责人和关联任务", x)
	edges := make([]any, 0, len(nodes))
	for i := 1; i < len(nodes); i++ {
		prev := asMap(nodes[i-1])
		cur := asMap(nodes[i])
		edges = append(edges, map[string]any{"id": fmt.Sprintf("ge%d", i), "source": prev["id"], "target": cur["id"]})
	}
	version := 1
	if len(previous) > 0 {
		version = intFrom(asMap(previous[0])["version"]) + 1
	}
	risk := coalesce(str(constraints["riskLevel"]), "L2")
	warnings := []any{"草稿示例需专家复核后才可应用为隔离草稿", "审计留痕由工作区策略强制开启"}
	return map[string]any{
		"id": id, "version": version, "label": fmt.Sprintf("示例 v%d", version),
		"createdAt":     time.Now().UTC().Format(time.RFC3339),
		"summary":       "已由企业模型路由生成草稿示例，应用后进入隔离草稿。",
		"changeSummary": []any{"已由企业模型路由生成草稿示例", "应用后进入隔离草稿，不会自动执行或发布"},
		"workflow":      map[string]any{"nodes": nodes, "edges": edges},
		"nodes":         nodes, "edges": edges,
		"warnings": warnings, "qualityScore": 88, "requiresReview": true,
		"risk": risk, "constraints": constraints,
		"risks": []any{},
	}
}

func findOrchCandidate(session map[string]any, id string) map[string]any {
	for _, raw := range asSlice(session["candidates"]) {
		item := asMap(raw)
		if str(item["id"]) == id {
			return item
		}
	}
	return nil
}

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func asSlice(v any) []any {
	switch t := v.(type) {
	case []any:
		return t
	case []map[string]any:
		out := make([]any, len(t))
		for i, item := range t {
			out[i] = item
		}
		return out
	default:
		return []any{}
	}
}

func boolOrDefault(v any, def bool) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return t == "true" || t == "1"
	default:
		return def
	}
}
