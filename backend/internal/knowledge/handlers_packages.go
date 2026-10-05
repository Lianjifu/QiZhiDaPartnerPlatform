package knowledge

import (
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// CreateKnowledgePackage → POST /api/knowledge/packages
func (s *Service) CreateKnowledgePackage(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "知识包名称必填")
	}
	ws := s.Deps.WorkspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)
	ver := map[string]any{
		"id": s.Store.ID("kpv"), "version": "0.1.0", "status": "draft",
		"indexVersion": "idx-0", "qualityScore": 0, "changeSummary": "创建知识包",
	}
	pkg := map[string]any{
		"id": s.Store.ID("pkg"), "workspaceId": ws, "name": name,
		"description":    coalesce(str(body["description"]), ""),
		"domain":         coalesce(str(body["domain"]), "通用"),
		"classification": coalesce(str(body["classification"]), "internal"),
		"owner":          id.Name, "ownerId": id.ID, "status": "draft",
		"documentCount": 0, "documentIds": []string{}, "consumers": 0,
		"currentVersion": ver, "versions": []map[string]any{ver}, "updatedAt": now,
	}
	s.Store.Lock()
	pkgs := knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"])
	s.Store.KnowledgeExtra["packages"] = append([]map[string]any{pkg}, pkgs...)
	s.appendKnowledgeAuditLocked(ws, id.Name, "创建知识包", name, "success", "")
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return pkg, nil
}

