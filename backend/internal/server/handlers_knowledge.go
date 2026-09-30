package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citationlog"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/eval"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/scope"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func requireKnowledgeRead(id *auth.Identity) error {
	if id == nil || !auth.Has(id, "knowledge.read") {
		return apperr.Forbidden(apperr.KnowledgeReadForbidden, "缺少 knowledge.read")
	}
	return nil
}

func requireKnowledgeWrite(id *auth.Identity) error {
	if id == nil || !auth.Has(id, "knowledge.write") {
		return apperr.Forbidden(apperr.KnowledgeWriteForbidden, "缺少 knowledge.write")
	}
	return nil
}

func (s *Server) persistKnowledgeExtra() {
	s.Store.Persist("knowledge_extra")
}

func (s *Server) appendKnowledgeAuditLocked(ws, actor, action, target, result, reason string) {
	evt := map[string]any{
		"id": s.Store.ID("ka"), "workspaceId": ws, "time": time.Now().UTC().Format(time.RFC3339),
		"actor": actor, "action": action, "target": target, "result": result, "reason": reason,
	}
	arr, _ := s.Store.KnowledgeExtra["audit"].([]map[string]any)
	if arr == nil {
		if raw, ok := s.Store.KnowledgeExtra["audit"].([]any); ok {
			for _, x := range raw {
				if m, ok := x.(map[string]any); ok {
					arr = append(arr, m)
				}
			}
		}
	}
	s.Store.KnowledgeExtra["audit"] = append([]map[string]any{evt}, arr...)
	s.Store.AppendAudit(ws, actor, action, target, result, reason)
}

func knowledgeSliceMaps(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, x := range t {
			if m, ok := x.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func (s *Server) knowledgeExtraFiltered(r *http.Request, key string) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeRead(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
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

func (s *Server) knowledgeBlobDir(ws string) string {
	root := os.Getenv("DE_KNOWLEDGE_BLOB_DIR")
	if root == "" {
		root = filepath.Join("data", "knowledge-blobs")
	}
	return filepath.Join(root, ws)
}

func (s *Server) writeKnowledgeBlob(ws, docID, content string) (string, error) {
	dir := s.knowledgeBlobDir(ws)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, docID+".txt")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func (s *Server) readKnowledgeBlob(path string) string {
	if path == "" {
		return ""
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

func (s *Server) listKnowledgeDocsAuth(r *http.Request) (any, error) {
	if err := requireKnowledgeRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	return s.listKnowledgeDocs(r)
}

func (s *Server) createKnowledgeDocAuth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	title := strings.TrimSpace(str(body["title"]))
	if title == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "文档标题必填")
	}
	ws := s.workspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)
	content := str(body["content"])
	if content == "" {
		content = str(body["snippet"])
	}
	if strings.TrimSpace(content) == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "文档正文不能为空，请上传 Markdown / 文本文件")
	}
	item := map[string]any{
		"id": s.Store.ID("kd"), "workspaceId": ws, "title": title,
		"source":    coalesce(str(body["source"]), "upload"),
		"tags":      body["tags"],
		"fileName":  str(body["fileName"]),
		"status":    "indexing",
		"ownerId":   id.ID,
		"sizeKb":    maxInt(1, len(content)/1024),
		"chunks":    0,
		"citeCount": 0,
		"snippet":   truncateRunes(content, 160),
		"content":   content,
		"createdAt": now,
		"updatedAt": now,
		"quality":   map[string]any{"completeness": 70, "freshness": 90, "citationAccuracy": 80},
	}
	if blobPath, err := s.writeKnowledgeBlob(ws, str(item["id"]), content); err == nil {
		item["blobPath"] = blobPath
		item["blobStatus"] = "stored"
	} else {
		item["blobStatus"] = "failed"
		item["blobError"] = err.Error()
	}
	s.Store.Lock()
	s.Store.KnowledgeDocs = append([]map[string]any{item}, s.Store.KnowledgeDocs...)
	s.appendKnowledgeAuditLocked(ws, id.Name, "上传知识文档", title, "success", "")
	requestedPkg := strings.TrimSpace(str(body["packageId"]))
	pkgID := requestedPkg
	if pkgID == "" {
		pkgID = s.ensureDraftPackageLocked(ws, id.Name)
	} else if !s.packageExistsLocked(ws, pkgID) {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "目标知识包不存在")
	}
	item["packageId"] = pkgID
	s.attachDocsToPackageLocked(ws, pkgID, []string{str(item["id"])}, false)
	job := map[string]any{
		"id": s.Store.ID("kj"), "workspaceId": ws, "packageId": pkgID,
		"source": title, "strategy": "semantic", "status": "queued",
		"documentCount": 1, "chunkCount": 0, "indexVersion": "idx-pending",
		"startedAt": now, "docId": item["id"],
	}
	jobs := knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
	s.Store.KnowledgeExtra["processingJobs"] = append([]map[string]any{job}, jobs...)
	s.Store.Unlock()
	s.Store.Persist("knowledge_docs")
	s.persistKnowledgeExtra()
	go s.runKnowledgeJob(str(job["id"]))
	return item, nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if n <= 0 || len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

