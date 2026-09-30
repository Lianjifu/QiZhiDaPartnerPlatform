package server

import (
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

// ServiceMode selects which coarse-grained deployment unit this process owns.
// Logical modules (platform/policy/…) remain packages; one Listen port per mode.
type ServiceMode string

const (
	ModeAll      ServiceMode = "all"      // unit tests only (single-process full routes)
	ModeApp      ServiceMode = "app"      // :8100 monolith · sys + collab + cap（方案 A）
	ModeSys      ServiceMode = "sys"      // :8100 platform · ops（默认仍吸收 policy/audit）
	ModeCollab   ServiceMode = "collab"   // :8101 collab · employee
	ModeCap      ServiceMode = "cap"      // :8102 model · knowledge · memory · skill · channel
	ModeWorkflow ServiceMode = "workflow" // :8103 workflow HTTP
	ModePolicy   ServiceMode = "policy"   // :8104 access · zero-trust · evaluate · release-approvals
	ModeAudit    ServiceMode = "audit"    // :8105 audit-center · /v1/events
)

func unifiedMode(m ServiceMode) bool {
	return m == ModeAll || m == ModeApp
}

// IsUnified reports monolith / full-route modes (tests + qzda-app deployment).
func (m ServiceMode) IsUnified() bool {
	return unifiedMode(m)
}

func ParseServiceMode(s string) ServiceMode {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "all":
		return ModeAll
	case "app", "qzda-app":
		return ModeApp
	case "sys", "qzda-sys", "platform", "":
		return ModeSys
	case "collab", "qzda-collab":
		return ModeCollab
	case "cap", "qzda-cap", "capability":
		return ModeCap
	case "workflow", "qzda-workflow":
		return ModeWorkflow
	case "policy", "qzda-policy":
		return ModePolicy
	case "audit", "qzda-audit":
		return ModeAudit
	default:
		return ModeSys
	}
}

func (m ServiceMode) String() string {
	switch m {
	case ModeApp:
		return "qzda-app"
	case ModeSys:
		return "qzda-sys"
	case ModeCollab:
		return "qzda-collab"
	case ModeCap:
		return "qzda-cap"
	case ModeWorkflow:
		return "qzda-workflow"
	case ModePolicy:
		return "qzda-policy"
	case ModeAudit:
		return "qzda-audit"
	case ModeAll:
		return "qzda-all"
	default:
		return "qzda-sys"
	}
}

func sysAbsorbsCrosscutting() bool {
	return store.AbsorbCrosscutting()
}

func (m ServiceMode) ownsOwner(owner ServiceMode) bool {
	if owner == m {
		return true
	}
	if m == ModeSys && sysAbsorbsCrosscutting() && (owner == ModePolicy || owner == ModeAudit) {
		return true
	}
	return false
}

// OwnsPath reports whether this deployment unit should handle the HTTP path.
func (m ServiceMode) OwnsPath(path string) bool {
	if unifiedMode(m) {
		return true
	}
	if path == "/healthz" || path == "/readyz" || path == "/metrics" {
		return true
	}
	// Connect-RPC: mount per mode (see mountConnectRPCForMode)
	if path == "/connect/" || strings.HasPrefix(path, "/connect/") {
		return m == ModeSys || m == ModeCollab || m == ModeCap || m == ModePolicy || m == ModeAudit
	}
	if strings.HasPrefix(path, "/qzda.") {
		return m.ownsOwner(connectOwner(path))
	}
	return m.ownsOwner(ownerForAPI(path))
}

// connectOwner maps Connect path prefix to owning mode.
func connectOwner(path string) ServiceMode {
	switch {
	case strings.HasPrefix(path, "/qzda.collab."), strings.HasPrefix(path, "/qzda.partner."):
		return ModeCollab
	case strings.HasPrefix(path, "/qzda.rag."), strings.HasPrefix(path, "/qzda.runtime."):
		return ModeCap
	case strings.HasPrefix(path, "/qzda.policy."):
		return ModePolicy
	case strings.HasPrefix(path, "/qzda.audit."):
		return ModeAudit
	case strings.HasPrefix(path, "/qzda.platform."):
		return ModeSys
	default:
		return ModeSys
	}
}

func ownerForAPI(path string) ServiceMode {
	switch {
	case matchPref(path,
		"/api/partners", "/api/partner-templates", "/api/partner-template-adoptions",
		"/api/partner-capability-catalog",
		"/api/tasks", "/api/agents",
		"/api/sessions", "/api/slash-commands", "/api/conversations", "/api/copilot", "/api/actions",
		"/api/share", "/api/attachments", "/api/internal/channel-sessions"):
		return ModeCollab

	case matchPref(path,
		"/api/internal/copilot/post-turn", "/api/internal/memory/purge-conversation", "/api/internal/skill/invocation"):
		return ModeCap

	case matchPref(path,
		"/api/workflows", "/api/workflow-templates", "/api/workflow-skills", "/api/workflow-runs"):
		return ModeWorkflow

	case matchPref(path,
		"/api/model-providers", "/api/model-routing", "/api/model-governance", "/api/model-audit",
		"/api/models", "/api/model", "/api/model-invoke",
		"/api/knowledge",
		"/api/skills", "/api/skill-artifacts", "/api/skill-integrations", "/api/mcp-connections", "/api/tools",
		"/api/platform-tools",
		"/api/memory",
		"/api/channel-control", "/api/channel-templates", "/api/channel-blacklist", "/api/channels",
		"/api/channel", "/api/internal/skill-catalog"):
		return ModeCap

	case matchPref(path,
		"/api/access", "/api/zero-trust", "/api/release-approvals", "/api/governance",
		"/v1/evaluate"):
		return ModePolicy

	case matchPref(path,
		"/api/audit", "/api/audit-center", "/api/audits",
		"/v1/events"):
		return ModeAudit

	case matchPref(path,
		"/api/auth", "/api/workspaces", "/api/workspace-switch-history",
		"/api/home", "/api/operations", "/api/billing", "/api/backups",
		"/api/notification-channels", "/api/tenant", "/api/api-keys", "/api/webhooks-config"):
		return ModeSys

	default:
		// Unknown /api/* → sys so new routes are visible; prefer explicit prefixes above.
		if strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/v1/") {
			return ModeSys
		}
		return ModeSys
	}
}

func matchPref(path string, prefixes ...string) bool {
	for _, p := range prefixes {
		if path == p || strings.HasPrefix(path, p+"/") {
			return true
		}
	}
	return false
}