// KnowledgePackageAction → POST /api/knowledge/packages/{id}/{action}
//
// Single dispatcher that handles the four sub-actions:
//   attach   — add doc IDs to the package
//   publish  — bump semver, mark published, gate behind SoD + countersign
//   process  — enqueue a chunking / embedding job
//   delete   — drop the package + cascade clear related control-plane rows
//   update   — name / description / domain / classification
//
// All four actions take the Store write lock (held by defer), perform
// the mutation, and unlock before the background goroutines fan out.
func (s *Service) KnowledgePackageAction(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/knowledge/packages/:id/:action
	if len(parts) < 5 {
		return nil, apperr.BadReq(apperr.BadRequest, "路径无效")
	}
	pkgID, action := parts[3], parts[4]
	ws := s.Deps.WorkspaceID(r)
	body, _ := s.Deps.DecodeMap(r)

	if action == "publish" {
		s.Store.RLock()
		gov, _ := s.Store.KnowledgeExtra["governance"].(map[string]any)
		highRisk := true
		if gov != nil {
			if v, ok := gov["highRiskChangeApproval"].(bool); ok {
				highRisk = v
			}
		}
		eval, _ := s.Store.KnowledgeExtra["eval"].(map[string]any)
		pkgStatus, pkgSubmitter := "", ""
		for _, p := range knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"]) {
			if str(p["id"]) == pkgID && (str(p["workspaceId"]) == "" || str(p["workspaceId"]) == ws) {
				pkgStatus = str(p["status"])
				pkgSubmitter = str(p["requestedById"])
				break
			}
		}
		s.Store.RUnlock()
		if highRisk {
			// 首提进入待审批时不要把申请人同时填成批准人，否则会误触 SoD。
			in := policyInput(id.ID, id.ID)
			if pkgStatus == "pending_approval" || pkgStatus == "pending_countersign" {
				in.ApproverID = id.ID
				if pkgSubmitter != "" {
					in.SubmitterID = pkgSubmitter
				}
			}
			if err := s.Deps.EvaluateWrite(r, "knowledge", "publish", in); err != nil && id.Role != "admin" {
				return nil, err
			}
		}
		if eval != nil {
			recall := toFloat(eval["recall"])
			if recall <= 0 {
				recall = toFloat(eval["recallAtK"])
				if recall > 0 && recall <= 1 {
					recall *= 100
				}
			}
			if recall > 0 && recall < 50 {
				return nil, apperr.BadReq(apperr.BadRequest, "评测召回率过低，请先通过评测门禁后再发布")
			}
		}
	}

	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	pkgs := knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"])
	var pkg map[string]any
	idx := -1
	for i, p := range pkgs {
		if str(p["id"]) == pkgID && (str(p["workspaceId"]) == "" || str(p["workspaceId"]) == ws) {
			pkg = p
			idx = i
			break
		}
	}
	if pkg == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "知识包不存在")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	switch action {
	case "attach":
		ids := stringSlice(body["docIds"])
		if len(ids) == 0 {
			return nil, apperr.BadReq(apperr.BadRequest, "请至少选择一篇文档")
		}
		added := s.attachDocsToPackageLocked(ws, pkgID, ids, true)
		if added == 0 {
			// Idempotent: already attached members still succeed.
			existing := map[string]struct{}{}
			for _, mid := range packageDocumentIDs(pkg) {
				existing[mid] = struct{}{}
			}
			allPresent := true
			for _, docID := range ids {
				if docID == "" {
					continue
				}
				if _, ok := existing[docID]; !ok {
					allPresent = false
					break
				}
			}
			if !allPresent {
				return nil, apperr.BadReq(apperr.BadRequest, "未找到可纳管的工作区文档")
			}
		}
		for _, p := range knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"]) {
			if str(p["id"]) == pkgID {
				pkg = p
				break
			}
		}
		s.appendKnowledgeAuditLocked(ws, id.Name, "纳管知识文档", str(pkg["name"]), "success", fmt.Sprintf("added=%d", added))
		unlocked = true
		s.Store.Unlock()
		go func() { s.Store.Persist("knowledge_docs"); s.persistKnowledgeExtra() }()
		return pkg, nil
	case "publish":
		if str(pkg["status"]) == "archived" || str(pkg["status"]) == "deprecated" {
			return nil, apperr.BadReq(apperr.BadRequest, "已归档/废弃的知识包不可发布")
		}
		if s.Deps.RequiresPeerApprovalGate != nil && s.Deps.RequiresPeerApprovalGate(id) && str(pkg["status"]) != "pending_approval" && str(pkg["status"]) != "pending_countersign" {
			if err := s.requirePackageEvalSetLocked(ws, pkgID); err != nil {
				return nil, err
			}
			pkg["status"] = "pending_approval"
			pkg["requestedBy"] = id.Name
			pkg["requestedById"] = id.ID
			pkg["requestedAt"] = time.Now().UTC().Format(time.RFC3339)
			s.Store.KnowledgeExtra["packages"] = pkgs
			s.appendKnowledgeAuditLocked(ws, id.Name, "申请发布知识包", str(pkg["name"]), "success", "待管理员审批")
			go s.persistKnowledgeExtra()
			return pkg, nil
		}
		if s.Deps.RequireProductionDualApproval != nil {
			if err := s.Deps.RequireProductionDualApproval(str(pkg["requestedById"]), str(pkg["requestedBy"]), id, "知识发布"); err != nil {
				return nil, err
			}
		}
		if err := s.requirePackageEvalSetLocked(ws, pkgID); err != nil {
			return nil, err
		}
		if s.Deps.MaybeHoldForCountersign != nil {
			if hold, err := s.Deps.MaybeHoldForCountersign(pkg, id, str(pkg["classification"]), "知识发布"); err != nil {
				return nil, err
			} else if hold {
				s.Store.KnowledgeExtra["packages"] = pkgs
				s.appendKnowledgeAuditLocked(ws, id.Name, "知识发布会签待副署", str(pkg["name"]), "success", "pending_countersign")
				go s.persistKnowledgeExtra()
				return pkg, nil
			}
		}
		memberIDs := packageDocumentIDs(pkg)
		if len(memberIDs) == 0 {
			// Fallback: docs stamped with packageId (legacy seeds / uploads).
			for _, d := range s.Store.KnowledgeDocs {
				if str(d["workspaceId"]) == ws && str(d["packageId"]) == pkgID {
					memberIDs = append(memberIDs, str(d["id"]))
				}
			}
			pkg["documentIds"] = memberIDs
			syncPackageDocumentCount(pkg)
		}
		ready := 0
		memberSet := map[string]struct{}{}
		for _, mid := range memberIDs {
			memberSet[mid] = struct{}{}
		}
		for _, d := range s.Store.KnowledgeDocs {
			docID := str(d["id"])
			if _, ok := memberSet[docID]; !ok || str(d["workspaceId"]) != ws {
				continue
			}
			st := str(d["status"])
			if st == "ready" || st == "published" {
				ready++
			}
		}
		if ready == 0 {
			return nil, apperr.BadReq(apperr.BadRequest, "知识包内无可发布文档，请先纳管并完成索引")
		}
		prev, _ := pkg["currentVersion"].(map[string]any)
		prevVer := "0.1.0"
		if prev != nil {
			prevVer = coalesce(str(prev["version"]), "0.1.0")
			prev["status"] = "deprecated"
		}
		verName := bumpSemverPatch(prevVer)
		next := map[string]any{
			"id": s.Store.ID("kpv"), "version": verName, "status": "published",
			"publishedAt": now, "qualityScore": 85, "changeSummary": coalesce(str(body["changeSummary"]), "发布版本"),
			"indexVersion": "idx-" + strings.ReplaceAll(strings.TrimPrefix(strings.TrimPrefix(verName, "v"), "V"), ".", ""),
		}
		pkg["currentVersion"] = next
		pkg["status"] = "published"
		pkg["updatedAt"] = now
		syncPackageDocumentCount(pkg)
		vers := knowledgeSliceMaps(pkg["versions"])
		// Replace previous current entry status if present, then prepend next.
		for i, v := range vers {
			if prev != nil && str(v["id"]) == str(prev["id"]) {
				vers[i] = prev
			}
		}
		pkg["versions"] = append([]map[string]any{next}, vers...)
		pkgs[idx] = pkg
		s.Store.KnowledgeExtra["packages"] = pkgs
		for _, d := range s.Store.KnowledgeDocs {
			docID := str(d["id"])
			if _, ok := memberSet[docID]; !ok || str(d["workspaceId"]) != ws {
				continue
			}
			if str(d["status"]) == "ready" {
				d["status"] = "published"
			}
		}
		s.appendKnowledgeAuditLocked(ws, id.Name, "发布知识包", str(pkg["name"]), "success", verName)
		unlocked = true
		s.Store.Unlock()
		go func() { s.Store.Persist("knowledge_docs"); s.persistKnowledgeExtra(); _, _ = s.SyncRAGIndexStrict(ws) }()
		return pkg, nil
	case "process":
		memberIDs := packageDocumentIDs(pkg)
		if len(memberIDs) == 0 {
			for _, d := range s.Store.KnowledgeDocs {
				if str(d["workspaceId"]) == ws && str(d["packageId"]) == pkgID {
					memberIDs = append(memberIDs, str(d["id"]))
				}
			}
			pkg["documentIds"] = memberIDs
			syncPackageDocumentCount(pkg)
		}
		if len(memberIDs) == 0 {
			return nil, apperr.BadReq(apperr.BadRequest, "知识包尚未纳管文档，无法启动加工")
		}
		strategy := coalesce(str(body["strategy"]), "semantic")
		job := map[string]any{
			"id": s.Store.ID("kj"), "workspaceId": ws, "packageId": pkgID,
			"source": str(pkg["name"]), "strategy": strategy, "status": "queued",
			"documentCount": len(memberIDs), "chunkCount": 0,
			"indexVersion": "idx-building", "startedAt": now,
		}
		jobs := knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
		s.Store.KnowledgeExtra["processingJobs"] = append([]map[string]any{job}, jobs...)
		pkg["status"] = "review"
		pkg["updatedAt"] = now
		pkgs[idx] = pkg
		s.Store.KnowledgeExtra["packages"] = pkgs
		s.appendKnowledgeAuditLocked(ws, id.Name, "启动知识包加工", str(pkg["name"]), "success", strategy)
		go s.RunKnowledgeJob(str(job["id"]))
		go s.persistKnowledgeExtra()
		return job, nil
	case "delete":
		if intFrom(pkg["consumers"]) > 0 {
			return nil, apperr.BadReq(apperr.BadRequest, "知识包仍有运行时引用方，请先解除绑定再删除")
		}
		bindings := knowledgeSliceMaps(s.Store.KnowledgeExtra["bindings"])
		for _, b := range bindings {
			if str(b["packageId"]) == pkgID && (str(b["workspaceId"]) == "" || str(b["workspaceId"]) == ws) {
				return nil, apperr.BadReq(apperr.BadRequest, "知识包仍有运行时绑定，请先解除绑定再删除")
			}
		}
		kept := make([]map[string]any, 0, len(pkgs)-1)
		for i, p := range pkgs {
			if i == idx {
				continue
			}
			kept = append(kept, p)
		}
		s.Store.KnowledgeExtra["packages"] = kept
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["packageId"]) == pkgID && str(d["workspaceId"]) == ws {
				delete(d, "packageId")
			}
		}
		filterExtra := func(key string) {
			items := knowledgeSliceMaps(s.Store.KnowledgeExtra[key])
			out := make([]map[string]any, 0, len(items))
			for _, item := range items {
				if str(item["packageId"]) == pkgID {
					continue
				}
				out = append(out, item)
			}
			s.Store.KnowledgeExtra[key] = out
		}
		filterExtra("processingJobs")
		filterExtra("retrievalProfiles")
		filterExtra("evaluations")
		filterExtra("sources")
		s.appendKnowledgeAuditLocked(ws, id.Name, "删除知识包", str(pkg["name"]), "success", pkgID)
		unlocked = true
		s.Store.Unlock()
		go func() { s.Store.Persist("knowledge_docs"); s.persistKnowledgeExtra() }()
		return map[string]any{"id": pkgID, "deleted": true}, nil
	case "update":
		if name := strings.TrimSpace(str(body["name"])); name != "" {
			pkg["name"] = name
		}
		if _, ok := body["description"]; ok {
			pkg["description"] = str(body["description"])
		}
		if domain := strings.TrimSpace(str(body["domain"])); domain != "" {
			pkg["domain"] = domain
		}
		if class := strings.TrimSpace(str(body["classification"])); class != "" {
			pkg["classification"] = class
		}
		pkg["updatedAt"] = now
		pkgs[idx] = pkg
		s.Store.KnowledgeExtra["packages"] = pkgs
		s.appendKnowledgeAuditLocked(ws, id.Name, "更新知识包资料", str(pkg["name"]), "success", "")
		go s.persistKnowledgeExtra()
		return pkg, nil
	default:
		return nil, apperr.NotFoundErr(apperr.NotFound, "未知动作")
	}
}

