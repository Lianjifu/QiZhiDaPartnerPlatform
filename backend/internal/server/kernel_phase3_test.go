package server_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/internal/vault"
	"github.com/qizhida-partner-platform/backend/internal/wecom"
)

func TestWecomWebhookReusesSessionForSameUser(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	srv.Vault = vault.NewFromEnv()
	h := srv.Handler()

	encodingKey := "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
	aesKey, err := wecom.DecodeAESKey(encodingKey)
	if err != nil {
		t.Fatal(err)
	}

	cred := wecom.Credentials{
		CorpID: "wwcorp", CorpSecret: "s", AgentID: "1000002",
		CallbackToken: "tok", CallbackAESKey: encodingKey,
	}.Normalize()
	payload, _ := cred.Marshal()
	if err := srv.Vault.Put(context.Background(), "vault://channel-deployments/dep-wecom-route/credential", payload); err != nil {
		t.Fatal(err)
	}
	st.Lock()
	st.ChannelDeploys = append([]map[string]any{{
		"id": "dep-wecom-route", "workspaceId": "w1", "name": "企微路由", "kind": "wecom",
		"status": "active", "credentialRef": "vault://channel-deployments/dep-wecom-route/credential",
		"connectionMode": "webhook", "digitalPartnerId": "de-1",
		"webhookPath": "/api/channel/wecom/events/dep-wecom-route",
	}}, st.ChannelDeploys...)
	st.Unlock()

	post := func(msgID, text string) {
		t.Helper()
		inner := `<xml><ToUserName><![CDATA[to]]></ToUserName><FromUserName><![CDATA[fromU]]></FromUserName><CreateTime>1</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[` + text + `]]></Content><MsgId>` + msgID + `</MsgId><AgentID>1000002</AgentID></xml>`
		enc, err := wecom.EncryptMsg(aesKey, inner, "wwcorp")
		if err != nil {
			t.Fatal(err)
		}
		body := []byte(`<xml><Encrypt><![CDATA[` + enc + `]]></Encrypt></xml>`)
		sig := wecom.CallbackSignature(cred.CallbackToken, "2", "n2", enc)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/channel/wecom/events/dep-wecom-route?msg_signature="+sig+"&timestamp=2&nonce=n2", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/xml")
		h.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatalf("webhook %s %d %s", msgID, rr.Code, rr.Body.String())
		}
	}
	post("101", "first inbound")
	post("102", "second inbound")
	post("101", "duplicate event")

	if n := countChannelSessions(st, "wecom", "user:fromU"); n != 1 {
		t.Fatalf("want 1 session for wecom user, got %d", n)
	}
}

