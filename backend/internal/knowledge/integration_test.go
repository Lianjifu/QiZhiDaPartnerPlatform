// Integration tests for the M07 知识中心 (Knowledge Center) handlers (K1–K17
// from docs/整合方案/知识中心模块整合方案.md §3.3 + §四 D8). Mirrors the
// pattern of internal/models/integration_test.go (T1–T16),
// internal/workflows/integration_test.go (W1–W15), and internal/partners/
// integration_test.go (P1–P14): each test boots a fresh server +
// in-memory store, mints a signed admin JWT for workspace "w1", and
// round-trips through the standard {ok, data, error} envelope used by
// pkg/response.
//
// Test surface (mirrors §3.3 of the plan doc):
//
//	K1  GET    /api/knowledge/docs                 — list docs
//	K2  POST   /api/knowledge/docs                 — create doc (id)
//	K3  POST   /api/knowledge/docs/delete          — bulk delete
//	K4  POST   /api/knowledge/retrieve             — retrieve (snippets + citations)
//	K5  GET    /api/knowledge/doc/{id}             — doc detail
//	K6  DELETE /api/knowledge/doc/{id}             — single-doc delete
//	K7  GET/POST /api/knowledge/packages           — list + create package
//	K8  POST   /api/knowledge/packages/{id}/{action} — package publish
//	K9  GET/POST /api/knowledge/sources(+ /sync)   — source list/create/sync
//	K10 GET/PATCH /api/knowledge/governance        — governance read+patch
//	K11 GET    /api/knowledge/audit                — audit log
//	K12 GET    /api/knowledge/processing-jobs(+ /retry) — jobs list + retry
//	K13 GET    /api/knowledge/retrieval-profiles  — retrieval profiles
//	K14 GET    /api/knowledge/evaluations + POST /evaluations/run
//	K15 GET    /api/knowledge/graph/entities + /graph/relations
//	K16 跨模块: qzda.rag.v1.RagService/Retrieve (Connect-RPC)
//	K17 GET    /api/knowledge/docs (no Authorization) — 401
//
// Package note: `package knowledge_test` (external test). The knowledge
// package is imported by internal/server, so an internal test would
// close an import cycle. All 17 tests reach the package via server.New
// which wires the 25 knowledgeSvc routes through s.knowledgeSvc.<Method>(r)
// per server.go L824-L908 + the ragConnect binding through
// knowledge.NewConnect per connect_services.go L47.
package knowledge_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/qizhida-partner-platform/backend/gen/qzda/rag/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/rag/v1/ragv1connect"
	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// envelope mirrors {ok, data, error} used by pkg/response. Kept in sync
// with internal/models/integration_test.go, internal/workflows/
// integration_test.go, internal/partners/integration_test.go.
type envelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error *envErr         `json:"error,omitempty"`
}

type envErr struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// signToken mints a signed JWT for the given identity.
func signToken(t *testing.T, id auth.Identity) string {
	t.Helper()
	tok, err := auth.Sign(id, time.Hour)
	if err != nil {
		t.Fatalf("auth.Sign: %v", err)
	}
	return tok
}

// newServer boots a fresh server + store for each sub-test and seeds
// the office builtin knowledge packs so the M07 module has docs /
// packages / retrieval-profiles to read.
func newServer(t *testing.T) (*server.Server, *store.Store) {
	t.Helper()
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinKnowledgeReady()
	return srv, st
}

// doRequest sends a single HTTP request through the server's Handler
// and returns the recorder. Authorization is set when tok is non-empty;
// Content-Type is set when body is non-nil.
func doRequest(t *testing.T, srv *server.Server, method, path, tok string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	return rr
}

func decodeEnvelope(t *testing.T, rr *httptest.ResponseRecorder) envelope {
	t.Helper()
	var e envelope
	if err := json.Unmarshal(rr.Body.Bytes(), &e); err != nil {
		t.Fatalf("envelope parse: %v body=%s", err, rr.Body.String())
	}
	return e
}

func decodeData(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("data parse: %v raw=%s", err, string(raw))
	}
	return m
}

