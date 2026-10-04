package store

import (
	"context"
	"testing"
)

// After the qzda-sys / qzda-collab / qzda-cap / qzda-workflow collapse
// every collection is owned by the qzda-app monolith. The coarse-split
// domain guards no longer apply; these tests only document the
// post-collapse invariant: CollectionsForDomain always returns the full
// DurableCollections, CollectionDomain is always DomainAll, and CanWrite
// is always true.
func TestCollectionsForDomainReturnsAllCollections(t *testing.T) {
	got := CollectionsForDomain(DomainAll)
	if len(got) != len(DurableCollections) {
		t.Fatalf("want %d durable collections, got %d", len(DurableCollections), len(got))
	}
	for _, name := range DurableCollections {
		found := false
		for _, n := range got {
			if n == name {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing %s from CollectionsForDomain", name)
		}
	}
}

func TestCollectionDomainAlwaysAll(t *testing.T) {
	for _, name := range DurableCollections {
		if d := CollectionDomain(name); d != DomainAll {
			t.Fatalf("%s owned by %s, want DomainAll", name, d)
		}
	}
}

func TestCanWriteAllCollections(t *testing.T) {
	st := New()
	for _, name := range DurableCollections {
		if !st.CanWrite(name) {
			t.Fatalf("monolith must write %s", name)
		}
	}
	if !st.CanWrite("arbitrary-collection") {
		t.Fatal("monolith must write unknown collections too")
	}
}

func TestWriteDomainAlwaysAll(t *testing.T) {
	st := New()
	if d := st.WriteDomain(); d != DomainAll {
		t.Fatalf("WriteDomain=%s want DomainAll", d)
	}
}

func TestPersistNowWritesAllCollections(t *testing.T) {
	st := New()
	got := map[string]int{}
	st.SetPersistHook(func(_ context.Context, collection string, items []map[string]any) error {
		got[collection] = len(items)
		return nil
	})
	if err := st.PersistNow(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["skills"]; !ok {
		t.Fatalf("monolith must persist skills: %#v", got)
	}
	if _, ok := got["workflows"]; !ok {
		t.Fatalf("monolith must persist workflows: %#v", got)
	}
	if _, ok := got["sessions"]; !ok {
		t.Fatalf("monolith must persist sessions: %#v", got)
	}
}

func TestShouldReplaceOnPersistShrinkHeavy(t *testing.T) {
	for _, name := range []string{"channel_dlq", "channel_audit"} {
		if !ShouldReplaceOnPersist(name) {
			t.Fatalf("%s should still full-replace", name)
		}
	}
	if ShouldReplaceOnPersist("channel_inbound") {
		t.Fatal("channel_inbound is a kernel table (R2); must not full-replace")
	}
}

func TestSeedCollection(t *testing.T) {
	if SeedCollection(DomainAll) != "workspaces" {
		t.Fatalf("SeedCollection=%q want workspaces", SeedCollection(DomainAll))
	}
}