package infra

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ReplicaStandbyFromEnv reports QZDA_REPLICA_MODE=standby|readonly|passive.
func ReplicaStandbyFromEnv() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_REPLICA_MODE")))
	return v == "standby" || v == "readonly" || v == "passive"
}

// ResolveDatabaseURL picks the primary URL, or QZDA_DATABASE_REPLICA_URL when
// this process is explicitly standby. Empty means memory-only (tests).
func ResolveDatabaseURL() string {
	primary := strings.TrimSpace(os.Getenv("QZDA_DATABASE_URL"))
	replica := strings.TrimSpace(os.Getenv("QZDA_DATABASE_REPLICA_URL"))
	if ReplicaStandbyFromEnv() && replica != "" {
		return replica
	}
	return primary
}

// PostgresInRecovery is the R5 min replica probe. A recovering primary
// must not accept writes (standby until PG replica promotion).
func PostgresInRecovery(ctx context.Context, pool *pgxpool.Pool) (bool, error) {
	if pool == nil {
		return false, nil
	}
	var inRecovery bool
	err := pool.QueryRow(ctx, "SELECT pg_is_in_recovery()").Scan(&inRecovery)
	if err != nil {
		return false, err
	}
	return inRecovery, nil
}

// OpenPostgres connects via QZDA_DATABASE_URL, or QZDA_DATABASE_REPLICA_URL when
// QZDA_REPLICA_MODE=standby. Returns nil pool when URL is empty (tests / memory-only).
func OpenPostgres(ctx context.Context) (*pgxpool.Pool, error) {
	url := ResolveDatabaseURL()
	if url == "" {
		return nil, nil
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 16
	cfg.MinConns = 1
	cfg.MaxConnLifetime = time.Hour

	var pool *pgxpool.Pool
	var last error
	for i := 0; i < 30; i++ {
		pool, last = pgxpool.NewWithConfig(ctx, cfg)
		if last == nil {
			if pingErr := pool.Ping(ctx); pingErr == nil {
				log.Printf("postgres connected (%s)", redactURL(url))
				return pool, nil
			} else {
				last = pingErr
				pool.Close()
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return nil, fmt.Errorf("postgres not ready after retries: %w", last)
}

func MustReady(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("QZDA_DATABASE_URL 未设置：请先 make compose-up，并 export QZDA_DATABASE_URL")
	}
	return pool.Ping(ctx)
}

func redactURL(u string) string {
	// postgres://user:pass@host → postgres://user:***@host
	at := -1
	for i := 0; i < len(u); i++ {
		if u[i] == '@' {
			at = i
			break
		}
	}
	if at < 0 {
		return "postgres"
	}
	colon := -1
	for i := 0; i < at; i++ {
		if u[i] == ':' && i > len("postgres://") {
			colon = i
			break
		}
	}
	if colon < 0 {
		return u[:at] + "@…"
	}
	return u[:colon+1] + "***" + u[at:]
}
