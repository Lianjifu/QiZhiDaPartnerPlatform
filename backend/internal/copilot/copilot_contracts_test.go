package copilot

import "testing"

// TestEveryRegisteredToolHasACapabilityContract is the P2 table-driven
// guarantee: every tool the platform can expose to a digital partner carries
// a contract, so nothing reaches the model (or the audit trail) without a
// declared calling shape.
func TestEveryRegisteredToolHasACapabilityContract(t *testing.T) {
	reg := buildToolRegistry(nil, nil)
	if len(reg) == 0 {
		t.Fatal("empty registry")
	}
	for _, tool := range reg {
		if tool.Contract.Name == "" {
			t.Errorf("tool %q has no contract", tool.Name)
			continue
		}
		if tool.Contract.InputSchema == nil {
			t.Errorf("tool %q contract has no input schema", tool.Name)
		}
		if tool.Contract.Mode == "" {
			t.Errorf("tool %q contract has no mode", tool.Name)
		}
	}
}

// TestValidateContractArgsRejectsMissingRequired covers the pre-execution
// guard: a call missing a required argument is rejected and reported back to
// the model instead of running and failing in an opaque way.
func TestValidateContractArgsRejectsMissingRequired(t *testing.T) {
	c, ok := lookupContract("shell.exec")
	if !ok {
		t.Fatal("shell.exec contract missing")
	}
	if msg := ValidateContractArgs(c, map[string]any{}); msg == "" {
		t.Fatal("expected missing-argument rejection")
	}
	if msg := ValidateContractArgs(c, map[string]any{"cmd": "ls"}); msg != "" {
		t.Fatalf("alias should satisfy the contract, got %q", msg)
	}
	if msg := ValidateContractArgs(c, map[string]any{"command": "ls"}); msg != "" {
		t.Fatalf("unexpected rejection: %q", msg)
	}
}

// TestValidateContractArgsChecksTypes makes sure the contract also catches
// obvious type mistakes (a string where an object is required).
func TestValidateContractArgsChecksTypes(t *testing.T) {
	c, ok := lookupContract("chart.generate")
	if !ok {
		t.Fatal("chart.generate contract missing")
	}
	if msg := ValidateContractArgs(c, map[string]any{"schema": "bar", "data": "not-an-object"}); msg == "" {
		t.Fatal("expected type rejection")
	}
	if msg := ValidateContractArgs(c, map[string]any{"schema": "bar", "data": map[string]any{"x": 1}}); msg != "" {
		t.Fatalf("unexpected rejection: %q", msg)
	}
}

// TestEmployeeCapabilityContractsProjectsConfiguredCapabilities checks the
// M05 payload projection: only the capabilities the partner actually mounted
// show up, each with its calling shape.
func TestEmployeeCapabilityContractsProjectsConfiguredCapabilities(t *testing.T) {
	emp := map[string]any{
		"capabilities": map[string]any{
			"model":  "m1",
			"tools":  []any{"knowledge.retrieve", "cmdb.asset.lookup"},
			"skills": []any{"docx"},
		},
		"boundaryPolicy": map[string]any{
			"capabilityModes": []any{
				map[string]any{"capabilityType": "tool", "capabilityName": "cmdb.asset.lookup", "mode": "approval_required"},
			},
		},
	}
	contracts := EmployeeCapabilityContracts(emp)
	if len(contracts) != 3 {
		t.Fatalf("want 3 contracts, got %d: %#v", len(contracts), contracts)
	}
	byName := map[string]map[string]any{}
	for _, c := range contracts {
		byName[c["name"].(string)] = c
	}
	kr, ok := byName["knowledge.retrieve"]
	if !ok {
		t.Fatalf("knowledge.retrieve contract missing: %#v", contracts)
	}
	if kr["inputSchema"] == nil {
		t.Fatal("knowledge.retrieve contract has no schema")
	}
	cmdb, ok := byName["cmdb.asset.lookup"]
	if !ok {
		t.Fatalf("cmdb contract missing: %#v", contracts)
	}
	if cmdb["mode"] != "approval_required" {
		t.Fatalf("boundary mode not applied to contract: %#v", cmdb)
	}
	if _, ok := byName["docx"]; !ok {
		t.Fatalf("skill contract missing: %#v", contracts)
	}
}

// TestEmployeeContractIssuesFlagsTypos keeps the release gate narrow but
// useful: a mistyped platform capability is flagged, an unrelated enterprise
// tool is not.
func TestEmployeeContractIssuesFlagsTypos(t *testing.T) {
	typo := map[string]any{"capabilities": map[string]any{"tools": []any{"knowlege.retrieve"}}}
	if issues := EmployeeContractIssues(typo); len(issues) == 0 {
		t.Fatal("expected typo to be flagged")
	}
	enterprise := map[string]any{"capabilities": map[string]any{"tools": []any{"cmdb.asset.lookup"}}}
	if issues := EmployeeContractIssues(enterprise); len(issues) != 0 {
		t.Fatalf("enterprise tool should not be flagged: %#v", issues)
	}
}