func (s *Server) ensureDraftPackageLocked(ws, owner string) string {
	pkgs := knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"])
	// Prefer an editable package so uploads do not silently attach to a published delivery unit.
	for _, status := range []string{"draft", "review"} {
		for _, p := range pkgs {
			if str(p["workspaceId"]) == ws && str(p["status"]) == status {
				return str(p["id"])
			}
		}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	ver := map[string]any{
		"id": s.Store.ID("kpv"), "version": "0.1.0", "status": "draft",
		"indexVersion": "idx-0", "qualityScore": 0, "changeSummary": "初始草稿",
	}
	pkg := map[string]any{
		"id": s.Store.ID("pkg"), "workspaceId": ws, "name": "默认知识包",
		"description": "自动创建的工作区知识包", "domain": "通用",
		"classification": "internal", "owner": owner, "ownerId": "",
		"status": "draft", "documentCount": 0, "documentIds": []string{}, "consumers": 0,
		"currentVersion": ver, "versions": []map[string]any{ver},
		"updatedAt": now,
	}
	s.Store.KnowledgeExtra["packages"] = append([]map[string]any{pkg}, pkgs...)
	return str(pkg["id"])
}

func (s *Server) packageExistsLocked(ws, pkgID string) bool {
	for _, p := range knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"]) {
		if str(p["id"]) == pkgID && (str(p["workspaceId"]) == "" || str(p["workspaceId"]) == ws) {
			return true
		}
	}
	return false
}

func packageDocumentIDs(pkg map[string]any) []string {
	return stringSlice(pkg["documentIds"])
}

func syncPackageDocumentCount(pkg map[string]any) {
	ids := packageDocumentIDs(pkg)
	pkg["documentIds"] = ids
	pkg["documentCount"] = len(ids)
}

func bumpSemverPatch(version string) string {
	raw := strings.TrimSpace(version)
	if raw == "" {
		return "0.1.1"
	}
	prefix := ""
	body := raw
	if strings.HasPrefix(body, "v") || strings.HasPrefix(body, "V") {
		prefix = body[:1]
		body = body[1:]
	}
	parts := strings.Split(body, ".")
	nums := make([]int, 0, 3)
	ok := true
	for _, p := range parts {
		n := 0
		if _, err := fmt.Sscanf(p, "%d", &n); err != nil {
			ok = false
			break
		}
		nums = append(nums, n)
	}
	if !ok || len(nums) == 0 {
		return prefix + body + ".1"
	}
	for len(nums) < 3 {
		nums = append(nums, 0)
	}
	nums[len(nums)-1]++
	out := make([]string, len(nums))
	for i, n := range nums {
		out[i] = fmt.Sprintf("%d", n)
	}
	return prefix + strings.Join(out, ".")
}

// attachDocsToPackageLocked merges doc IDs into the package and stamps packageId on docs.
// When markReview is true and the package was published, status becomes review.
func (s *Server) attachDocsToPackageLocked(ws, pkgID string, docIDs []string, markReview bool) int {
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
		return 0
	}
	existing := map[string]struct{}{}
	merged := packageDocumentIDs(pkg)
	for _, id := range merged {
		existing[id] = struct{}{}
	}
	added := 0
	want := map[string]struct{}{}
	for _, id := range docIDs {
		if id != "" {
			want[id] = struct{}{}
		}
	}
	for _, d := range s.Store.KnowledgeDocs {
		docID := str(d["id"])
		if _, ok := want[docID]; !ok || str(d["workspaceId"]) != ws {
			continue
		}
		d["packageId"] = pkgID
		if _, seen := existing[docID]; !seen {
			merged = append(merged, docID)
			existing[docID] = struct{}{}
			added++
		}
	}
	pkg["documentIds"] = merged
	syncPackageDocumentCount(pkg)
	pkg["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	if markReview && added > 0 && str(pkg["status"]) == "published" {
		pkg["status"] = "review"
	}
	pkgs[idx] = pkg
	s.Store.KnowledgeExtra["packages"] = pkgs
	return added
}

func (s *Server) knowledgeDocDetailAuth(r *http.Request) (any, error) {
	if err := requireKnowledgeRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/knowledge/doc/")
	id = strings.Trim(id, "/")
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["id"]) != id {
			continue
		}
		if str(d["workspaceId"]) != ws {
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "文档不在当前工作区")
		}
		cp := map[string]any{}
		for k, v := range d {
			cp[k] = v
		}
		content := coalesce(str(d["content"]), str(d["snippet"]))
		if blob := s.readKnowledgeBlob(str(d["blobPath"])); blob != "" {
			content = blob
		}
		if content == "" {
			content = coalesce(str(d["title"]), "（空文档）")
		}
		cp["content"] = content
		if cp["quality"] == nil {
			cp["quality"] = map[string]any{"completeness": 80, "freshness": 80, "citationAccuracy": 80}
		}
		if cp["versions"] == nil {
			cp["versions"] = []map[string]any{}
		}
		if cp["size"] == nil {
			cp["size"] = fmt.Sprintf("%d KB", intFrom(cp["sizeKb"]))
		}
		if str(cp["chunkStrategy"]) == "" {
			cp["chunkStrategy"] = "结构切片"
		}
		if str(cp["version"]) == "" {
			cp["version"] = "v1.0"
		}
		return cp, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "文档不存在")
}

