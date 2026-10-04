package knowledge

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// --- docs CRUD ---

// ListKnowledgeDocs → GET /api/knowledge/docs
func (s *Service) ListKnowledgeDocs(r *http.Request) (any, error) {
	if err := requireKnowledgeRead(identityFromCtx(r)); err != nil {
		return nil, err
	}
	return s.listKnowledgeDocs(r), nil
}

func (s *Service) listKnowledgeDocs(r *http.Request) any {
	ws := s.Deps.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0, len(s.Store.KnowledgeDocs))
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != ws {
			continue
		}
		cp := map[string]any{}
		for k, v := range d {
			cp[k] = v
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
		// summary 用 snippet 兜底,知识库选择器 / 列表预览需要它
		if str(cp["summary"]) == "" {
			cp["summary"] = str(cp["snippet"])
		}
		if cp["tags"] == nil {
			cp["tags"] = []string{}
		}
		if cp["quality"] == nil {
			cp["quality"] = map[string]any{"completeness": 80, "freshness": 80, "citationAccuracy": 80}
		}
		if cp["versions"] == nil {
			cp["versions"] = []map[string]any{}
		}
		if cp["blobPath"] != nil {
			delete(cp, "content")
		}
		out = append(out, cp)
	}
	return out
}

// CreateKnowledgeDoc → POST /api/knowledge/docs
func (s *Service) CreateKnowledgeDoc(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	title := strings.TrimSpace(str(body["title"]))
	if title == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "文档标题必填")
	}
	ws := s.Deps.WorkspaceID(r)
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
	go s.RunKnowledgeJob(str(job["id"]))
	return item, nil
}

// DeleteKnowledgeDocs → POST /api/knowledge/docs/delete
func (s *Service) DeleteKnowledgeDocs(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	ids := stringSlice(body["ids"])
	if len(ids) == 0 {
		return nil, apperr.BadReq(apperr.BadRequest, "请至少选择一项知识资产")
	}
	return s.deleteKnowledgeDocsByIDs(r, id, ids)
}

// DeleteKnowledgeDoc → DELETE /api/knowledge/doc/{id}
func (s *Service) DeleteKnowledgeDoc(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	docID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/knowledge/doc/"), "/")
	if docID == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "文档 ID 无效")
	}
	return s.deleteKnowledgeDocsByIDs(r, id, []string{docID})
}

