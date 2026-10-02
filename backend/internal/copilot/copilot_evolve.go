package copilot

import (
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// Evolve candidate kinds — never silently mutate published production artifacts.
const (
	evolveKindMemoryPromote = "memory_promote"
	evolveKindSkillPatch    = "skill_patch"
	evolveKindRoutingHint   = "routing_hint"
	evolveKindDream         = "dream"
)

const (
	evolveStatusPending            = "pending_review"
	evolveStatusPendingCountersign = "pending_countersign"
	evolveStatusApproved           = "approved"
	evolveStatusRejected           = "rejected"
	evolveStatusApplied            = "applied" // dream compress applied under policy (working only)
)

func evolveNeedsDualSign(kind string) bool {
	return kind == evolveKindSkillPatch || kind == evolveKindRoutingHint
}

const dreamShortTermThreshold = 3

type evolveTurnInput struct {
	WorkspaceID       string
	OwnerID           string
	OwnerName         string
	DigitalPartnerID string
	ConversationID    string
	CorrelationID     string
	MessageID         string
	UserMessage       string
	AssistantText     string
	Mode              string
	ReflectRounds     int
	ToolCalls         []map[string]any
	MemoryHits        []memoryHit
	Emit              func(event, stage string, data map[string]any)
}

func looksLikePreferenceStatement(msg string) bool {
	needles := []string{
		"记住", "以后请", "下次请", "偏好", "习惯", "不要再", "请默认",
		"remember", "prefer", "always use", "from now on",
	}
	lower := strings.ToLower(msg)
	for _, n := range needles {
		if strings.Contains(msg, n) || strings.Contains(lower, strings.ToLower(n)) {
			return true
		}
	}
	return false
}

func toolSuccessNames(toolCalls []map[string]any) []string {
	var names []string
	seen := map[string]bool{}
	for _, tc := range toolCalls {
		st := strings.ToLower(str(tc["status"]))
		if st != "" && st != "success" && st != "ok" {
			continue
		}
		name := coalesce(str(tc["name"]), str(tc["key"]))
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	return names
}

func (s *Service) appendEvolveCandidateLocked(cand map[string]any) {
	s.Store.EvolveCands = append([]map[string]any{cand}, s.Store.EvolveCands...)
}

func (s *Service) hasPendingEvolveLocked(ws, kind, fingerprint string) bool {
	for _, c := range s.Store.EvolveCands {
		if str(c["workspaceId"]) != ws || str(c["kind"]) != kind {
			continue
		}
		if str(c["status"]) != evolveStatusPending {
			continue
		}
		if fingerprint != "" && str(c["fingerprint"]) == fingerprint {
			return true
		}
	}
	return false
}

// runPostTurnEvolution creates reviewable EvolveCandidates + optional dream compress.
// Must be called with Store.Lock held. Never publishes routing / skills / long_term.
func (s *Service) runPostTurnEvolutionLocked(in evolveTurnInput) []map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	ws := coalesce(in.WorkspaceID, "w1")
	var created []map[string]any

	emitCand := func(cand map[string]any) {
		created = append(created, cand)
		if in.Emit != nil {
			in.Emit("evolve", "candidate", map[string]any{
				"id": cand["id"], "kind": cand["kind"], "status": cand["status"],
				"title": cand["title"], "summary": cand["summary"],
			})
		}
	}

	// 1) Preference → memory_promote candidate (working/long), never auto-write long_term.
	if looksLikePreferenceStatement(in.UserMessage) {
		fp := "pref:" + truncateRunes(in.UserMessage, 80)
		if !s.hasPendingEvolveLocked(ws, evolveKindMemoryPromote, fp) {
			summary := "用户偏好：" + truncateRunes(in.UserMessage, 160)
			if in.AssistantText != "" {
				summary += "；助手确认：" + truncateRunes(in.AssistantText, 120)
			}
			cand := map[string]any{
				"id": s.Store.ID("evolve"), "workspaceId": ws,
				"kind": evolveKindMemoryPromote, "status": evolveStatusPending,
				"title": "会话偏好晋升候选", "summary": summary,
				"fingerprint": fp,
				"payload": map[string]any{
					"targetLayer": "working",
					"title":       "用户偏好 · " + truncateRunes(in.UserMessage, 40),
					"content":     summary,
					"scope":       "user",
					"confidence":  0.9,
				},
				"digitalPartnerId":   in.DigitalPartnerID,
				"conversationId":      in.ConversationID,
				"messageId":           in.MessageID,
				"correlationId":       in.CorrelationID,
				"sourceCorrelationId": in.CorrelationID,
				"submittedAt":         now, "createdBy": coalesce(in.OwnerName, in.OwnerID), "createdById": in.OwnerID,
			}
			s.appendEvolveCandidateLocked(cand)
			s.appendAudit(ws, coalesce(in.OwnerName, "系统"), "自进化候选", str(cand["title"]), "pending", in.CorrelationID)
			emitCand(cand)
		}
	}

	// 2) Successful tools / reflection → skill_patch candidate (draft only until approve).
	tools := toolSuccessNames(in.ToolCalls)
	if len(tools) > 0 && (in.ReflectRounds > 0 || in.Mode == modePlanExec || in.Mode == modeMultiAgent) {
		fp := "skill:" + strings.Join(tools, ",") + ":" + in.Mode
		if !s.hasPendingEvolveLocked(ws, evolveKindSkillPatch, fp) {
			cand := map[string]any{
				"id": s.Store.ID("evolve"), "workspaceId": ws,
				"kind": evolveKindSkillPatch, "status": evolveStatusPending,
				"title": "技能/提示补丁候选", "summary": "基于成功工具轨迹建议固化：" + strings.Join(tools, "、"),
				"fingerprint": fp,
				"payload": map[string]any{
					"tools": tools, "mode": in.Mode,
					"promptHint": "当用户意图匹配时优先调用：" + strings.Join(tools, "、"),
					"sampleUser": truncateRunes(in.UserMessage, 120),
				},
				"digitalPartnerId":   in.DigitalPartnerID,
				"conversationId":      in.ConversationID,
				"messageId":           in.MessageID,
				"correlationId":       in.CorrelationID,
				"sourceCorrelationId": in.CorrelationID,
				"submittedAt":         now, "createdBy": coalesce(in.OwnerName, in.OwnerID), "createdById": in.OwnerID,
			}
			s.appendEvolveCandidateLocked(cand)
			s.appendAudit(ws, coalesce(in.OwnerName, "系统"), "自进化候选", str(cand["title"]), "pending", in.CorrelationID)
			emitCand(cand)
		}
	}

	// 3) Heavy modes → routing_hint draft candidate (never publish).
	if in.Mode == modeMultiAgent || (in.Mode == modePlanExec && in.ReflectRounds > 0) {
		fp := "route:" + in.Mode
		if !s.hasPendingEvolveLocked(ws, evolveKindRoutingHint, fp) {
			cand := map[string]any{
				"id": s.Store.ID("evolve"), "workspaceId": ws,
				"kind": evolveKindRoutingHint, "status": evolveStatusPending,
				"title": "路由策略候选", "summary": "本回合走 " + in.Mode + "，建议审核是否调整对应难度档位主模型。",
				"fingerprint": fp,
				"payload": map[string]any{
					"suggestedLevel": "P0", "mode": in.Mode,
					"note": "仅生成 draft 路由策略，不会自动 published。",
				},
				"digitalPartnerId":   in.DigitalPartnerID,
				"conversationId":      in.ConversationID,
				"messageId":           in.MessageID,
				"correlationId":       in.CorrelationID,
				"sourceCorrelationId": in.CorrelationID,
				"submittedAt":         now, "createdBy": coalesce(in.OwnerName, "系统"), "createdById": in.OwnerID,
			}
			s.appendEvolveCandidateLocked(cand)
			s.appendAudit(ws, coalesce(in.OwnerName, "系统"), "自进化候选", str(cand["title"]), "pending", in.CorrelationID)
			emitCand(cand)
		}
	}

	// 4) Dream / compress: merge idle short_term of this conversation → working.
	if dream := s.dreamCompressConversationLocked(in); dream != nil {
		emitCand(dream)
	}

	return created
}

// dreamCompressConversationLocked consolidates short_term rows for one conversation into working.
// Working-layer write is allowed by runtime policy; long_term / published artifacts stay untouched.
func (s *Service) dreamCompressConversationLocked(in evolveTurnInput) map[string]any {
	ws := coalesce(in.WorkspaceID, "w1")
	cid := in.ConversationID
	if cid == "" {
		return nil
	}
	var policy map[string]any
	if s.Deps.MemoryPolicyForFn != nil {
		policy = s.Deps.MemoryPolicyForFn(ws)
	}
	if policy["shortToWorkingEnabled"] != true {
		return nil
	}
	var shorts []map[string]any
	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) != ws || str(m["layer"]) != "short_term" || str(m["status"]) != "active" {
			continue
		}
		if str(m["sourceId"]) != cid {
			continue
		}
		shorts = append(shorts, m)
	}
	if len(shorts) < dreamShortTermThreshold {
		return nil
	}
	// Already compressed for this conversation?
	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) == ws && str(m["layer"]) == "working" &&
			str(m["sourceId"]) == cid && str(m["sourceType"]) == "dream_compress" && str(m["status"]) == "active" {
			return nil
		}
	}

	var b strings.Builder
	b.WriteString("Dream 压缩（会话摘要）：\n")
	ids := make([]string, 0, len(shorts))
	for i, m := range shorts {
		if i >= 8 {
			break
		}
		ids = append(ids, str(m["id"]))
		b.WriteString("- ")
		b.WriteString(coalesce(str(m["title"]), str(m["id"])))
		b.WriteString("：")
		b.WriteString(truncateRunes(str(m["content"]), 160))
		b.WriteString("\n")
	}
	content := strings.TrimSpace(b.String())
	item, err := s.Deps.IngestRuntimeMemoryLockedFn(runtimeMemoryInput{
		WorkspaceID: ws, OwnerID: in.OwnerID, OwnerName: in.OwnerName,
		DigitalPartnerID: in.DigitalPartnerID,
		Title:             "Dream 压缩 · " + truncateRunes(cid, 24),
		Content:           content, SourceType: "dream_compress", SourceID: cid,
		CorrelationID: in.CorrelationID, Layer: "working", Scope: "team", Confidence: 0.88,
	})
	if err != nil {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for _, m := range shorts {
		m["status"] = "expired"
		m["updatedAt"] = now
		m["compressedInto"] = str(item["id"])
	}
	cand := map[string]any{
		"id": s.Store.ID("evolve"), "workspaceId": ws,
		"kind": evolveKindDream, "status": evolveStatusApplied,
		"title": "Dream 压缩已应用", "summary": "合并 " + itoa(len(shorts)) + " 条短期记忆 → 工作记忆 " + str(item["id"]),
		"fingerprint": "dream:" + cid,
		"payload": map[string]any{
			"workingMemoryId": str(item["id"]),
			"sourceMemoryIds": ids,
			"count":           len(shorts),
		},
		"digitalPartnerId":   in.DigitalPartnerID,
		"conversationId":      cid,
		"messageId":           in.MessageID,
		"correlationId":       in.CorrelationID,
		"sourceCorrelationId": in.CorrelationID,
		"submittedAt":         now, "reviewedAt": now, "reviewer": "dream",
		"createdBy": coalesce(in.OwnerName, "系统"),
	}
	s.appendEvolveCandidateLocked(cand)
	s.appendAudit(ws, coalesce(in.OwnerName, "系统"), "Dream压缩", str(cand["title"]), "success", in.CorrelationID)
	return cand
}

