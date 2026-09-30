package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func defaultMemoryPolicy(ws string) map[string]any {
	return map[string]any{
		"workspaceId": ws, "shortTermTtlHours": 24, "workingMemoryTtlDays": 30, "dailyRefinementTime": "02:00",
		"shortToWorkingEnabled": true, "workingToLongEnabled": true, "longToKnowledgeEnabled": true,
		"minimumConfidence": 0.85, "longTermWriteApproval": true, "sensitiveDataMasking": true,
		"longTermCapacity": 5000, "usedCapacity": 0,
	}
}

func (s *Server) memoryPolicyFor(ws string) map[string]any {
	if p := s.Store.MemoryPolicies[ws]; p != nil {
		return p
	}
	return defaultMemoryPolicy(ws)
}

func (s *Server) appendMemoryAuditLocked(ws, actor, action, target, result, corr string) {
	if corr == "" {
		corr = s.Store.ID("memory_corr")
	}
	s.Store.MemoryAudits = append([]map[string]any{{
		"id": s.Store.ID("ma"), "workspaceId": ws, "time": time.Now().UTC().Format(time.RFC3339),
		"actor": actor, "action": action, "target": target, "result": result, "correlationId": corr,
	}}, s.Store.MemoryAudits...)
}

func (s *Server) persistMemory() {
	for _, coll := range []string{"memory_records", "memory_candidates", "memory_policies", "memory_audits"} {
		if s.Store.CanWrite(coll) {
			s.Store.Persist(coll)
		}
	}
}

func memoryCanRead(id *auth.Identity, item map[string]any) bool {
	if id == nil || id.Role == "admin" || id.Role == "auditor" {
		return true
	}
	class := str(item["classification"])
	if class == "restricted" || class == "confidential" {
		return str(item["ownerId"]) == id.ID || str(item["createdBy"]) == id.ID
	}
	return true
}

func memoryCanChange(id *auth.Identity, item map[string]any) bool {
	if id == nil || id.Role == "admin" {
		return true
	}
	return str(item["ownerId"]) == id.ID || str(item["createdBy"]) == id.ID
}

func (s *Server) recountLongTermCapacityLocked(ws string) {
	p := s.Store.MemoryPolicies[ws]
	if p == nil {
		p = defaultMemoryPolicy(ws)
		s.Store.MemoryPolicies[ws] = p
	}
	used := 0
	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) == ws && str(m["layer"]) == "long_term" && str(m["status"]) == "active" {
			used++
		}
	}
	p["usedCapacity"] = used
}

func (s *Server) requireMemoryGovernance(r *http.Request, actionLabel string) (*auth.Identity, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, actionLabel+"仅限管理员执行")
	}
	eval, err := s.evaluateZeroTrust(id, "memory", "write", "internal", false, "")
	if err != nil {
		return nil, err
	}
	if str(eval["decision"]) == "deny" {
		return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, coalesce(str(eval["reason"]), "零信任拒绝记忆写操作"))
	}
	return id, nil
}

func (s *Server) memoryOverviewAligned(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	id := identityFrom(r.Context())
	s.Store.RLock()
	defer s.Store.RUnlock()
	short, working, long, pending := 0, 0, 0, 0
	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) != ws || !memoryCanRead(id, m) {
			continue
		}
		if str(m["status"]) != "active" {
			continue
		}
		switch str(m["layer"]) {
		case "short_term":
			short++
		case "working":
			working++
		case "long_term":
			long++
		}
	}
	for _, c := range s.Store.MemoryCands {
		if str(c["workspaceId"]) == ws && str(c["status"]) == "pending_review" {
			pending++
		}
	}
	policy := s.memoryPolicyFor(ws)
	return map[string]any{
		"workspaceId": ws,
		"totals": map[string]any{
			"shortTerm": short, "working": working, "longTerm": long, "pendingCandidates": pending,
		},
		"policy": policy,
	}, nil
}

func (s *Server) listMemory(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	id := identityFrom(r.Context())
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) == ws && memoryCanRead(id, m) {
			out = append(out, m)
		}
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, nil
}