// deleteKnowledgeDocsByIDs is the shared bulk-delete body. Handles the
// high-risk-change approval gate, the citation-active 409 conflict (K10),
// the per-workspace scope, the cascading control-plane trace cleanup,
// and the durable-delete-sync signal for downstream stores.
func (s *Service) deleteKnowledgeDocsByIDs(r *http.Request, actor *auth.Identity, ids []string) (any, error) {
	ws := s.Deps.WorkspaceID(r)
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
		if err := s.Deps.EvaluateWrite(r, "knowledge", "delete", policyInput(actor.ID, actor.ID)); err != nil && !actorIsAdmin(actor) {
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
	log := s.CitationLog()
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
	if s.Deps.DurableDeleteSync != nil {
		s.Deps.DurableDeleteSync("knowledge_docs", deletedIDList...)
	}
	s.Store.Persist("knowledge_docs")
	s.persistKnowledgeExtra()
	for _, path := range blobPaths {
		_ = removeFile(path)
	}
	return map[string]any{
		"deleted": len(deleted),
		"ids":     deletedIDList,
	}, nil
}

// KnowledgeDocDetail → GET /api/knowledge/doc/{id}
func (s *Service) KnowledgeDocDetail(r *http.Request) (any, error) {
	if err := requireKnowledgeRead(identityFromCtx(r)); err != nil {
		return nil, err
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/knowledge/doc/")
	id = strings.Trim(id, "/")
	ws := s.Deps.WorkspaceID(r)
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

// --- retrieve ---

// KnowledgeRetrieve → POST /api/knowledge/retrieve
//
// Auth gate first (knowledge.read), then delegates to
// retrievePublishedNormalized which projects onto the canonical
// {query, results, backend, correlationId, metrics} envelope.
func (s *Service) KnowledgeRetrieve(r *http.Request) (any, error) {
	if err := requireKnowledgeRead(identityFromCtx(r)); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	corr := coalesce(str(body["correlationId"]), r.Header.Get("x-correlation-id"))
	if corr == "" {
		corr = s.Store.ID("corr")
	}
	return s.retrievePublishedNormalized(r, body, corr)
}

// retrievePublishedNormalized is the M07 retrieve implementation. When
// the sidecar returns hits, we filter to the published corpus. When
// the sidecar is unreachable, we fall back to a published-only keyword
// match against the in-memory KnowledgeDocs. Either path stamps a
// correlation id and a metrics envelope; a production environment
// without sidecar + with published docs surfaces `degraded: true` so
// the copilot path can warn the caller.
func (s *Service) retrievePublishedNormalized(r *http.Request, body map[string]any, corr string) (any, error) {
	query := str(body["query"])
	ws := s.Deps.WorkspaceID(r)
	start := time.Now()
	var results []map[string]any
	sidecarOK := false
	if hits := s.RAGRetrieveForConnect(r.Context(), query, ws, corr); hits != nil {
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
	if s.Deps.RecordUsageWS != nil {
		s.Deps.RecordUsageWS(ws, "rag", 1, corr)
	}
	latency := time.Since(start).Milliseconds()
	out := map[string]any{
		"query": query, "results": results, "backend": "knowledge-control-plane", "correlationId": corr,
		"metrics": map[string]any{
			"recall": float64(minInt(100, len(results)*20)), "precision": 80, "p95Latency": latency, "hitRate": len(results),
		},
	}
	if !sidecarOK && s.Deps.ProductionLikeEnv != nil && s.Deps.ProductionLikeEnv() && publishedOnly > 0 {
		out["degraded"] = true
		out["backend"] = "knowledge-control-plane-degraded"
		out["code"] = string(apperr.RuntimeUnavailable)
		out["warning"] = "向量检索不可用，已降级到已发布关键词检索"
	}
	return out, nil
}

// filterRetrieveToPublished drops sidecar hits whose docId isn't in the
// published corpus — defense in depth against a sidecar that returns
// unfiltered results.
func filterRetrieveToPublished(s *Service, workspaceID string, hits []map[string]any) []map[string]any {
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

// normalizeRetrieveHitList coerces the sidecar's hit shape (which may
// be a `[]map[string]any` or a `[]any` after JSON round-trip) into the
// canonical {idx, source, page, score, docId, text} shape used by the
// in-memory fallback path.
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

// RAGRetrieveForConnect is the canonical sidecar projection used by
// the Connect-RPC RagService binding, the Copilot SSE path, and the
// /api/knowledge/retrieve envelope. Single source of truth — server
// and knowledge call sites all funnel through here instead of each
// minting their own http.Client.
//
// Returns nil when:
//   - no RAG URL is configured (DE_RAG_URL=""),
//   - the workspace has no published corpus (skips the sidecar so
//     its process-global INDEX can't leak demo seeds), or
//   - the sidecar is unreachable / returned non-2xx.
//
// On success the returned map mirrors the sidecar's
// {results[], backend, correlationId} shape with results[] already
// filtered to the workspace's published corpus (defense in depth).
// The caller is expected to layer its own per-doc ACL filter on top
// (Server.filterRAGHitsByScope, eval_gate.go, etc.).
func (s *Service) RAGRetrieveForConnect(ctx context.Context, query, ws, corr string) any {
	if s.Deps.RAGURL == nil || s.Deps.RAGURL() == "" {
		return nil
	}
	docs, allowed := s.snapshotPublishedCorpus(ws)
	if len(docs) == 0 {
		return nil
	}
	raw, err := s.ragClient().Retrieve(ctx, query, ws, corr, docs)
	if err != nil || raw == nil {
		return nil
	}
	if corr != "" {
		raw["correlationId"] = corr
	}
	return filterRAGResultsToAllowed(raw, allowed)
}

// SyncRAGIndex snapshots the workspace's published + ready docs and
// pushes them to qzda-rag (/v1/ingest, fallback /v1/sync). Returns
// the indexed count (sidecar-reported or fallback len(docs)). When
// no RAG URL is configured this is a no-op returning 0.
//
// Mirrors the legacy Server.syncRAGIndex; the migration moves the
// HTTP boundary into Service.ragClient() so server/ no longer
// touches qzda-rag directly.
func (s *Service) SyncRAGIndex(ws string) int {
	if s.Deps.RAGURL == nil || s.Deps.RAGURL() == "" {
		return 0
	}
	s.Store.RLock()
	var docs []map[string]any
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != ws {
			continue
		}
		st := str(d["status"])
		if st != "published" && st != "ready" {
			continue
		}
		docs = append(docs, map[string]any{
			"docId": str(d["id"]), "title": str(d["title"]),
			"snippet": coalesce(str(d["snippet"]), "已发布："+str(d["title"])),
			"score":   0.9, "status": "published",
		})
	}
	s.Store.RUnlock()
	n, _ := s.ragClient().Ingest(context.Background(), ws, docs)
	return n
}

// snapshotPublishedCorpus returns (1) the minimal doc shape the
// qzda-rag /v1/retrieve payload expects and (2) the set of allowed
// docIds the post-sidecar filter must accept. Caller skips the
// sidecar entirely when len(docs) == 0.
func (s *Service) snapshotPublishedCorpus(ws string) ([]map[string]any, map[string]struct{}) {
	allowed := map[string]struct{}{}
	if ws == "" {
		return nil, allowed
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	var docs []map[string]any
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != ws || str(d["status"]) != "published" {
			continue
		}
		id := str(d["id"])
		if id == "" {
			continue
		}
		allowed[id] = struct{}{}
		docs = append(docs, map[string]any{
			"docId": id, "title": str(d["title"]),
			"snippet": "已发布：" + str(d["title"]), "score": 0.9, "status": "published",
		})
	}
	return docs, allowed
}

// filterRAGResultsToAllowed is the defense-in-depth pass that drops
// sidecar hits whose docId isn't in the workspace's published corpus.
// Mirrors the trailing block of the legacy Service.callRAGPublished.
func filterRAGResultsToAllowed(raw map[string]any, allowed map[string]struct{}) map[string]any {
	if raw == nil {
		return nil
	}
	resultsRaw, ok := raw["results"]
	if !ok {
		return raw
	}
	filtered := make([]any, 0, len(knowledgeSliceMaps(resultsRaw)))
	for _, item := range knowledgeSliceMaps(resultsRaw) {
		id := coalesce(str(item["docId"]), str(item["id"]))
		if _, ok := allowed[id]; !ok {
			continue
		}
		filtered = append(filtered, item)
	}
	raw["results"] = filtered
	return raw
}

// --- kb-list ---

// ListKB → GET /api/knowledge/kb-list
func (s *Service) ListKB(r *http.Request) (any, error) {
	if err := requireKnowledgeRead(identityFromCtx(r)); err != nil {
		return nil, err
	}
	ws := s.Deps.WorkspaceID(r)
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

// --- local helpers (only used inside this file) ---
// (coalesce / removeFile live in helpers.go so handlers_packages.go,
// handlers_jobs.go, and friends can use the same helpers without
// re-defining them.)
