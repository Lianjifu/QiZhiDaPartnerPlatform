package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestListSkillPacksReportsWorkspaceInstallState(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "builtin", "skills"))
	if err != nil {
		t.Skip(err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Skip("builtin skills dir missing")
	}
	t.Setenv("QZDA_BUILTIN_SKILLS_DIR", root)
	t.Setenv("QZDA_ENV", "demo")

	st := store.NewEmpty()
	st.Workspaces = []map[string]any{{"id": "w4", "name": "外协沙箱"}}
	st.Skills = []map[string]any{
		{"id": "sk-builtin-weather", "workspaceId": "w4", "name": "weather", "builtinSkillName": "weather", "source": "builtin"},
	}
	srv := server.New(st)
	h := srv.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/skills/packs", nil)
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("x-workspace-id", "w4")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("packs %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		Data struct {
			Packs []map[string]any `json:"packs"`
			PlatformTools []map[string]any `json:"platformTools"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if len(env.Data.PlatformTools) == 0 {
		t.Fatal("expected platformTools in packs response")
	}
	var general map[string]any
	for _, p := range env.Data.Packs {
		if p["packId"] == "general" {
			general = p
			break
		}
	}
	if general == nil {
		t.Fatal("general pack missing")
	}
	if general["installed"] == true {
		t.Fatalf("general should be partial on w4, got %#v", general)
	}
	if int(general["installedCount"].(float64)) < 1 {
		t.Fatalf("expected at least weather installed, got %#v", general)
	}
}
