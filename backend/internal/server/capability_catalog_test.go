package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestCapabilityCatalogAggregatesLiveAssets(t *testing.T) {
	st := store.New()
	srv := New(st)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/partner-capability-catalog", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d %s", rr.Code, rr.Body.String())
	}
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	cat := envelope.Data
	if cat == nil {
		// some handlers return bare object
		_ = json.Unmarshal(rr.Body.Bytes(), &cat)
	}
	models, _ := cat["models"].([]any)
	skills, _ := cat["skills"].([]any)
	tools, _ := cat["tools"].([]any)
	workflows, _ := cat["workflows"].([]any)
	knowledge, _ := cat["knowledge"].([]any)
	channels, _ := cat["channels"].([]any)
	if len(models) < 1 {
		t.Fatalf("expected live models/routes, got %#v", cat["models"])
	}
	if len(skills) < 1 || len(tools) < 1 {
		t.Fatalf("expected skills+tools from store, skills=%d tools=%d", len(skills), len(tools))
	}
	if len(workflows) < 1 || len(knowledge) < 1 {
		t.Fatalf("expected workflows+knowledge, wf=%d kn=%d", len(workflows), len(knowledge))
	}
	foundWeb := false
	for _, c := range channels {
		m, _ := c.(map[string]any)
		if str(m["name"]) == "Web" {
			foundWeb = true
		}
	}
	if !foundWeb {
		t.Fatalf("expected Web channel in catalog: %#v", channels)
	}
	// must not be static-only catalog (should include loki-query skill)
	joined := rr.Body.String()
	if !strings.Contains(joined, "docx") {
		t.Fatalf("catalog missing live skill/tool names: %s", joined)
	}
	// published routes should be labeled as routes, not bare model ids with "已发布路由 … 主模型"
	for _, raw := range models {
		m, _ := raw.(map[string]any)
		meta := str(m["meta"])
		name := str(m["name"])
		if strings.HasPrefix(meta, "已发布路由") && !strings.Contains(name, "路由") {
			t.Fatalf("model option looks like confusing route/model hybrid: name=%q meta=%q", name, meta)
		}
	}
}

func TestCapabilityCatalogCollabFetchesCapPeers(t *testing.T) {
	capStore := store.New()
	capSrv := New(capStore)
	capSrv.Mode = ModeCap
	capHTTP := httptest.NewServer(capSrv.Handler())
	t.Cleanup(capHTTP.Close)
	t.Setenv("DE_CAP_URL", capHTTP.URL)
	t.Setenv("DE_WORKFLOW_URL", "http://127.0.0.1:1") // unreachable; local/workflow soft-fail

	// Cap-only package skill
	capStore.Lock()
	capStore.Skills = append([]map[string]any{{
		"id": "sk-pptx", "workspaceId": "w1", "name": "pptx", "kind": "skill",
		"version": "0.1.0", "status": "installed", "lifecycleStatus": "enabled", "source": "package",
	}}, capStore.Skills...)
	pkgs, _ := capStore.KnowledgeExtra["packages"].([]map[string]any)
	capStore.KnowledgeExtra["packages"] = append([]map[string]any{{
		"id": "pkg-hr", "workspaceId": "w1", "name": "人事制度库", "domain": "人事", "status": "published",
		"currentVersion": map[string]any{"version": "1.0.0", "status": "published"},
	}}, pkgs...)
	capStore.Unlock()

	collab := New(store.New())
	collab.Mode = ModeCollab
	// Wipe local skills/knowledge so catalog must come from Cap peer.
	collab.Store.Lock()
	collab.Store.Skills = nil
	collab.Store.SkillCatalog = nil
	collab.Store.KnowledgeExtra = map[string]any{"packages": []map[string]any{}}
	collab.Store.KnowledgeDocs = nil
	collab.Store.Unlock()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/partner-capability-catalog", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	collab.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "pptx") {
		t.Fatalf("expected peer skill pptx in catalog: %s", body)
	}
	if !strings.Contains(body, "人事制度库") {
		t.Fatalf("expected peer knowledge in catalog: %s", body)
	}
}

func TestEmployeeConfigurationDraftPersistsCapabilities(t *testing.T) {
	st := store.New()
	srv := New(st)
	body := `{
	  "scope":"capability",
	  "profile":{"name":"客服质检助手","role":"QA","department":"运营部","environment":"sandbox","risk":"low","owner":"业务构建者","escalationOwner":"运营负责人","serviceObject":"客服团队","description":"会话质检"},
	  "capabilities":{"model":"企业通用路由 v2","skills":["docx"],"tools":[],"workflows":["故障自愈技能"],"knowledge":["运维知识库"],"channels":["Web"]},
	  "boundary":{"responsibilities":[{"id":"r1","title":"质检","objective":"评分","trigger":"会话结束","deliverables":["报告"],"evidenceRequired":true}],"boundaryPolicy":{"responsibilities":[{"id":"r1","title":"质检","objective":"评分","trigger":"会话结束","deliverables":["报告"],"evidenceRequired":true}],"capabilityModes":[{"capabilityType":"skill","capabilityName":"docx","mode":"recommend"}],"handoff":{"triggers":["高风险"],"approvers":["运营负责人"],"slaMinutes":30},"dataClassification":"internal","allowedEnvironments":["sandbox"]}},
	  "memoryPolicy":{"shortTermHours":24,"workingDays":7,"longTermCadence":"daily","knowledgePromotion":"approval_required"}
	}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-2/configuration", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Workspace-Id", "w1")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d %s", rr.Code, rr.Body.String())
	}
	st.RLock()
	var emp map[string]any
	for _, e := range st.Employees {
		if str(e["id"]) == "de-2" {
			emp = e
			break
		}
	}
	st.RUnlock()
	if emp == nil {
		t.Fatal("employee missing")
	}
	caps, _ := emp["capabilities"].(map[string]any)
	if str(caps["model"]) != "企业通用路由 v2" {
		t.Fatalf("capabilities not applied: %#v", caps)
	}
	if len(toAnySlice(caps["skills"])) < 1 {
		t.Fatalf("skills/tools not persisted: %#v", caps)
	}
	if emp["boundaryPolicy"] == nil {
		t.Fatalf("boundaryPolicy not applied")
	}
}
