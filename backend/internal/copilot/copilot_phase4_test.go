package copilot

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// withIdentity is a tiny test helper that injects an auth.Identity into
// the request context so handlers depending on identityFrom() can run
// without going through the auth middleware (which lives in the server
// package). CopH().ServeHTTP dispatches the routes directly.
func withIdentity(req *http.Request, id *auth.Identity) *http.Request {
	return req.WithContext(auth.WithIdentity(req.Context(), id))
}

// adminReq / auditorReq build requests that simulate the dev mock tokens
// the server-side auth middleware would otherwise resolve.
func adminReq(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("x-workspace-id", "w1")
	return withIdentity(req, &auth.Identity{ID: "u1", Name: "平台管理员", Role: "admin", WorkspaceID: "w1"})
}

func auditorReq(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer mock-auditor-token")
	req.Header.Set("x-workspace-id", "w1")
	return withIdentity(req, &auth.Identity{ID: "u3", Name: "合规审计员", Role: "auditor", WorkspaceID: "w1"})
}

func TestLooksLikePreferenceStatement(t *testing.T) {
	if !looksLikePreferenceStatement("请记住我偏好邮件催办") {
		t.Fatal("expected preference")
	}
	if looksLikePreferenceStatement("年假怎么请") {
		t.Fatal("normal question should not match")
	}
}

func TestMemoryProvenanceMaps(t *testing.T) {
	hits := []memoryHit{
		{ID: "mem-1", Title: "偏好", Layer: "working", Score: 0.9},
	}
	rows := memoryProvenanceMaps(hits)
	if len(rows) != 1 || str(rows[0]["id"]) != "mem-1" {
		t.Fatalf("%#v", rows)
	}
}

func TestBuildCopilotSystemPrompt_IncludesMemoryID(t *testing.T) {
	prompt := buildCopilotSystemPrompt(nil, nil, []memoryHit{
		{ID: "mem-x", Title: "偏好", Content: "邮件催办", Layer: "working", Score: 0.8},
	})
	if !strings.Contains(prompt, "mem-x") {
		t.Fatalf("prompt should cite memory id: %s", prompt)
	}
}

func TestRunPostTurnEvolution_PreferenceCandidate(t *testing.T) {
	st := store.New()
	s := New(st)
	s.Store.Lock()
	created := s.runPostTurnEvolutionLocked(evolveTurnInput{
		WorkspaceID: "w1", OwnerID: "u1", OwnerName: "测试",
		ConversationID: "cv-e1", CorrelationID: "corr-e1", MessageID: "msg-1",
		UserMessage: "请记住我以后默认用邮件催办", AssistantText: "好的，已记下。",
		Mode: modeReact,
	})
	s.Store.Unlock()
	if len(created) == 0 {
		t.Fatal("expected evolve candidate")
	}
	found := false
	for _, c := range created {
		if str(c["kind"]) == evolveKindMemoryPromote && str(c["status"]) == evolveStatusPending {
			found = true
		}
	}
	if !found {
		t.Fatalf("want pending memory_promote, got %#v", created)
	}
	for _, p := range st.RoutingPolicies {
		if str(p["source"]) == "evolve_candidate" && str(p["status"]) == "published" {
			t.Fatal("must not publish routing from evolution")
		}
	}
}

func TestDreamCompress_ShortToWorking(t *testing.T) {
	st := store.New()
	s := New(st)
	// Stub MemoryPolicyForFn so dreamCompressConversationLocked treats the
	// conversation as eligible for short→working compression.
	s.Deps.Memory.MemoryPolicyForFn = func(ws string) map[string]any {
		return map[string]any{"shortToWorkingEnabled": true}
	}
	// Stub the IngestRuntimeMemoryLockedFn Dep so the test can populate
	// short_term records without spinning up the full runtime_memory
	// subsystem.
	s.Deps.Memory.IngestRuntimeMemoryLockedFn = func(in runtimeMemoryInput) (map[string]any, error) {
		id := st.ID("memory")
		item := map[string]any{
			"id": id, "workspaceId": in.WorkspaceID, "ownerId": in.OwnerID,
			"layer": in.Layer, "title": in.Title, "content": in.Content,
			"sourceType": in.SourceType, "sourceId": in.SourceID,
			"correlationId": in.CorrelationID, "confidence": in.Confidence,
			"status": "active",
		}
		st.MemoryRecords = append(st.MemoryRecords, item)
		return item, nil
	}
	cid := "cv-dream-1"
	s.Store.Lock()
	for i := 0; i < dreamShortTermThreshold; i++ {
		_, err := s.Deps.Memory.IngestRuntimeMemoryLockedFn(runtimeMemoryInput{
			WorkspaceID: "w1", OwnerID: "u1", OwnerName: "测试",
			Title: "短记忆" + itoa(i), Content: "内容" + itoa(i),
			SourceType: "conversation", SourceID: cid, CorrelationID: "c" + itoa(i),
			Layer: "short_term", Scope: "user", Confidence: 0.8,
		})
		if err != nil {
			s.Store.Unlock()
			t.Fatal(err)
		}
	}
	cand := s.dreamCompressConversationLocked(evolveTurnInput{
		WorkspaceID: "w1", OwnerID: "u1", OwnerName: "测试",
		ConversationID: cid, CorrelationID: "dream-1",
	})
	s.Store.Unlock()
	if cand == nil || str(cand["status"]) != evolveStatusApplied {
		t.Fatalf("dream cand %#v", cand)
	}
	workingID := ""
	if payload, ok := cand["payload"].(map[string]any); ok {
		workingID = str(payload["workingMemoryId"])
	}
	if workingID == "" {
		t.Fatal("missing workingMemoryId")
	}
	activeShort := 0
	foundWorking := false
	for _, m := range st.MemoryRecords {
		if str(m["sourceId"]) == cid && str(m["layer"]) == "short_term" && str(m["status"]) == "active" {
			activeShort++
		}
		if str(m["id"]) == workingID && str(m["layer"]) == "working" {
			foundWorking = true
		}
	}
	if activeShort != 0 {
		t.Fatalf("shorts should be expired, still active=%d", activeShort)
	}
	if !foundWorking {
		t.Fatal("working memory missing")
	}
}