// requirePackageEvalSetLocked — guard that the package has been through
// the evaluation gate (recall ≥ QZDA_EVAL_RECALL_MIN OR pending approval
// bypass). In production this is the SoD-adjacent gate that prevents
// pushing a knowledge package to /api/copilot until the eval set
// proves recall ≥ 70%. Mirrors the legacy
// server.requirePackageEvalSetLocked (which lived in eval_gate.go).
func (s *Service) requirePackageEvalSetLocked(ws, pkgID string) error {
	prod := false
	if s.Deps.ProductionLikeEnv != nil {
		prod = s.Deps.ProductionLikeEnv()
	}
	if !prod {
		return nil
	}
	min := evalRecallMin()
	if min <= 0 {
		return nil
	}
	pkgID = strings.TrimSpace(pkgID)
	bestRecall := -1.0
	passed := false
	for _, ev := range knowledgeSliceMaps(s.Store.KnowledgeExtra["evaluations"]) {
		if str(ev["workspaceId"]) != "" && str(ev["workspaceId"]) != ws {
			continue
		}
		if pkgID != "" && str(ev["packageId"]) != pkgID {
			continue
		}
		recall := toFloat(ev["recallAtK"])
		if recall > 1 {
			recall = recall / 100
		}
		if recall > bestRecall {
			bestRecall = recall
		}
		if str(ev["status"]) == "passed" && recall >= min {
			passed = true
		}
	}
	if !passed {
		if bestRecall < 0 {
			return apperr.BadReq(apperr.EvalSetRequired, "生产发布须先通过评测集")
		}
		return apperr.BadReq(apperr.EvalSetFailed, "评测集未达门禁，无法发布")
	}
	return nil
}

