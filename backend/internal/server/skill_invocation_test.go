package server

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestRecordSkillInvocationUpdatesGovernance(t *testing.T) {
	st := store.New()
	st.EnsureDocxSkillReady()
	srv := New(st)

	srv.Store.Lock()
	var sk map[string]any
	for _, item := range srv.Store.Skills {
		if str(item["id"]) == "sk-docx" || str(item["name"]) == "docx" {
			sk = item
			break
		}
	}
	if sk == nil {
		srv.Store.Unlock()
		t.Fatal("docx skill missing")
	}
	ws := str(sk["workspaceId"])
	srv.recordSkillInvocationLocked(ws, sk, 120, true, "tester", "unit-test")
	srv.recordSkillInvocationLocked(ws, sk, 80, true, "tester", "unit-test")
	h := srv.ensureSkillHealthLocked(sk)
	calls := intFrom(h["calls24h"])
	if calls < 2 {
		srv.Store.Unlock()
		t.Fatalf("calls24h=%d", calls)
	}
	if str(h["updatedAt"]) == "尚未调用" {
		srv.Store.Unlock()
		t.Fatalf("updatedAt still 尚未调用")
	}
	if intFrom(h["p95Ms"]) < 120 {
		srv.Store.Unlock()
		t.Fatalf("p95Ms=%v", h["p95Ms"])
	}
	buckets := srv.skillTrendBucketsLocked(ws)
	total := 0
	for _, b := range buckets {
		total += intFrom(b["calls"])
	}
	srv.Store.Unlock()
	if total < 2 {
		t.Fatalf("trend calls=%d", total)
	}
}

func TestCollabSkillInvocationDelegatesToCap(t *testing.T) {
	t.Setenv("DE_ALLOW_MOCK_IDENTITY", "1")

	capStore := store.New()
	capStore.SetWriteDomain(store.DomainCap)
	capStore.DropUnowned(store.DomainCap)
	capStore.EnsureDocxSkillReady()
	capSrv := New(capStore)
	capSrv.Mode = ModeCap
	capTS := httptest.NewServer(capSrv.Handler())
	t.Cleanup(capTS.Close)

	collabStore := store.New()
	collabStore.SetWriteDomain(store.DomainCollab)
	collabStore.DropUnowned(store.DomainCollab)
	collabStore.EnsureDocxSkillReady()
	collab := New(collabStore)
	collab.Mode = ModeCollab
	collab.PeerHTTP = capTS.Client()
	t.Setenv("DE_CAP_URL", capTS.URL)

	var sk map[string]any
	collab.Store.RLock()
	for _, item := range collabStore.Skills {
		if str(item["id"]) == "sk-docx" {
			sk = item
			break
		}
	}
	collab.Store.RUnlock()
	if sk == nil {
		t.Fatal("docx skill missing on collab bootstrap")
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		collab.recordSkillInvocationWithRequest(nil, "w1", sk, 42, true, "tester", "unit-test")
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("recordSkillInvocation blocked or panicked")
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		capStore.RLock()
		calls := 0
		for _, h := range capStore.SkillHealth {
			if str(h["skillId"]) == "sk-docx" {
				calls = intFrom(h["calls24h"])
				break
			}
		}
		capStore.RUnlock()
		if calls > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("expected cap to receive delegated skill invocation metrics")
}
