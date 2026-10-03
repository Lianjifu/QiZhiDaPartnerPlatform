package knowledge

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"

	"connectrpc.com/connect"
	ragv1 "github.com/qizhida-partner-platform/backend/gen/qzda/rag/v1"
)

// --- Test exports ---
//
// These functions expose the package-private helpers so external test
// files (notably internal/knowledge/handlers_test.go after M07 P2) can
// drive the canonical M07 handler paths without needing to construct the
// full Deps surface. Each is the minimal façade needed for a single
// test scenario; production code never calls them.

// EnsureKnowledgeSeededForTest runs the office builtin loader once.
// Mirrors the legacy *Server.EnsureBuiltinKnowledgeReady. Returns the
// final knowledge-doc count for the seeded "w1" workspace so tests can
// assert the loader actually populated the store.
func EnsureKnowledgeSeededForTest(s *Service) int {
	if s == nil {
		return 0
	}
	s.EnsureBuiltinKnowledgeReady()
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := 0
	for _, d := range s.Store.KnowledgeDocs {
		if d["builtin"] == true {
			out++
		}
	}
	return out
}

// BuildKnowledgePackageLockedForTest creates a draft package via the
// canonical CreateKnowledgePackage handler. Caller must have constructed
// the Service through NewService (which guarantees Store is non-nil)
// and must have bound the Deps fields needed for the create-package
// handler (WorkspaceID, DecodeMap, EvaluateWrite, AppendAudit, ...).
//
// Mirrors the legacy *Server.buildKnowledgePackageLocked helper used
// by TestKnowledgePackageAttachAndPublishScope et al. Returns the
// resulting package row from CreateKnowledgePackage so tests can assert
// the package id + status fields.
func BuildKnowledgePackageLockedForTest(s *Service, workspaceID, name string) (map[string]any, error) {
	if s == nil {
		return nil, nil
	}
	body, _ := json.Marshal(map[string]any{"name": name})
	r, _ := http.NewRequest(http.MethodPost, "/api/knowledge/packages", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("x-workspace-id", workspaceID)
	item, err := s.CreateKnowledgePackage(r)
	if err != nil {
		return nil, err
	}
	if m, ok := item.(map[string]any); ok {
		return m, nil
	}
	return nil, nil
}

// RetrieveRequestForTest synthesizes a minimal *http.Request carrying
// the retrieve body so external test fixtures can call
// KnowledgeRetrieve / retrievePublishedNormalized without hand-crafting
// the request every time.
//
// Returns (request, correlationID). When ws is non-empty, the
// x-workspace-id header is set so WorkspaceID() resolves correctly.
func RetrieveRequestForTest(query, ws, corr string) (*http.Request, string) {
	body, _ := json.Marshal(map[string]any{"query": query, "correlationId": corr})
	r, _ := http.NewRequest(http.MethodPost, "/api/knowledge/retrieve", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if ws != "" {
		r.Header.Set("x-workspace-id", ws)
	}
	if corr != "" {
		r.Header.Set("x-correlation-id", corr)
	}
	return r, corr
}

// ConnectRetrieveRequestForTest synthesizes a Connect-RPC-shaped
// retrieve request so external fixtures can call ragConnect.Retrieve
// without going through the buf-generated wire types every time.
//
// Returns (request, connect-request). The wire side gets a minimal
// RetrieveRequest with Query + CorrelationId set. The HTTP side carries
// the same Connect headers so requestFromConnect can clone them onto
// the synthesized *http.Request.
func ConnectRetrieveRequestForTest(ctx context.Context, query, corr string) (*http.Request, *connect.Request[ragv1.RetrieveRequest]) {
	r, _ := http.NewRequestWithContext(ctx, http.MethodPost, "/", nil)
	req := connect.NewRequest(&ragv1.RetrieveRequest{Query: query, CorrelationId: corr})
	for k, vs := range req.Header() {
		for _, v := range vs {
			r.Header.Add(k, v)
		}
	}
	return r, req
}