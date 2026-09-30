package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestPhaseACriticalPath(t *testing.T) {
	h := server.New(store.New()).Handler()

	loginBody := `{"email":"admin@acme.com","password":"x"}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(loginBody))
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("login status %d body %s", rr.Code, rr.Body.String())
	}
	var loginResp struct {
		OK   bool `json:"ok"`
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &loginResp); err != nil || !loginResp.OK || loginResp.Data.Token == "" {
		t.Fatalf("login envelope: %s", rr.Body.String())
	}
	token := loginResp.Data.Token

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("workspaces %d %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/zero-trust/evaluate", bytes.NewBufferString(`{"resource":"workflow","action":"publish"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("evaluate %d %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/audit-center", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("audit %d %s", rr.Code, rr.Body.String())
	}
}

func TestAuditorWriteForbidden(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces", bytes.NewBufferString(`{"name":"x"}`))
	req.Header.Set("Authorization", "Bearer mock-auditor-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("expected 403 got %d %s", rr.Code, rr.Body.String())
	}
}

func TestEmployeeReleaseActivatesWithoutSOD(t *testing.T) {
	st := store.New()
	for _, e := range st.Employees {
		if strID(e["id"]) == "de-2" {
			e["lifecycle"] = "testing"
			e["release"] = map[string]any{"status": "not_released"}
			e["owner"] = "平台管理员"
			e["escalationOwner"] = "运营负责人"
			e["serviceObject"] = "客服团队"
			e["responsibilities"] = []any{"质检评分"}
			e["capabilities"] = map[string]any{
				"model": "gpt-4o", "skills": []any{"工单分诊"}, "tools": []any{"Jira"}, "workflows": []any{}, "knowledge": []any{}, "channels": []any{"Web"},
			}
			e["evaluation"] = map[string]any{"status": "passed", "score": 93.5}
		}
	}
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-2/release", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("release %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"lifecycle":"active"`) || !strings.Contains(body, `"status":"released"`) {
		t.Fatalf("expected direct release: %s", body)
	}
	if strings.Contains(body, "提交人不可自批") || strings.Contains(body, "E_SOD") {
		t.Fatalf("release must not trip SoD: %s", body)
	}
}

func TestLegacyApproveActivatesWithoutSOD(t *testing.T) {
	h := server.New(store.New()).Handler()
	// de-2 is pending_approval submitted by u2; submitter confirming should succeed now.
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-2/approve", nil)
	req.Header.Set("Authorization", "Bearer mock-user-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("approve %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"lifecycle":"active"`) {
		t.Fatalf("expected active after approve: %s", rr.Body.String())
	}
}

func TestEmployeeLifecyclePersists(t *testing.T) {
	st := store.New()
	persisted := false
	var wg sync.WaitGroup
	wg.Add(1)
	st.SetPersistHook(func(_ context.Context, collection string, items []map[string]any) error {
		if collection != "employees" {
			return nil
		}
		defer wg.Done()
		for _, e := range items {
			if strID(e["id"]) == "de-2" && strID(e["lifecycle"]) == "active" {
				persisted = true
			}
		}
		return nil
	})
	h := server.New(st).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/partners/de-2/lifecycle", bytes.NewBufferString(`{"lifecycle":"active"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("lifecycle patch %d %s", rr.Code, rr.Body.String())
	}
	wg.Wait()
	if !persisted {
		t.Fatal("expected employees collection persist after lifecycle transition")
	}
}
