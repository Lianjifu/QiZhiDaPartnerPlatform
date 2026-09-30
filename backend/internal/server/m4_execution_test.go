package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestWorkflowTrialUsesWorkerEngine(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/workflows/run",
		bytes.NewBufferString(`{"workflowId":"wf-1"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("run %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data struct {
			Engine string `json:"engine"`
			Status string `json:"status"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if env.Data.Engine != "de-workflow" {
		t.Fatalf("expected de-workflow, got %s body=%s", env.Data.Engine, rr.Body.String())
	}
	if env.Data.Status != "succeeded" {
		t.Fatalf("status %s", env.Data.Status)
	}
}

func TestChannelDLQReplay(t *testing.T) {
	h := server.New(store.New()).Handler()
	// create dead letter
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/channels/outbound",
		bytes.NewBufferString(`{"channelId":"ch-1","fail":true,"payload":{"x":1}}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("outbound %d %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if out.Data.ID == "" {
		t.Fatalf("missing dlq id: %s", rr.Body.String())
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/channel-control/dead-letters/"+out.Data.ID+"/replay", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("replay %d %s", rr.Code, rr.Body.String())
	}
}