// createFeedbackEvolveCandidateLocked records like/dislike as reviewable evolution signal.
func (s *Service) createFeedbackEvolveCandidateLocked(ws, ownerID, ownerName, cid, mid, kind, comment string, msg map[string]any) map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	corr := coalesce(str(msg["correlationId"]), s.Store.ID("memory_corr"))
	content := truncateRunes(str(msg["content"]), 200)
	if kind == "like" {
		fp := "fb-like:" + mid
		if s.hasPendingEvolveLocked(ws, evolveKindMemoryPromote, fp) {
			return nil
		}
		cand := map[string]any{
			"id": s.Store.ID("evolve"), "workspaceId": ws,
			"kind": evolveKindMemoryPromote, "status": evolveStatusPending,
			"title": "点赞晋升候选", "summary": coalesce(comment, "用户点赞该回答，建议固化为工作记忆"),
			"fingerprint": fp,
			"payload": map[string]any{
				"targetLayer": "working",
				"title":       "优质回答 · " + truncateRunes(content, 40),
				"content":     content,
				"scope":       "team",
				"confidence":  0.92,
			},
			"conversationId": cid, "messageId": mid, "correlationId": corr,
			"sourceCorrelationId": corr, "submittedAt": now, "createdBy": ownerName, "createdById": ownerID,
			"feedbackKind": "like",
		}
		s.appendEvolveCandidateLocked(cand)
		s.appendAudit(ws, ownerName, "反馈自进化", str(cand["title"]), "pending", corr)
		return cand
	}
	// dislike → skill/prompt patch candidate
	fp := "fb-dislike:" + mid
	if s.hasPendingEvolveLocked(ws, evolveKindSkillPatch, fp) {
		return nil
	}
	cand := map[string]any{
		"id": s.Store.ID("evolve"), "workspaceId": ws,
		"kind": evolveKindSkillPatch, "status": evolveStatusPending,
		"title": "点踩修正候选", "summary": coalesce(comment, "用户点踩，请审核提示词/技能补丁"),
		"fingerprint": fp,
		"payload": map[string]any{
			"promptHint":      "避免重复该回答问题：" + truncateRunes(content, 160),
			"feedback":        comment,
			"sampleAssistant": content,
		},
		"conversationId": cid, "messageId": mid, "correlationId": corr,
		"sourceCorrelationId": corr, "submittedAt": now, "createdBy": ownerName, "createdById": ownerID,
		"feedbackKind": "dislike",
	}
	s.appendEvolveCandidateLocked(cand)
	s.appendAudit(ws, ownerName, "反馈自进化", str(cand["title"]), "pending", corr)
	return cand
}