func (s *Server) createMemory(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	body, _ := decodeMap(r)
	title := strings.TrimSpace(str(body["title"]))
	content := strings.TrimSpace(str(body["content"]))
	layer := str(body["layer"])
	if title == "" || content == "" || layer == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_INVALID: 标题、内容与记忆层级不能为空")
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)

	s.Store.Lock()
	defer s.Store.Unlock()
	policy := s.memoryPolicyFor(ws)
	if s.Store.MemoryPolicies[ws] == nil {
		s.Store.MemoryPolicies[ws] = policy
	}
	if layer == "long_term" {
		if policy["longTermWriteApproval"] == true {
			return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_APPROVAL_REQUIRED: 长期记忆写入需要通过提炼审核")
		}
		cap := int(toFloat(policy["longTermCapacity"]))
		used := int(toFloat(policy["usedCapacity"]))
		if cap > 0 && used >= cap {
			return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_CAPACITY: 长期记忆容量已满")
		}
	}
	item := map[string]any{
		"id": s.Store.ID("memory"), "workspaceId": ws, "ownerId": id.ID,
		"digitalPartnerId": body["digitalPartnerId"],
		"layer":             layer, "scope": coalesce(str(body["scope"]), "user"),
		"title": title, "content": content,
		"classification": coalesce(str(body["classification"]), "internal"),
		"sourceType":     coalesce(str(body["sourceType"]), "manual"),
		"sourceId":       coalesce(str(body["sourceId"]), "manual"),
		"correlationId":  coalesce(str(body["correlationId"]), s.Store.ID("memory_corr")),
		"confidence":     coalesceAny(body["confidence"], 0.8),
		"status":         "active", "createdAt": now, "updatedAt": now,
	}
	if exp := str(body["expiresAt"]); exp != "" {
		item["expiresAt"] = exp
	} else if layer == "short_term" {
		hours := int(toFloat(policy["shortTermTtlHours"]))
		if hours <= 0 {
			hours = 24
		}
		item["expiresAt"] = time.Now().UTC().Add(time.Duration(hours) * time.Hour).Format(time.RFC3339)
	} else if layer == "working" {
		days := int(toFloat(policy["workingMemoryTtlDays"]))
		if days <= 0 {
			days = 30
		}
		item["expiresAt"] = time.Now().UTC().Add(time.Duration(days) * 24 * time.Hour).Format(time.RFC3339)
	}
	s.Store.MemoryRecords = append([]map[string]any{item}, s.Store.MemoryRecords...)
	if layer == "long_term" {
		s.recountLongTermCapacityLocked(ws)
	}
	s.appendMemoryAuditLocked(ws, id.Name, "写入记忆", title, "success", str(item["correlationId"]))
	go s.persistMemory()
	return item, nil
}

func (s *Server) memoryRecordAction(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "记忆不存在")
	}
	mid, action := parts[3], ""
	if len(parts) >= 5 {
		action = parts[4]
	}
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)

	s.Store.Lock()
	defer s.Store.Unlock()
	for _, m := range s.Store.MemoryRecords {
		if str(m["id"]) != mid {
			continue
		}
		if str(m["workspaceId"]) != ws {
			return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, "E_WORKSPACE_SCOPE: 无权操作其他工作区记忆")
		}
		if !memoryCanChange(id, m) {
			return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, "E_MEMORY_OWNER_SCOPE: 仅可维护本人创建的记忆")
		}
		switch {
		case action == "expire" && r.Method == http.MethodPost:
			m["status"] = "expired"
			m["updatedAt"] = now
			s.appendMemoryAuditLocked(ws, id.Name, "使记忆失效", coalesce(str(m["title"]), mid), "success", str(m["correlationId"]))
			if str(m["layer"]) == "long_term" {
				s.recountLongTermCapacityLocked(ws)
			}
			go s.persistMemory()
			return m, nil
		case action == "candidate" && r.Method == http.MethodPost:
			if str(m["layer"]) != "long_term" {
				return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_LAYER_INVALID: 仅长期记忆可以提炼为知识候选")
			}
			for _, c := range s.Store.MemoryCands {
				if str(c["memoryId"]) == mid && str(c["status"]) == "pending_review" {
					return c, nil
				}
			}
			summary := str(m["content"])
			if len([]rune(summary)) > 180 {
				summary = string([]rune(summary)[:180])
			}
			cand := map[string]any{
				"id": s.Store.ID("memory_candidate"), "workspaceId": ws, "memoryId": mid,
				"title": coalesce(str(m["title"]), "记忆候选"), "summary": summary,
				"classification":      coalesce(str(m["classification"]), "internal"),
				"sourceCorrelationId": coalesce(str(m["correlationId"]), s.Store.ID("memory_corr")),
				"status":              "pending_review", "submittedAt": now,
			}
			s.Store.MemoryCands = append([]map[string]any{cand}, s.Store.MemoryCands...)
			m["status"] = "pending_review"
			m["updatedAt"] = now
			s.appendMemoryAuditLocked(ws, id.Name, "提炼知识候选", str(cand["title"]), "success", str(cand["sourceCorrelationId"]))
			go s.persistMemory()
			return cand, nil
		case r.Method == http.MethodDelete:
			m["status"] = "revoked"
			m["updatedAt"] = now
			s.appendMemoryAuditLocked(ws, id.Name, "删除记忆", coalesce(str(m["title"]), mid), "success", str(m["correlationId"]))
			if str(m["layer"]) == "long_term" {
				s.recountLongTermCapacityLocked(ws)
			}
			go s.persistMemory()
			return map[string]any{"id": mid, "status": "revoked"}, nil
		}
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "记忆不存在")
}