func TestEvolveApprove_DoesNotPublishRouting(t *testing.T) {
	st := store.New()
	s := New(st)
	s.Store.Lock()
	cand := map[string]any{
		"id": "evolve-route-1", "workspaceId": "w1",
		"kind": evolveKindRoutingHint, "status": evolveStatusPending,
		"title": "路由候选", "summary": "建议 P0",
		"payload":       map[string]any{"suggestedLevel": "P0", "note": "test"},
		"correlationId": "corr-r1",
	}
	s.Store.EvolveCands = append(s.Store.EvolveCands, cand)
	s.Store.Unlock()

	// First sign (admin) → pending_countersign, no draft yet
	req := adminReq(http.MethodPost, "/api/evolve/candidates/evolve-route-1/approve", "{}")
	rr := httptest.NewRecorder()
	s.CopH().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("first approve %d %s", rr.Code, rr.Body.String())
	}
	if str(st.EvolveCands[0]["status"]) != evolveStatusPendingCountersign {
		t.Fatalf("want pending_countersign got %s", str(st.EvolveCands[0]["status"]))
	}
	for _, p := range st.RoutingPolicies {
		if str(p["evolveCandidateId"]) == "evolve-route-1" {
			t.Fatal("must not create routing before countersign")
		}
	}

	// Second sign (auditor) → draft only
	req2 := auditorReq(http.MethodPost, "/api/evolve/candidates/evolve-route-1/approve", "{}")
	rr2 := httptest.NewRecorder()
	s.CopH().ServeHTTP(rr2, req2)
	if rr2.Code != 200 {
		t.Fatalf("countersign %d %s", rr2.Code, rr2.Body.String())
	}
	foundDraft := false
	for _, p := range st.RoutingPolicies {
		if str(p["evolveCandidateId"]) == "evolve-route-1" {
			if str(p["status"]) != "draft" {
				t.Fatalf("routing must stay draft, got %s", str(p["status"]))
			}
			foundDraft = true
		}
	}
	if !foundDraft {
		t.Fatal("expected draft routing policy after dual-sign")
	}
}

func TestCopilotMessageFeedback_CreatesCandidate(t *testing.T) {
	st := store.New()
	s := New(st)
	cid := "cv-fb-1"
	mid := "msg-fb-1"
	s.Store.Lock()
	s.Store.Messages[cid] = []map[string]any{
		{"id": mid, "role": "assistant", "content": "这是回答", "correlationId": "corr-fb"},
	}
	s.Store.Unlock()

	req := adminReq(http.MethodPost, "/api/copilot/conversations/"+cid+"/messages/"+mid+"/feedback",
		`{"kind":"dislike","comment":"答非所问"}`)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.CopH().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("feedback %d %s", rr.Code, rr.Body.String())
	}
	found := false
	for _, c := range st.EvolveCands {
		if str(c["kind"]) == evolveKindSkillPatch && str(c["messageId"]) == mid {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected skill_patch from dislike, cands=%#v", st.EvolveCands)
	}
}

func TestRetrieveMemory_IncludesID(t *testing.T) {
	st := store.New()
	s := New(st)
	s.Store.RLock()
	hits := s.retrieveMemoryForTurnLocked("w1", "u1", "", "other-cv", "Redis OOM 处置", &auth.Identity{ID: "u1", Role: "admin"})
	s.Store.RUnlock()
	if len(hits) == 0 {
		t.Fatal("expected memory hits from seed")
	}
	if hits[0].ID == "" {
		t.Fatalf("hit missing id: %#v", hits[0])
	}
}