func (s *Service) listEvolveCandidates(r *http.Request) (any, error) {
	ws := s.Deps.WorkspaceIDFn(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, c := range s.Store.EvolveCands {
		if str(c["workspaceId"]) == ws {
			out = append(out, c)
		}
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, nil
}

func (s *Service) evolveDreamRun(r *http.Request) (any, error) {
	id, err := s.Deps.RequireMemoryGovernanceFn(r, "执行 Dream 压缩")
	if err != nil {
		return nil, err
	}
	ws := s.Deps.WorkspaceIDFn(r)
	body, _ := decodeMap(r)
	cid := strings.TrimSpace(str(body["conversationId"]))
	s.Store.Lock()
	defer s.Store.Unlock()
	applied := 0
	var cands []map[string]any
	if cid != "" {
		cand := s.dreamCompressConversationLocked(evolveTurnInput{
			WorkspaceID: ws, OwnerID: id.ID, OwnerName: id.Name,
			ConversationID: cid, CorrelationID: s.Store.ID("dream_corr"),
		})
		if cand != nil {
			applied++
			cands = append(cands, cand)
		}
	} else {
		// Sweep all conversations that have enough short_term rows.
		counts := map[string]int{}
		for _, m := range s.Store.MemoryRecords {
			if str(m["workspaceId"]) != ws || str(m["layer"]) != "short_term" || str(m["status"]) != "active" {
				continue
			}
			sid := str(m["sourceId"])
			if sid == "" {
				continue
			}
			counts[sid]++
		}
		for sid, n := range counts {
			if n < dreamShortTermThreshold {
				continue
			}
			cand := s.dreamCompressConversationLocked(evolveTurnInput{
				WorkspaceID: ws, OwnerID: id.ID, OwnerName: id.Name,
				ConversationID: sid, CorrelationID: s.Store.ID("dream_corr"),
			})
			if cand != nil {
				applied++
				cands = append(cands, cand)
			}
		}
	}
	go s.persistEvolve()
	return map[string]any{"applied": applied, "candidates": cands}, nil
}

func (s *Service) persistEvolve() {
	if s.Store.CanWrite("evolve_candidates") {
		s.Store.Persist("evolve_candidates")
	}
	if s.Deps.PersistMemorySyncFn != nil {
		s.Deps.PersistMemorySyncFn()
	}
}

func (s *Service) evolveCandidateAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/evolve/candidates/:id/:action
	if len(parts) < 5 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "候选不存在")
	}
	cid, action := parts[3], parts[4]
	if action != "approve" && action != "reject" {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持 approve / reject")
	}
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.Forbidden(apperr.AdminRequired, "未认证")
	}
	ws := s.depWorkspaceID(r)
	if ws == "" {
		ws = "w1"
	}
	now := time.Now().UTC().Format(time.RFC3339)

	// Peek status/kind without holding write lock across zero-trust (which also locks).
	s.Store.RLock()
	var peek map[string]any
	for _, c := range s.Store.EvolveCands {
		if str(c["id"]) == cid {
			peek = c
			break
		}
	}
	var peekStatus, peekKind string
	if peek != nil {
		peekStatus = str(peek["status"])
		peekKind = str(peek["kind"])
	}
	s.Store.RUnlock()
	if peek == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "候选不存在")
	}
	if str(peek["workspaceId"]) != ws {
		return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, "E_WORKSPACE_SCOPE: 无权操作其他工作区候选")
	}
	if peekStatus != evolveStatusPending && peekStatus != evolveStatusPendingCountersign {
		return nil, apperr.BadReq(apperr.BadRequest, "候选已审或已应用，不可重复操作")
	}

	if action == "approve" && peekStatus == evolveStatusPending {
		if evolveNeedsDualSign(peekKind) {
			if id.Role != "admin" {
				return nil, apperr.Forbidden(apperr.AdminRequired, "技能/路由候选首签仅限管理员")
			}
		} else if id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "审核自进化候选仅限管理员执行")
		}
		var eval map[string]any
		if s.Deps.EvaluateZeroTrustFn != nil {
			var err error
			eval, err = s.Deps.EvaluateZeroTrustFn(id, "memory", "write", "internal", false, "")
			if err != nil {
				return nil, err
			}
		}
		if str(eval["decision"]) == "deny" {
			return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, coalesce(str(eval["reason"]), "零信任拒绝"))
		}
	}

	s.Store.Lock()
	defer s.Store.Unlock()
	var cand map[string]any
	for _, c := range s.Store.EvolveCands {
		if str(c["id"]) == cid {
			cand = c
			break
		}
	}
	if cand == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "候选不存在")
	}
	if str(cand["workspaceId"]) != ws {
		return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, "E_WORKSPACE_SCOPE: 无权操作其他工作区候选")
	}
	status := str(cand["status"])
	if status != evolveStatusPending && status != evolveStatusPendingCountersign {
		return nil, apperr.BadReq(apperr.BadRequest, "候选已审或已应用，不可重复操作")
	}

	if action == "reject" {
		if id.Role != "admin" && id.Role != "auditor" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "拒绝自进化候选仅限管理员或审计员")
		}
		cand["status"] = evolveStatusRejected
		cand["reviewedAt"] = now
		cand["reviewer"] = id.Name
		s.appendAudit(ws, id.Name, "拒绝自进化候选", str(cand["title"]), "success", str(cand["correlationId"]))
		go s.persistEvolve()
		return cand, nil
	}

	// approve
	kind := str(cand["kind"])
	if s.Deps.RequireProductionDualApprovalFn != nil {
		if err := s.Deps.RequireProductionDualApprovalFn(str(cand["createdById"]), str(cand["createdBy"]), id, "自进化"); err != nil {
			return nil, err
		}
	}
	if evolveNeedsDualSign(kind) {
		signers := knowledgeSliceMaps(cand["signers"])
		for _, sg := range signers {
			if str(sg["userId"]) == id.ID {
				return nil, apperr.BadReq(apperr.BadRequest, "同一人不可重复会签")
			}
		}
		if status == evolveStatusPending {
			signers = append(signers, map[string]any{
				"userId": id.ID, "name": id.Name, "role": id.Role, "signedAt": now,
			})
			cand["signers"] = signers
			cand["status"] = evolveStatusPendingCountersign
			cand["firstReviewer"] = id.Name
			s.appendAudit(ws, id.Name, "自进化首签", str(cand["title"]), "pending_countersign", str(cand["correlationId"]))
			go s.persistEvolve()
			return cand, nil
		}
		// Second sign: auditor preferred; another admin allowed if different user
		if id.Role != "auditor" && id.Role != "admin" {
			return nil, apperr.Forbidden(apperr.AdminRequired, "会签仅限审计员或另一管理员")
		}
		signers = append(signers, map[string]any{
			"userId": id.ID, "name": id.Name, "role": id.Role, "signedAt": now,
		})
		cand["signers"] = signers
	}

	effect, applyErr := s.applyEvolveCandidateLocked(ws, id.ID, id.Name, cand)
	if applyErr != nil {
		return nil, applyErr
	}
	cand["status"] = evolveStatusApproved
	cand["reviewedAt"] = now
	cand["reviewer"] = id.Name
	if effect != nil {
		cand["effect"] = effect
	}
	s.appendAudit(ws, id.Name, "通过自进化候选", str(cand["title"]), "success", str(cand["correlationId"]))
	go s.persistEvolve()
	return cand, nil
}

