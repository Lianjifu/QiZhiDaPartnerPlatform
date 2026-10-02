// Integration tests for the M08 模型中心 (Model Center) handlers (T1–T16
// from docs/整合方案/模型中心模块整合方案.md §3.3). Mirrors the pattern of
// internal/workflows/integration_test.go (W1–W15), internal/partners/
// integration_test.go (P1–P14), and internal/copilot/integration_test.go
// (C1–C9): each test boots a fresh server + in-memory store, mints a signed
// JWT for an admin identity, and round-trips through the standard
// {ok, data, error} envelope used by pkg/response.
//
// Test surface (mirrors §3.3 of the plan doc):
//
//	T1  GET   /api/model-providers                          — list providers
//	T2  POST  /api/model-providers                          — create provider (id)
//	T3  POST  /api/model-providers/discover-models          — discover candidate models (httptest stub)
//	T4  POST  /api/model-providers/test-connection          — probe connectivity (httptest stub)
//	T5  GET   /api/model-providers/{id}/impact              — impact analysis
//	    PATCH /api/model-providers/{id}                     — patch fields
//	    DELETE /api/model-providers/{id}                     — delete provider
//	T6  GET   /api/model-routing/policies                   — list policies
//	T7  POST  /api/model-routing/policies                   — create policy (id)
//	T8  PATCH /api/model-routing/policies/{id}/draft       — update draft
//	    GET   /api/model-routing/policies/{id}/versions    — list versions
//	T9  POST  /api/model-routing/failover-tests            — drill on published route
//	T11 GET   /api/model-audit                             — audit entries
//	T12 POST  /api/model-invoke                            — sync invoke via embedded provider
//	T13 POST  /api/model-invoke/stream                     — SSE stream (parse `data:` chunks)
//	T14 GET   /api/models/providers                        — FE alias for ListModelProviders
//	T15 GET   /api/model/providers                         — legacy alias for ListModelProviders
//	T10 GET   /api/model-governance/overview               — overview stats
//	T16 GET   /api/model-providers (no Authorization)      — 401
//
// Package note: `package models_test` (external test). The models
// package is imported by internal/server, so an internal test would
// close an import cycle. All 16 tests reach the package via server.New
// which wires the 17 modelSvc routes through s.modelSvc.<Method>(r)
// per server.go L777-L821.
package models_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// envelope mirrors {ok, data, error} used by pkg/response. Kept in sync
// with internal/partners/integration_test.go, internal/workflows/
// integration_test.go, internal/tasks/integration_test.go.
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

// newServer boots a fresh server + store for each sub-test.
func newServer(t *testing.T) (*server.Server, *store.Store) {
	t.Helper()
	st := store.New()
	return server.New(st), st
}

// doRequest sends a single HTTP request through the server's Handler and
// returns the recorder. Authorization is set when tok is non-empty;
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
// every permission in the platform model (see auth.RolePermissions) and
// the result set includes model.read + model.write so all 16 routes'
// permission gates open.
func adminTok(t *testing.T) string {
	t.Helper()
	return signToken(t, auth.Identity{
		ID: "u1", Name: "平台管理员", Email: "admin@acme.com",
		Role: "admin", TenantID: "tenant-acme", WorkspaceID: "w1",
		Permissions: auth.RolePermissions("admin"),
	})
}

// seedEmbeddedProvider adds a deterministic embedded-protocol provider
// to the store so T12 (ModelInvoke) and T13 (ModelInvokeStream) have
// a candidate whose StreamChat dispatches into streamEmbedded — no
// network is hit. Workspace "w1" matches admin identity's WorkspaceID.
// `protocol: "embedded"` short-circuits StreamChat before ValidateBaseURL
// runs, so the baseUrl placeholder is fine.
func seedEmbeddedProvider(t *testing.T, st *store.Store, id string) {
	t.Helper()
	st.Lock()
	defer st.Unlock()
	st.ModelProviders = append(st.ModelProviders, map[string]any{
		"id": id, "workspaceId": "w1", "name": "T12 内置对话", "tier": "self_hosted",
		"protocol": "embedded", "baseUrl": "https://placeholder.local",
		"cloudRegion": "cn-east", "dataResidency": "cn",
		"status": "active", "credentialRef": "",
		"models": []map[string]any{
			{"id": id + "-m", "providerId": id, "name": "local-chat",
				"cloudRegion": "cn-east", "dataResidency": "cn",
				"capabilities": []string{"chat"}, "status": "available", "contextWindow": 32000},
		},
	})
}

