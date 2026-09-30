package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResolveEndpointsFromDiscovery(t *testing.T) {
	ClearDiscoveryCache()
	mux := http.NewServeMux()
	mux.HandleFunc("/application/o/de/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"authorization_endpoint": "http://idp/application/o/authorize/",
			"token_endpoint":         "http://idp/application/o/token/",
			"userinfo_endpoint":      "http://idp/application/o/userinfo/",
		})
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	cfg := OIDCConfig{
		Enabled: true, Issuer: ts.URL + "/application/o/de",
		ClientID: "qzda-core", HTTPClient: ts.Client(),
	}
	authEP, tok, ui, err := cfg.resolveEndpoints(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(authEP, "/authorize") || !strings.HasSuffix(tok, "/token/") || !strings.Contains(ui, "userinfo") {
		t.Fatalf("auth=%s tok=%s ui=%s", authEP, tok, ui)
	}
	u, err := cfg.AuthURL("st1")
	if err != nil || !strings.Contains(u, "state=st1") || !strings.Contains(u, "/authorize") {
		t.Fatalf("AuthURL=%s err=%v", u, err)
	}
}

func TestResolveEndpointsFallback(t *testing.T) {
	ClearDiscoveryCache()
	cfg := OIDCConfig{
		Enabled: true, Issuer: "http://127.0.0.1:5556/dex",
		AuthPath: "/auth", ClientID: "c",
		HTTPClient: &http.Client{Timeout: 1}, // discovery will fail quickly
	}
	authEP, tok, ui, err := cfg.resolveEndpoints(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if authEP != "http://127.0.0.1:5556/dex/auth" || tok != "http://127.0.0.1:5556/dex/token" || ui == "" {
		t.Fatalf("got %s %s %s", authEP, tok, ui)
	}
}
