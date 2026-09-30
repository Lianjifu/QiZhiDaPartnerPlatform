package server

import "testing"

func TestServiceModeOwnsPath(t *testing.T) {
	cases := []struct {
		mode ServiceMode
		path string
		want bool
	}{
		{ModeAll, "/api/skills", true},
		{ModeApp, "/api/skills", true},
		{ModeApp, "/api/sessions", true},
		{ModeApp, "/api/workspaces", true},
		{ModeApp, "/api/model-providers", true},
		{ModeSys, "/api/workspaces", true},
		{ModeSys, "/api/audit-center", true},
		{ModeSys, "/api/zero-trust/evaluate", true},
		{ModeSys, "/api/home/kpis", true},
		{ModeSys, "/api/skills", false},
		{ModeCollab, "/api/tasks", true},
		{ModeCollab, "/api/copilot/conversations", true},
		{ModeCollab, "/api/partners", true},
		{ModeCollab, "/api/models/providers", false},
		{ModeCap, "/api/model-providers", true},
		{ModeCap, "/api/knowledge/packages", true},
		{ModeCap, "/api/memory/records", true},
		{ModeCap, "/api/skills/catalog", true},
		{ModeCap, "/api/channel-control/health", true},
		{ModeCap, "/api/workspaces", false},
		{ModeWorkflow, "/api/workflows", true},
		{ModeWorkflow, "/api/workflow-runs", true},
		{ModeWorkflow, "/api/tasks", false},
		{ModeSys, "/healthz", true},
		{ModeCap, "/healthz", true},
		{ModePolicy, "/v1/evaluate", true},
		{ModePolicy, "/api/access/governance", true},
		{ModePolicy, "/api/zero-trust/evaluate", true},
		{ModePolicy, "/api/release-approvals", true},
		{ModePolicy, "/api/workspaces", false},
		{ModeAudit, "/api/audit-center", true},
		{ModeAudit, "/api/audits", true},
		{ModeAudit, "/v1/events", true},
		{ModeAudit, "/api/workspaces", false},
		{ModePolicy, "/qzda.policy.v1.PolicyService/EvaluateZeroTrust", true},
		{ModeAudit, "/qzda.audit.v1.AuditService/ListAuditCenter", true},
		{ModeCap, "/qzda.policy.v1.PolicyService/EvaluateZeroTrust", false},
	}
	for _, tc := range cases {
		if got := tc.mode.OwnsPath(tc.path); got != tc.want {
			t.Errorf("%s.OwnsPath(%q)=%v want %v", tc.mode, tc.path, got, tc.want)
		}
	}
}

func TestParseServiceMode(t *testing.T) {
	if ParseServiceMode("qzda-sys") != ModeSys {
		t.Fatal("qzda-sys")
	}
	if ParseServiceMode("") != ModeSys {
		t.Fatal("empty defaults to sys")
	}
	if ParseServiceMode("all") != ModeAll {
		t.Fatal("all")
	}
	if ParseServiceMode("qzda-app") != ModeApp {
		t.Fatal("qzda-app")
	}
	if ParseServiceMode("app") != ModeApp {
		t.Fatal("app")
	}
	if ParseServiceMode("qzda-policy") != ModePolicy {
		t.Fatal("qzda-policy")
	}
	if ParseServiceMode("audit") != ModeAudit {
		t.Fatal("audit")
	}
}

func TestSysDropsPolicyWhenSplit(t *testing.T) {
	t.Setenv("DE_CROSSCUTTING_SPLIT", "1")
	if ModeSys.OwnsPath("/v1/evaluate") {
		t.Fatal("split sys must not own evaluate")
	}
	if ModeSys.OwnsPath("/api/audit-center") {
		t.Fatal("split sys must not own audit-center")
	}
	if !ModeSys.OwnsPath("/api/workspaces") {
		t.Fatal("split sys still owns workspaces")
	}
	if !ModePolicy.OwnsPath("/v1/evaluate") || !ModeAudit.OwnsPath("/api/audit-center") {
		t.Fatal("policy/audit binaries own split routes")
	}
}
