package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestVaultKeysAdminAllowed(t *testing.T) {
	t.Setenv("DE_ENV", "test")
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "true")
	h := server.New(store.New()).Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/vault/keys", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	data, _ := body["data"].(map[string]any)
	if data == nil {
		t.Fatalf("missing data envelope: %v", body)
	}
	if _, ok := data["enabled"]; !ok {
		t.Errorf("missing enabled: %v", data)
	}
	if _, ok := data["refs"]; !ok {
		t.Errorf("missing refs: %v", data)
	}
}