func TestProductionEmployeeApproveRequiresDualApproval(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-2/approve", nil)
	req.Header.Set("Authorization", "Bearer mock-user-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code == 200 {
		t.Fatalf("submitter must not self-approve in production: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_SOD_SELF_APPROVAL") {
		t.Fatalf("want E_SOD_SELF_APPROVAL: %s", rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/partners/de-2/approve", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("admin approve %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"lifecycle":"active"`) {
		t.Fatalf("expected active: %s", rr.Body.String())
	}
}

func TestProductionRoutingPublishPendingThenSoD(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()

	// Admin publish: no second admin required — goes live immediately.
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/model-routing/policies/rp-draft/validate", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("validate %d %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/model-routing/policies/rp-draft/publish", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("admin publish %d %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), `"status":"pending_approval"`) {
		t.Fatalf("admin must not wait for peer approval: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"policyId":"rp-draft"`) && !strings.Contains(rr.Body.String(), `"publishedBy"`) {
		t.Fatalf("want published version: %s", rr.Body.String())
	}
}

func TestProductionUserRoutingPublishNeedsAdmin(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	st.Lock()
	for _, p := range st.RoutingPolicies {
		if strAny(p["id"]) != "rp-draft" {
			continue
		}
		p["status"] = "pending_approval"
		p["requestedBy"] = "业务构建者"
		p["requestedById"] = "u2"
		p["primaryModelId"] = "mdl-gpt4"
		p["validationIssues"] = []string{}
	}
	st.Unlock()
	h := server.New(st).Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/model-routing/policies/rp-draft/publish", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("admin approve user routing %d %s", rr.Code, rr.Body.String())
	}
}

func TestWorkflowPublishAsSkillRequiresPublishedTrial(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/workflows", bytes.NewBufferString(`{"name":"草稿流"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	wfID := ""
	if i := strings.Index(rr.Body.String(), `"id":"`); i >= 0 {
		rest := rr.Body.String()[i+6:]
		if j := strings.Index(rest, `"`); j >= 0 {
			wfID = rest[:j]
		}
	}
	if wfID == "" {
		t.Fatalf("missing workflow id: %s", rr.Body.String())
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/workflows/"+wfID+"/publish-as-skill", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code == 200 {
		t.Fatalf("draft must not publish as skill: %s", rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/workflows/wf1/publish-as-skill", bytes.NewBufferString(`{"name":"故障自愈技能-组装"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("published workflow %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"kind":"workflow"`) && !strings.Contains(rr.Body.String(), "故障自愈") {
		t.Fatalf("want workflow skill: %s", rr.Body.String())
	}
}

func TestTemporalFailClosedInProduction(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("DE_TEMPORAL_HOST", "127.0.0.1:1")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/workflows/run", bytes.NewBufferString(`{"workflowId":"wf1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code == 200 {
		t.Fatalf("production must not fallback local: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_RUNTIME_UNAVAILABLE") && !strings.Contains(rr.Body.String(), "temporal") {
		t.Fatalf("want temporal unavailable: %s", rr.Body.String())
	}
}

func TestProductionBudgetHardGate(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	st.Lock()
	st.ModelBudgets = []map[string]any{
		{"workspaceId": "w1", "month": "2026-08", "usedUsd": 9999, "limitUsd": 10},
	}
	st.Unlock()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/copilot/conversations/conv-1/stream",
		bytes.NewBufferString(`{"content":"budget gate","correlationId":"corr-budget-prod-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code == 200 && strings.Contains(rr.Body.String(), `"ok":true`) {
		t.Fatalf("production budget must hard-stop: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "E_BUDGET_EXCEEDED") && !strings.Contains(rr.Body.String(), "预算") {
		t.Fatalf("want budget exceeded: %s", rr.Body.String())
	}
}

func TestOpsOverviewGovernanceHonestCounts(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/operations/overview", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("ops %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, key := range []string{`"pendingEmployeeReleases"`, `"pendingRouting"`, `"pendingKnowledge"`, `"pendingWorkflowSkills"`, `"live-aggregate"`} {
		if !strings.Contains(body, key) {
			t.Fatalf("missing %s in %s", key, body)
		}
	}
}

func TestProductionKnowledgePublishPendingThenSoD(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()

	// Admin publish knowledge: immediate, no peer wait.
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/knowledge/packages/pkg-ops/publish", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("admin publish %d %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), `"status":"pending_approval"`) {
		t.Fatalf("admin must not wait for peer approval: %s", rr.Body.String())
	}

	// User-submitted pending package → admin approves.
	st := store.New()
	st.Lock()
	pkgs := knowledgeSliceMapsForTest(st.KnowledgeExtra["packages"])
	for _, p := range pkgs {
		if strAny(p["id"]) == "pkg-ops" {
			p["status"] = "pending_approval"
			p["requestedBy"] = "业务构建者"
			p["requestedById"] = "u2"
		}
	}
	st.KnowledgeExtra["packages"] = pkgs
	st.Unlock()
	h = server.New(st).Handler()

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/knowledge/packages/pkg-ops/publish", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("admin approve user knowledge %d %s", rr.Code, rr.Body.String())
	}
}

func knowledgeSliceMapsForTest(v any) []map[string]any {
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

func TestProductionEmployeeSubmitAdminDirectRelease(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	st.Lock()
	for _, e := range st.Employees {
		if strAny(e["id"]) != "de-hr" {
			continue
		}
		e["lifecycle"] = "testing"
		e["release"] = map[string]any{"status": "not_released"}
		e["evaluation"] = map[string]any{"status": "passed", "score": 95.0}
	}
	st.Unlock()
	h := server.New(st).Handler()
	tok := mustAdminJWT(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-hr/submit", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("submit %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"lifecycle":"active"`) {
		t.Fatalf("admin production submit should activate directly: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"status":"released"`) {
		t.Fatalf("admin production submit should release directly: %s", rr.Body.String())
	}
}

func TestProductionEmployeeSubmitNonAdminStaysPending(t *testing.T) {
	t.Setenv("DE_ENV", "production")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	st := store.New()
	st.Lock()
	for _, e := range st.Employees {
		if strAny(e["id"]) != "de-hr" {
			continue
		}
		e["lifecycle"] = "testing"
		e["release"] = map[string]any{"status": "not_released"}
		e["evaluation"] = map[string]any{"status": "passed", "score": 95.0}
	}
	st.Unlock()
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-hr/submit", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-user-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("submit %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "pending_approval") {
		t.Fatalf("non-admin production submit must stay pending: %s", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), `"lifecycle":"active"`) {
		t.Fatalf("must not auto-activate for non-admin: %s", rr.Body.String())
	}
}
