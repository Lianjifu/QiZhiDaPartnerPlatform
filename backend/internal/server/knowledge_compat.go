package server

import (
	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/scope"
)

// knowledgeSliceMaps coerces a `any` from Store.KnowledgeExtra /
// Store.SkillExtra (which the snapshot round-trip types as either
// []map[string]any or []any) into a uniform []map[string]any slice.
//
// After M07 P2 the canonical implementation lives in
// internal/knowledge/helpers.go (knowledgeSliceMaps). This server-side
// alias preserves the existing call sites that read
// Store.KnowledgeExtra / Store.SkillExtra from outside the knowledge
// package (cmdb_adapter.go, employee_runtime.go, eval_gate.go,
// handlers_memory.go, handlers_pmsop.go, handlers_selfimproving.go,
// handlers_skills*.go, kernel_phase3_test.go,
// session_panel_p0p2_fix_test.go).
//
// Kept as a thin free function (not a method on *Server) so existing
// callers can keep their `knowledgeSliceMaps(s.Store.X)` call shape.
// Behaviorally identical to the knowledge package version.
func knowledgeSliceMaps(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, x := range t {
			if m, ok := x.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

// scopeDocFromMap projects a KnowledgeDocs row onto the shape
// `internal/knowledge/scope.Source` expects. After M07 P2 the canonical
// implementation lives in internal/knowledge/helpers.go. This
// server-side alias preserves the call sites in connect_gateway.go
// (filterRAGHitsByScope + retrievePublished's per-doc ACL filter).
//
// Behaviorally identical to the knowledge package version.
func scopeDocFromMap(d map[string]any) scope.Source {
	roles := []string{}
	for _, r := range knowledgeSliceMaps(d["roles"]) {
		roles = append(roles, str(r["id"]))
	}
	for _, r := range knowledgeSliceAny(d["roles"]) {
		if s, ok := r.(string); ok && s != "" {
			roles = append(roles, s)
		}
	}
	scopes := []string{}
	for _, s := range knowledgeSliceAny(d["scopes"]) {
		if v, ok := s.(string); ok && v != "" {
			scopes = append(scopes, v)
		}
	}
	tags := []string{}
	for _, t := range knowledgeSliceAny(d["scopeTags"]) {
		if v, ok := t.(string); ok && v != "" {
			tags = append(tags, v)
		}
	}
	return scope.Source{
		ID:        str(d["id"]),
		Workspace: str(d["workspaceId"]),
		Status:    str(d["status"]),
		Scopes:    scopes,
		ScopeTags: tags,
		OwnerID:   str(d["digitalPartnerId"]),
		Roles:     roles,
	}
}

// scopeViewerFromIdentity builds a `scope.Viewer` from an auth identity
// + workspace. Mirrors the legacy *Server.scopeViewerFromIdentity
// (lived in handlers_knowledge.go).
//
// After M07 P2 the canonical implementation lives in
// internal/knowledge/helpers.go. This server-side alias preserves the
// connect_gateway.go retrievePublished call sites.
func scopeViewerFromIdentity(id *auth.Identity, ws string) scope.Viewer {
	if id == nil {
		return scope.Viewer{WorkspaceID: ws}
	}
	return scope.Viewer{
		IdentityID:  id.Name,
		WorkspaceID: ws,
		Roles:       append([]string{}, id.Permissions...),
	}
}

// knowledgeSliceAny is the inverse of knowledgeSliceMaps. Used by
// scopeDocFromMap above.
func knowledgeSliceAny(v any) []any {
	switch x := v.(type) {
	case []any:
		return x
	case []map[string]any:
		out := make([]any, 0, len(x))
		for _, m := range x {
			out = append(out, m)
		}
		return out
	}
	return nil
}

// truncateRunes caps a string at n runes, appending an ellipsis when it
// overflows. After M07 P2 the canonical implementation lives in
// internal/knowledge/helpers.go. This server-side alias preserves the
// existing call sites that build message / reasoning previews
// (handlers_actions.go, handlers_c.go, handlers_channel_webhooks.go,
// handlers_channels.go, handlers_d.go, ...).
func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if n <= 0 || len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

// minFloat picks the smaller of two float64 values. After M07 P2 the
// canonical implementation lives in internal/knowledge/helpers.go.
// This server-side alias preserves the handlers_memory.go call sites
// (recall scaling math).
func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}