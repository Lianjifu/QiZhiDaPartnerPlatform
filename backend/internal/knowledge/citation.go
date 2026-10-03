package knowledge

import (
	"time"

	"github.com/qizhida-partner-platform/backend/internal/knowledge/citationlog"
)

// citationlogRecord is the local re-export of citationlog.Record so the
// rest of the package can refer to it without bouncing through
// `citationlog.X` at every call site. The Citation type and helpers
// (Build / ExtractQuote / QuoteHash) are similarly re-exported from
// the service.go `Citation` / `Hit` / `Tier` aliases.
type citationlogRecord = citationlog.Record

// CitationLog returns the per-Service citation log, hydrating it from
// KnowledgeExtra["citationLog"] on first use. All persistence happens
// in KnowledgeExtra so the existing snapshot machinery covers it.
//
// Public accessor kept on the Service so server code (handlers_c.go +
// any future chat handler) can record citations via a Deps callback
// (CitationlogFn + CitationQuoteFn) without re-importing the
// citationlog package directly.
//
// Mirrors the legacy *Server.citationLog() helper that lived in
// handlers_knowledge.go L1837-L1863.
func (s *Service) CitationLog() *citationlog.Log {
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

// LogCitation appends a citation event to the per-Service log.
// Idempotent for callers that may fire multiple citations per turn.
// Caller may be invoked from chat handlers; safe to call concurrently.
//
// Public accessor kept on the Service so server code (handlers_c.go +
// any future chat handler) can record citations via a Deps callback
// (CitationlogFn + CitationQuoteFn) without re-importing the
// citationlog package directly.
func (s *Service) LogCitation(workspaceID, turnID, docID, chunkID, tier, quoteHash string, score float64) {
	l := s.CitationLog()
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
