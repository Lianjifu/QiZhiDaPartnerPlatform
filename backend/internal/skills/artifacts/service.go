package artifacts

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/gateway"
)

// Service is the artifacts HTTP sub-router for /api/skill-artifacts/*.
// It is owned by the parent skills.Service and constructed with the
// cross-package Deps that the artifact gateway needs (audit, identity,
// policy). All the request handlers live in artifacts.go / pptx_preview.go
// as `func (s *Service)` methods.
type Service struct {
	// AppendAuditSink is a thin shim around store.AppendAudit that the
	// gateway.AuditFunc requires. The parent skills.Service injects this.
	AppendAuditSink func(ws, actor, action, target, result, reason string)
	// WorkspaceResolver turns a request into a workspace ID; the parent
	// skills.Service.WorkspaceID satisfies this signature.
	WorkspaceResolver func(r *http.Request) string
	// AppendAuditFromRequest is a no-fallback variant used when the
	// caller already has a workspace ID resolved.
	AppendAuditFromRequest func(r *http.Request, ws string) gateway.AuditFunc
	// IdentityFrom returns the auth.Identity off the request context.
	IdentityFrom func(r *http.Request) *auth.Identity
}

// artifactPolicy reads DE_ARTIFACT_MAX_BYTES + DE_ARTIFACT_REQUIRE_AUTH
// and returns the gate configuration for /api/skill-artifacts/*. Mirrors
// the legacy server.Server.artifactPolicy (server.go L1277).
func (s *Service) artifactPolicy() *gateway.ArtifactPolicy {
	p := gateway.DefaultArtifactPolicy()
	if v := strings.TrimSpace(os.Getenv("DE_ARTIFACT_MAX_BYTES")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			p.MaxBytes = n
		}
	}
	if envFlagFalse("DE_ARTIFACT_REQUIRE_AUTH") {
		p.RequireAuth = false
	}
	return p
}

// envFlagFalse reports whether the named env var is "0" / "false" / "off".
func envFlagFalse(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return v == "0" || v == "false" || v == "off"
}

// appendAuditFn adapts the parent Service.AppendAuditSink into a
// gateway.AuditFunc so the gateway can write audits directly.
func (s *Service) appendAuditFn() gateway.AuditFunc {
	if s == nil || s.AppendAuditSink == nil {
		return func(ws, actor, action, target, result, reason string) {}
	}
	return func(ws, actor, action, target, result, reason string) {
		if ws == "" && s.WorkspaceResolver != nil {
			ws = s.WorkspaceResolver(nil)
		}
		s.AppendAuditSink(ws, actor, action, target, result, reason)
	}
}

// identityAdapter wraps the request-scoped identity for the gateway.
func (s *Service) identityAdapter(r *http.Request) gateway.IdentityProvider {
	id := s.identityFrom(r)
	ws := s.workspaceID(r)
	return &artifactsIdentity{id: id, wsFallback: ws}
}

func (s *Service) identityFrom(r *http.Request) *auth.Identity {
	if s == nil || s.IdentityFrom == nil {
		return nil
	}
	return s.IdentityFrom(r)
}

func (s *Service) workspaceID(r *http.Request) string {
	if s == nil || s.WorkspaceResolver == nil {
		return ""
	}
	return s.WorkspaceResolver(r)
}

type artifactsIdentity struct {
	id         *auth.Identity
	wsFallback string
}

func (a *artifactsIdentity) ActorName() string {
	if a.id == nil {
		return ""
	}
	return a.id.Name
}

func (a *artifactsIdentity) WorkspaceID() string {
	if a.id != nil && a.id.WorkspaceID != "" {
		return a.id.WorkspaceID
	}
	return a.wsFallback
}

// ServeSkillArtifact — GET /api/skill-artifacts/{name}. Public façade so
// the parent skills.Service can dispatch without exposing package-private
// methods.
func (s *Service) ServeSkillArtifact(w http.ResponseWriter, r *http.Request) {
	s.serveSkillArtifact(w, r)
}

// ServeSkillArtifactPreview — GET /api/skill-artifacts/{name}/preview.
func (s *Service) ServeSkillArtifactPreview(w http.ResponseWriter, r *http.Request) {
	s.serveSkillArtifactPreview(w, r)
}

// ServeSkillArtifactSlidePNG — GET /api/skill-artifacts/{name}/slides/{n}.png.
func (s *Service) ServeSkillArtifactSlidePNG(w http.ResponseWriter, r *http.Request) {
	s.serveSkillArtifactSlidePNG(w, r)
}
