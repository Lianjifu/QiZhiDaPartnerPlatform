package server

import (
	"strings"
	"testing"
)

func TestValidateEmployeeReleaseGates(t *testing.T) {
	ok := map[string]any{
		"owner": "A", "escalationOwner": "B", "serviceObject": "S",
		"responsibilities": []any{"值班"},
		"capabilities": map[string]any{
			"model": "m1", "skills": []any{"s1"}, "tools": []any{}, "workflows": []any{},
		},
		"evaluation": map[string]any{"status": "passed"},
	}
	if err := validateEmployeeReleaseGates(ok); err != nil {
		t.Fatalf("expected ok: %v", err)
	}

	bad := map[string]any{
		"owner": "", "escalationOwner": "待指定", "serviceObject": "",
		"responsibilities": []any{"待配置岗位职责"},
		"capabilities":     map[string]any{"model": "", "skills": []any{}},
		"evaluation":       map[string]any{"status": "failed"},
	}
	err := validateEmployeeReleaseGates(bad)
	if err == nil || !strings.Contains(err.Error(), "E_DIGITAL_PARTNER_PROFILE_INCOMPLETE") {
		t.Fatalf("expected profile incomplete, got %v", err)
	}
}

func TestEmployeeEvaluateIncomplete(t *testing.T) {
	emp := map[string]any{
		"responsibilities": []any{"待配置岗位职责"},
		"capabilities":     map[string]any{"model": "m", "skills": []any{}, "tools": []any{}, "workflows": []any{}},
	}
	if !employeeEvaluateIncomplete(emp) {
		t.Fatal("expected incomplete")
	}
}

func TestValidateEmployeeConfigurationBody(t *testing.T) {
	err := validateEmployeeConfigurationBody(map[string]any{
		"profile":      map[string]any{"name": "n", "role": "r", "department": "d"},
		"capabilities": map[string]any{"model": "m1"},
		"boundary": map[string]any{
			"responsibilities": []any{"值班"},
			"boundaryPolicy": map[string]any{
				"responsibilities": []any{"值班"},
				"handoff":          map[string]any{"triggers": []any{"升级"}, "approvers": []any{"经理"}},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	err = validateEmployeeConfigurationBody(map[string]any{
		"scope":   "role",
		"profile": map[string]any{"name": "n", "role": "r", "department": "d"},
		"boundary": map[string]any{
			"responsibilities": []any{"值班"},
			"boundaryPolicy": map[string]any{
				"responsibilities": []any{"值班"},
				"handoff":          map[string]any{"triggers": []any{"升级"}, "approvers": []any{"经理"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("role scope should not require model: %v", err)
	}
	err = validateEmployeeConfigurationBody(map[string]any{
		"scope":        "capability",
		"profile":      map[string]any{"name": "n", "role": "r", "department": "d"},
		"capabilities": map[string]any{"model": ""},
		"boundary": map[string]any{
			"responsibilities": []any{"值班"},
			"boundaryPolicy": map[string]any{
				"responsibilities": []any{"值班"},
				"handoff":          map[string]any{"triggers": []any{"升级"}, "approvers": []any{"经理"}},
			},
		},
	})
	if err == nil {
		t.Fatal("capability scope should require model")
	}
	err = validateEmployeeConfigurationBody(map[string]any{"profile": map[string]any{}})
	if err == nil {
		t.Fatal("expected configuration required")
	}
}
