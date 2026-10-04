package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/apprun"
	"github.com/qizhida-partner-platform/backend/internal/qzdaworkflow"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// Service: qzda-app
// Architecture: monolith — sys + collab + cap + workflow in one Go process
// Port: 8100
// Owns: platform, sessions/copilot, models/knowledge/memory/skills/channels,
//   workflow HTTP + Temporal worker (when DE_WORKFLOW_WORKER=1)
// Sidecars: qzda-sandbox (8093) for sandbox execution; qzda-agent-runtime,
//   qzda-rag optional
// Forbidden: in-process skill script execution (→ qzda-sandbox)
func main() {
	addr := env("DE_APP_ADDR", env("DE_LISTEN_ADDR", ":8100"))

	var wg sync.WaitGroup
	errCh := make(chan error, 2)

	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := apprun.Run(apprun.Options{Addr: addr, Mode: server.ModeApp}); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	if env("DE_WORKFLOW_WORKER", "0") == "1" {
		host := env("DE_TEMPORAL_HOST", "")
		if host == "" {
			log.Printf("qzda-app: DE_TEMPORAL_HOST empty — Temporal worker disabled (set DE_TEMPORAL_HOST to enable)")
		} else {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if err := runTemporalWorker(host); err != nil {
					errCh <- err
				}
			}()
		}
	}

	select {
	case err := <-errCh:
		log.Fatal(err)
	case <-waitDone(&wg):
	}
}

func waitDone(wg *sync.WaitGroup) <-chan struct{} {
	ch := make(chan struct{})
	go func() {
		wg.Wait()
		close(ch)
	}()
	return ch
}

func runTemporalWorker(host string) error {
	c, err := client.Dial(client.Options{HostPort: host})
	if err != nil {
		return err
	}
	defer c.Close()

	w := worker.New(c, "qzda-workflow", worker.Options{})
	w.RegisterWorkflowWithOptions(TrialRunWorkflow, workflow.RegisterOptions{Name: qzdaworkflow.TrialWorkflowName})
	w.RegisterActivity(SimulateTrialActivity)

	log.Printf("qzda-app Temporal worker on %s queue=qzda-workflow", host)
	return w.Run(worker.InterruptCh())
}

func TrialRunWorkflow(ctx workflow.Context, in qzdaworkflow.TrialInput) (qzdaworkflow.TrialResult, error) {
	ao := workflow.ActivityOptions{StartToCloseTimeout: 30 * time.Second}
	ctx = workflow.WithActivityOptions(ctx, ao)
	var steps []string
	if err := workflow.ExecuteActivity(ctx, SimulateTrialActivity, in).Get(ctx, &steps); err != nil {
		return qzdaworkflow.TrialResult{Status: "failed", Error: err.Error(), Steps: steps}, nil
	}
	return qzdaworkflow.TrialResult{Status: "succeeded", Steps: steps}, nil
}

func SimulateTrialActivity(ctx context.Context, in qzdaworkflow.TrialInput) ([]string, error) {
	steps := []string{"validate_graph", "allocate_worker"}
	steps = append(steps, qzdaworkflow.CallTrialActivities(ctx, in.WorkflowID)...)
	steps = append(steps, "collect_artifacts", "temporal_activity")
	return steps, nil
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