func (s *Server) listMemoryCandidates(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	id := identityFrom(r.Context())
	s.Store.RLock()
	defer s.Store.RUnlock()
	recordsByID := map[string]map[string]any{}
	for _, m := range s.Store.MemoryRecords {
		recordsByID[str(m["id"])] = m
	}
	var out []map[string]any
	for _, c := range s.Store.MemoryCands {
		if str(c["workspaceId"]) != ws {
			continue
		}
		rec := recordsByID[str(c["memoryId"])]
		if rec == nil {
			rec = map[string]any{}
		}
		if !memoryCanRead(id, rec) {
			continue
		}
		out = append(out, c)
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, nil
}

func (s *Server) memoryCandidateActionAligned(r *http.Request) (any, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "候选不存在")
	}
	cid, action := parts[3], parts[4]
	if action == "promote" {
		action = "approve"
	}
	if action != "approve" && action != "reject" {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持 approve / reject")
	}
	id, err := s.requireMemoryGovernance(r, "审核知识候选")
	if err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)

	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	var cand map[string]any
	for _, c := range s.Store.MemoryCands {
		if str(c["id"]) == cid {
			cand = c
			break
		}
	}
	if cand == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "候选不存在")
	}
	if str(cand["workspaceId"]) != ws {
		return nil, apperr.Forbidden(apperr.MemoryWriteForbidden, "E_WORKSPACE_SCOPE: 无权操作其他工作区知识候选")
	}

	approved := action == "approve"
	cand["status"] = map[bool]string{true: "approved", false: "rejected"}[approved]
	cand["reviewedAt"] = now
	cand["reviewer"] = id.Name

	var record map[string]any
	for _, m := range s.Store.MemoryRecords {
		if str(m["id"]) == str(cand["memoryId"]) {
			record = m
			break
		}
	}

	if approved {
		summary := coalesce(str(cand["summary"]), "")
		title := coalesce(str(cand["title"]), "记忆晋升")
		quality := 80
		if record != nil {
			quality = int(toFloat(record["confidence"]) * 100)
			if quality <= 0 {
				quality = 80
			}
		}
		ver := map[string]any{
			"id": s.Store.ID("kpv"), "version": "v0.1", "status": "draft",
			"indexVersion": "idx-" + s.Store.ID("idx"), "qualityScore": quality,
			"changeSummary": "由记忆候选 " + cid + " 受控提炼",
		}
		pkg := map[string]any{
			"id": s.Store.ID("knowledge_package"), "workspaceId": ws, "ownerId": id.ID,
			"environment": "sandbox", "name": title, "description": summary,
			"domain": "运行经验", "classification": coalesce(str(cand["classification"]), "internal"),
			"owner": id.Name, "status": "draft", "documentCount": 1, "documentIds": []string{}, "consumers": 0,
			"currentVersion": ver, "versions": []map[string]any{ver},
			"updatedAt": now, "source": "memory_candidate", "memoryCandidateId": cid,
		}
		pkgs := knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"])
		s.Store.KnowledgeExtra["packages"] = append([]map[string]any{pkg}, pkgs...)
		s.appendKnowledgeAuditLocked(ws, id.Name, "从记忆候选创建知识包", title, "success", "")
		cand["knowledgePackageId"] = pkg["id"]
		if record != nil {
			record["status"] = "promoted"
			record["updatedAt"] = now
		}
	} else if record != nil {
		record["status"] = "active"
		record["updatedAt"] = now
	}

	actionLabel := "拒绝知识候选"
	if approved {
		actionLabel = "审核通过知识候选"
	}
	s.appendMemoryAuditLocked(ws, id.Name, actionLabel, str(cand["title"]), "success", str(cand["sourceCorrelationId"]))
	unlocked = true
	s.Store.Unlock()
	go func() {
		s.persistMemory()
		s.persistKnowledgeExtra()
	}()
	return cand, nil
}

