package policy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEvaluateLocalSoD(t *testing.T) {
	e := New()
	d := e.evaluateLocal(context.Background(), Input{
		ActorRole: "admin", Action: "publish",
		SubmitterID: "u1", ApproverID: "u1",
	})
	if d.Allow || d.PolicyID != "baseline.sod" {
		t.Fatalf("want sod deny, got %+v", d)
	}
}

func TestEvaluateRemoteOPA(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/data/de/authz/result" {
			t.Errorf("path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"result": Decision{
				Allow: false, Reason: "remote deny", PolicyID: "remote.test",
			},
		})
	}))
	defer srv.Close()

	t.Setenv("QZDA_OPA_URL", srv.URL)
	e := New()
	d := e.Evaluate(context.Background(), Input{ActorRole: "admin", Action: "read"})
	if d.Allow || d.PolicyID != "remote.test" {
		t.Fatalf("want remote decision, got %+v", d)
	}
}

func TestEvaluateRemoteFallbackOnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	t.Setenv("QZDA_OPA_URL", srv.URL)
	e := New()
	d := e.Evaluate(context.Background(), Input{ActorRole: "admin", Action: "read"})
	if !d.Allow || d.PolicyID != "baseline.default_allow" {
		t.Fatalf("want local fallback allow, got %+v", d)
	}
}