// evalRecallMin returns the minimum recall (0..1) the eval gate demands
// in production. Reads QZDA_EVAL_RECALL_MIN; defaults to 0.7 in
// production, 0 elsewhere (gate skipped). Mirrors the legacy
// server.evalRecallMin in eval_gate.go.
func evalRecallMin() float64 {
	v := strings.TrimSpace(os.Getenv("QZDA_EVAL_RECALL_MIN"))
	if v == "" {
		if isProdEnv() {
			return 0.7
		}
		return 0
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0.7
	}
	if n > 1 {
		n = n / 100
	}
	return n
}

// isProdEnv reports whether QZDA_ENV is "production" or "prod". The
// full server-side productionLikeEnv() also considers other signals
// (AUTH_REQUIRED, ...); for the eval gate in production, the env var
// check is sufficient and lets this helper stay inside the
// knowledge package without an extra Deps call.
func isProdEnv() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_ENV"))) {
	case "production", "prod":
		return true
	}
	return false
}

// KnowledgeListFiltered → GET /api/knowledge/packages (and other /api/knowledge/*
// list paths) — read-only listing helper. Used by every /api/knowledge/<key>
// list route where <key> is one of "packages", "sources", "governance",
// "audit", "processingJobs", "retrievalProfiles", "evaluations",
// "graphEntities", "graphRelations", "bindings", "citationTrace",
// "eval", "chunksTop".
func (s *Service) KnowledgeListFiltered(r *http.Request, key string) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeRead(id); err != nil {
		return nil, err
	}
	ws := s.Deps.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	raw, ok := s.Store.KnowledgeExtra[key]
	if !ok || raw == nil {
		if key == "governance" || key == "eval" {
			return map[string]any{}, nil
		}
		return []any{}, nil
	}
	if key == "governance" || key == "eval" {
		if m, ok := raw.(map[string]any); ok {
			if wid := str(m["workspaceId"]); wid != "" && wid != ws {
				return map[string]any{"workspaceId": ws}, nil
			}
			cp := map[string]any{}
			for k, v := range m {
				cp[k] = v
			}
			if key == "eval" {
				return normalizeEvalMetrics(cp), nil
			}
			return normalizeGovernance(cp, ws), nil
		}
		return raw, nil
	}
	items := knowledgeSliceMaps(raw)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if wid := str(item["workspaceId"]); wid != "" && wid != ws {
			continue
		}
		cp := map[string]any{}
		for k, v := range item {
			cp[k] = v
		}
		switch key {
		case "sources":
			cp = normalizeSourceItem(cp)
		case "citationTrace":
			cp = normalizeCitationTrace(cp)
		case "graphEntities":
			cp = normalizeGraphEntity(cp)
		case "graphRelations":
			cp = normalizeGraphRelation(cp)
		case "evaluations":
			cp = normalizeEvaluationItem(cp)
		case "bindings":
			cp = normalizeBindingItem(cp)
		case "retrievalProfiles":
			cp = normalizeRetrievalProfile(cp)
		}
		out = append(out, cp)
	}
	return out, nil
}