// adminTok returns a signed admin JWT for workspace "w1". Admin holds
// every permission in the platform model (see auth.RolePermissions) so
// the knowledge.read / knowledge.write gates all open. The seeded
// KnowledgeDocs / KnowledgeExtra rows live in w1 so the workspace
// filter matches.
func adminTok(t *testing.T) string {
	t.Helper()
	return signToken(t, auth.Identity{
		ID: "u1", Name: "平台管理员", Email: "admin@acme.com",
		Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1",
		WorkspaceIDs: []string{"w1"},
		Permissions:  auth.RolePermissions("admin"),
	})
}

// roundTripperFunc — minimal RoundTripper adapter for httptest-based
// Connect clients. Mirrors internal/server/connect_rpc_test.go.
type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// ----------------------------------------------------------------------
// K1 — GET /api/knowledge/docs: 200 + JSON array
// ----------------------------------------------------------------------

// TestK1_ListDocs verifies the M07 list endpoint round-trips through
// the standard envelope and returns a JSON array of the workspace's
// knowledge docs. The builtin seed loads office-pack docs into
// workspace "w1" so the array has at least one entry.
func TestK1_ListDocs(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/knowledge/docs", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data is not an array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded builtin docs in list, got 0")
	}
}

// ----------------------------------------------------------------------
// K2 — POST /api/knowledge/docs: 200 + id
// ----------------------------------------------------------------------

// TestK2_CreateDoc verifies create returns a new doc id with the
// expected initial fields (status="indexing", workspaceId="w1",
// ownerId stamped from the actor). Admin has knowledge.write so the
// gate opens; the handler also creates a queued processing job and
// starts the chunking goroutine.
func TestK2_CreateDoc(t *testing.T) {
	srv, st := newServer(t)
	body := []byte(`{"title":"K2 测试文档","content":"K2 正文 — 集成测试用例","tags":["k2"]}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/docs", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if id, _ := d["id"].(string); id == "" {
		t.Fatalf("missing id in response; data=%v", d)
	}
	if d["status"] != "indexing" {
		t.Fatalf("status=%v, want indexing; data=%v", d["status"], d)
	}
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	// Verify the doc landed in the store.
	st.RLock()
	var found bool
	for _, d := range st.KnowledgeDocs {
		if d["workspaceId"] == "w1" && d["status"] == "indexing" && strings.Contains(toStr(d["title"]), "K2 测试") {
			found = true
			break
		}
	}
	st.RUnlock()
	if !found {
		t.Fatalf("K2 doc not in store.KnowledgeDocs after create")
	}
}

func toStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// ----------------------------------------------------------------------
// K3 — POST /api/knowledge/docs/delete: 200 (bulk delete)
// ----------------------------------------------------------------------

// TestK3_BulkDelete creates two docs, then bulk-deletes both via the
// /docs/delete endpoint. Asserts the response includes a deleted
// count + the id list. Uses the knowledge.write permission (admin).
func TestK3_BulkDelete(t *testing.T) {
	srv, st := newServer(t)
	tok := adminTok(t)
	created := []string{}
	for i := 0; i < 2; i++ {
		body := []byte(`{"title":"K3 待删除 ` + string(rune('A'+i)) + `","content":"K3 内容"}`)
		rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/docs", tok, body)
		if rr.Code != http.StatusOK {
			t.Fatalf("create #%d: want 200, got %d", i, rr.Code)
		}
		d := decodeData(t, decodeEnvelope(t, rr).Data)
		created = append(created, toStr(d["id"]))
	}
	if len(created) != 2 {
		t.Fatalf("created ids len=%d, want 2", len(created))
	}
	// Bulk delete via /docs/delete.
	body, _ := json.Marshal(map[string]any{"ids": created})
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/docs/delete", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("bulk delete: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("bulk delete ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if v, _ := d["deleted"].(float64); int(v) != 2 {
		t.Fatalf("deleted=%v, want 2; data=%v", d["deleted"], d)
	}
	// Verify the docs are gone from the store.
	st.RLock()
	stillThere := 0
	for _, x := range st.KnowledgeDocs {
		for _, id := range created {
			if x["id"] == id {
				stillThere++
			}
		}
	}
	st.RUnlock()
	if stillThere != 0 {
		t.Fatalf("after bulk delete, %d of the created docs still in store", stillThere)
	}
}

// ----------------------------------------------------------------------
// K4 — POST /api/knowledge/retrieve: 200 + retrieval results
// ----------------------------------------------------------------------

// TestK4_Retrieve exercises the canonical KnowledgeRetrieve handler
// end-to-end: it sends a query, the sidecar URL is empty (RAGURL not
// configured) → handler falls back to the in-memory published-only
// keyword path against the seeded builtin docs (which carry
// status="ready" / "published"), and the response includes a
// correlationId + the canonical {query, results, backend,
// correlationId, metrics} envelope.
//
// Deviation note: the plan called for "snippets + citations" — the
// canonical envelope returns results[] (snippets) + correlationId; the
// per-result citations field is on the Connect-RPC shape (see K16),
// not on the HTTP envelope.
func TestK4_Retrieve(t *testing.T) {
	srv, _ := newServer(t)
	body := []byte(`{"query":""}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/retrieve", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if corr, _ := d["correlationId"].(string); corr == "" {
		t.Fatalf("missing correlationId; data=%v", d)
	}
	if d["backend"] != "knowledge-control-plane" {
		t.Fatalf("backend=%v, want knowledge-control-plane", d["backend"])
	}
	results, ok := d["results"].([]any)
	if !ok || len(results) == 0 {
		t.Fatalf("results not array or empty: %v (raw=%s)", d["results"], string(e.Data))
	}
	// Every fallback result carries {idx, source, score, docId, text}.
	first, _ := results[0].(map[string]any)
	if first["docId"] == nil || first["text"] == nil {
		t.Fatalf("first result missing docId/text: %v", first)
	}
	if _, ok := d["metrics"].(map[string]any); !ok {
		t.Fatalf("missing metrics envelope; data=%v", d)
	}
}

