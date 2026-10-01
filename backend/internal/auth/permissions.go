package auth

import "strings"

// RolePermissions returns the permission list associated with the given role.
// Used by Identity.Permissions at login + JWT mint time so downstream handlers
// can check authorization without re-reading role tables.
func RolePermissions(role string) []string {
	switch role {
	case "admin":
		return []string{
			"workspace.read", "workspace.write", "agent.read", "agent.write", "agent.install",
			"workflow.read", "workflow.write", "workflow.execute", "knowledge.read", "knowledge.write",
			"skill.read", "skill.write", "skill.execute", "model.read", "model.write",
			"task.read", "task.write", "task.approve", "channel.read", "channel.write",
			"audit.read", "audit.export", "access.read", "access.write", "release.approve",
			"billing.read", "billing.write",
			"skill.vet.override", "publisher_key.rotate", "vault.read",
		}
	case "auditor":
		return []string{
			"workspace.read", "agent.read", "workflow.read", "knowledge.read", "skill.read",
			"model.read", "task.read", "channel.read", "audit.read", "audit.export",
		}
	default: // user
		return []string{
			"workspace.read", "agent.read", "agent.write", "workflow.read", "workflow.write", "workflow.execute",
			"knowledge.read", "knowledge.write", "skill.read", "skill.write", "skill.execute",
			"task.read", "task.write",
		}
	}
}

// Has reports whether the given identity's Permissions include the requested permission.
// A nil identity is treated as having no permissions.
func Has(id *Identity, perm string) bool {
	if id == nil {
		return false
	}
	for _, p := range id.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}

// RoleFromEmail maps the email prefix to the canonical demo role for the
// mock-token login path. admin@* → admin, audit@* → auditor, everything else → user.
func RoleFromEmail(email string) (role, name, userID string) {
	e := strings.ToLower(email)
	switch {
	case strings.HasPrefix(e, "admin@"):
		return "admin", "平台管理员", "u1"
	case strings.HasPrefix(e, "audit@"):
		return "auditor", "合规审计员", "u3"
	default:
		return "user", "业务构建者", "u2"
	}
}