// patchKnowledgeGovernanceAuth → PATCH /api/knowledge/governance
func (s *Service) PatchKnowledgeGovernance(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	ws := s.Deps.WorkspaceID(r)
	s.Store.Lock()
	gov, _ := s.Store.KnowledgeExtra["governance"].(map[string]any)
	if gov == nil {
		gov = map[string]any{}
	}
	gov = normalizeGovernance(gov, ws)
	for k, v := range body {
		gov[k] = v
	}
	gov["workspaceId"] = ws
	s.Store.KnowledgeExtra["governance"] = gov
	s.appendKnowledgeAuditLocked(ws, id.Name, "更新知识治理", "governance", "success", "")
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return gov, nil
}

// --- normalize helpers used by KnowledgeListFiltered ---

// normalizeEvalMetrics fills in defaults for the eval control-plane
// row so the FE never sees `null` for recall / precision / hitRate.
func normalizeEvalMetrics(m map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range m {
		out[k] = v
	}
	recall := toFloat(out["recall"])
	if recall <= 0 {
		if rak := toFloat(out["recallAtK"]); rak > 0 {
			if rak <= 1 {
				recall = rak * 100
			} else {
				recall = rak
			}
		}
	}
	if recall > 0 && recall <= 1 {
		recall = recall * 100
	}
	out["recall"] = recall
	if out["precision"] == nil {
		if ca := toFloat(out["citationAccuracy"]); ca > 0 {
			if ca <= 1 {
				out["precision"] = ca * 100
			} else {
				out["precision"] = ca
			}
		} else {
			out["precision"] = 0
		}
	}
	if out["p95Latency"] == nil {
		out["p95Latency"] = 0
	}
	if out["hitRate"] == nil {
		out["hitRate"] = 0
	}
	return out
}

// normalizeGovernance fills in default policy values (retention 365d,
// sensitive-data detection on, etc.) so PATCH /api/knowledge/governance
// with an empty body still returns a meaningful envelope.
func normalizeGovernance(m map[string]any, ws string) map[string]any {
	out := map[string]any{
		"workspaceId":            ws,
		"sensitiveDataDetection": true,
		"versionRetention":       true,
		"retentionDays":          365,
		"highRiskChangeApproval": true,
		"piiMasking":             true,
	}
	for k, v := range m {
		out[k] = v
	}
	if out["sensitiveDataDetection"] == nil {
		out["sensitiveDataDetection"] = out["piiMasking"]
	}
	if out["retentionDays"] == nil {
		out["retentionDays"] = 365
	}
	if out["highRiskChangeApproval"] == nil {
		out["highRiskChangeApproval"] = true
	}
	return out
}

func normalizeSourceItem(m map[string]any) map[string]any {
	status := str(m["status"])
	switch status {
	case "ready", "healthy":
		m["status"] = "healthy"
	case "syncing", "running":
		m["status"] = "syncing"
	case "attention", "failed", "error":
		m["status"] = "attention"
	default:
		if status == "" {
			m["status"] = "healthy"
		}
	}
	if m["documents"] == nil {
		m["documents"] = 0
	}
	if m["lastSync"] == nil || str(m["lastSync"]) == "" {
		m["lastSync"] = "尚未同步"
	}
	return m
}

