package modelprov

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMaskAndCredentialAlias(t *testing.T) {
	if MaskCredential("sk-abcdefgh") != "••••efgh" {
		t.Fatalf("mask: %s", MaskCredential("sk-abcdefgh"))
	}
	body := map[string]any{"credential": "from-cred"}
	if ExtractCredential(body) != "from-cred" {
		t.Fatal("credential preferred")
	}
	body = map[string]any{"apiKey": "from-key"}
	if ExtractCredential(body) != "from-key" {
		t.Fatal("apiKey alias")
	}
}

func TestProbeAndDiscoverAgainstHTTPTestServer(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/models", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	c := NewClient()
	c.HTTP = ts.Client()
	ctx := context.Background()
	pr, err := c.Probe(ctx, "openai_compatible", ts.URL, "sk-test", "", "")
	if err != nil || !pr.Healthy {
		t.Fatalf("probe: %+v err=%v", pr, err)
	}
	dr, err := c.Discover(ctx, "openai_compatible", ts.URL, "sk-test", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(dr.Models) != 2 || dr.Models[0]["id"] != "gpt-4o" {
		t.Fatalf("discover: %+v", dr)
	}
}

func TestValidateBaseURLBlocksPrivate(t *testing.T) {
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "0")
	if err := ValidateBaseURL("http://127.0.0.1:11434"); err == nil {
		t.Fatal("expected private block")
	}
	t.Setenv("QZDA_MODEL_ALLOW_PRIVATE", "1")
	if err := ValidateBaseURL("http://127.0.0.1:11434"); err != nil {
		t.Fatal(err)
	}
}
