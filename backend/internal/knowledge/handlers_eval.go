package knowledge

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/knowledge/eval"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/scope"
)

// RunKnowledgeEvaluation → POST /api/knowledge/evaluations/run
//
// Runs the gold-set evaluator against the workspace's ready +
// published corpus. Stamps the result onto both KnowledgeExtra["evaluations"]
// (historical list) and KnowledgeExtra["eval"] (the canonical /api/knowledge/eval
// envelope used by the package-publish recall gate).
func (s *Service) RunKnowledgeEvaluation(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	ws := s.Deps.WorkspaceID(r)
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

// KnowledgeRetrieveConnect is the Connect-RPC projection of
// retrievePublished. The body is {query, correlationId}; the response
// is the canonical {query, results, backend, correlationId} envelope
// mirrored onto qzda.rag.v1.RetrieveResponse.
//
// The Connect binding (connect.go) calls this method directly so the
// Server doesn't have to know about ragv1.RetrieveResponse shaping.
func (s *Service) KnowledgeRetrieveConnect(r *http.Request, body map[string]any, corr string) (any, error) {
	return s.retrievePublishedNormalized(r, body, corr)
}

// KnowledgeSyncPublishedConnect is the ragConnect SyncPublished
// projection. The legacy implementation was a stub that echoed the
// requested doc count — preserved here as a thin delegator so the
// Connect binding doesn't change.
func (s *Service) KnowledgeSyncPublishedConnect(reqDocs int) int {
	return reqDocs
}
