package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestHardDeletePersistsDeleteHooks(t *testing.T) {
	t.Setenv("DE_ENV", "development")

	st := store.NewEmpty()
	st.KnowledgeDocs = []map[string]any{{
		"id": "kd-del-1", "workspaceId": "w1", "title": "t",
	}}
	st.ModelProviders = []map[string]any{{
		"id": "mp-del-1", "workspaceId": "w1", "name": "p", "status": "disabled",
		"credentialRef": "",
	}}
	st.ChannelDeploys = []map[string]any{{
		"id": "cd-del-1", "workspaceId": "w1", "name": "d", "status": "disabled",
	}}
	st.Skills = []map[string]any{{
		"id": "sk-del-1", "workspaceId": "w1", "name": "s", "lifecycleStatus": "enabled",
		"source": "import",
	}}
	st.SkillHealth = []map[string]any{{
		"id": "sh-sk-del-1", "skillId": "sk-del-1", "name": "s",
	}}
	st.WorkflowTpls = []map[string]any{{
		"id": "wt-del-1", "workspaceId": "w1", "name": "personal tpl",
		"builtin": false, "source": "personal", "ownerId": "u1",
	}}

	var mu sync.Mutex
	deleted := map[string][]string{}
	st.SetDeleteHook(func(_ context.Context, collection string, ids []string) error {
		mu.Lock()
		deleted[collection] = append(deleted[collection], ids...)
		mu.Unlock()
		return nil
	})
	st.SetPersistHook(func(context.Context, string, []map[string]any) error { return nil })

	h := New(st).Handler()
	admin := func(method, path string) {
		t.Helper()
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		h.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatalf("%s %s -> %d %s", method, path, rr.Code, rr.Body.String())
		}
	}

	admin(http.MethodDelete, "/api/knowledge/doc/kd-del-1")
	admin(http.MethodDelete, "/api/model-providers/mp-del-1")
	admin(http.MethodDelete, "/api/channel-control/deployments/cd-del-1")
	admin(http.MethodPost, "/api/skills/sk-del-1/uninstall")
	admin(http.MethodDelete, "/api/workflow-templates/wt-del-1")

	mu.Lock()
	defer mu.Unlock()
	assertDeleted := func(coll, id string) {
		t.Helper()
		for _, x := range deleted[coll] {
			if x == id {
				return
			}
		}
		t.Fatalf("expected PersistDelete %s id=%s got %v", coll, id, deleted[coll])
	}
	assertDeleted("knowledge_docs", "kd-del-1")
	assertDeleted("model_providers", "mp-del-1")
	assertDeleted("channel_deploys", "cd-del-1")
	assertDeleted("skills", "sk-del-1")
	assertDeleted("skill_health", "sh-sk-del-1")
	assertDeleted("workflow_templates", "wt-del-1")
}

func TestIdsBeyondKeep(t *testing.T) {
	items := []map[string]any{
		{"id": "a"}, {"id": "b"}, {"id": "c"},
	}
	got := idsBeyondKeep(items, 2)
	if len(got) != 1 || got[0] != "c" {
		t.Fatalf("got %v", got)
	}
	if idsBeyondKeep(items, 5) != nil {
		t.Fatal("expected nil when under keep")
	}
}