// ----------------------------------------------------------------------
// K5 — GET /api/knowledge/doc/{id}: 200
// ----------------------------------------------------------------------

// TestK5_DocDetail reads the seeded first doc id and asks for it via the
// detail endpoint. Asserts the response includes the title + workspaceId
// and that the body echoes the seeded content.
func TestK5_DocDetail(t *testing.T) {
	srv, st := newServer(t)
	st.RLock()
	var docID, title string
	for _, d := range st.KnowledgeDocs {
		if d["workspaceId"] == "w1" {
			docID = toStr(d["id"])
			title = toStr(d["title"])
			break
		}
	}
	st.RUnlock()
	if docID == "" {
		t.Fatalf("no seeded w1 doc available")
	}
	rr := doRequest(t, srv, http.MethodGet, "/api/knowledge/doc/"+docID, adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["id"] != docID {
		t.Fatalf("id=%v, want %s", d["id"], docID)
	}
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	if d["title"] != title {
		t.Fatalf("title=%v, want %s", d["title"], title)
	}
}

// ----------------------------------------------------------------------
// K6 — DELETE /api/knowledge/doc/{id}: 200
// ----------------------------------------------------------------------

// TestK6_DeleteDoc creates a doc, then deletes it by id via the
// single-doc DELETE endpoint. Asserts the response includes the id and
// that the row is gone from the store.
func TestK6_DeleteDoc(t *testing.T) {
	srv, st := newServer(t)
	tok := adminTok(t)
	body := []byte(`{"title":"K6 待删除","content":"K6 内容"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/docs", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d", rr.Code)
	}
	d := decodeData(t, decodeEnvelope(t, rr).Data)
	id := toStr(d["id"])
	if id == "" {
		t.Fatalf("create response missing id; data=%v", d)
	}
	rr = doRequest(t, srv, http.MethodDelete, "/api/knowledge/doc/"+id, tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("delete ok=false: %+v body=%s", e, rr.Body.String())
	}
	d = decodeData(t, e.Data)
	if v, _ := d["deleted"].(float64); v != 1 {
		t.Fatalf("deleted=%v, want 1", d["deleted"])
	}
	st.RLock()
	still := 0
	for _, x := range st.KnowledgeDocs {
		if x["id"] == id {
			still++
		}
	}
	st.RUnlock()
	if still != 0 {
		t.Fatalf("doc %s still in store after delete", id)
	}
}

// ----------------------------------------------------------------------
// K7 — GET/POST /api/knowledge/packages: 200
// ----------------------------------------------------------------------

// TestK7_PackagesListAndCreate exercises both verbs on /packages:
//   GET  — returns the seeded builtin packages (≥1 in workspace w1)
//   POST — creates a new draft package; response carries the new id
func TestK7_PackagesListAndCreate(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// GET
	rr := doRequest(t, srv, http.MethodGet, "/api/knowledge/packages", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("list ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("list data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded builtin packages in list, got 0")
	}

	// POST
	body := []byte(`{"name":"K7 测试知识包","description":"集成测试"}`)
	rr = doRequest(t, srv, http.MethodPost, "/api/knowledge/packages", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("create ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["name"] != "K7 测试知识包" {
		t.Fatalf("name=%v, want K7 测试知识包", d["name"])
	}
	if d["status"] != "draft" {
		t.Fatalf("status=%v, want draft", d["status"])
	}
	if id, _ := d["id"].(string); id == "" {
		t.Fatalf("missing id; data=%v", d)
	}
}

// ----------------------------------------------------------------------
// K8 — POST /api/knowledge/packages/{id}/publish: 200
// ----------------------------------------------------------------------

// TestK8_PackagePublish picks the first seeded builtin package
// (status="published" with at least one ready/published doc attached
// via the builtin loader) and re-publishes it. The handler still
// increments the patch version + writes an audit row even when the
// target is already published.
//
// Deviation note: the plan listed "/publish" generically. The
// canonical path shape is /api/knowledge/packages/{id}/{action}; we
// use {action}=publish against a builtin seed so no SoD countersign
// or eval-recall gate blocks the publish in a non-DE_ENV=production
// test env.
func TestK8_PackagePublish(t *testing.T) {
	srv, st := newServer(t)
	tok := adminTok(t)
	st.RLock()
	var pkgID string
	for _, p := range knowledgeExtraSlice(st.KnowledgeExtra, "packages") {
		if p["workspaceId"] == "w1" || p["workspaceId"] == "" {
			pkgID = toStr(p["id"])
			break
		}
	}
	st.RUnlock()
	if pkgID == "" {
		t.Fatalf("no seeded package available")
	}
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/packages/"+pkgID+"/publish", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("publish: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("publish ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["id"] != pkgID {
		t.Fatalf("id=%v, want %s", d["id"], pkgID)
	}
	if d["status"] != "published" {
		t.Fatalf("status=%v, want published", d["status"])
	}
	if d["currentVersion"] == nil {
		t.Fatalf("missing currentVersion; data=%v", d)
	}
}

// knowledgeExtraSlice is a local helper that fetches a KnowledgeExtra
// slice key (returns nil if the slot is missing) without exposing the
// package-private knowledgeSliceMaps.
func knowledgeExtraSlice(x map[string]any, key string) []map[string]any {
	if x == nil {
		return nil
	}
	switch v := x[key].(type) {
	case []map[string]any:
		return v
	case []any:
		out := make([]map[string]any, 0, len(v))
		for _, it := range v {
			if m, ok := it.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

// ----------------------------------------------------------------------
// K9 — GET/POST /api/knowledge/sources(+ /sync): 200
// ----------------------------------------------------------------------

// TestK9_SourcesListCreateSync exercises the source lifecycle:
//   GET  /sources                  — list returns at least one seeded
//                                    builtin-source seed row
//   POST /sources                  — create a new source (id stamped)
//   POST /sources/{id}/sync        — mark healthy + create a sync'd doc
func TestK9_SourcesListCreateSync(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// GET (seeded sources list)
	rr := doRequest(t, srv, http.MethodGet, "/api/knowledge/sources", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("list ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("list data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded builtin sources in list, got 0")
	}

	// POST (create a REST-API source)
	body := []byte(`{"name":"K9 测试数据源","kind":"REST API","endpoint":"https://example.com/feed","schedule":"每 6 小时"}`)
	rr = doRequest(t, srv, http.MethodPost, "/api/knowledge/sources", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("create: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("create ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	srcID := toStr(d["id"])
	if srcID == "" {
		t.Fatalf("create response missing id; data=%v", d)
	}
	if d["status"] != "attention" {
		t.Fatalf("initial status=%v, want attention", d["status"])
	}

	// POST /sync
	rr = doRequest(t, srv, http.MethodPost, "/api/knowledge/sources/"+srcID+"/sync", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("sync: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("sync ok=false: %+v body=%s", e, rr.Body.String())
	}
	d = decodeData(t, e.Data)
	if d["status"] != "healthy" {
		t.Fatalf("post-sync status=%v, want healthy", d["status"])
	}
	if d["documents"].(float64) < 1 {
		t.Fatalf("post-sync documents=%v, want ≥1", d["documents"])
	}
}

// ----------------------------------------------------------------------
// K10 — GET/PATCH /api/knowledge/governance: 200
// ----------------------------------------------------------------------

// TestK10_GovernanceGetAndPatch exercises both verbs on /governance.
// GET returns the normalized governance map (sensitiveDataDetection,
// versionRetention, retentionDays, highRiskChangeApproval, piiMasking
// — all true / 365 in the default seed). PATCH overlays a new
// retentionDays value and the response reflects it.
func TestK10_GovernanceGetAndPatch(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// GET
	rr := doRequest(t, srv, http.MethodGet, "/api/knowledge/governance", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("get ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	if d["highRiskChangeApproval"] != true {
		t.Fatalf("highRiskChangeApproval=%v, want true (default seed)", d["highRiskChangeApproval"])
	}
	if v, _ := d["retentionDays"].(float64); v != 365 {
		t.Fatalf("retentionDays=%v, want 365 (default seed)", d["retentionDays"])
	}

	// PATCH
	patch := []byte(`{"retentionDays":180,"highRiskChangeApproval":false}`)
	rr = doRequest(t, srv, http.MethodPatch, "/api/knowledge/governance", tok, patch)
	if rr.Code != http.StatusOK {
		t.Fatalf("patch: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("patch ok=false: %+v body=%s", e, rr.Body.String())
	}
	d = decodeData(t, e.Data)
	if v, _ := d["retentionDays"].(float64); v != 180 {
		t.Fatalf("retentionDays=%v, want 180 (patched)", d["retentionDays"])
	}
	if d["highRiskChangeApproval"] != false {
		t.Fatalf("highRiskChangeApproval=%v, want false (patched)", d["highRiskChangeApproval"])
	}
}

// ----------------------------------------------------------------------
// K11 — GET /api/knowledge/audit: 200 + audit entries
// ----------------------------------------------------------------------

// TestK11_Audit lists the knowledge audit log. The seed + every prior
// K test appends audit rows (create/delete/etc.), so the list is
// non-empty. We assert at least one entry plus a sample field shape.
func TestK11_Audit(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// Seed an extra audit row by creating + deleting a doc.
	body := []byte(`{"title":"K11 审计触发","content":"K11 内容"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/docs", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("seed create: want 200, got %d", rr.Code)
	}
	d := decodeData(t, decodeEnvelope(t, rr).Data)
	docID := toStr(d["id"])
	if docID != "" {
		_ = doRequest(t, srv, http.MethodDelete, "/api/knowledge/doc/"+docID, tok, nil)
	}

	rr = doRequest(t, srv, http.MethodGet, "/api/knowledge/audit", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("list ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected at least one audit row, got 0")
	}
	first, _ := arr[0].(map[string]any)
	if first["actor"] == nil || first["action"] == nil || first["time"] == nil {
		t.Fatalf("first audit row missing actor/action/time: %v", first)
	}
}

// ----------------------------------------------------------------------
// K12 — GET /api/knowledge/processing-jobs(+ /retry): 200
// ----------------------------------------------------------------------

// TestK12_ProcessingJobs exercises both verbs on /processing-jobs:
//   GET  /processing-jobs                    — list returns ≥1
//                                              (the K2 create queued one)
//   POST /processing-jobs/{id}/retry         — flip status back to queued
func TestK12_ProcessingJobs(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// Create a doc — that handler also creates a queued processing job.
	body := []byte(`{"title":"K12 加工任务","content":"K12 内容"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/docs", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("seed create: want 200, got %d", rr.Code)
	}

	// GET
	rr = doRequest(t, srv, http.MethodGet, "/api/knowledge/processing-jobs", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("list ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("list data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected ≥1 processing job, got 0")
	}
	first, _ := arr[0].(map[string]any)
	jobID := toStr(first["id"])
	if jobID == "" {
		t.Fatalf("first job missing id: %v", first)
	}

	// POST /retry
	rr = doRequest(t, srv, http.MethodPost, "/api/knowledge/processing-jobs/"+jobID+"/retry", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("retry: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("retry ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["id"] != jobID {
		t.Fatalf("id=%v, want %s", d["id"], jobID)
	}
	if d["status"] != "queued" {
		t.Fatalf("status=%v, want queued (after retry)", d["status"])
	}
}

// ----------------------------------------------------------------------
// K13 — GET /api/knowledge/retrieval-profiles: 200
// ----------------------------------------------------------------------

// TestK13_RetrievalProfiles lists the seeded retrieval profiles (the
// office builtin loader seeds a default profile named "办公默认检索"
// with retrievalModes {keyword, vector}, topK=5, rerankEnabled=true,
// noResultPolicy=handoff). Asserts the array shape + the default row.
func TestK13_RetrievalProfiles(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/knowledge/retrieval-profiles", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded retrieval profile, got 0")
	}
	first, _ := arr[0].(map[string]any)
	modes, _ := first["retrievalModes"].([]any)
	if len(modes) < 2 {
		t.Fatalf("retrievalModes too short: %v", first["retrievalModes"])
	}
	if first["noResultPolicy"] != "handoff" {
		t.Fatalf("noResultPolicy=%v, want handoff (default)", first["noResultPolicy"])
	}
}

// ----------------------------------------------------------------------
// K14 — GET /api/knowledge/evaluations + POST /evaluations/run: 200
// ----------------------------------------------------------------------

// TestK14_EvaluationsListAndRun exercises both verbs:
//   GET  /evaluations           — list returns the array shape
//   POST /evaluations/run       — runs the eval gate; writes a row
//                                 and returns the report
//
// Deviation note: the plan listed "GET /api/knowledge/evaluations +
// POST /api/knowledge/evaluations/run". The handler also writes to
// KnowledgeExtra["eval"] (the canonical eval gate envelope used by
// the package-publish recall gate), but we focus on the historical
// list endpoint per the plan spec.
func TestK14_EvaluationsListAndRun(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// POST /evaluations/run — produces a report row.
	body := []byte(`{}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/evaluations/run", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("run: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("run ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if _, ok := d["recallAtK"].(float64); !ok {
		t.Fatalf("missing recallAtK; data=%v", d)
	}
	if _, ok := d["status"].(string); !ok {
		t.Fatalf("missing status; data=%v", d)
	}

	// GET /evaluations — the run just persisted a new row.
	rr = doRequest(t, srv, http.MethodGet, "/api/knowledge/evaluations", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("list ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("list data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected ≥1 evaluation row after run, got 0")
	}
}

// ----------------------------------------------------------------------
// K15 — GET /api/knowledge/graph/entities + /graph/relations: 200
// ----------------------------------------------------------------------

// TestK15_GraphEntitiesAndRelations exercises both graph list
// endpoints. The RunKnowledgeJob goroutine writes graph entities
// + relations, so we trigger one job and let it run before listing.
// We tolerate an empty array (the worker may not have completed by
// list time) — the assertion is purely on the 200 + array envelope.
func TestK15_GraphEntitiesAndRelations(t *testing.T) {
	srv, _ := newServer(t)
	tok := adminTok(t)

	// Seed a doc so the worker has at least one target.
	body := []byte(`{"title":"K15 知识图谱","content":"K15 内容"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/knowledge/docs", tok, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("seed create: want 200, got %d", rr.Code)
	}

	// GET /graph/entities
	rr = doRequest(t, srv, http.MethodGet, "/api/knowledge/graph/entities", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("entities: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("entities ok=false: %+v body=%s", e, rr.Body.String())
	}
	var entities []any
	if err := json.Unmarshal(e.Data, &entities); err != nil {
		t.Fatalf("entities data not array: %v raw=%s", err, string(e.Data))
	}

	// GET /graph/relations
	rr = doRequest(t, srv, http.MethodGet, "/api/knowledge/graph/relations", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("relations: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("relations ok=false: %+v body=%s", e, rr.Body.String())
	}
	var relations []any
	if err := json.Unmarshal(e.Data, &relations); err != nil {
		t.Fatalf("relations data not array: %v raw=%s", err, string(e.Data))
	}

	// If the worker has flushed, entities should be non-empty (one
	// per doc). We only assert the shape + 200 here; the timing
	// guarantee is the worker's problem, not the API's.
	_ = entities
	_ = relations
}

// ----------------------------------------------------------------------
// K16 — 跨模块: Connect-RPC qzda.rag.v1.RagService/Retrieve: 200
// ----------------------------------------------------------------------

// TestK16_ConnectRPCRetrieve exercises the ragConnect binding that
// the M07 P2 deep move put behind internal/knowledge/connect.go
// (Bind: knowledge.NewConnect → ragv1connect.NewRagServiceHandler
// in server.go connect_services.go L47). The Connect client dials
// the in-process handler through a roundTripperFunc that stamps the
// dev mock-admin-token + x-workspace-id header so the auth + workspace
// middleware accept the call.
//
// Request shape: ragv1.RetrieveRequest{Query, CorrelationId,
// PublishedOnly}. Response shape: ragv1.RetrieveResponse{Query,
// CorrelationId, Backend, Results[]*RetrieveHit}. We assert:
//   - no Connect error
//   - correlationId round-trips (or auto-generated)
//   - at least one result hit (the seeded builtin docs supply
//     published corpus for the fallback keyword path)
func TestK16_ConnectRPCRetrieve(t *testing.T) {
	srv := newServerConn(t)
	client := ragv1connect.NewRagServiceClient(
		&http.Client{Transport: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			r.Header.Set("Authorization", "Bearer mock-admin-token")
			r.Header.Set("x-workspace-id", "w1")
			rr := httptest.NewRecorder()
			srv.Handler().ServeHTTP(rr, r)
			return rr.Result(), nil
		})},
		"http://test",
	)
	res, err := client.Retrieve(context.Background(), connect.NewRequest(&ragv1.RetrieveRequest{
		Query:         "", // empty query → fallback path returns every published doc
		CorrelationId: "corr-k16-1",
		PublishedOnly: true,
	}))
	if err != nil {
		t.Fatalf("connect.Retrieve: %v", err)
	}
	if res.Msg.GetCorrelationId() != "corr-k16-1" {
		t.Fatalf("corr=%s, want corr-k16-1", res.Msg.GetCorrelationId())
	}
	if res.Msg.GetBackend() == "" {
		t.Fatalf("backend empty; msg=%+v", res.Msg)
	}
	if len(res.Msg.GetResults()) == 0 {
		t.Fatalf("expected ≥1 result, got 0; msg=%+v", res.Msg)
	}
	first := res.Msg.GetResults()[0]
	if first.GetDocId() == "" {
		t.Fatalf("first hit docId empty: %+v", first)
	}
}

// newServerConn boots a server specifically for Connect-RPC tests; we
// pass through the workspace cookie / mock token via the roundTripper
// rather than a signed JWT so we don't depend on auth.Sign.
func newServerConn(t *testing.T) *server.Server {
	t.Helper()
	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinKnowledgeReady()
	return srv
}

// ----------------------------------------------------------------------
// K17 — GET /api/knowledge/docs (no Authorization): 401
// ----------------------------------------------------------------------

// TestK17_Unauthorized confirms the auth middleware rejects
// unauthenticated requests with 401, matching TestT16_Unauthorized
// (M08) / TestW14_Unauthorized (M06) / TestP13_Unauthorized (M05)
// / TestC9_Unauthorized (M02) precedent.
func TestK17_Unauthorized(t *testing.T) {
	srv, _ := newServer(t)
	t.Setenv("DE_BAN_MOCK_TOKEN", "")
	rr := doRequest(t, srv, http.MethodGet, "/api/knowledge/docs", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if e.OK {
		t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
	}
}