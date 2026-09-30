// Package apprun boots a coarse-grained control-plane process
// (de-sys / collab / cap / workflow, plus optional de-policy / de-audit).
package apprun

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/infra"
	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// Options configures Listen address and ServiceMode.
type Options struct {
	Addr string
	Mode server.ServiceMode
}

// Run blocks serving HTTP for the given coarse-grained unit.
func Run(opts Options) error {
	if opts.Mode == "" {
		opts.Mode = server.ParseServiceMode(os.Getenv("DE_SERVICE"))
	}
	if opts.Mode == server.ModeAll && os.Getenv("DE_ALLOW_MODE_ALL") != "1" {
		return fmt.Errorf("refusing ModeAll deployment (set DE_SERVICE=app for monolith or sys|collab|cap|workflow); use make compose-up-monolith or compose-up-coarse")
	}
	if opts.Addr == "" {
		opts.Addr = env("DE_LISTEN_ADDR", ":8080")
	}

	rt := runtimeenv.FromEnv()
	log.Printf("runtimeenv DE_ENV=%s persist=%v seed=%v", rt, rt.PersistEnabled(), rt.AllowsSeed())

	ctx := context.Background()
	domain := store.DomainFromMode(opts.Mode.String())

	if rt.IsDemo() {
		return runDemo(ctx, opts, domain)
	}
	return runDurable(ctx, opts, domain, rt)
}

func runDemo(ctx context.Context, opts Options, domain store.Domain) error {
	st := store.NewDemo()
	st.SetWriteDomain(domain)
	st.DropUnowned(domain)
	if domain == store.DomainAll || domain == store.DomainCap {
		st.EnsureDocxSkillReady()
		server.New(st).EnsureBuiltinSkillsReady()
		server.New(st).EnsureBuiltinKnowledgeReady()
	}
	if domain == store.DomainAll || domain == store.DomainCap || domain == store.DomainWorkflow {
		server.New(st).EnsureBuiltinWorkflowsReady()
	}
	if domain == store.DomainAll || domain == store.DomainCollab {
		st.EnsureGeneralEmployee()
		st.EnsureOfficeEmployee()
		st.EnsureEmployeesReplyModeDefaults()
	}
	srv := server.New(st)
	srv.Mode = opts.Mode
	if opts.Mode == server.ModeCap || opts.Mode == server.ModeCollab || opts.Mode.IsUnified() {
		srv.StartMemoryMaintenance()
	}
	httpServer := &http.Server{
		Addr:              opts.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("%s listening on %s [mode=%s env=demo memory-only]", opts.Mode.String(), opts.Addr, opts.Mode)
	return serveWithGracefulShutdown(httpServer, srv)
}

// serveWithGracefulShutdown runs httpServer.ListenAndServe in a goroutine
// and listens for SIGTERM/SIGINT. On signal it calls httpServer.Shutdown
// and srv.Shutdown with a 10s deadline so the heartbeat sweep / visualdiff
// janitor / memory TTL goroutine exit cleanly instead of being SIGKILLed.
//
// Used by runDemo and runDurable. Other cmd entry points (de-audit /
// de-policy / de-sys) manage their own lifecycle.
func serveWithGracefulShutdown(httpServer *http.Server, srv *server.Server) error {
	errCh := make(chan error, 1)
	go func() { errCh <- httpServer.ListenAndServe() }()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	defer signal.Stop(sigCh)

	select {
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			return err
		}
	case sig := <-sigCh:
		log.Printf("apprun: received %s, shutting down", sig)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("apprun: http shutdown: %v", err)
		}
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("apprun: server shutdown: %v", err)
		}
	}
	return nil
}

