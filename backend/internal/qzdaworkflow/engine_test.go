package qzdaworkflow

import (
	"context"
	"testing"
)

func TestStartTrialLocal(t *testing.T) {
	e := New()
	run, err := e.StartTrial(context.Background(), "run-1", "wf-1")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "succeeded" {
		t.Fatalf("status %s", run.Status)
	}
	if run.EngineName != "de-workflow" {
		t.Fatalf("engine %s", run.EngineName)
	}
	m := run.ToMap()
	if m["engine"] != "de-workflow" {
		t.Fatalf("map engine %v", m["engine"])
	}
}
