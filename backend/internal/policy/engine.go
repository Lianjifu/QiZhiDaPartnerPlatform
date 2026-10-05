package policy

import (
	"fmt"
	"strings"
)

// Input is the OPA-shaped evaluation input for write paths.
type Input struct {
	ActorID     string
	ActorRole   string
	WorkspaceID string
	Resource    string
	Action      string
	// Optional SoD: submitter vs approver
	SubmitterID string
	ApproverID  string
	// Extra facts
	PublishedBinding bool
	EgressExternal   bool
	DataClass        string // internal | confidential | restricted
}

type Decision struct {
	Allow           bool   `json:"allow"`
	Reason          string `json:"reason"`
	RequireDualSign bool   `json:"requireDualSign"`
	PolicyID        string `json:"policyId"`
	EvaluatedAt     string `json:"evaluatedAt,omitempty"`
}

// Engine evaluates write-path policy (remote OPA when QZDA_OPA_URL set, else embedded).
type Engine struct{}

func New() *Engine { return &Engine{} }

func isReadAction(action string) bool {
	a := strings.ToLower(action)
	return a == "read" || a == "list" || a == "get" || a == "export"
}

func (d Decision) Err() error {
	if d.Allow {
		return nil
	}
	return fmt.Errorf("policy_deny:%s:%s", d.PolicyID, d.Reason)
}
