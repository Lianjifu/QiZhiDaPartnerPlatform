package server_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestNormalizeInstalledSkillsLocked_DedupesByBuiltinName(t *testing.T) {
	st := store.New()
	st.Skills = []map[string]any{
		{"id": "sk-3", "workspaceId": "w1", "name": "weather", "builtinSkillName": "weather"},
		{"id": "sk-3", "workspaceId": "w1", "name": "summarize", "builtinSkillName": "summarize"},
		{"id": "sk-4", "workspaceId": "w1", "name": "pptx", "builtinSkillName": "pptx"},
		{"id": "sk-7", "workspaceId": "w1", "name": "pptx", "builtinSkillName": "pptx"},
	}
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()

	ids := map[string]string{}
	for _, sk := range st.Skills {
		id := str(sk["id"])
		if prev, ok := ids[id]; ok {
			t.Fatalf("duplicate id %s: %s vs %s", id, prev, str(sk["name"]))
		}
		ids[id] = str(sk["name"])
	}
	if ids["sk-builtin-weather"] != "weather" {
		t.Fatalf("weather id not migrated: %#v", ids)
	}
	if ids["sk-builtin-pptx"] != "pptx" {
		t.Fatalf("pptx missing or dup: %#v", ids)
	}
}

func TestEnsureBuiltinSkillsReady_PruneDeprecatedSeed(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "services", "qzda-sandbox", "builtin", "skills"))
	if err != nil {
		t.Skip(err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Skip("builtin skills dir missing")
	}
	t.Setenv("DE_BUILTIN_SKILLS_DIR", root)

	st := store.New()
	st.SkillCatalog = append(st.SkillCatalog,
		map[string]any{"id": "sc-1", "name": "日志检索", "channel": "builtin"},
		map[string]any{"id": "sc-2", "name": "mysql-cli", "channel": "builtin"},
	)
	st.Skills = append(st.Skills,
		map[string]any{"id": "sk-1", "workspaceId": "w1", "name": "kubectl 只读"},
		map[string]any{"id": "sk-2", "workspaceId": "w1", "name": "loki-query"},
		map[string]any{"id": "tool-cmdb", "workspaceId": "w1", "name": "CMDB 查询"},
		map[string]any{"id": "sk-docx", "workspaceId": "w1", "name": "docx"},
	)
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()

	for _, id := range []string{"sc-1", "sc-2"} {
		for _, item := range st.SkillCatalog {
			if str(item["id"]) == id {
				t.Fatalf("deprecated catalog %s still present", id)
			}
		}
	}
	for _, id := range []string{"sk-1", "sk-2", "tool-cmdb"} {
		for _, sk := range st.Skills {
			if str(sk["id"]) == id {
				t.Fatalf("deprecated installed skill %s still present", id)
			}
		}
	}
	foundDocx := false
	for _, sk := range st.Skills {
		if str(sk["id"]) == "sk-docx" {
			foundDocx = true
		}
	}
	if !foundDocx {
		t.Fatal("expected sk-docx to remain after prune")
	}
}

func TestEnsureBuiltinSkillsReady_GeneralPack(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "services", "qzda-sandbox", "builtin", "skills"))
	if err != nil {
		t.Skip(err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Skip("builtin skills dir missing; run make sync-builtin-skills")
	}
	t.Setenv("DE_BUILTIN_SKILLS_DIR", root)

	st := store.New()
	srv := server.New(st)
	srv.EnsureBuiltinSkillsReady()
	st.EnsureGeneralEmployee()

	var weatherInstalled bool
	var withPackage int
	for _, sk := range st.Skills {
		if str(sk["workspaceId"]) != "w1" {
			continue
		}
		if strings.EqualFold(str(sk["name"]), "weather") {
			weatherInstalled = true
			if str(sk["packagePath"]) != "" {
				withPackage++
			}
		}
		if str(sk["packagePath"]) != "" && str(sk["defaultPack"]) == "true" || sk["defaultPack"] == true {
			withPackage++
		}
	}
	if !weatherInstalled {
		t.Fatal("general pack skill weather not installed")
	}

	foundGeneral := false
	for _, emp := range st.Employees {
		if str(emp["id"]) == "de-general" {
			foundGeneral = true
			caps, _ := emp["capabilities"].(map[string]any)
			tools := caps["tools"]
			if tools == nil {
				t.Fatal("de-general missing tools")
			}
		}
	}
	if !foundGeneral {
		t.Fatal("de-general employee missing")
	}

	h := srv.Handler()
	rr := httptest.NewRequest(http.MethodGet, "/api/platform-tools/registry", nil)
	rr.Header.Set("Authorization", "Bearer mock-admin-token")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, rr)
	if w.Code != http.StatusOK {
		t.Fatalf("platform-tools registry %d %s", w.Code, w.Body.String())
	}
}

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
