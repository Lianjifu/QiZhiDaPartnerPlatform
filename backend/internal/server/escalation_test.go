package server_test

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestEscalateDigitalPartnerHandsOffToEscalationOwner covers the M05 promise
// that has never been honoured at runtime: a partner configured with
// boundaryPolicy.handoff triggers must actually hand the session over to the
// escalation owner when the trigger fires.
func TestEscalateDigitalPartnerHandsOffToEscalationOwner(t *testing.T) {
	st := store.New()
	st.Lock()
	st.Employees = append(st.Employees, map[string]any{
		"id": "de-ops", "workspaceId": "w1", "name": "运维岗", "role": "运维",
		"escalationOwner": "业务构建者",
		"boundaryPolicy": map[string]any{
			"capabilityModes": []any{},
			"handoff": map[string]any{
				"triggers":  []any{"prohibited_action"},
				"approvers": []any{"业务构建者"},
			},
		},
	})
	st.Sessions = append(st.Sessions, map[string]any{
		"id": "sess-1", "workspaceId": "w1", "conversationId": "conv-1",
		"digitalPartnerId": "de-1", "status": "active",
	})
	st.Unlock()

	srv := server.New(st)
	escalate := srv.CopSvc.Deps.Escalation.EscalateFn
	if escalate == nil {
		t.Fatal("Escalation.EscalateFn not wired")
	}

	out, err := escalate(copilot.EscalationInput{
		WorkspaceID: "w1", ConversationID: "conv-1", CorrelationID: "corr-1",
		DigitalPartnerID: "de-ops", Trigger: "prohibited_action",
		Reason: "尝试执行被边界策略禁止的能力：shell.exec", ToolName: "shell.exec",
	})
	if err != nil {
		t.Fatalf("escalate: %v", err)
	}
	if escalated, _ := out["escalated"].(bool); !escalated {
		t.Fatalf("expected escalation, got %#v", out)
	}
	if owner, _ := out["ownerName"].(string); owner != "业务构建者" {
		t.Fatalf("owner=%q want 业务构建者", owner)
	}

	st.RLock()
	var sess map[string]any
	for _, s := range st.Sessions {
		if s["id"] == "sess-1" {
			sess = s
			break
		}
	}
	st.RUnlock()
	if sess == nil {
		t.Fatal("session disappeared")
	}
	h, _ := sess["handoff"].(map[string]any)
	if h == nil {
		t.Fatalf("handoff not set on session: %#v", sess)
	}
	if active, _ := h["active"].(bool); !active {
		t.Fatalf("handoff not active: %#v", h)
	}
	if owner, _ := h["ownerName"].(string); owner != "业务构建者" {
		t.Fatalf("handoff owner=%q", owner)
	}

	// Escalation must be idempotent: a second trigger must not re-hand-off.
	again, err := escalate(copilot.EscalationInput{
		WorkspaceID: "w1", ConversationID: "conv-1", DigitalPartnerID: "de-ops",
		Trigger: "prohibited_action", Reason: "再次触发",
	})
	if err != nil {
		t.Fatalf("second escalate: %v", err)
	}
	if escalated, _ := again["escalated"].(bool); escalated {
		t.Fatalf("second escalation should be a no-op, got %#v", again)
	}
}

// TestEscalateDigitalPartnerWithoutSessionIsNoop makes sure a missing session
// never panics and never claims an escalation happened.
func TestEscalateDigitalPartnerWithoutSessionIsNoop(t *testing.T) {
	st := store.New()
	srv := server.New(st)
	out, err := srv.CopSvc.Deps.Escalation.EscalateFn(copilot.EscalationInput{
		WorkspaceID: "w1", ConversationID: "conv-missing", DigitalPartnerID: "de-ops",
		Trigger: "prohibited_action",
	})
	if err != nil {
		t.Fatalf("escalate: %v", err)
	}
	if escalated, _ := out["escalated"].(bool); escalated {
		t.Fatalf("expected no escalation, got %#v", out)
	}
}