func (s *Service) applyEvolveCandidateLocked(ws, actorID, actorName string, cand map[string]any) (map[string]any, error) {
	kind := str(cand["kind"])
	payload, _ := cand["payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	switch kind {
	case evolveKindMemoryPromote:
		target := coalesce(str(payload["targetLayer"]), "working")
		if target == "long_term" {
			// long_term still goes through MemoryCands / refinement path — create pending long via ingest forbidden;
			// instead write working first OR create a memory knowledge candidate from a new long draft under review.
			// Safe path: write working memory only; escalate to knowledge candidate if requested.
			target = "working"
		}
		var item map[string]any
		var err error
		if s.Deps.IngestRuntimeMemoryLockedFn != nil {
			item, err = s.Deps.IngestRuntimeMemoryLockedFn(runtimeMemoryInput{
				WorkspaceID: ws, OwnerID: actorID, OwnerName: actorName,
				DigitalPartnerID: str(cand["digitalPartnerId"]),
				Title:             coalesce(str(payload["title"]), str(cand["title"])),
				Content:           coalesce(str(payload["content"]), str(cand["summary"])),
				SourceType:        "evolve_approve", SourceID: coalesce(str(cand["conversationId"]), str(cand["id"])),
				CorrelationID:     coalesce(str(cand["correlationId"]), str(cand["id"])),
				Layer:             target, Scope: coalesce(str(payload["scope"]), "team"),
				Confidence:        toFloat(payload["confidence"]),
			})
			if err != nil {
				return nil, err
			}
			return map[string]any{"memoryId": str(item["id"]), "layer": target}, nil
		}
		return map[string]any{"memoryId": "", "layer": target}, nil

	case evolveKindSkillPatch:
		// Draft skill note only — never mark installed/published.
		now := time.Now().UTC().Format(time.RFC3339)
		draft := map[string]any{
			"id": s.Store.ID("skill_draft"), "workspaceId": ws,
			"name":        coalesce(str(cand["title"]), "自进化技能草稿"),
			"description": coalesce(str(payload["promptHint"]), str(cand["summary"])),
			"status":      "draft", "channel": "evolve", "source": "evolve_candidate",
			"evolveCandidateId": str(cand["id"]),
			"payload":           payload, "createdAt": now, "updatedAt": now, "owner": actorName,
		}
		if s.Store.SkillExtra == nil {
			s.Store.SkillExtra = map[string]any{}
		}
		drafts := knowledgeSliceMaps(s.Store.SkillExtra["evolveDrafts"])
		s.Store.SkillExtra["evolveDrafts"] = append([]map[string]any{draft}, drafts...)
		s.Deps.PersistSkillHealthFn()
		return map[string]any{"skillDraftId": str(draft["id"]), "status": "draft"}, nil

	case evolveKindRoutingHint:
		level := coalesce(str(payload["suggestedLevel"]), "P3")
		item := map[string]any{
			"id": s.Store.ID("rp"), "workspaceId": ws,
			"level": level, "primaryModelId": "",
			"fallbackModelIds": []string{}, "dataScope": "internal",
			"egressAllowed": false, "budgetLimitUsd": 0,
			"status": "draft", "validationIssues": []string{"自进化候选，待人工补全主模型后发布"},
			"source": "evolve_candidate", "evolveCandidateId": str(cand["id"]),
			"note": coalesce(str(payload["note"]), str(cand["summary"])),
		}
		s.Store.RoutingPolicies = append([]map[string]any{item}, s.Store.RoutingPolicies...)
		s.Store.PersistCollection("routing_policies", s.Store.RoutingPolicies)
		return map[string]any{"routingPolicyId": str(item["id"]), "status": "draft"}, nil

	case evolveKindDream:
		return nil, apperr.BadReq(apperr.BadRequest, "Dream 记录已应用，无需审核通过")

	default:
		return nil, apperr.BadReq(apperr.BadRequest, "未知自进化候选类型")
	}
}

