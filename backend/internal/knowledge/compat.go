package knowledge

// Public delegators over the package-private (s *Service) helpers that
// the server package still calls (handlers_memory.go, handlers_pmsop.go,
// handlers_selfimproving.go, ...). After M07 P2 these helpers live in
// helpers.go as package-private methods. The Server side calls them
// through the thin delegators in server.go (Server.appendKnowledgeAuditLocked,
// Server.persistKnowledgeExtra, Server.writeKnowledgeBlob,
// Server.ensureDraftPackageLocked) so the package boundary stays clean.

// AppendKnowledgeAuditLocked is the public version of
// (s *Service).appendKnowledgeAuditLocked. Caller MUST hold
// Store.Lock; the implementation does NOT acquire the lock itself.
func (s *Service) AppendKnowledgeAuditLocked(ws, actor, action, target, result, reason string) {
	s.appendKnowledgeAuditLocked(ws, actor, action, target, result, reason)
}

// PersistKnowledgeExtra is the public version of
// (s *Service).persistKnowledgeExtra.
func (s *Service) PersistKnowledgeExtra() {
	s.persistKnowledgeExtra()
}

// WriteKnowledgeBlob is the public version of
// (s *Service).writeKnowledgeBlob.
func (s *Service) WriteKnowledgeBlob(ws, docID, content string) (string, error) {
	return s.writeKnowledgeBlob(ws, docID, content)
}

// EnsureDraftPackageLocked is the public version of
// (s *Service).ensureDraftPackageLocked. Caller MUST hold Store.Lock.
func (s *Service) EnsureDraftPackageLocked(ws, owner string) string {
	return s.ensureDraftPackageLocked(ws, owner)
}

// AttachDocsToPackageLocked is the public version of
// (s *Service).attachDocsToPackageLocked. Caller MUST hold
// Store.Lock. Returns the count of newly-attached docs (already
// attached ones are skipped, not double-counted).
func (s *Service) AttachDocsToPackageLocked(ws, pkgID string, docIDs []string, markReview bool) int {
	return s.attachDocsToPackageLocked(ws, pkgID, docIDs, markReview)
}

// RunKnowledgeJob is already declared in handlers_jobs.go as a public
// method on *Service — no delegator needed here. The Server-side
// runKnowledgeJob thin wrapper in server.go just calls
// s.knowledgeSvc.RunKnowledgeJob(jobID).