// memoryCandidateAction keeps the legacy promote path for callers that still hit it directly in tests.
func (s *Server) memoryCandidateAction(r *http.Request) (any, error) {
	return s.memoryCandidateActionAligned(r)
}

func (s *Server) memoryRefinement(r *http.Request) (any, error) {
	id, err := s.requireMemoryGovernance(r, "执行记忆渐进提炼")
	if err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)

	s.Store.Lock()
	defer s.Store.Unlock()
	policy := s.memoryPolicyFor(ws)
	if s.Store.MemoryPolicies[ws] == nil {
		s.Store.MemoryPolicies[ws] = policy
	}
	minConf := toFloat(policy["minimumConfidence"])
	if minConf <= 0 {
		minConf = 0.85
	}
	workingDays := int(toFloat(policy["workingMemoryTtlDays"]))
	if workingDays <= 0 {
		workingDays = 30
	}
	cap := int(toFloat(policy["longTermCapacity"]))

	hasLayerSource := func(layer, sourceID string) bool {
		for _, m := range s.Store.MemoryRecords {
			if str(m["workspaceId"]) == ws && str(m["layer"]) == layer && str(m["sourceId"]) == sourceID {
				return true
			}
		}
		return false
	}
	hasPendingCand := func(memoryID string) bool {
		for _, c := range s.Store.MemoryCands {
			if str(c["memoryId"]) == memoryID && str(c["status"]) == "pending_review" {
				return true
			}
		}
		return false
	}

	workingCreated, longCreated, candidatesCreated := 0, 0, 0
	snapshot := append([]map[string]any{}, s.Store.MemoryRecords...)

	if policy["shortToWorkingEnabled"] == true {
		for _, source := range snapshot {
			if str(source["workspaceId"]) != ws || str(source["layer"]) != "short_term" || str(source["status"]) != "active" {
				continue
			}
			if hasLayerSource("working", str(source["sourceId"])) {
				continue
			}
			if hasWorkingDreamCompressLocked(s.Store.MemoryRecords, ws, str(source["sourceId"])) {
				continue
			}
			item := map[string]any{}
			for k, v := range source {
				item[k] = v
			}
			item["id"] = s.Store.ID("memory_work")
			item["layer"] = "working"
			item["scope"] = "team"
			item["title"] = coalesce(str(source["title"]), "短期记忆") + " · 会话摘要"
			item["content"] = "每日归纳：" + str(source["content"])
			item["confidence"] = minFloat(0.99, toFloat(source["confidence"])+0.02)
			item["expiresAt"] = now.Add(time.Duration(workingDays) * 24 * time.Hour).Format(time.RFC3339)
			item["createdAt"] = nowStr
			item["updatedAt"] = nowStr
			item["status"] = "active"
			s.Store.MemoryRecords = append([]map[string]any{item}, s.Store.MemoryRecords...)
			workingCreated++
		}
	}

	if policy["workingToLongEnabled"] == true {
		for _, source := range snapshot {
			if str(source["workspaceId"]) != ws || str(source["layer"]) != "working" || str(source["status"]) != "active" {
				continue
			}
			if toFloat(source["confidence"]) < minConf {
				continue
			}
			if hasLayerSource("long_term", str(source["sourceId"])) {
				continue
			}
			used := int(toFloat(policy["usedCapacity"]))
			if cap > 0 && used+longCreated >= cap {
				continue
			}
			item := map[string]any{}
			for k, v := range source {
				item[k] = v
			}
			item["id"] = s.Store.ID("memory_long")
			item["layer"] = "long_term"
			item["scope"] = "workspace"
			item["title"] = coalesce(str(source["title"]), "工作记忆") + " · 日结经验"
			item["content"] = "经每日提炼的可复用经验：" + str(source["content"])
			item["status"] = "active"
			delete(item, "expiresAt")
			item["createdAt"] = nowStr
			item["updatedAt"] = nowStr
			s.Store.MemoryRecords = append([]map[string]any{item}, s.Store.MemoryRecords...)
			longCreated++
		}
	}

	if policy["longToKnowledgeEnabled"] == true {
		for _, source := range s.Store.MemoryRecords {
			if str(source["workspaceId"]) != ws || str(source["layer"]) != "long_term" || str(source["status"]) != "active" {
				continue
			}
			if toFloat(source["confidence"]) < minConf {
				continue
			}
			if hasPendingCand(str(source["id"])) {
				continue
			}
			summary := str(source["content"])
			if len([]rune(summary)) > 180 {
				summary = string([]rune(summary)[:180])
			}
			cand := map[string]any{
				"id": s.Store.ID("memory_candidate"), "workspaceId": ws, "memoryId": source["id"],
				"title": coalesce(str(source["title"]), "长期记忆"), "summary": summary,
				"classification":      coalesce(str(source["classification"]), "internal"),
				"sourceCorrelationId": coalesce(str(source["correlationId"]), s.Store.ID("memory_corr")),
				"status":              "pending_review", "submittedAt": nowStr,
			}
			s.Store.MemoryCands = append([]map[string]any{cand}, s.Store.MemoryCands...)
			source["status"] = "pending_review"
			source["updatedAt"] = nowStr
			candidatesCreated++
		}
	}

	s.recountLongTermCapacityLocked(ws)
	s.appendMemoryAuditLocked(ws, id.Name, "执行每日渐进提炼",
		"短期→工作 "+itoa(workingCreated)+" · 工作→长期 "+itoa(longCreated)+" · 长期→知识候选 "+itoa(candidatesCreated),
		"success", "")
	go s.persistMemory()
	return map[string]any{
		"scheduledFor":      coalesce(str(policy["dailyRefinementTime"]), "02:00"),
		"workingCreated":    workingCreated,
		"longCreated":       longCreated,
		"candidatesCreated": candidatesCreated,
	}, nil
}

