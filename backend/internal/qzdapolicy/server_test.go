package qzdapolicy

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/policy"
)

func TestEvaluateEndpointSoD(t *testing.T) {
	s := &Server{Engine: policy.New(), CoreURL: "http://127.0.0.1:9"}
	body := `{"actorRole":"admin","action":"publish","submitterId":"u1","approverId":"u1","resource":"workflow"}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", bytes.NewBufferString(body))
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d %s", rr.Code, rr.Body.String())
	}
	var wrap struct {
		Data struct {
			Allow    bool   `json:"allow"`
			PolicyID string `json:"policyId"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &wrap)
	if wrap.Data.Allow || wrap.Data.PolicyID != "baseline.sod" {
		t.Fatalf("%+v body=%s", wrap.Data, rr.Body.String())
	}
}

func TestInternalTokenRequired(t *testing.T) {
	s := &Server{Engine: policy.New(), internal: "secret"}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", bytes.NewBufferString(`{"action":"read","actorRole":"admin"}`))
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}
	req2 := httptest.NewRequest(http.MethodPost, "/v1/evaluate", bytes.NewBufferString(`{"action":"read","actorRole":"admin"}`))
	req2.Header.Set("X-De-Policy-Token", "secret")
	rr2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr2, req2)
	if rr2.Code != 200 {
		t.Fatalf("want 200 got %d %s", rr2.Code, rr2.Body.String())
	}
}

func TestClientEvaluate(t *testing.T) {
	s := &Server{Engine: policy.New()}
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	c := &Client{Base: ts.URL, HTTP: ts.Client()}
	d, err := c.Evaluate(context.Background(), policy.Input{
		ActorRole: "auditor", Action: "publish", Resource: "workflow",
	})
	if err != nil {
		t.Fatal(err)
	}
	if d.Allow {
		t.Fatalf("auditor publish should deny: %+v", d)
	}
}

func TestClientEvaluateOKEnvelope(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"allow":true,"reason":"ok","policyId":"baseline","requireDualSign":false,"evaluatedAt":"t"}}`))
	}))
	defer ts.Close()
	c := &Client{Base: ts.URL, HTTP: ts.Client()}
	d, err := c.Evaluate(context.Background(), policy.Input{Action: "read", ActorRole: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	if !d.Allow || d.PolicyID != "baseline" {
		t.Fatalf("%+v", d)
	}
}

func TestZTEvaluateUserPublish(t *testing.T) {
	s := &Server{Engine: policy.New()}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/zero-trust/evaluate",
		bytes.NewBufferString(`{"resource":"workflow","action":"publish"}`))
	req.Header.Set("X-De-Actor-Role", "user")
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	var wrap struct {
		Data struct {
			Decision string `json:"decision"`
			Source   string `json:"source"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &wrap)
	if wrap.Data.Decision != "approval_required" || wrap.Data.Source != "de-policy" {
		t.Fatalf("%+v", wrap.Data)
	}
}
