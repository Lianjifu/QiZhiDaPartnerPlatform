package server_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestSkillStoreCatalogP0P3(t *testing.T) {
	h := server.New(store.New()).Handler()

	rr := knowledgeDo(t, h, http.MethodGet, "/api/skills/catalog", "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatalf("catalog %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	items, _ := env.Data["items"].([]any)
	if len(items) == 0 {
		t.Fatalf("expected catalog items: %s", rr.Body.String())
	}
	meta, _ := env.Data["meta"].(map[string]any)
	if strAny(meta["demoNotice"]) == "" {
		t.Fatalf("expected demoNotice meta")
	}
	first, _ := items[0].(map[string]any)
	if first["channel"] == nil || first["releaseChannel"] == nil {
		t.Fatalf("P0 fields missing: %#v", first)
	}

	// P2: registry sync
	rr = knowledgeDo(t, h, http.MethodPost, "/api/skills/catalog/sync", "mock-admin-token",
		`{"items":[{"name":"registry-sync-skill","version":"1.0.0","description":"synced","publisher":"企业能力商店","signed":true,"vulnerabilityCount":0,"releaseChannel":"stable","visibilityScope":"global"}]}`)
	if rr.Code != 200 {
		t.Fatalf("sync %d %s", rr.Code, rr.Body.String())
	}
	var syncEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &syncEnv)
	if int(syncEnv.Data["acceptedCount"].(float64)) < 1 {
		t.Fatalf("expected accepted sync: %s", rr.Body.String())
	}

	// unsigned rejected
	rr = knowledgeDo(t, h, http.MethodPost, "/api/skills/catalog/sync", "mock-admin-token",
		`{"items":[{"name":"bad-unsigned","version":"1.0.0","description":"x","publisher":"企业能力商店","signed":false}]}`)
	_ = json.Unmarshal(rr.Body.Bytes(), &syncEnv)
	if int(syncEnv.Data["rejectedCount"].(float64)) < 1 {
		t.Fatalf("unsigned must reject: %s", rr.Body.String())
	}

	// filter registry + stable
	rr = knowledgeDo(t, h, http.MethodGet, "/api/skills/catalog?channel=registry&releaseChannel=stable", "mock-admin-token", "")
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	items, _ = env.Data["items"].([]any)
	found := false
	for _, it := range items {
		m := it.(map[string]any)
		if m["name"] == "registry-sync-skill" {
			found = true
			if m["channel"] != "registry" || m["releaseChannel"] != "stable" {
				t.Fatalf("bad filters: %#v", m)
			}
		}
	}
	if !found {
		t.Fatalf("registry item not listed")
	}

	// P1: promote workspace skill
	rr = knowledgeDo(t, h, http.MethodPost, "/api/skills/catalog/publish", "mock-admin-token",
		`{"skillId":"sk-docx","releaseChannel":"beta","visibilityScope":"workspace","approvalTicket":"APR-PROMOTE-1"}`)
	if rr.Code != 200 {
		t.Fatalf("publish %d %s", rr.Code, rr.Body.String())
	}
	var pubEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pubEnv)
	if pubEnv.Data["channel"] != "promoted" {
		t.Fatalf("expected promoted: %s", rr.Body.String())
	}
	if pubEnv.Data["releaseChannel"] != "beta" {
		t.Fatalf("expected beta: %s", rr.Body.String())
	}

	// P3: workspace-scoped high-risk builtin not visible in w2
	rr = skillDoWS(t, h, http.MethodGet, "/api/skills/catalog", "mock-admin-token", "w2", "")
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	items, _ = env.Data["items"].([]any)
	for _, it := range items {
		m := it.(map[string]any)
		if m["id"] == "sc-high" || m["id"] == "sc-unsigned" || m["id"] == "sc-vuln" {
			t.Fatalf("workspace-scoped builtin leaked to w2: %#v", m)
		}
	}
}
