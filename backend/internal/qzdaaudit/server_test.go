package qzdaaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/infra"
)

func TestClientAppendAndList(t *testing.T) {
	var got map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/events" && r.Method == http.MethodPost {
			_ = json.NewDecoder(r.Body).Decode(&got)
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"id": got["id"], "source": "qzda-audit"}})
			return
		}
		if r.URL.Path == "/v1/events" && r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": []map[string]any{got}})
			return
		}
		http.NotFound(w, r)
	}))
	defer ts.Close()

	c := &Client{Base: ts.URL, HTTP: ts.Client()}
	ev := map[string]any{"id": "a-1", "workspaceId": "w1", "action": "login", "actor": "admin"}
	if err := c.Append(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
	if got["id"] != "a-1" {
		t.Fatalf("got=%v", got)
	}
	rows, err := c.ListRecent(context.Background(), []string{"w1"}, 10)
	if err != nil || len(rows) != 1 {
		t.Fatalf("list=%v err=%v", rows, err)
	}
}

func TestInternalTokenOnHandler(t *testing.T) {
	s := &Server{Sink: &infra.AuditSink{}, internal: "tok"}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewBufferString(`{"id":"x","workspaceId":"w1"}`))
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewBufferString(`{"id":"x","workspaceId":"w1"}`))
	req2.Header.Set("X-De-Audit-Token", "tok")
	s.Handler().ServeHTTP(rr2, req2)
	if rr2.Code != 200 {
		t.Fatalf("want 200 got %d %s", rr2.Code, rr2.Body.String())
	}
}

func TestAuditCenterAuth(t *testing.T) {
	s := &Server{Sink: &infra.AuditSink{}}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/audit-center", nil)
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}

	tok, err := auth.Sign(auth.Identity{
		ID: "u1", Name: "Admin", Role: "admin", WorkspaceID: "w1",
		WorkspaceIDs: []string{"w1"}, Permissions: auth.RolePermissions("admin"),
	}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/api/audit-center", nil)
	req2.Header.Set("Authorization", "Bearer "+tok)
	s.Handler().ServeHTTP(rr2, req2)
	if rr2.Code != 200 {
		t.Fatalf("want 200 got %d %s", rr2.Code, rr2.Body.String())
	}
}
