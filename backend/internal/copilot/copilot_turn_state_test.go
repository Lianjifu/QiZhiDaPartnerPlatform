package copilot

import "testing"

func TestCopilotTurnCancelSkipsPersist(t *testing.T) {
	corr := "corr_test_1"
	registerCopilotTurn("conv1", corr, "c1")
	if !lookupTurnRunning(corr) {
		t.Fatal("expected running turn")
	}
	markCopilotTurnCancelled(corr)
	if !isCopilotTurnCancelled(corr) {
		t.Fatal("expected cancelled turn")
	}
	finishCopilotTurn(corr, turnStatusDone)
	rec, ok := lookupCopilotTurn(corr)
	if !ok || rec.Status != turnStatusCancelled {
		t.Fatalf("cancelled turn must not be overwritten by finish: %+v", rec)
	}
}

func lookupTurnRunning(corr string) bool {
	rec, ok := lookupCopilotTurn(corr)
	return ok && rec.Status == turnStatusRunning
}

func TestCorrelationIDFromTurnSubPath(t *testing.T) {
	path := "/api/copilot/conversations/s1/turns/corr-42/status"
	got := correlationIDFromTurnSubPath(path, "status")
	if got != "corr-42" {
		t.Fatalf("got %q", got)
	}
}
