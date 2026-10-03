package memory

import (
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listMemoryCandidates → GET /api/memory/candidates
// Lists pending_review / approved / rejected candidates for the workspace,
// filtered by memoryCanRead against the source memory record's
// classification (so confidential candidates stay hidden from non-owners).
func (s *Service) listMemoryCandidates(r *http.Request) any {
	ws := s.workspaceID(r)
	id := s.identityFrom(r.Context())
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
	return out
}

// memoryCandidateActionAligned → POST /api/memory/candidates/{id}/{approve|reject|promote}
// "promote" is the legacy alias for "approve" kept for backward compat.
// Approving creates a draft knowledge package + appends a knowledge audit
// row; the parent memory record flips to status="promoted". Rejecting
// just flips the candidate status and restores the parent record to
// "active".
func (s *Service) memoryCandidateActionAligned(r *http.Request) (any, error) {
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
		pkgs := s.knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"])
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

// memoryCandidateAction keeps the legacy promote path for callers that
// still hit it directly in tests (mirrors the legacy shim that wrapped
// memoryCandidateActionAligned).
func (s *Service) memoryCandidateAction(r *http.Request) (any, error) {
	return s.memoryCandidateActionAligned(r)
}