func (s *Server) getMemoryPolicy(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.memoryPolicyFor(ws), nil
}

func (s *Server) patchMemoryPolicy(r *http.Request) (any, error) {
	id, err := s.requireMemoryGovernance(r, "更新记忆策略")
	if err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	p := s.Store.MemoryPolicies[ws]
	if p == nil {
		p = defaultMemoryPolicy(ws)
		s.Store.MemoryPolicies[ws] = p
	}
	for k, v := range body {
		if k == "workspaceId" || k == "usedCapacity" {
			continue
		}
		p[k] = v
	}
	p["workspaceId"] = ws
	s.recountLongTermCapacityLocked(ws)
	s.appendMemoryAuditLocked(ws, id.Name, "更新记忆策略", "记忆策略", "success", "")
	go s.persistMemory()
	return p, nil
}

func (s *Server) listMemoryAudits(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	var out []map[string]any
	for _, a := range s.Store.MemoryAudits {
		if str(a["workspaceId"]) == ws {
			out = append(out, a)
		}
	}
	if out == nil {
		out = []map[string]any{}
	}
	return store.DedupeMapsByID(out), nil
}

// ---- Mem5: digital-employee identity profiles ----

func (s *Server) identityStore() *memid.Store {
	if s.IdentityProfiles == nil {
		s.IdentityProfiles = memid.NewStore()
	}
	return s.IdentityProfiles
}

func (s *Server) listMemoryIdentity(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	if _, err := s.requireMemoryGovernance(r, "查看身份画像"); err != nil {
		return nil, err
	}
	return s.identityStore().ListAll(ws), nil
}

func (s *Server) upsertMemoryIdentity(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	if _, err := s.requireMemoryGovernance(r, "写入身份画像"); err != nil {
		return nil, err
	}
	body, err := decodeMap(r)
	if err != nil {
		return nil, err
	}
	de := strings.TrimSpace(str(body["digitalPartnerId"]))
	if de == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_IDENTITY_DE_REQUIRED: 必须提供 digitalPartnerId")
	}
	profile := memid.Profile{
		WorkspaceID:        ws,
		DigitalPartnerID:  de,
		PreferredName:      strings.TrimSpace(str(body["preferredName"])),
		Locale:             strings.TrimSpace(str(body["locale"])),
		PrimaryLanguage:    strings.TrimSpace(str(body["primaryLanguage"])),
		CommunicationStyle: strings.TrimSpace(str(body["communicationStyle"])),
		HardNo:             stringSlice(body["hardNo"]),
		CustomFacts:        stringSlice(body["customFacts"]),
	}
	profile.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := s.identityStore().Set(profile); err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, err.Error())
	}
	s.Store.Lock()
	s.appendMemoryAuditLocked(ws, id.Name, "写入身份画像", de, "success", "")
	s.Store.Unlock()
	return profile, nil
}