func (s *Server) reindexKnowledgeAuth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	n, err := s.syncRAGIndexStrict(ws)
	s.Store.Lock()
	result := "success"
	reason := fmt.Sprintf("affected=%d", n)
	if err != nil {
		result = "failed"
		reason = err.Error()
		s.appendKnowledgeAuditLocked(ws, id.Name, "重建知识索引", ws, result, reason)
		s.Store.Unlock()
		s.persistKnowledgeExtra()
		return nil, apperr.BadReq(apperr.BadRequest, "索引重建失败: "+err.Error())
	}
	s.appendKnowledgeAuditLocked(ws, id.Name, "重建知识索引", ws, result, reason)
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return map[string]any{"status": "ok", "affected": n}, nil
}

func (s *Server) syncRAGIndexStrict(workspaceID string) (int, error) {
	client := &http.Client{Timeout: 3 * time.Second}
	s.Store.RLock()
	var docs []map[string]any
	for _, d := range s.Store.KnowledgeDocs {
		st := str(d["status"])
		if str(d["workspaceId"]) == workspaceID && (st == "published" || st == "ready") {
			docs = append(docs, map[string]any{
				"docId": d["id"], "title": d["title"],
				"snippet": coalesce(str(d["snippet"]), coalesce(str(d["content"]), "已发布："+str(d["title"]))),
				"score":   0.9, "status": "published",
			})
		}
	}
	s.Store.RUnlock()
	if len(docs) == 0 {
		return 0, nil
	}
	payload, _ := json.Marshal(map[string]any{"docs": docs, "workspaceId": workspaceID})
	resp, err := client.Post(s.RAGURL+"/v1/ingest", "application/json", strings.NewReader(string(payload)))
	if err != nil {
		resp, err = client.Post(s.RAGURL+"/v1/sync", "application/json", strings.NewReader(string(payload)))
	}
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("rag status %d", resp.StatusCode)
	}
	var out struct {
		Indexed int `json:"indexed"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.Indexed > 0 {
		return out.Indexed, nil
	}
	return len(docs), nil
}

func (s *Server) knowledgeRetrieveAuth(r *http.Request) (any, error) {
	if err := requireKnowledgeRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	corr := coalesce(str(body["correlationId"]), r.Header.Get("x-correlation-id"))
	if corr == "" {
		corr = s.Store.ID("corr")
	}
	raw, err := s.retrievePublishedNormalized(r, body, corr)
	return raw, err
}

func (s *Server) retrievePublishedNormalized(r *http.Request, body map[string]any, corr string) (any, error) {
	query := str(body["query"])
	ws := s.workspaceID(r)
	start := time.Now()
	var results []map[string]any
	sidecarOK := false
	if hits := s.callRAGPublished(query, ws, corr); hits != nil {
		sidecarOK = true
		if m, ok := hits.(map[string]any); ok {
			results = filterRetrieveToPublished(s, ws, normalizeRetrieveHitList(m["results"]))
		}
	}
	publishedOnly := 0
	if len(results) == 0 {
		s.Store.RLock()
		idx := 1
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["workspaceId"]) != ws {
				continue
			}
			st := str(d["status"])
			// ready = 控制面可读；indexing/draft 等不得进入 retrieve
			if st != "published" && st != "ready" {
				continue
			}
			if st == "published" {
				publishedOnly++
			}
			title := str(d["title"])
			if query != "" && !strings.Contains(title, query) && !strings.Contains(str(d["snippet"]), query) && !strings.Contains(str(d["content"]), query) {
				continue
			}
			text := coalesce(str(d["snippet"]), coalesce(str(d["content"]), "已发布知识命中："+title))
			results = append(results, map[string]any{
				"idx": idx, "source": coalesce(str(d["source"]), title), "page": nil,
				"score": 0.8, "docId": d["id"], "text": text,
			})
			idx++
		}
		s.Store.RUnlock()
	}
	s.recordUsageWS(ws, "rag", 1, corr)
	latency := time.Since(start).Milliseconds()
	out := map[string]any{
		"query": query, "results": results, "backend": "knowledge-control-plane", "correlationId": corr,
		"metrics": map[string]any{
			"recall": float64(minInt(100, len(results)*20)), "precision": 80, "p95Latency": latency, "hitRate": len(results),
		},
	}
	if !sidecarOK && productionLikeEnv() && publishedOnly > 0 {
		out["degraded"] = true
		out["backend"] = "knowledge-control-plane-degraded"
		out["code"] = string(apperr.RuntimeUnavailable)
		out["warning"] = "向量检索不可用，已降级到已发布关键词检索"
	}
	return out, nil
}

func filterRetrieveToPublished(s *Server, workspaceID string, hits []map[string]any) []map[string]any {
	if len(hits) == 0 {
		return hits
	}
	s.Store.RLock()
	allowed := map[string]struct{}{}
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != workspaceID {
			continue
		}
		st := str(d["status"])
		if st == "published" || st == "ready" {
			allowed[str(d["id"])] = struct{}{}
		}
	}
	s.Store.RUnlock()
	out := make([]map[string]any, 0, len(hits))
	for _, hit := range hits {
		id := coalesce(str(hit["docId"]), str(hit["id"]))
		if _, ok := allowed[id]; ok {
			out = append(out, hit)
		}
	}
	return out
}

func normalizeRetrieveHitList(v any) []map[string]any {
	items := knowledgeSliceMaps(v)
	out := make([]map[string]any, 0, len(items))
	for i, item := range items {
		idx := i + 1
		if n := intFrom(item["idx"]); n > 0 {
			idx = n
		}
		text := coalesce(str(item["text"]), coalesce(str(item["snippet"]), str(item["title"])))
		source := coalesce(str(item["source"]), coalesce(str(item["title"]), str(item["docId"])))
		out = append(out, map[string]any{
			"idx": idx, "source": source, "page": item["page"],
			"score": toFloat(item["score"]), "docId": coalesce(str(item["docId"]), str(item["id"])),
			"text": text,
		})
	}
	return out
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *Server) patchKnowledgeGovernanceAuth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
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

func (s *Server) createKnowledgePackage(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "知识包名称必填")
	}
	ws := s.workspaceID(r)
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

func (s *Server) knowledgePackageAction(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/knowledge/packages/:id/:action
	if len(parts) < 5 {
		return nil, apperr.BadReq(apperr.BadRequest, "路径无效")
	}
	pkgID, action := parts[3], parts[4]
	ws := s.workspaceID(r)
	body, _ := decodeMap(r)

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
			in := policy.Input{SubmitterID: id.ID}
			if pkgStatus == "pending_approval" || pkgStatus == "pending_countersign" {
				in.ApproverID = id.ID
				if pkgSubmitter != "" {
					in.SubmitterID = pkgSubmitter
				}
			}
			if err := s.evaluateWrite(r, "knowledge", "publish", in); err != nil && id.Role != "admin" {
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
		if requiresPeerApprovalGate(id) && str(pkg["status"]) != "pending_approval" && str(pkg["status"]) != "pending_countersign" {
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
		if err := requireProductionDualApproval(str(pkg["requestedById"]), str(pkg["requestedBy"]), id, "知识发布"); err != nil {
			return nil, err
		}
		if err := s.requirePackageEvalSetLocked(ws, pkgID); err != nil {
			return nil, err
		}
		if hold, err := maybeHoldForCountersign(pkg, id, str(pkg["classification"]), "知识发布"); err != nil {
			return nil, err
		} else if hold {
			s.Store.KnowledgeExtra["packages"] = pkgs
			s.appendKnowledgeAuditLocked(ws, id.Name, "知识发布会签待副署", str(pkg["name"]), "success", "pending_countersign")
			go s.persistKnowledgeExtra()
			return pkg, nil
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
		go func() { s.Store.Persist("knowledge_docs"); s.persistKnowledgeExtra(); _, _ = s.syncRAGIndexStrict(ws) }()
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
		go s.runKnowledgeJob(str(job["id"]))
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
		s.appendKnowledgeAuditLocked(ws, id.Name, "删除知识包", str(pkg["name"]), "success", pkgID)
		unlocked = true
		s.Store.Unlock()
		go func() { s.Store.Persist("knowledge_docs"); s.persistKnowledgeExtra() }()
		return map[string]any{"id": pkgID, "deleted": true}, nil
	default:
		return nil, apperr.NotFoundErr(apperr.NotFound, "未知动作")
	}
}

func (s *Server) createKnowledgeSource(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "数据源名称必填")
	}
	kind := coalesce(str(body["kind"]), "REST API")
	endpoint := strings.TrimSpace(str(body["endpoint"]))
	if kind == "Webhook" {
		ws := s.workspaceID(r)
		endpoint = "/hooks/knowledge/" + ws + "/" + s.Store.ID("wh")
	} else if endpoint == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "连接地址必填")
	}
	schedule := coalesce(str(body["schedule"]), "每 1 小时")
	if kind == "Webhook" {
		schedule = "事件推送"
	}
	credentialHint := strings.TrimSpace(str(body["credentialHint"]))
	ws := s.workspaceID(r)
	item := map[string]any{
		"id": s.Store.ID("ks"), "workspaceId": ws, "name": name,
		"kind": kind, "schedule": schedule, "endpoint": endpoint,
		"lastSync": "尚未同步", "documents": 0, "status": "attention",
	}
	if credentialHint != "" {
		item["credentialHint"] = credentialHint
	}
	s.Store.Lock()
	srcs := knowledgeSliceMaps(s.Store.KnowledgeExtra["sources"])
	s.Store.KnowledgeExtra["sources"] = append([]map[string]any{item}, srcs...)
	s.appendKnowledgeAuditLocked(ws, id.Name, "接入知识数据源", name, "success", "")
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return normalizeSourceItem(item), nil
}

func (s *Server) syncKnowledgeSource(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		return nil, apperr.BadReq(apperr.BadRequest, "路径无效")
	}
	srcID := parts[3]
	ws := s.workspaceID(r)
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	srcs := knowledgeSliceMaps(s.Store.KnowledgeExtra["sources"])
	for i, src := range srcs {
		if str(src["id"]) != srcID {
			continue
		}
		if str(src["workspaceId"]) != "" && str(src["workspaceId"]) != ws {
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "数据源不在当前工作区")
		}
		src["status"] = "healthy"
		src["lastSync"] = time.Now().UTC().Format(time.RFC3339)
		n := intFrom(src["documents"]) + 1
		src["documents"] = n
		srcs[i] = src
		s.Store.KnowledgeExtra["sources"] = srcs
		// create a doc from sync
		doc := map[string]any{
			"id": s.Store.ID("kd"), "workspaceId": ws, "title": str(src["name"]) + " 同步文档",
			"source": str(src["name"]), "status": "ready", "ownerId": id.ID,
			"sizeKb": 16, "chunks": 4, "citeCount": 0,
			"snippet":   "来自数据源同步：" + str(src["name"]),
			"updatedAt": time.Now().UTC().Format(time.RFC3339),
			"quality":   map[string]any{"completeness": 75, "freshness": 95, "citationAccuracy": 80},
		}
		s.Store.KnowledgeDocs = append([]map[string]any{doc}, s.Store.KnowledgeDocs...)
		s.appendKnowledgeAuditLocked(ws, id.Name, "同步知识数据源", str(src["name"]), "success", "")
		unlocked = true
		s.Store.Unlock()
		go func() { s.Store.Persist("knowledge_docs"); s.persistKnowledgeExtra() }()
		return normalizeSourceItem(src), nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "数据源不存在")
}

func (s *Server) retryKnowledgeJob(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		return nil, apperr.BadReq(apperr.BadRequest, "路径无效")
	}
	jobID := parts[3]
	ws := s.workspaceID(r)
	s.Store.Lock()
	jobs := knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
	var job map[string]any
	for i, j := range jobs {
		if str(j["id"]) == jobID {
			if str(j["workspaceId"]) != "" && str(j["workspaceId"]) != ws {
				s.Store.Unlock()
				return nil, apperr.Forbidden(apperr.WorkspaceScope, "任务不在当前工作区")
			}
			j["status"] = "queued"
			j["error"] = nil
			j["startedAt"] = time.Now().UTC().Format(time.RFC3339)
			jobs[i] = j
			job = j
			break
		}
	}
	if job == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "加工任务不存在")
	}
	s.Store.KnowledgeExtra["processingJobs"] = jobs
	s.appendKnowledgeAuditLocked(ws, id.Name, "重试知识加工任务", str(job["source"]), "success", "")
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	go s.runKnowledgeJob(jobID)
	return job, nil
}

func (s *Server) runKnowledgeJob(jobID string) {
	time.Sleep(300 * time.Millisecond)
	s.Store.Lock()
	jobs := knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
	var job map[string]any
	jidx := -1
	for i, j := range jobs {
		if str(j["id"]) == jobID {
			job = j
			jidx = i
			break
		}
	}
	if job == nil {
		s.Store.Unlock()
		return
	}
	job["status"] = "running"
	jobs[jidx] = job
	s.Store.KnowledgeExtra["processingJobs"] = jobs
	s.Store.Unlock()
	s.persistKnowledgeExtra()

	time.Sleep(400 * time.Millisecond)
	s.Store.Lock()
	jobs = knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
	for i, j := range jobs {
		if str(j["id"]) != jobID {
			continue
		}
		ws := str(j["workspaceId"])
		chunks := 0
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["workspaceId"]) != ws {
				continue
			}
			if str(d["status"]) == "indexing" || str(j["docId"]) == str(d["id"]) {
				text := coalesce(str(d["content"]), coalesce(str(d["snippet"]), str(d["title"])))
				if blob := s.readKnowledgeBlob(str(d["blobPath"])); blob != "" {
					text = blob
					d["content"] = blob
					if str(d["snippet"]) == "" {
						runes := []rune(blob)
						if len(runes) > 120 {
							d["snippet"] = string(runes[:120])
						} else {
							d["snippet"] = blob
						}
					}
				}
				if str(d["blobStatus"]) == "failed" {
					j["status"] = "failed"
					j["error"] = "对象存储写入失败，禁止假成功：" + str(d["blobError"])
					jobs[i] = j
					s.Store.KnowledgeExtra["processingJobs"] = jobs
					s.Store.Unlock()
					s.persistKnowledgeExtra()
					return
				}
				n := maxInt(1, len([]rune(text))/200)
				d["chunks"] = n
				d["status"] = "ready"
				d["sizeKb"] = maxInt(1, len(text)/1024)
				d["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
				chunks += n
				// graph entities from title
				ents := knowledgeSliceMaps(s.Store.KnowledgeExtra["graphEntities"])
				ent := map[string]any{
					"id": s.Store.ID("ge"), "workspaceId": ws, "name": str(d["title"]),
					"type": "runbook", "confidence": 0.86, "sourceDocId": d["id"], "sourceVersion": "v1",
				}
				s.Store.KnowledgeExtra["graphEntities"] = append([]map[string]any{ent}, ents...)
			}
		}
		j["status"] = "succeeded"
		j["chunkCount"] = chunks
		j["documentCount"] = maxInt(1, intFrom(j["documentCount"]))
		j["indexVersion"] = "idx-" + time.Now().Format("150405")
		jobs[i] = j
		s.Store.KnowledgeExtra["processingJobs"] = jobs
		// refresh chunksTop
		tops := []map[string]any{}
		idx := 1
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["workspaceId"]) != ws {
				continue
			}
			st := str(d["status"])
			if st != "ready" && st != "published" {
				continue
			}
			tops = append(tops, map[string]any{
				"idx": idx, "source": coalesce(str(d["source"]), str(d["title"])),
				"score": 0.85, "docId": d["id"],
				"text": coalesce(str(d["snippet"]), str(d["title"])),
			})
			idx++
			if idx > 8 {
				break
			}
		}
		s.Store.KnowledgeExtra["chunksTop"] = tops
		break
	}
	s.Store.Unlock()
	s.Store.Persist("knowledge_docs")
	s.persistKnowledgeExtra()
}

func (s *Server) deleteKnowledgeDocAuth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	docID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/knowledge/doc/"), "/")
	if docID == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "文档 ID 无效")
	}
	return s.deleteKnowledgeDocsByIDs(r, id, []string{docID})
}

func (s *Server) deleteKnowledgeDocsAuth(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	ids := stringSlice(body["ids"])
	if len(ids) == 0 {
		return nil, apperr.BadReq(apperr.BadRequest, "请至少选择一项知识资产")
	}
	return s.deleteKnowledgeDocsByIDs(r, id, ids)
}

func (s *Server) deleteKnowledgeDocsByIDs(r *http.Request, actor *auth.Identity, ids []string) (any, error) {
	ws := s.workspaceID(r)
	s.Store.RLock()
	gov, _ := s.Store.KnowledgeExtra["governance"].(map[string]any)
	highRisk := true
	if gov != nil {
		if v, ok := gov["highRiskChangeApproval"].(bool); ok {
			highRisk = v
		}
	}
	s.Store.RUnlock()
	if highRisk {
		if err := s.evaluateWrite(r, "knowledge", "delete", policy.Input{ApproverID: actor.ID, SubmitterID: actor.ID}); err != nil && actor.Role != "admin" {
			return nil, err
		}
	}

	want := map[string]struct{}{}
	for _, id := range ids {
		if id != "" {
			want[id] = struct{}{}
		}
	}
	// K10 — block delete when docs still have un-retracted citations.
	log := s.citationLog()
	for id := range want {
		if err := log.EnsureDeleted(ws, id); err != nil {
			return nil, apperr.Conflict("knowledge.citation_active", err.Error())
		}
	}
	s.Store.Lock()
	kept := make([]map[string]any, 0, len(s.Store.KnowledgeDocs))
	deleted := make([]map[string]any, 0)
	blobPaths := []string{}
	for _, d := range s.Store.KnowledgeDocs {
		docID := str(d["id"])
		if _, ok := want[docID]; !ok || str(d["workspaceId"]) != ws {
			kept = append(kept, d)
			continue
		}
		deleted = append(deleted, d)
		if path := str(d["blobPath"]); path != "" {
			blobPaths = append(blobPaths, path)
		}
	}
	if len(deleted) == 0 {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "文档不存在或不在当前工作区")
	}
	s.Store.KnowledgeDocs = kept

	deletedIDs := map[string]struct{}{}
	titles := make([]string, 0, len(deleted))
	for _, d := range deleted {
		deletedIDs[str(d["id"])] = struct{}{}
		titles = append(titles, str(d["title"]))
	}

	// Drop related control-plane traces for deleted docs.
	filterExtra := func(key string, keep func(map[string]any) bool) {
		items := knowledgeSliceMaps(s.Store.KnowledgeExtra[key])
		out := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if keep(item) {
				out = append(out, item)
			}
		}
		s.Store.KnowledgeExtra[key] = out
	}
	filterExtra("chunksTop", func(m map[string]any) bool {
		_, gone := deletedIDs[str(m["docId"])]
		return !gone
	})
	filterExtra("citationTrace", func(m map[string]any) bool {
		_, gone := deletedIDs[str(m["docId"])]
		return !gone
	})
	filterExtra("graphEntities", func(m map[string]any) bool {
		_, gone := deletedIDs[str(m["sourceDocId"])]
		return !gone
	})
	filterExtra("graphRelations", func(m map[string]any) bool {
		_, goneFrom := deletedIDs[str(m["sourceDocId"])]
		return !goneFrom
	})

	s.appendKnowledgeAuditLocked(ws, actor.Name, "删除知识文档", strings.Join(titles, ","), "success", fmt.Sprintf("count=%d", len(deleted)))
	s.Store.Unlock()
	deletedIDList := make([]string, 0, len(deleted))
	for _, d := range deleted {
		if id := str(d["id"]); id != "" {
			deletedIDList = append(deletedIDList, id)
		}
	}
	s.durableDeleteSync("knowledge_docs", deletedIDList...)
	s.Store.Persist("knowledge_docs")
	s.persistKnowledgeExtra()
	for _, path := range blobPaths {
		_ = os.Remove(path)
	}
	return map[string]any{
		"deleted": len(deleted),
		"ids":     deletedIDList,
	}, nil
}

func (s *Server) reviewKnowledgeDocs(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	ids := stringSlice(body["ids"])
	ws := s.workspaceID(r)
	s.Store.Lock()
	reviewed := []string{}
	for _, docID := range ids {
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["id"]) == docID && str(d["workspaceId"]) == ws {
				d["status"] = "ready"
				d["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
				reviewed = append(reviewed, docID)
			}
		}
	}
	s.appendKnowledgeAuditLocked(ws, id.Name, "发起知识复核", strings.Join(reviewed, ","), "success", "")
	s.Store.Unlock()
	s.Store.Persist("knowledge_docs")
	s.persistKnowledgeExtra()
	return map[string]any{"ids": reviewed}, nil
}

func (s *Server) runKnowledgeEvaluation(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	pkgID := str(body["packageId"])
	profileID := str(body["profileId"])

	gold := s.loadGoldSetLocked(ws, pkgID)
	if len(gold) == 0 {
		gold = eval.DefaultGoldSet
	}

	type docRow struct {
		id      string
		title   string
		content string
	}
	docs := []docRow{}
	s.Store.RLock()
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != ws {
			continue
		}
		if str(d["status"]) != "ready" && str(d["status"]) != "published" {
			continue
		}
		if !scope.Allowed(scopeDocFromMap(d), scopeViewerFromIdentity(id, ws)) {
			continue
		}
		title := coalesce(str(d["title"]), str(d["id"]))
		body := coalesce(str(d["snippet"]), title)
		docs = append(docs, docRow{id: str(d["id"]), title: title, content: title + " " + body})
	}
	s.Store.RUnlock()

	corpusMap := make(map[string]string, len(docs))
	for _, d := range docs {
		corpusMap[d.id] = d.content
	}
	retriever := func(query string, k int) []eval.Hit {
		if len(corpusMap) == 0 {
			return nil
		}
		tokens := eval.TokenizeQuery(query)
		if len(tokens) == 0 {
			return nil
		}
		out := make([]eval.Hit, 0, len(corpusMap))
		for id, body := range corpusMap {
			bl := strings.ToLower(body)
			hits := 0
			for _, tok := range tokens {
				if strings.Contains(bl, tok) {
					hits++
				}
			}
			if hits > 0 {
				out = append(out, eval.Hit{DocID: id, Score: float64(hits)})
			}
		}
		out = eval.SortHitsByScore(out)
		if len(out) > k {
			out = out[:k]
		}
		return out
	}

	started := time.Now()
	rep, err := eval.RunEvaluation(retriever, gold, eval.Options{Ks: []int{5, 10}})
	if err != nil {
		return nil, err
	}
	latencyMs := float64(time.Since(started).Milliseconds())

	hitRate := 0.0
	if rep.HitRate > 0 {
		hitRate = rep.HitRate
	}
	item := map[string]any{
		"id":               s.Store.ID("kev"),
		"workspaceId":      ws,
		"packageId":        pkgID,
		"profileId":        profileID,
		"baselineVersion":  "baseline",
		"evaluatedVersion": "candidate",
		"status":           rep.Status,
		"recallAt5":        rep.RecallAt5,
		"recallAt10":       rep.RecallAt10,
		"recallAtK":        rep.RecallAt10,
		"mrr":              rep.MRR,
		"ndcg":             rep.NDCGAt10,
		"ndcgAt10":         rep.NDCGAt10,
		"hitRate":          hitRate,
		"hallucinationRate": rep.HallucinationRate,
		"sampleSize":       rep.SampleSize,
		"hallucinatedHits": rep.HallucinatedHits,
		"failReasons":      rep.FailReasons,
		"citationAccuracy": 1.0 - rep.HallucinationRate,
		"p95LatencyMs":     latencyMs,
		"evaluatedAt":      time.Now().UTC().Format(time.RFC3339),
	}

	s.Store.Lock()
	evals := knowledgeSliceMaps(s.Store.KnowledgeExtra["evaluations"])
	s.Store.KnowledgeExtra["evaluations"] = append([]map[string]any{item}, evals...)
	s.Store.KnowledgeExtra["eval"] = normalizeEvalMetrics(map[string]any{
		"workspaceId":      ws,
		"recallAtK":        rep.RecallAt10,
		"recallAt10":       rep.RecallAt10,
		"mrr":              rep.MRR,
		"ndcg":             rep.NDCGAt10,
		"hitRate":          hitRate,
		"hallucinationRate": rep.HallucinationRate,
		"sampleSize":       rep.SampleSize,
		"status":           rep.Status,
		"p95Latency":       latencyMs,
	})
	s.appendKnowledgeAuditLocked(ws, id.Name, "运行知识评测", pkgID, "success",
		fmt.Sprintf("status=%s recall@10=%.4f halluc=%.4f n=%d",
			rep.Status, rep.RecallAt10, rep.HallucinationRate, rep.SampleSize))
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return item, nil
}

func (s *Server) loadGoldSetLocked(ws, pkgID string) []eval.GoldItem {
	type goldShape struct {
		Items []struct {
			Query          string   `json:"query"`
			RelevantDocIDs []string `json:"relevantDocIds"`
		} `json:"items"`
	}
	for _, m := range knowledgeSliceMaps(s.Store.KnowledgeExtra["goldSets"]) {
		if str(m["workspaceId"]) != ws {
			continue
		}
		if pkgID != "" && str(m["packageId"]) != pkgID {
			continue
		}
		js, _ := json.Marshal(m["items"])
		var g goldShape
		if err := json.Unmarshal(js, &g); err != nil {
			continue
		}
		out := make([]eval.GoldItem, 0, len(g.Items))
		for _, it := range g.Items {
			if strings.TrimSpace(it.Query) == "" || len(it.RelevantDocIDs) == 0 {
				continue
			}
			out = append(out, eval.GoldItem{Query: it.Query, RelevantDocIDs: it.RelevantDocIDs})
		}
		if len(out) > 0 {
			return out
		}
	}
	return nil
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func scopeDocFromMap(d map[string]any) scope.Source {
	roles := []string{}
	for _, r := range knowledgeSliceMaps(d["roles"]) {
		roles = append(roles, str(r["id"]))
	}
	for _, r := range knowledgeSliceAny(d["roles"]) {
		if s, ok := r.(string); ok && s != "" {
			roles = append(roles, s)
		}
	}
	scopes := []string{}
	for _, s := range knowledgeSliceAny(d["scopes"]) {
		if v, ok := s.(string); ok && v != "" {
			scopes = append(scopes, v)
		}
	}
	tags := []string{}
	for _, t := range knowledgeSliceAny(d["scopeTags"]) {
		if v, ok := t.(string); ok && v != "" {
			tags = append(tags, v)
		}
	}
	return scope.Source{
		ID:        str(d["id"]),
		Workspace: str(d["workspaceId"]),
		Status:    str(d["status"]),
		Scopes:    scopes,
		ScopeTags: tags,
		OwnerID:   str(d["digitalPartnerId"]),
		Roles:     roles,
	}
}

func scopeViewerFromIdentity(id *auth.Identity, ws string) scope.Viewer {
	if id == nil {
		return scope.Viewer{WorkspaceID: ws}
	}
	return scope.Viewer{
		IdentityID:  id.Name,
		WorkspaceID: ws,
		Roles:       append([]string{}, id.Permissions...),
	}
}

func knowledgeSliceAny(v any) []any {
	switch x := v.(type) {
	case []any:
		return x
	case []map[string]any:
		out := make([]any, 0, len(x))
		for _, m := range x {
			out = append(out, m)
		}
		return out
	}
	return nil
}

// citationLog returns the per-Server citation log, hydrating it from
// KnowledgeExtra["citationLog"] on first use. All persistence happens
// in KnowledgeExtra so the existing snapshot machinery covers it.
func (s *Server) citationLog() *citationlog.Log {
	s.Store.Lock()
	defer s.Store.Unlock()
	if v, ok := s.Store.KnowledgeExtra["__citationLog"].(*citationlog.Log); ok {
		return v
	}
	l := citationlog.NewLog()
	if rows := knowledgeSliceMaps(s.Store.KnowledgeExtra["citationLog"]); len(rows) > 0 {
		for _, r := range rows {
			created, _ := time.Parse(time.RFC3339, str(r["createdAt"]))
			retracted, _ := time.Parse(time.RFC3339, str(r["retractedAt"]))
			l.Append(citationlog.Record{
				WorkspaceID: str(r["workspaceId"]),
				TurnID:      str(r["turnId"]),
				DocID:       str(r["docId"]),
				ChunkID:     str(r["chunkId"]),
				Tier:        str(r["tier"]),
				QuoteHash:   str(r["quoteHash"]),
				Score:       toFloat(r["score"]),
				CreatedAt:   created,
				RetractedAt: retracted,
			})
		}
	}
	s.Store.KnowledgeExtra["__citationLog"] = l
	return l
}

// LogCitation appends a citation event to the per-Server log. Idempotent
// for callers that may fire multiple citations per turn. Caller may be
// invoked from chat handlers; safe to call concurrently.
func (s *Server) LogCitation(workspaceID, turnID, docID, chunkID, tier, quoteHash string, score float64) {
	l := s.citationLog()
	l.Append(citationlog.Record{
		WorkspaceID: workspaceID,
		TurnID:      turnID,
		DocID:       docID,
		ChunkID:     chunkID,
		Tier:        tier,
		QuoteHash:   quoteHash,
		Score:       score,
	})
}

func (s *Server) rescoreKnowledgeChunks(r *http.Request) (any, error) {
	if err := requireKnowledgeWrite(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.Lock()
	tops := []map[string]any{}
	idx := 1
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != ws {
			continue
		}
		if str(d["status"]) != "ready" && str(d["status"]) != "published" {
			continue
		}
		tops = append(tops, map[string]any{
			"idx": idx, "source": coalesce(str(d["source"]), str(d["title"])),
			"score": 0.9 - float64(idx)*0.02, "docId": d["id"],
			"text": coalesce(str(d["snippet"]), str(d["title"])),
		})
		idx++
		if idx > 10 {
			break
		}
	}
	s.Store.KnowledgeExtra["chunksTop"] = tops
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return tops, nil
}

func (s *Server) listKBAuth(r *http.Request) (any, error) {
	if err := requireKnowledgeRead(identityFrom(r.Context())); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, kb := range s.Store.KBList {
		if str(kb["workspaceId"]) == ws || str(kb["workspaceId"]) == "" {
			out = append(out, kb)
		}
	}
	return out, nil
}