func normalizeCitationTrace(m map[string]any) map[string]any {
	if m["citeCount"] == nil {
		m["citeCount"] = intFrom(m["count"])
	}
	if str(m["lastUsed"]) == "" {
		m["lastUsed"] = "—"
	}
	if m["usedBy"] == nil {
		if agent := str(m["agent"]); agent != "" {
			m["usedBy"] = []string{agent}
		} else {
			m["usedBy"] = []string{}
		}
	}
	return m
}

func normalizeGraphEntity(m map[string]any) map[string]any {
	typ := str(m["type"])
	if typ == "" {
		switch str(m["kind"]) {
		case "document", "runbook":
			typ = "runbook"
		case "system", "service":
			typ = "service"
		case "owner", "team":
			typ = "owner"
		case "vulnerability", "cve":
			typ = "vulnerability"
		default:
			typ = "asset"
		}
		m["type"] = typ
	}
	if m["confidence"] == nil {
		m["confidence"] = 0.85
	}
	if str(m["sourceVersion"]) == "" {
		m["sourceVersion"] = "v1"
	}
	return m
}

func normalizeGraphRelation(m map[string]any) map[string]any {
	if str(m["fromId"]) == "" {
		m["fromId"] = coalesce(str(m["from"]), str(m["source"]))
	}
	if str(m["toId"]) == "" {
		m["toId"] = coalesce(str(m["to"]), str(m["target"]))
	}
	rel := str(m["type"])
	switch rel {
	case "depends_on", "impacts", "owned_by", "handled_by", "references":
	case "covers", "related":
		m["type"] = "references"
	default:
		if rel == "" {
			m["type"] = "references"
		}
	}
	if m["confidence"] == nil {
		m["confidence"] = 0.8
	}
	if str(m["sourceVersion"]) == "" {
		m["sourceVersion"] = "v1"
	}
	return m
}

func normalizeEvaluationItem(m map[string]any) map[string]any {
	if m["p95LatencyMs"] == nil {
		m["p95LatencyMs"] = intFrom(m["p95Latency"])
	}
	if str(m["evaluatedAt"]) == "" {
		m["evaluatedAt"] = coalesce(str(m["createdAt"]), time.Now().UTC().Format(time.RFC3339))
	}
	if str(m["baselineVersion"]) == "" {
		m["baselineVersion"] = "baseline"
	}
	if str(m["evaluatedVersion"]) == "" {
		m["evaluatedVersion"] = "candidate"
	}
	if m["mrr"] == nil {
		m["mrr"] = toFloat(m["recallAtK"]) * 0.9
	}
	if m["ndcg"] == nil {
		m["ndcg"] = toFloat(m["recallAtK"]) * 0.95
	}
	st := str(m["status"])
	switch st {
	case "passed", "needs_review", "failed":
	case "completed", "success":
		if toFloat(m["recallAtK"]) >= 0.7 {
			m["status"] = "passed"
		} else {
			m["status"] = "needs_review"
		}
	default:
		if st == "" {
			m["status"] = "needs_review"
		}
	}
	return m
}

func normalizeBindingItem(m map[string]any) map[string]any {
	if str(m["packageName"]) == "" {
		m["packageName"] = coalesce(str(m["packageId"]), "知识包")
	}
	if str(m["packageVersion"]) == "" {
		m["packageVersion"] = "v1"
	}
	if str(m["environment"]) == "" {
		m["environment"] = "production"
	}
	if str(m["noResultPolicy"]) == "" {
		m["noResultPolicy"] = "handoff"
	}
	if str(m["profileId"]) == "" {
		m["profileId"] = "rp-default"
	}
	return m
}

func normalizeRetrievalProfile(m map[string]any) map[string]any {
	if m["retrievalModes"] == nil {
		m["retrievalModes"] = []string{"keyword", "vector"}
	}
	if m["topK"] == nil {
		m["topK"] = 5
	}
	if m["rerankEnabled"] == nil {
		m["rerankEnabled"] = true
	}
	if str(m["noResultPolicy"]) == "" {
		m["noResultPolicy"] = "handoff"
	}
	return m
}

// _ = auth.Identity{} keeps the auth import alive even when this file
// only references id.Role via identityFromCtx callers.
var _ = (*auth.Identity)(nil)