func (s *Service) copilotMessageFeedback(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/copilot/conversations/:cid/messages/:mid/feedback
	if len(parts) < 6 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "消息不存在")
	}
	cid, mid := parts[3], parts[5]
	body, _ := decodeMap(r)
	kind := strings.ToLower(strings.TrimSpace(str(body["kind"])))
	if kind != "like" && kind != "dislike" && kind != "none" && kind != "" {
		return nil, apperr.BadReq(apperr.BadRequest, "kind 仅支持 like / dislike / none")
	}
	comment := strings.TrimSpace(str(body["comment"]))
	ws := s.depWorkspaceID(r)
	if ws == "" {
		ws = "w1"
	}

	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	msgs := s.Store.Messages[cid]
	var target map[string]any
	for _, m := range msgs {
		if str(m["id"]) == mid {
			target = m
			break
		}
	}
	if target == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "消息不存在")
	}
	if kind == "none" || kind == "" {
		delete(target, "feedback")
		unlocked = true
		s.Store.Unlock()
		go s.Store.Persist("messages")
		return map[string]any{"ok": true, "messageId": mid, "feedback": nil}, nil
	}
	fb := map[string]any{
		"kind": kind, "comment": comment, "ratedBy": id.Name,
		"ratedAt": time.Now().UTC().Format(time.RFC3339),
	}
	if tags := body["tags"]; tags != nil {
		fb["tags"] = tags
	}
	target["feedback"] = fb
	var cand map[string]any
	if kind == "like" || kind == "dislike" {
		cand = s.createFeedbackEvolveCandidateLocked(ws, id.ID, id.Name, cid, mid, kind, comment, target)
	}
	unlocked = true
	s.Store.Unlock()
	go func() {
		s.Store.Persist("messages")
		s.persistEvolve()
	}()
	out := map[string]any{"ok": true, "messageId": mid, "feedback": fb}
	if cand != nil {
		out["evolveCandidate"] = cand
	}
	return out, nil
}


func (s *Service) appendAudit(ws, actor, action, target, result, corr string) {
	if s == nil || s.Deps.AppendMemoryAuditLockedFn == nil {
		return
	}
	s.Deps.AppendMemoryAuditLockedFn(ws, actor, action, target, result, corr)
}
