package store

import (
	"context"
	"testing"
)

func TestCollectionsForDomainExcludesForeign(t *testing.T) {
	collab := CollectionsForDomain(DomainCollab)
	for _, name := range collab {
		if CollectionDomain(name) != DomainCollab {
			t.Fatalf("collab owns %s", name)
		}
	}
	cap := CollectionsForDomain(DomainCap)
	seen := map[string]bool{}
	for _, name := range cap {
		seen[name] = true
		if CollectionDomain(name) != DomainCap {
			t.Fatalf("cap owns %s", name)
		}
	}
	if seen["sessions"] || seen["routing_policies"] == false {
		t.Fatalf("cap should have routing_policies and not sessions: %#v", seen)
	}
	if ShouldReplaceOnPersist("channel_inbound") {
		t.Fatal("channel_inbound must not full-replace after R2")
	}
}

func TestWriteGuardPanicsOnCrossDomainPersist(t *testing.T) {
	st := New()
	st.SetWriteDomain(DomainCollab)
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic persisting skills from collab")
		}
	}()
	st.Persist("skills")
}

func TestPersistNowOnlyOwnedCollections(t *testing.T) {
	st := New()
	st.SetWriteDomain(DomainWorkflow)
	got := map[string]int{}
	st.SetPersistHook(func(_ context.Context, collection string, items []map[string]any) error {
		got[collection] = len(items)
		return nil
	})
	if err := st.PersistNow(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["skills"]; ok {
		t.Fatalf("workflow must not persist skills: %#v", got)
	}
	if _, ok := got["workflows"]; !ok {
		t.Fatalf("workflow should persist workflows: %#v", got)
	}
}

func TestDomainFromModeApp(t *testing.T) {
	if DomainFromMode("qzda-app") != DomainAll {
		t.Fatal("qzda-app must map to DomainAll")
	}
	if DomainFromMode("app") != DomainAll {
		t.Fatal("app must map to DomainAll")
	}
}

func TestCanWriteAllByDefault(t *testing.T) {
	st := New()
	if !st.CanWrite("skills") || !st.CanWrite("sessions") {
		t.Fatal("DomainAll should write every collection")
	}
}

func TestDomainPolicyCollectionsAndSysAbsorb(t *testing.T) {
	pol := CollectionsForDomain(DomainPolicy)
	seen := map[string]bool{}
	for _, name := range pol {
		seen[name] = true
		if CollectionDomain(name) != DomainPolicy {
			t.Fatalf("policy owns %s", name)
		}
	}
	if !seen["release_approvals"] || !seen["zt_policies"] || seen["sessions"] {
		t.Fatalf("policy collections %#v", seen)
	}
	sys := CollectionsForDomain(DomainSys)
	sysSeen := map[string]bool{}
	for _, name := range sys {
		sysSeen[name] = true
	}
	if !sysSeen["workspaces"] || !sysSeen["release_approvals"] {
		t.Fatalf("sys absorb should include policy collections: %#v", sysSeen)
	}
}

func TestSysSplitDropsPolicyCollections(t *testing.T) {
	t.Setenv("DE_CROSSCUTTING_SPLIT", "1")
	sys := CollectionsForDomain(DomainSys)
	for _, name := range sys {
		if CollectionDomain(name) == DomainPolicy {
			t.Fatalf("split sys must not hydrate %s", name)
		}
	}
	st := New()
	st.SetWriteDomain(DomainSys)
	if st.CanWrite("release_approvals") {
		t.Fatal("split sys must not write release_approvals")
	}
	pol := New()
	pol.SetWriteDomain(DomainPolicy)
	if !pol.CanWrite("release_approvals") || pol.CanWrite("workspaces") {
		t.Fatal("policy domain write guard")
	}
}

func TestDropUnownedPolicyKeepsZT(t *testing.T) {
	st := New()
	st.DropUnowned(DomainPolicy)
	if len(st.ZTPolicies) == 0 || len(st.ReleaseApprovals) == 0 {
		t.Fatal("policy should keep ZT/release")
	}
	if len(st.Workspaces) != 0 || len(st.Sessions) != 0 {
		t.Fatal("policy should drop sys/collab slices")
	}
}
