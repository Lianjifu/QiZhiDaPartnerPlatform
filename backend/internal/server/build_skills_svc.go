// Package server — M09 技能中心 (Skills Center) façade construction.
//
// Phase 2 of the M09 技能中心整合方案
// (docs/整合方案/技能中心模块整合方案.md §3.2 + §四 D1-D13 + §五 G1-G13)
// extracted the M09 handlers out of internal/server/ into
// internal/skills/. This file holds the lone bridge between the two
// packages: buildSkillsSvc constructs the *skills.Service façade and
// wires every cross-package Deps callback to its *Server method.
//
// Extracted from the legacy internal/server/skills_compat.go compat
// shim once the route table + cross-module Deps injections were in
// place (commit 1a7f8c6 + follow-up). At that point the shim's only
// surviving value was the buildSkillsSvc factory; keeping it on disk
// under a compat-* name would be misleading.
//
// Package boundary stays one-way: internal/skills/ never imports
// internal/server/; internal/server/ imports internal/skills/.
package server

import (
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/skills"
)

// buildSkillsSvc constructs the M09 技能中心 service façade with all
// the cross-package Deps wired to *Server methods. Called once in
// New() after CopSvc is available (skill harness needs it).
//
// Deps that map to legacy Server methods are bound here. The Service
// stays nil-tolerant: tests can supply a partial Deps by wiring a
// subset of the function values.
func (s *Server) buildSkillsSvc() *skills.Service {
	deps := skills.Deps{
		WorkspaceID:  s.workspaceID,
		IdentityFrom: identityFrom,
		DecodeMap:    decodeMap,
		EvaluateWrite: func(r *http.Request, resource, action string, extra policy.Input) error {
			return s.evaluateWrite(r, resource, action, extra)
		},
		EvaluateZeroTrust: func(id *auth.Identity, kind, action, target string, isExternal bool, reason string) (map[string]any, error) {
			return s.evaluateZeroTrust(id, kind, action, target, isExternal, reason)
		},
		ActorIsAdmin:      actorIsAdmin,
		OwnsCapRuntime:    s.ownsCapRuntime,
		ProductionLikeEnv: productionLikeEnv,
		AppendAudit: func(ws, actor, action, target, result, reason string) {
			if s.Store != nil {
				s.Store.AppendAudit(ws, actor, action, target, result, reason)
			}
		},
		PersistSkillsLocked: s.persistSkills,
		PersistSkillExtra:   s.persistSkillExtra,
		PersistCollection: s.Store.Persist,
		PersistDelete: func(collection string, ids ...string) {
			s.Store.PersistDelete(collection, ids...)
		},
		DurableDeleteSync: func(collection string, ids ...string) {
			_ = s.Store.PersistDeleteSync(collection, ids...)
		},
		KV: func() any { return nil },
		ResolvePublisherKey: func(wsID, keyID string) (any, string, error) {
			pub, trust, err := s.resolvePublisherKey(wsID, keyID)
			return any(pub), trust, err
		},
		SkillTrustStore: func() any { return s.SkillTrustStore },
		SkillDevKey:     func() any { return s.SkillDevKey },
		PeerPOST:        s.peerPOST,
		CapBaseURL:      func() string { return capBaseURL() },
		DelegateSkillInvocation: func(r *http.Request, ws string, skill map[string]any, durationMs int, ok bool, actor, source string) {
			s.delegateSkillInvocation(r, ws, skill, durationMs, ok, actor, source)
		},
		KnowledgeSliceMaps: knowledgeSliceMaps,
		LoadTrustStore: func() error {
			s.bootstrapSkillSigning()
			return nil
		},
		AuthorizeActorCapability: func(id *auth.Identity, cap string) bool {
			return auth.Has(id, cap)
		},
		Signer:      s.SkillSigner,
		ToFloat:     toFloat,
		CoalesceNum: coalesceNum,
	}
	svc := skills.NewService(s.Store, deps)
	if s.CopSvc != nil {
		svc.CopSvc = s.CopSvc
	}
	return svc
}
