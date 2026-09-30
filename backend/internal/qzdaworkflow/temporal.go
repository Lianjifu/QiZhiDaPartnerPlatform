package qzdaworkflow

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.temporal.io/sdk/client"
)

// TrialWorkflowName is registered by cmd/de-workflow.
const TrialWorkflowName = "qzda.workflow.TrialRun"

// StartTrialTemporal submits a Temporal workflow when the frontend is reachable.
// Falls back to the in-process engine on dial/start failure.
func (e *Engine) StartTrialTemporal(ctx context.Context, runID, workflowID string) (*Run, error) {
	if !e.TemporalConfigured() {
		return e.StartTrialLocal(ctx, runID, workflowID)
	}
	c, err := client.Dial(client.Options{
		HostPort: e.temporalHost,
		ConnectionOptions: client.ConnectionOptions{
			GetSystemInfoTimeout: 2 * time.Second,
		},
	})
	if err != nil {
		if temporalFailClosed() {
			return nil, fmt.Errorf("%w: %v", ErrTemporalUnavailable, err)
		}
		log.Printf("temporal dial %s failed, falling back to local: %v", e.temporalHost, err)
		return e.StartTrialLocal(ctx, runID, workflowID)
	}
	defer c.Close()

	temporalID := fmt.Sprintf("de-wf-%s-%s", workflowID, runID)
	run := &Run{
		ID: runID, WorkflowID: workflowID, Status: "running",
		StartedAt:  time.Now().UTC(),
		Steps:      []string{"validate_graph", "temporal_start"},
		EngineName: "temporal", TemporalID: temporalID,
	}
	e.mu.Lock()
	e.runs[runID] = run
	e.mu.Unlock()

	wctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	we, err := c.ExecuteWorkflow(wctx, client.StartWorkflowOptions{
		ID:        temporalID,
		TaskQueue: "de-workflow",
	}, TrialWorkflowName, TrialInput{RunID: runID, WorkflowID: workflowID})
	if err != nil {
		if temporalFailClosed() {
			return nil, fmt.Errorf("%w: %v", ErrTemporalUnavailable, err)
		}
		log.Printf("temporal start failed, falling back to local: %v", err)
		return e.StartTrialLocal(ctx, runID, workflowID)
	}

	var out TrialResult
	if err := we.Get(wctx, &out); err != nil {
		if temporalFailClosed() {
			return nil, fmt.Errorf("%w: %v", ErrTemporalUnavailable, err)
		}
		log.Printf("temporal wait failed, falling back to local: %v", err)
		return e.StartTrialLocal(ctx, runID, workflowID)
	}
	run.Status = out.Status
	run.Steps = out.Steps
	run.Error = out.Error
	run.FinishedAt = time.Now().UTC()
	return run, nil
}

// TrialInput / TrialResult are shared with the worker process.
type TrialInput struct {
	RunID      string `json:"runId"`
	WorkflowID string `json:"workflowId"`
}

type TrialResult struct {
	Status string   `json:"status"`
	Steps  []string `json:"steps"`
	Error  string   `json:"error"`
}