func (s *Server) deleteMemoryIdentity(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	ws := s.workspaceID(r)
	if _, err := s.requireMemoryGovernance(r, "删除身份画像"); err != nil {
		return nil, err
	}
	de := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/memory/identity/"))
	if de == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_IDENTITY_DE_REQUIRED: 路径缺少 digitalPartnerId")
	}
	if err := s.identityStore().Delete(ws, de); err != nil {
		return nil, apperr.NotFoundErr("memory.identity_not_found", "身份画像不存在")
	}
	s.Store.Lock()
	s.appendMemoryAuditLocked(ws, id.Name, "删除身份画像", de, "success", "")
	s.Store.Unlock()
	return map[string]any{"deleted": de}, nil
}

type runtimeMemoryInput struct {
	WorkspaceID       string
	OwnerID           string
	OwnerName         string
	DigitalPartnerID string
	Title             string
	Content           string
	SourceType        string
	SourceID          string
	CorrelationID     string
	Layer             string // short_term | working
	Scope             string
	Classification    string
	Confidence        float64
}

// IngestRuntimeMemory writes a controlled runtime memory (short_term / working).
func (s *Server) IngestRuntimeMemory(in runtimeMemoryInput) (map[string]any, error) {
	s.Store.Lock()
	defer s.Store.Unlock()
	item, err := s.ingestRuntimeMemoryLocked(in)
	if err != nil {
		return nil, err
	}
	go s.persistMemory()
	return item, nil
}

// ingestRuntimeMemoryLocked requires Store.Lock held by caller.
func (s *Server) ingestRuntimeMemoryLocked(in runtimeMemoryInput) (map[string]any, error) {
	title := strings.TrimSpace(in.Title)
	content := strings.TrimSpace(in.Content)
	if title == "" || content == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_INVALID: 标题与内容不能为空")
	}
	layer := coalesce(in.Layer, "short_term")
	if layer != "short_term" && layer != "working" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_LAYER_INVALID: 运行时仅可写入短期或工作记忆")
	}
	ws := coalesce(in.WorkspaceID, "w1")
	policy := s.memoryPolicyFor(ws)
	if s.Store.MemoryPolicies[ws] == nil {
		s.Store.MemoryPolicies[ws] = policy
	}
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)
	scope := coalesce(in.Scope, "user")
	if layer == "working" && scope == "user" {
		scope = "team"
	}
	conf := in.Confidence
	if conf <= 0 {
		conf = 0.8
	}
	item := map[string]any{
		"id": s.Store.ID("memory"), "workspaceId": ws, "ownerId": coalesce(in.OwnerID, "system"),
		"digitalPartnerId": in.DigitalPartnerID, "layer": layer, "scope": scope,
		"title": truncateRunes(title, 80), "content": truncateRunes(content, 2000),
		"classification": coalesce(in.Classification, "internal"),
		"sourceType":     coalesce(in.SourceType, "conversation"), "sourceId": coalesce(in.SourceID, "runtime"),
		"correlationId": coalesce(in.CorrelationID, s.Store.ID("memory_corr")), "confidence": conf,
		"status": "active", "createdAt": nowStr, "updatedAt": nowStr,
	}
	if layer == "short_term" {
		hours := int(toFloat(policy["shortTermTtlHours"]))
		if hours <= 0 {
			hours = 24
		}
		item["expiresAt"] = now.Add(time.Duration(hours) * time.Hour).Format(time.RFC3339)
	} else {
		days := int(toFloat(policy["workingMemoryTtlDays"]))
		if days <= 0 {
			days = 30
		}
		item["expiresAt"] = now.Add(time.Duration(days) * 24 * time.Hour).Format(time.RFC3339)
	}
	s.Store.MemoryRecords = append([]map[string]any{item}, s.Store.MemoryRecords...)
	s.appendMemoryAuditLocked(ws, coalesce(in.OwnerName, "系统"), "写入记忆", str(item["title"]), "success", str(item["correlationId"]))
	return item, nil
}

func hasWorkingDreamCompressLocked(records []map[string]any, ws, sourceID string) bool {
	if sourceID == "" {
		return false
	}
	for _, m := range records {
		if str(m["workspaceId"]) == ws && str(m["layer"]) == "working" && str(m["status"]) == "active" &&
			str(m["sourceId"]) == sourceID && str(m["sourceType"]) == "dream_compress" {
			return true
		}
	}
	return false
}
