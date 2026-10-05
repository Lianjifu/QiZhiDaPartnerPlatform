package infra

import (
	"context"
	"testing"
)

func TestResolveDatabaseURLStandbyPrefersReplica(t *testing.T) {
	t.Setenv("QZDA_DATABASE_URL", "postgres://de:de@primary:5432/digital_employee")
	t.Setenv("QZDA_DATABASE_REPLICA_URL", "postgres://de:de@replica:5432/digital_employee")
	t.Setenv("QZDA_REPLICA_MODE", "active")
	if got := ResolveDatabaseURL(); got != "postgres://de:de@primary:5432/digital_employee" {
		t.Fatalf("active primary %s", got)
	}
	t.Setenv("QZDA_REPLICA_MODE", "standby")
	if got := ResolveDatabaseURL(); got != "postgres://de:de@replica:5432/digital_employee" {
		t.Fatalf("standby replica %s", got)
	}
}

func TestPostgresInRecoveryNilPool(t *testing.T) {
	ok, err := PostgresInRecovery(context.Background(), nil)
	if err != nil || ok {
		t.Fatalf("nil pool %v %v", ok, err)
	}
}
