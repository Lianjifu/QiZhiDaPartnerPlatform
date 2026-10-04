package store

// Domain marks write ownership for durable collections. The coarse-split
// domains (sys / collab / cap / workflow / policy / audit) were collapsed
// into a single DomainAll when qzda-sys / qzda-collab / qzda-cap /
// qzda-workflow merged into qzda-app.
type Domain string

const (
	DomainAll Domain = "all"
)

// KernelCollections are promoted off kv_documents into typed PG tables (R2).
var KernelCollections = []string{
	"sessions",
	"messages",
	"context_snapshots",
	"channel_inbound",
}

// CollectionDomain is a stable lookup for which Domain owns a durable
// collection. After the collapse every collection is owned by the monolith,
// so this always reports DomainAll.
func CollectionDomain(collection string) Domain { return DomainAll }

// IsKernelCollection reports collections stored only in typed PG tables (not kv_documents).
func IsKernelCollection(collection string) bool {
	for _, name := range KernelCollections {
		if name == collection {
			return true
		}
	}
	return false
}

// CollectionsForDomain is the hydrate/persist set for a process. The
// monolith owns everything, so it always returns the full DurableCollections.
func CollectionsForDomain(d Domain) []string {
	return append([]string{}, DurableCollections...)
}

// SeedCollection is the kv count probe used to decide first-boot persist.
func SeedCollection(d Domain) string { return "workspaces" }

// WriteDomain returns the write domain for this process. The monolith is
// always DomainAll.
func (s *Store) WriteDomain() Domain { return DomainAll }

// CanWrite reports whether this process may persist a collection. The
// monolith owns everything.
func (s *Store) CanWrite(collection string) bool { return true }