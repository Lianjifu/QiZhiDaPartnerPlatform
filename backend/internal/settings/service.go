// Package settings is the M09 平台设置 (Platform Settings) module — the
// HTTP façade that owns the billing / backups / notification-channel /
// tenant-profile / api-keys / webhooks-config surface (12 REST routes).
// It mirrors the standard partners/copilot/tasks/workflows/channels
// pattern: function-value Deps struct + NewService(deps) constructor +
// Service façade methods.
//
// History: prior to M09 P2 all M09 platform-settings handlers lived in
// internal/server/ as (s *Server) receiver methods across handlers_e.go
// (getBilling, getBillingQuota, listBackups, requestBackup, backupAction)
// and handlers_p1.go (listNotificationChannels, getTenantProfile,
// patchTenantProfile, patchNotificationChannel, listAPIKeys,
// listWebhooksConfig). Phase 2 of the M09 平台设置整合方案 extracts that
// code into internal/settings/.
//
// Service is constructed once at server boot via NewService. The route
// table in server.go dispatches the 12 M09 routes through
// s.settingsSvc.<Method>(r).
//
// The package boundary is one-way: internal/settings never imports
// internal/server/. All cross-package helpers stay on Server and are
// bound as method values on Deps: workspaceID, identityFrom, decodeMap,
// appendAudit, persistCollection, actorIsAdmin, evaluateWrite.
package settings

import (
	"context"
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// Deps groups the cross-package helpers the M09 module needs.
// Server.New() constructs the Service once and passes method values
// bound to its own *Server methods. The package boundary stays one-way:
// internal/settings/ never imports internal/server/.
type Deps struct {
	// Workspace / identity / access gating — every handler.
	WorkspaceID  func(r *http.Request) string
	IdentityFrom func(ctx context.Context) *auth.Identity
	DecodeMap    func(r *http.Request) (map[string]any, error)

	// Audit + persistence — every write path.
	AppendAudit       func(workspaceId, actor, action, target, result, reason string)
	PersistCollection func(name string, v any)

	// Authorization / policy — gated write paths.
	ActorIsAdmin  func(id *auth.Identity) bool
	EvaluateWrite func(r *http.Request, kind, action string, p policy.Input) error
}

// Service is the M09 平台设置 (Platform Settings) HTTP-route façade.
// All 12 REST routes bind to methods on this struct. Constructed once
// via NewService; the route table in server.go dispatches M09 paths
// through s.settingsSvc.<Method>.
type Service struct {
	Deps

	// Store is the in-memory store backing every read/write the M09
	// handlers perform. Required.
	Store *store.Store
}

// NewService builds a Service. store is required for the M09 module to
// do real work; deps may be partial for tests that exercise only one
// isolated handler.
func NewService(store *store.Store, deps Deps) *Service {
	return &Service{
		Deps:  deps,
		Store: store,
	}
}

// --- 11 REST route entry points ---
//
// Field naming mirrors the legacy *Server method names exactly so the
// route switch reads "s.settingsSvc.GetBilling(r)" the same way the
// legacy "s.getBilling(r)" read. The actual implementation lives in
// the per-domain handlers_*.go files (lowercase methods on *Service);
// this file only contains thin forwarders.

// GetBilling → GET /api/billing
func (s *Service) GetBilling(r *http.Request) (any, error) {
	return s.getBilling(r)
}

// GetBillingQuota → GET /api/billing/quota
func (s *Service) GetBillingQuota(r *http.Request) (any, error) {
	return s.getBillingQuota(r)
}

// ListBackups → GET /api/backups
func (s *Service) ListBackups(r *http.Request) (any, error) {
	return s.listBackups(r)
}

// RequestBackup → POST /api/backups
func (s *Service) RequestBackup(r *http.Request) (any, error) {
	return s.requestBackup(r)
}

// BackupAction → POST /api/backups/{id}/{action}
func (s *Service) BackupAction(r *http.Request) (any, error) {
	return s.backupAction(r)
}

// ListNotificationChannels → GET /api/notification-channels
func (s *Service) ListNotificationChannels(r *http.Request) (any, error) {
	return s.listNotificationChannels(r)
}

// PatchNotificationChannel → PATCH /api/notification-channels/{id}
func (s *Service) PatchNotificationChannel(r *http.Request) (any, error) {
	return s.patchNotificationChannel(r)
}

// GetTenantProfile → GET /api/tenant/profile
func (s *Service) GetTenantProfile(r *http.Request) (any, error) {
	return s.getTenantProfile(r)
}

// PatchTenantProfile → PATCH /api/tenant/profile
func (s *Service) PatchTenantProfile(r *http.Request) (any, error) {
	return s.patchTenantProfile(r)
}

// ListAPIKeys → GET /api/api-keys
func (s *Service) ListAPIKeys(r *http.Request) (any, error) {
	return s.listAPIKeys(r)
}

// ListWebhooksConfig → GET /api/webhooks-config
func (s *Service) ListWebhooksConfig(r *http.Request) (any, error) {
	return s.listWebhooksConfig(r)
}