func runDurable(ctx context.Context, opts Options, domain store.Domain, rt runtimeenv.Mode) error {
	pg, err := infra.OpenPostgres(ctx)
	if err != nil {
		return err
	}
	if pg == nil && rt.RequiresPostgres() {
		return fmt.Errorf("DE_ENV=%s requires Postgres (set DE_DATABASE_URL)", rt)
	}
	replicaForced := false
	postgresRecovery := false
	if pg != nil {
		if rec, recErr := infra.PostgresInRecovery(ctx, pg); recErr != nil {
			log.Printf("pg_is_in_recovery: %v", recErr)
		} else if rec {
			log.Printf("postgres in recovery: forcing replica=standby")
			replicaForced = true
			postgresRecovery = true
		}
	}
	rdb, err := infra.OpenRedis(ctx)
	if err != nil {
		return err
	}

	st := store.NewEmpty()
	st.SetWriteDomain(domain)
	auditSink := &infra.AuditSink{Pool: pg}
	auditBus := infra.NewAuditBus(rdb)
	kafkaBus := infra.NewKafkaAuditBusFromEnv()
	search := infra.NewOpenSearchAuditFromEnv()
	if search != nil {
		if err := search.EnsureIndex(ctx); err != nil {
			log.Printf("opensearch ensure index: %v", err)
		}
	}
	kv := &infra.KVStore{Pool: pg}
	kernel := &infra.KernelStore{Pool: pg}
	if err := kernel.Ensure(ctx); err != nil {
		log.Printf("kernel schema: %v", err)
	}

	st.SetAuditHook(func(ev map[string]any) {
		c := context.Background()
		failed := false
		if err := auditSink.Append(c, ev); err != nil {
			failed = true
			log.Printf("audit pg append: %v", err)
		}
		if auditBus != nil {
			auditBus.Publish(c, ev)
		}
		if kafkaBus != nil {
			kafkaBus.Publish(c, ev)
		}
		if search != nil {
			if err := search.IndexEvent(c, ev); err != nil {
				failed = true
				log.Printf("audit opensearch index: %v", err)
			}
		}
		if failed {
			server.IncAuditWriteFailure()
		}
	})

	if rt.PersistEnabled() && pg != nil {
		st.SetPersistHook(func(ctx context.Context, collection string, items []map[string]any) error {
			if kernel.Owns(collection) {
				return kernel.UpsertCollection(ctx, collection, items)
			}
			if store.ShouldReplaceOnPersist(collection) {
				return kv.ReplaceCollection(ctx, collection, items)
			}
			return kv.UpsertMany(ctx, collection, items)
		})
		st.SetDeleteHook(func(ctx context.Context, collection string, ids []string) error {
			if kernel.Owns(collection) {
				if err := kernel.DeleteMany(ctx, collection, ids); err != nil {
					return err
				}
				// Also clear any legacy kv copies lifted during hydrate fallback.
				_ = kv.DeleteMany(ctx, collection, ids)
				return nil
			}
			return kv.DeleteMany(ctx, collection, ids)
		})
	}

	hydrated := 0
	for _, coll := range store.CollectionsForDomain(domain) {
		var items []map[string]any
		if kernel.Owns(coll) {
			rows, err := kernel.List(ctx, coll)
			if err != nil {
				log.Printf("kernel hydrate %s: %v", coll, err)
			} else if len(rows) > 0 {
				items = rows
			}
		}
		if len(items) == 0 && !kernel.Owns(coll) {
			kvItems, err := kv.List(ctx, coll)
			if err != nil {
				log.Printf("hydrate %s: %v", coll, err)
				continue
			}
			items = kvItems
		} else if len(items) == 0 && kernel.Owns(coll) {
			kvItems, err := kv.List(ctx, coll)
			if err != nil {
				log.Printf("hydrate kv fallback %s: %v", coll, err)
			} else if len(kvItems) > 0 {
				items = kvItems
				if err := kernel.UpsertCollection(ctx, coll, kvItems); err != nil {
					log.Printf("kernel lift %s: %v", coll, err)
				}
			}
		}
		if len(items) > 0 {
			st.HydrateFrom(coll, items)
			hydrated++
		}
	}
	if hydrated > 0 {
		log.Printf("hydrated %d durable collections from postgres [domain=%s env=%s]", hydrated, domain, rt)
	} else {
		log.Printf("empty durable store [domain=%s env=%s] — no demonstration seed will be written", domain, rt)
	}
	// Intentionally NO PersistNow(seed) on empty DB — that polluted production with ACME demo data.

	st.DropUnowned(domain)
	if domain == store.DomainAll || domain == store.DomainSys {
		if st.EnsureDefaultWorkspace() {
			log.Printf("ensured default workspace %s (empty durable store shell)", store.DefaultWorkspaceID)
			if rt.PersistEnabled() && st.CanWrite("workspaces") {
				st.Persist("workspaces")
			}
		}
		st.RebuildWorkspaceAccessGrants()
	}
	if domain == store.DomainAll || domain == store.DomainCap {
		st.EnsureDocxSkillReady()
		server.New(st).EnsureBuiltinSkillsReady()
		server.New(st).EnsureBuiltinKnowledgeReady()
		if rt.PersistEnabled() && st.CanWrite("skills") {
			st.Persist("skills")
		}
	}
	if domain == store.DomainAll || domain == store.DomainCap || domain == store.DomainWorkflow {
		server.New(st).EnsureBuiltinWorkflowsReady()
	}
	if (domain == store.DomainAll || domain == store.DomainCollab) && rt.EnsureGeneralEmployeeAllowed() {
		st.EnsureGeneralEmployee()
		st.EnsureOfficeEmployee()
		st.EnsureEmployeesReplyModeDefaults()
		if rt.PersistEnabled() && st.CanWrite("employees") {
			st.Persist("employees")
		}
	}

	srv := server.New(st)
	srv.Mode = opts.Mode
	srv.PG = pg
	srv.Kernel = kernel
	srv.ReplicaForced = replicaForced
	srv.PostgresRecovery = postgresRecovery
	srv.Cache = &infra.Cache{RDB: rdb}
	srv.AuditSink = auditSink
	srv.UsageSink = &infra.UsageSink{Pool: pg}
	srv.KV = kv
	srv.Search = search
	// P1-3 · Register each *distinct* external resource for graceful close.
	// pg is shared by PG / AuditSink / UsageSink / KV / Kernel — only one
	// closer avoids double-close (pgxpool.Pool.Close is sync.Once-protected
	// and panics on the second call). rdb is shared by Cache + AuditBus —
	// same rationale. Kafka writer / AuditBus stream are owned by the
	// apprun-local kafkaBus / auditBus and not injected into Server, so
	// their close path is out-of-scope for this PR.
	if pg != nil {
		srv.RegisterCloseFunc(func() error { pg.Close(); return nil })
	}
	if rdb != nil {
		srv.RegisterCloseFunc(func() error { return rdb.Close() })
	}
	srv.AuditBus = auditBus
	srv.KafkaBus = kafkaBus
	// P1-4 · KafkaAuditBus.Close returns error directly — no adapter needed.
	// Nil-safe by infra implementation (kafkabus.go:39-44).
	if kafkaBus != nil {
		srv.RegisterCloseFunc(kafkaBus.Close)
	}
	// P1-4 · OpenSearchAudit.Close drains the pooled *http.Client's idle
	// connections so the audit sink doesn't leak sockets across restarts.
	// Nil-safe on both the receiver and the HTTP client (opensearch.go:38-45).
	if search != nil {
		srv.RegisterCloseFunc(search.Close)
	}
	srv.Search = search
	if opts.Mode == server.ModeCap || opts.Mode == server.ModeCollab || opts.Mode.IsUnified() {
		srv.StartMemoryMaintenance()
	}

	httpServer := &http.Server{
		Addr:              opts.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("%s listening on %s [mode=%s env=%s]", opts.Mode.String(), opts.Addr, opts.Mode, rt)
	return serveWithGracefulShutdown(httpServer, srv)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
