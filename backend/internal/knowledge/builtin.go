package knowledge

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citation"
)

// Package builtin holds the M07 知识中心 boot-time helpers that
// previously lived in internal/server/builtin_knowledge.go:
//
//   - builtin loader for the office builtin knowledge packs
//     (manifest.json + per-pack package.json + per-doc markdown files
//     in backend/builtin/knowledge/office/)
//   - EnsureBuiltinKnowledgeReady, the boot-time invocation that
//     seeds each workspace's Store.KnowledgeDocs +
//     KnowledgeExtra["packages"] + retrievalProfiles + evaluations
//     with the office packs
//   - RetrieveBuiltin, the M02 copilot "knowledge.retrieve" tool
//     handler (registered through copilot.Deps.RetrieveBuiltinFn)
//   - citationLog + LogCitation helpers used by the session_panel
//     audit path
//
// After M07 P2 these helpers live on the Service so the package
// boundary stays one-way (knowledge never imports server/).

// builtinKnowledgeManifest / builtinKnowledgePackage — JSON shapes for
// the office builtin loader. Mirrors the legacy internal/server
// types.
type builtinKnowledgeManifest struct {
	Version string `json:"version"`
	Packs   []struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"packs"`
}

type builtinKnowledgePackage struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Version        string   `json:"version"`
	Description    string   `json:"description"`
	Domain         string   `json:"domain"`
	Classification string   `json:"classification"`
	Builtin        bool     `json:"builtin"`
	Source         string   `json:"source"`
	Tags           []string `json:"tags"`
	Docs           []struct {
		File  string `json:"file"`
		Title string `json:"title"`
	} `json:"docs"`
	QA []map[string]any `json:"qa"`
}

var (
	builtinKnowledgeOnce sync.Once
	builtinKnowledgePacks []builtinKnowledgePackage
	builtinKnowledgeDocs  map[string][]map[string]any // packageId -> docs content
	builtinKnowledgeErr   error
)

// builtinKnowledgeRoot resolves the office-pack root directory.
// Override with QZDA_BUILTIN_KNOWLEDGE_DIR; otherwise walks the standard
// candidates relative to the working directory.
func builtinKnowledgeRoot() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_BUILTIN_KNOWLEDGE_DIR")); v != "" {
		return v
	}
	candidates := []string{
		filepath.Join("backend", "builtin", "knowledge", "office"),
		filepath.Join("builtin", "knowledge", "office"),
		filepath.Join("..", "backend", "builtin", "knowledge", "office"),
		filepath.Join("..", "..", "builtin", "knowledge", "office"),
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "backend", "builtin", "knowledge", "office"),
			filepath.Join(wd, "builtin", "knowledge", "office"),
		)
	}
	for _, c := range candidates {
		if st, err := os.Stat(filepath.Join(c, "manifest.json")); err == nil && !st.IsDir() {
			return c
		}
	}
	return filepath.Join("backend", "builtin", "knowledge", "office")
}

// loadBuiltinKnowledgePacks loads the manifest + per-pack package.json
// files exactly once per process. Returns (packs, docsByPkg, err).
// The err is sticky — once set, subsequent calls return the same value.
func loadBuiltinKnowledgePacks() ([]builtinKnowledgePackage, map[string][]map[string]any, error) {
	builtinKnowledgeOnce.Do(func() {
		root := builtinKnowledgeRoot()
		raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
		if err != nil {
			builtinKnowledgeErr = err
			return
		}
		var man builtinKnowledgeManifest
		if err := json.Unmarshal(raw, &man); err != nil {
			builtinKnowledgeErr = err
			return
		}
		packs := make([]builtinKnowledgePackage, 0, len(man.Packs))
		docsByPkg := map[string][]map[string]any{}
		for _, meta := range man.Packs {
			dir := filepath.Join(root, meta.ID)
			body, err := os.ReadFile(filepath.Join(dir, "package.json"))
			if err != nil {
				continue
			}
			var pack builtinKnowledgePackage
			if err := json.Unmarshal(body, &pack); err != nil {
				continue
			}
			if pack.ID == "" {
				pack.ID = meta.ID
			}
			pack.Builtin = true
			if pack.Source == "" {
				pack.Source = "platform"
			}
			docList := make([]map[string]any, 0, len(pack.Docs))
			for i, d := range pack.Docs {
				content := ""
				if b, err := os.ReadFile(filepath.Join(dir, "docs", d.File)); err == nil {
					content = string(b)
				}
				docID := "kd-builtin-" + pack.ID + "-" + strings.TrimSuffix(d.File, filepath.Ext(d.File))
				docID = strings.ReplaceAll(docID, ".", "-")
				snippet := content
				if len(snippet) > 120 {
					snippet = snippet[:120] + "…"
				}
				docList = append(docList, map[string]any{
					"id": docID, "packageId": pack.ID, "title": d.Title,
					"source": "平台内置", "status": "ready", "ownerId": "u1",
					"sizeKb": len(content)/1024 + 1, "chunks": 3 + i, "citeCount": 0,
					"snippet": snippet, "content": content,
					"updatedAt": "2026-08-21T00:00:00Z",
					"builtin": true, "sourceType": "platform",
					"quality": map[string]any{"completeness": 90, "freshness": 95, "citationAccuracy": 90},
				})
			}
			docsByPkg[pack.ID] = docList
			packs = append(packs, pack)
		}
		builtinKnowledgePacks = packs
		builtinKnowledgeDocs = docsByPkg
	})
	return builtinKnowledgePacks, builtinKnowledgeDocs, builtinKnowledgeErr
}

// EnsureBuiltinKnowledgeReady 将办公开箱知识包装入各工作区（已存在
// 同 id 则跳过覆盖自定义字段，仅补齐缺失）。
//
// Seeded under Store.Lock so concurrent boot paths (apprun/run.go,
// DomainWorkflow/DomainCap/DomainAll unit tests) don't race. Idempotent:
// re-running this method leaves existing rows in place (only fills in
// missing fields and adds packs that weren't there).
func (s *Service) EnsureBuiltinKnowledgeReady() {
	packs, docsByPkg, err := loadBuiltinKnowledgePacks()
	if err != nil || len(packs) == 0 {
		return
	}
	s.Store.Lock()
	defer s.Store.Unlock()

	workspaces := map[string]struct{}{"w1": {}}
	for _, w := range s.Store.Workspaces {
		if id := str(w["id"]); id != "" {
			workspaces[id] = struct{}{}
		}
	}

	if s.Store.KnowledgeExtra == nil {
		s.Store.KnowledgeExtra = map[string]any{}
	}
	packages, _ := s.Store.KnowledgeExtra["packages"].([]map[string]any)
	if packages == nil {
		if raw, ok := s.Store.KnowledgeExtra["packages"].([]any); ok {
			for _, item := range raw {
				if m, ok := item.(map[string]any); ok {
					packages = append(packages, m)
				}
			}
		}
	}
	existingPkg := map[string]bool{}
	for _, p := range packages {
		existingPkg[str(p["id"])] = true
	}
	existingDoc := map[string]bool{}
	for _, d := range s.Store.KnowledgeDocs {
		existingDoc[str(d["id"])] = true
	}

	now := time.Now().UTC().Format(time.RFC3339)
	for ws := range workspaces {
		for _, pack := range packs {
			docs := docsByPkg[pack.ID]
			docIDs := make([]string, 0, len(docs))
			for _, d := range docs {
				docID := str(d["id"])
				docIDs = append(docIDs, docID)
				if existingDoc[docID] {
					continue
				}
				cp := map[string]any{}
				for k, v := range d {
					cp[k] = v
				}
				cp["workspaceId"] = ws
				s.Store.KnowledgeDocs = append(s.Store.KnowledgeDocs, cp)
				existingDoc[docID] = true
			}
			if existingPkg[pack.ID] {
				continue
			}
			ver := coalesce(pack.Version, "1.0.0")
			pkg := map[string]any{
				"id": pack.ID, "workspaceId": ws, "name": pack.Name,
				"description": pack.Description, "domain": coalesce(pack.Domain, "办公"),
				"status": "published", "classification": coalesce(pack.Classification, "internal"),
				"owner": "平台内置", "ownerId": "u1",
				"documentCount": len(docIDs), "documentIds": docIDs, "consumers": 0,
				"builtin": true, "source": "platform", "tags": pack.Tags,
				"currentVersion": map[string]any{
					"id": "kpv-" + pack.ID + "-1", "version": ver, "status": "published",
					"indexVersion": "idx-office-1", "publishedAt": now, "qualityScore": 90,
					"changeSummary": "办公开箱首发",
				},
				"versions": []map[string]any{{
					"id": "kpv-" + pack.ID + "-1", "version": ver, "status": "published",
					"indexVersion": "idx-office-1", "publishedAt": now, "qualityScore": 90,
					"changeSummary": "办公开箱首发",
				}},
				"updatedAt": now,
			}
			packages = append(packages, pkg)
			existingPkg[pack.ID] = true

			// 检索配置
			profiles, _ := s.Store.KnowledgeExtra["retrievalProfiles"].([]map[string]any)
			if profiles == nil {
				if raw, ok := s.Store.KnowledgeExtra["retrievalProfiles"].([]any); ok {
					for _, item := range raw {
						if m, ok := item.(map[string]any); ok {
							profiles = append(profiles, m)
						}
					}
				}
			}
			profiles = append(profiles, map[string]any{
				"id": "rp-" + pack.ID, "workspaceId": ws, "packageId": pack.ID,
				"name": "办公默认检索", "retrievalModes": []string{"keyword", "vector"},
				"topK": 5, "rerankEnabled": true, "noResultPolicy": "clarify",
			})
			s.Store.KnowledgeExtra["retrievalProfiles"] = profiles

			evals, _ := s.Store.KnowledgeExtra["evaluations"].([]map[string]any)
			if evals == nil {
				if raw, ok := s.Store.KnowledgeExtra["evaluations"].([]any); ok {
					for _, item := range raw {
						if m, ok := item.(map[string]any); ok {
							evals = append(evals, m)
						}
					}
				}
			}
			evals = append(evals, map[string]any{
				"id": "kev-" + pack.ID, "workspaceId": ws, "packageId": pack.ID,
				"profileId": "rp-" + pack.ID, "baselineVersion": ver, "evaluatedVersion": ver,
				"status": "passed", "recallAtK": 0.85, "mrr": 0.8, "ndcg": 0.82,
				"citationAccuracy": 0.9, "p95LatencyMs": 180, "evaluatedAt": now,
			})
			s.Store.KnowledgeExtra["evaluations"] = evals
		}
	}
	s.Store.KnowledgeExtra["packages"] = packages

	// Persist the freshly-seeded builtin packs so that subsequent restarts
	// keep them across boot (without this, knowledge_extra stays in-memory
	// only and any user upload/eval lives only until next reboot).
	go func() { _ = s.Store.PersistSync("knowledge_extra") }()
}

// RetrieveBuiltin is the M02 copilot "knowledge.retrieve" tool
// handler. Wraps retrievePublishedNormalized so the tool returns the
// canonical {query, results, backend, correlationId} envelope. Server
// wires the closure into copilot.Deps.RetrieveBuiltinFn at boot.
//
// The reason this lives on the Service (rather than as a free function
// in copilot/copilot_tools.go): the retrieve path itself is M07 —
// without this delegation the M02 copilot module would need to import
// internal/knowledge/ for the canonical implementation, which would
// break the M02 → M07 one-way dependency direction.
func (s *Service) RetrieveBuiltin(ctx context.Context, r *http.Request, query, corr string) (any, error) {
	if s == nil {
		return nil, nil
	}
	if corr == "" {
		corr = s.Store.ID("corr")
	}
	return s.retrievePublishedNormalized(r, map[string]any{"query": query, "correlationId": corr}, corr)
}

// LogCitationsForRAG is the Deps.LogCitationsForRAGFn entry point —
// iterates the supplied RAG hits and writes one citationlog row per
// hit into the per-workspace citation log. The session_panel path
// uses this through Deps so it can stay free of citation + citationlog
// imports.
//
// The format mirrors the legacy *Server.logCitationsForRAG:
//   - snippet / title fallback
//   - quote extraction + quote-hash via CitationQuoteFn
//   - tier derivation (when the retriever didn't populate it directly)
//     from the doc-status string via copilot.CitationTierFromDocStatus
func (s *Service) LogCitationsForRAG(ws, turnID string, hits []map[string]any) {
	if len(hits) == 0 || s.Store == nil {
		return
	}
	cl := s.CitationLog()
	quoteFn := s.Deps.CitationQuoteFn
	for _, h := range hits {
		snippet := coalesce(str(h["snippet"]), str(h["title"]))
		var quotedHash string
		if quoteFn != nil {
			_, quotedHash = quoteFn(snippet)
		} else {
			// Fallback: when Deps.CitationQuoteFn isn't wired (tests,
			// boot ordering edge cases) call citation.ExtractQuote +
			// citation.QuoteHash directly. The knowledge package owns
			// the citation sub-package so this stays inside the
			// one-way boundary.
			quoted, _, _ := citation.ExtractQuote(snippet)
			quotedHash = citation.QuoteHash(quoted)
		}
		tier := str(h["tier"])
		if tier == "" {
			tier = string(copilot.CitationTierFromDocStatus(str(h["status"])))
		}
		cl.Append(citationlogRec(ws, turnID, h, tier, quotedHash))
	}
}

// citationlogRec constructs the citationlog.Record — kept on the
// Service so the same shape is used by LogCitationsForRAG and any
// future caller (e.g. session_panel tests that synthesize rows
// directly). Centralizing the row shape keeps the QuoteHash /
// extract-quote contract consistent with citation.Build.
func citationlogRec(ws, turnID string, hit map[string]any, tier, quoteHash string) citationlogRecord {
	return citationlogRecord{
		WorkspaceID: ws,
		TurnID:      turnID,
		DocID:       str(hit["docId"]),
		ChunkID:     str(hit["chunkId"]),
		Tier:        tier,
		QuoteHash:   quoteHash,
		Score:       toFloat(hit["score"]),
		CreatedAt:   time.Now().UTC(),
	}
}