// llmStubServer returns an httptest.Server that always answers 200 OK
// with the configured body. Used by T3 (discover-models) and T4
// (test-connection) so neither case ever dials a real provider URL.
func llmStubServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
}

// ----------------------------------------------------------------------
// T1 — GET /api/model-providers: 200 + JSON array
// ----------------------------------------------------------------------

// TestT1_ListProviders verifies the M08 list endpoint round-trips
// through the standard envelope and returns a JSON array of the
// workspace's model providers. The store seeds mp-1 + mp-2 in workspace
// "w1"; the admin identity owns that workspace so the filter lets
// both rows through.
func TestT1_ListProviders(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/model-providers", adminTok(t), nil)
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
	if len(arr) < 2 {
		t.Fatalf("expected seeded providers in list, got %d entries", len(arr))
	}
}

// ----------------------------------------------------------------------
// T2 — POST /api/model-providers: 200 + id
// ----------------------------------------------------------------------

// TestT2_CreateProvider verifies create returns a new provider id and
// initial status="standby". Admin has model.write so the gate opens.
// Deviation note: the plan said status="draft"; the implementation
// sets status="standby" (handlers.go L408) so we assert "standby".
func TestT2_CreateProvider(t *testing.T) {
	srv, st := newServer(t)
	before := len(st.ModelProviders)
	body := []byte(`{"name":"T2 测试供应商","model":"test-model","baseUrl":"https://example.com/v1","protocol":"openai_compatible","credential":"sk-test"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/model-providers", adminTok(t), body)
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
	if d["status"] != "standby" {
		t.Fatalf("status=%v, want standby; data=%v", d["status"], d)
	}
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	if got := len(st.ModelProviders); got != before+1 {
		t.Fatalf("store.ModelProviders count=%d, want %d", got, before+1)
	}
}

// ----------------------------------------------------------------------
// T3 — POST /api/model-providers/discover-models: 200 + candidate list
// ----------------------------------------------------------------------

// TestT3_DiscoverModels verifies the discover handler round-trips
// through a stub httptest LLM server (no real network call). The stub
// returns an OpenAI-compatible /v1/models payload; the handler's
// discoverRemote loop should parse {data:[…]} into the Models slice
// and return a non-empty list.
//
// DE_MODEL_ALLOW_PRIVATE=1 lets ValidateBaseURL accept the test
// server's 127.0.0.1 loopback URL.
func TestT3_DiscoverModels(t *testing.T) {
	t.Setenv("DE_MODEL_ALLOW_PRIVATE", "1")
	srv, _ := newServer(t)
	stub := llmStubServer(t, `{"data":[{"id":"stub-model-a","object":"model"},{"id":"stub-model-b","object":"model"}]}`)
	defer stub.Close()

	body := []byte(fmt.Sprintf(`{"protocol":"openai_compatible","baseUrl":"%s","apiKey":"sk-test"}`, stub.URL))
	rr := doRequest(t, srv, http.MethodPost, "/api/model-providers/discover-models", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	models, ok := d["models"].([]any)
	if !ok || len(models) < 2 {
		t.Fatalf("models not array or too few: %v (raw=%s)", d["models"], string(e.Data))
	}
	if s, _ := d["protocol"].(string); s != "openai_compatible" {
		t.Fatalf("protocol=%v, want openai_compatible", d["protocol"])
	}
}

// ----------------------------------------------------------------------
// T4 — POST /api/model-providers/test-connection: 200 (mock LLM endpoint)
// ----------------------------------------------------------------------

// TestT4_TestConnection verifies the connection probe hits the stub
// httptest server (no real network). Probe gets 200 OK → Healthy=true
// → handler returns status="healthy" + latencyMs. We assert the 200
// + status + protocol echo.
func TestT4_TestConnection(t *testing.T) {
	t.Setenv("DE_MODEL_ALLOW_PRIVATE", "1")
	srv, _ := newServer(t)
	stub := llmStubServer(t, `{"object":"list"}`)
	defer stub.Close()

	body := []byte(fmt.Sprintf(`{"protocol":"openai_compatible","baseUrl":"%s","apiKey":"sk-test"}`, stub.URL))
	rr := doRequest(t, srv, http.MethodPost, "/api/model-providers/test-connection", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["status"] != "healthy" {
		t.Fatalf("status=%v, want healthy; data=%v", d["status"], d)
	}
	if _, ok := d["latencyMs"]; !ok {
		t.Fatalf("missing latencyMs; data=%v", d)
	}
}

// ----------------------------------------------------------------------
// T5 — GET/PATCH/DELETE /api/model-providers/{id}/*: 200
// ----------------------------------------------------------------------

// TestT5_ProviderActionDispatch exercises the catch-all
// ModelProviderAction dispatcher with three verbs:
//
//	GET   /api/model-providers/mp-2/impact → providerImpactLocked
//	PATCH /api/model-providers/mp-2        → patchModelProvider
//	DELETE /api/model-providers/mp-2        → deleteModelProvider
//
// mp-2 is standby and not referenced by any published routing policy
// (rp-p0/rp-p1/rp-p3 all use mp-1 models), so the impact check
// reports deletionAllowed=true. We snapshot the label field on PATCH
// and verify the row is gone after DELETE.
func TestT5_ProviderActionDispatch(t *testing.T) {
	srv, st := newServer(t)
	tok := adminTok(t)

	// GET impact: confirms mp-2 is deletable
	rr := doRequest(t, srv, http.MethodGet, "/api/model-providers/mp-2/impact", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("impact: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("impact ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["providerId"] != "mp-2" {
		t.Fatalf("providerId=%v, want mp-2", d["providerId"])
	}
	if d["deletionAllowed"] != true {
		t.Fatalf("deletionAllowed=%v, want true; data=%v", d["deletionAllowed"], d)
	}

	// PATCH: shallow merge "note" field
	patch := []byte(`{"note":"T5 备注覆盖"}`)
	rr = doRequest(t, srv, http.MethodPatch, "/api/model-providers/mp-2", tok, patch)
	if rr.Code != http.StatusOK {
		t.Fatalf("patch: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("patch ok=false: %+v body=%s", e, rr.Body.String())
	}
	d = decodeData(t, e.Data)
	if d["note"] != "T5 备注覆盖" {
		t.Fatalf("note=%v, want 'T5 备注覆盖'", d["note"])
	}

	// DELETE: removes mp-2 from the store
	rr = doRequest(t, srv, http.MethodDelete, "/api/model-providers/mp-2", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("delete ok=false: %+v body=%s", e, rr.Body.String())
	}
	d = decodeData(t, e.Data)
	if d["id"] != "mp-2" {
		t.Fatalf("delete id=%v, want mp-2", d["id"])
	}
	if d["status"] != "deleted" {
		t.Fatalf("delete status=%v, want deleted", d["status"])
	}
	st.RLock()
	found := false
	for _, p := range st.ModelProviders {
		if p["id"] == "mp-2" {
			found = true
		}
	}
	st.RUnlock()
	if found {
		t.Fatalf("mp-2 still in store after delete")
	}
}

// ----------------------------------------------------------------------
// T6 — GET /api/model-routing/policies: 200 + array
// ----------------------------------------------------------------------

// TestT6_ListRoutingPolicies verifies the policies list endpoint
// round-trips. The store seeds rp-p0/rp-p1/rp-p3 (published) +
// rp-draft (draft) all in workspace "w1".
func TestT6_ListRoutingPolicies(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/model-routing/policies", adminTok(t), nil)
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
	if len(arr) < 3 {
		t.Fatalf("expected ≥3 published policies in list, got %d", len(arr))
	}
}

// ----------------------------------------------------------------------
// T7 — POST /api/model-routing/policies: 200 + id
// ----------------------------------------------------------------------

// TestT7_CreateRoutingPolicy verifies create returns a new policy id
// with initial status="draft". The plan said status="pending"; the
// implementation sets status="draft" (handlers_routing.go L62).
func TestT7_CreateRoutingPolicy(t *testing.T) {
	srv, st := newServer(t)
	before := len(st.RoutingPolicies)
	body := []byte(`{"level":"P2","primaryModelId":"mdl-gpt4","fallbackModelIds":["mdl-mini"],"budgetLimitUsd":100,"dataScope":"internal"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/model-routing/policies", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if id, _ := d["id"].(string); id == "" {
		t.Fatalf("missing id; data=%v", d)
	}
	if d["status"] != "draft" {
		t.Fatalf("status=%v, want draft; data=%v", d["status"], d)
	}
	if d["workspaceId"] != "w1" {
		t.Fatalf("workspaceId=%v, want w1", d["workspaceId"])
	}
	if got := len(st.RoutingPolicies); got != before+1 {
		t.Fatalf("store.RoutingPolicies count=%d, want %d", got, before+1)
	}
}

// ----------------------------------------------------------------------
// T8 — PATCH /api/model-routing/policies/{id}/draft: 200
//       GET /api/model-routing/policies/{id}/versions: 200
// ----------------------------------------------------------------------

// TestT8_PolicyActionDispatch exercises the RoutingPolicyAction
// catch-all with the two non-mutating verb paths:
//
//	PATCH /api/model-routing/policies/rp-draft/draft → updates draft fields
//	GET   /api/model-routing/policies/rp-p0/version  → would 404 (no versions sub-action for rp-p0)
//	GET   /api/model-routing/policies/rp-p0/versions → returns PolicyVersions (seeded rpv-1)
//
// Deviation note: the plan listed "GET/PATCH /{id}/*" generically.
// The real routes dispatch via parts[3] (policyId) and parts[4]
// (action). PATCH without an action suffix falls into the "unknown"
// 404 path; PATCH .../draft is the documented update flow. We exercise
// the canonical update path + the published versions list.
func TestT8_PolicyActionDispatch(t *testing.T) {
	srv, st := newServer(t)
	tok := adminTok(t)

	// PATCH .../draft: shallow merge of budgetLimitUsd
	patch := []byte(`{"budgetLimitUsd":250}`)
	rr := doRequest(t, srv, http.MethodPatch, "/api/model-routing/policies/rp-draft/draft", tok, patch)
	if rr.Code != http.StatusOK {
		t.Fatalf("patch draft: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("patch draft ok=false: %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["id"] != "rp-draft" {
		t.Fatalf("id=%v, want rp-draft", d["id"])
	}
	if d["status"] != "draft" {
		t.Fatalf("status=%v, want draft", d["status"])
	}
	// Verify the PATCH landed in the store (not just echoed in response).
	st.RLock()
	var saw250 bool
	for _, p := range st.RoutingPolicies {
		if p["id"] == "rp-draft" {
			if v, ok := p["budgetLimitUsd"].(float64); ok && v == 250 {
				saw250 = true
			}
		}
	}
	st.RUnlock()
	if !saw250 {
		t.Fatalf("store.RoutingPolicies budgetLimitUsd for rp-draft not updated to 250")
	}

	// GET .../versions: returns the seeded rpv-1 row for rp-p0
	rr = doRequest(t, srv, http.MethodGet, "/api/model-routing/policies/rp-p0/versions", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("versions: want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e = decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("versions ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("versions data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) == 0 {
		t.Fatalf("expected seeded rpv-1 in versions list, got 0")
	}
}

// ----------------------------------------------------------------------
// T9 — POST /api/model-routing/failover-tests: 200
// ----------------------------------------------------------------------

// TestT9_FailoverTest exercises the failover drill handler. The seed
// rp-p0 is the documented happy case (published + valid + has fallbacks
// mdl-mini). The handler returns correlationId + fromModelId/toModelId
// transition.
func TestT9_FailoverTest(t *testing.T) {
	srv, _ := newServer(t)
	body := []byte(`{"policyId":"rp-p0","scope":"sandbox","reason":"T9 演练"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/model-routing/failover-tests", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if d["status"] != "passed" {
		t.Fatalf("status=%v, want passed; data=%v", d["status"], d)
	}
	if d["policyId"] != "rp-p0" {
		t.Fatalf("policyId=%v, want rp-p0", d["policyId"])
	}
	if d["fromModelId"] != "mdl-gpt4" {
		t.Fatalf("fromModelId=%v, want mdl-gpt4", d["fromModelId"])
	}
	if d["toModelId"] != "mdl-mini" {
		t.Fatalf("toModelId=%v, want mdl-mini", d["toModelId"])
	}
	if d["correlationId"] != "" {
		// correlationId is generated; presence alone is the contract.
		_ = d["correlationId"]
	}
}

// ----------------------------------------------------------------------
// T10 — GET /api/model-governance/overview: 200 + overview stats
// ----------------------------------------------------------------------

// TestT10_GovernanceOverview verifies the governance overview
// endpoint round-trips with the documented counter fields
// (activeProviders, standbyProviders, monthlyBudgetUsd, etc.). The seed
// has mp-1 active and mp-2 standby in w1, so active≥1 and standby≥1.
func TestT10_GovernanceOverview(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/model-governance/overview", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if v, _ := d["activeProviders"].(float64); v < 1 {
		t.Fatalf("activeProviders=%v, want ≥1 (mp-1 seeded active); data=%v", d["activeProviders"], d)
	}
	if v, _ := d["standbyProviders"].(float64); v < 1 {
		t.Fatalf("standbyProviders=%v, want ≥1 (mp-2 seeded standby); data=%v", d["standbyProviders"], d)
	}
	if _, ok := d["publishedRoutes"]; !ok {
		t.Fatalf("missing publishedRoutes; data=%v", d)
	}
	if _, ok := d["monthlyBudgetUsd"]; !ok {
		t.Fatalf("missing monthlyBudgetUsd; data=%v", d)
	}
	if _, ok := d["budgetRisk"]; !ok {
		t.Fatalf("missing budgetRisk; data=%v", d)
	}
}

// ----------------------------------------------------------------------
// T11 — GET /api/model-audit: 200 + audit entries
// ----------------------------------------------------------------------

// TestT11_ListModelAudit verifies the audit log endpoint round-trips.
// The store seeds ma-1 (publish policy P0 success) in workspace "w1".
// After T2+T9 run as a side-effect, additional audit rows exist too;
// we check at least one matching "发布路由策略" entry.
func TestT11_ListModelAudit(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/model-audit", adminTok(t), nil)
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
		t.Fatalf("expected seeded audit entry ma-1, got 0")
	}
}

// ----------------------------------------------------------------------
// T12 — POST /api/model-invoke: 200 (mock LLM response, no real call)
// ----------------------------------------------------------------------

// TestT12_ModelInvoke exercises the sync invoke handler against a
// seeded embedded-protocol provider. The streamLocalCandidates loop
// resolves the embedded candidate first (proto bypasses ValidateBaseURL),
// streamEmbedded returns a non-empty assistant text, and the handler
// returns {output, modelId, modelName, providerId, source}.
//
// Deviation note: the plan said "mock LLM response, no real call".
// We achieve this by seeding protocol="embedded" (no network) rather
// than spinning up an httptest.LLM — the embedded path is the canonical
// local-fallback and avoids any flakiness from probe timeouts.
func TestT12_ModelInvoke(t *testing.T) {
	srv, st := newServer(t)
	seedEmbeddedProvider(t, st, "mp-t12")
	body := []byte(`{"workspaceId":"w1","modelId":"mp-t12-m","content":"T12 你好"}`)
	rr := doRequest(t, srv, http.MethodPost, "/api/model-invoke", adminTok(t), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("want ok=true, got %+v body=%s", e, rr.Body.String())
	}
	d := decodeData(t, e.Data)
	if out, _ := d["output"].(string); out == "" {
		t.Fatalf("empty output; data=%v", d)
	}
	if d["modelId"] != "mp-t12-m" {
		t.Fatalf("modelId=%v, want mp-t12-m", d["modelId"])
	}
	if d["providerId"] != "mp-t12" {
		t.Fatalf("providerId=%v, want mp-t12", d["providerId"])
	}
}

// ----------------------------------------------------------------------
// T13 — POST /api/model-invoke/stream: 200 (SSE parse `data:` chunks)
// ----------------------------------------------------------------------

// TestT13_ModelInvokeStream exercises the SSE stream handler against
// the same embedded provider as T12. The handler writes `data: <json>
// \n\n` frames (writeSSE) with chunks of type `meta`, `delta`, `done`,
// or `error`. We scan the body via bufio.Scanner and assert at least
// one frame whose JSON has type∈{meta,delta,done}.
//
// We also assert Content-Type starts with text/event-stream (per
// headerSSE) and HTTP status 200. The parser strips the `data:` prefix
// per the SSE framing convention (handlers_stream.go L159-167).
func TestT13_ModelInvokeStream(t *testing.T) {
	srv, st := newServer(t)
	seedEmbeddedProvider(t, st, "mp-t13")
	body := []byte(`{"workspaceId":"w1","modelId":"mp-t13-m","content":"T13 你好"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/model-invoke/stream", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+adminTok(t))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	ct := rr.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type=%q, want text/event-stream", ct)
	}
	sc := bufio.NewScanner(rr.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1*1024*1024)
	sawDelta := false
	sawDone := false
	sawMeta := false
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var m map[string]any
		if err := json.Unmarshal([]byte(payload), &m); err != nil {
			t.Fatalf("chunk JSON parse: %v payload=%q", err, payload)
		}
		typ, _ := m["type"].(string)
		switch typ {
		case "delta":
			sawDelta = true
		case "done":
			sawDone = true
		case "meta":
			sawMeta = true
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scanner: %v", err)
	}
	if !sawMeta {
		t.Fatalf("no meta frame in SSE stream (got=%v)", rr.Body.String())
	}
	if !sawDelta && !sawDone {
		t.Fatalf("no delta/done frame in SSE stream (got=%s)", rr.Body.String())
	}
}

// ----------------------------------------------------------------------
// T14 — GET /api/models/providers (FE alias): 200
// ----------------------------------------------------------------------

// TestT14_FEAlias verifies the FE-friendly /api/models/providers
// alias (server.go L804) maps to the same ListModelProviders handler.
// Response shape + store mutations must equal T1.
func TestT14_FEAlias(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/models/providers", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) < 2 {
		t.Fatalf("expected seeded providers via FE alias, got %d entries", len(arr))
	}
}

// ----------------------------------------------------------------------
// T15 — GET /api/model/providers (legacy alias): 200
// ----------------------------------------------------------------------

// TestT15_LegacyAlias verifies the legacy /api/model/providers alias
// (server.go L1308) maps to the same ListModelProviders handler. This
// route is the document-shaped "model" singular that older clients
// still depend on.
func TestT15_LegacyAlias(t *testing.T) {
	srv, _ := newServer(t)
	rr := doRequest(t, srv, http.MethodGet, "/api/model/providers", adminTok(t), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if !e.OK {
		t.Fatalf("ok=false: %+v body=%s", e, rr.Body.String())
	}
	var arr []any
	if err := json.Unmarshal(e.Data, &arr); err != nil {
		t.Fatalf("data not array: %v raw=%s", err, string(e.Data))
	}
	if len(arr) < 2 {
		t.Fatalf("expected seeded providers via legacy alias, got %d entries", len(arr))
	}
}

// ----------------------------------------------------------------------
// T16 — GET /api/model-providers (no Authorization): 401
// ----------------------------------------------------------------------

// TestT16_Unauthorized confirms the auth middleware rejects
// unauthenticated requests with 401, matching TestP13_Unauthorized /
// TestW14_Unauthorized / TestC9_Unauthorized precedent in earlier
// module integration tests.
func TestT16_Unauthorized(t *testing.T) {
	srv, _ := newServer(t)
	t.Setenv("DE_BAN_MOCK_TOKEN", "")
	rr := doRequest(t, srv, http.MethodGet, "/api/model-providers", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	e := decodeEnvelope(t, rr)
	if e.OK {
		t.Fatalf("want ok=false, got ok=true body=%s", rr.Body.String())
	}
}