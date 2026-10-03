package memory

import (
	"net/http"
	"strings"
	"time"

	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// --- Mem5: digital-employee identity profiles ---

// listMemoryIdentity → GET /api/memory/identity
// Admin-only listing of identity profiles for the workspace. Used by the
// Governance tab to surface which DEs have been customized.
func (s *Service) listMemoryIdentity(r *http.Request) (any, error) {
	ws := s.workspaceID(r)
	if _, err := s.requireMemoryGovernance(r, "查看身份画像"); err != nil {
		return nil, err
	}
	return s.identityStore().ListAll(ws), nil
}

// upsertMemoryIdentity → PUT /api/memory/identity
// Admin-only. Replaces or creates an identity profile (preferredName /
// locale / primaryLanguage / communicationStyle / hardNo / customFacts).
func (s *Service) upsertMemoryIdentity(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	ws := s.workspaceID(r)
	if _, err := s.requireMemoryGovernance(r, "写入身份画像"); err != nil {
		return nil, err
	}
	body, err := s.decodeMap(r)
	if err != nil {
		return nil, err
	}
	de := strings.TrimSpace(str(body["digitalPartnerId"]))
	if de == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_IDENTITY_DE_REQUIRED: 必须提供 digitalPartnerId")
	}
	profile := memid.Profile{
		WorkspaceID:        ws,
		DigitalPartnerID:  de,
		PreferredName:      strings.TrimSpace(str(body["preferredName"])),
		Locale:             strings.TrimSpace(str(body["locale"])),
		PrimaryLanguage:    strings.TrimSpace(str(body["primaryLanguage"])),
		CommunicationStyle: strings.TrimSpace(str(body["communicationStyle"])),
		HardNo:             stringSliceFromAny(body["hardNo"]),
		CustomFacts:        stringSliceFromAny(body["customFacts"]),
	}
	profile.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := s.identityStore().Set(profile); err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, err.Error())
	}
	s.Store.Lock()
	s.appendMemoryAuditLocked(ws, id.Name, "写入身份画像", de, "success", "")
	s.Store.Unlock()
	return profile, nil
}

// deleteMemoryIdentity → DELETE /api/memory/identity/{digitalPartnerId}
// Admin-only. Removes a profile + writes a "删除身份画像" audit row.
func (s *Service) deleteMemoryIdentity(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	ws := s.workspaceID(r)
	if _, err := s.requireMemoryGovernance(r, "删除身份画像"); err != nil {
		return nil, err
	}
	de := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/memory/identity/"))
	if de == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_IDENTITY_DE_REQUIRED: 路径缺少 digitalPartnerId")
	}
	if err := s.identityStore().Delete(ws, de); err != nil {
		return nil, apperr.NotFoundErr("memory.identity_not_found", "身份画像不存在")
	}
	s.Store.Lock()
	s.appendMemoryAuditLocked(ws, id.Name, "删除身份画像", de, "success", "")
	s.Store.Unlock()
	return map[string]any{"deleted": de}, nil
}

// stringSliceFromAny normalizes heterogeneous JSON shapes ([]string /
// []any) into []string. Mirrors the legacy server.stringSlice helper.
func stringSliceFromAny(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// ingestRuntimeMemoryLocked requires Store.Lock held by caller. Validates
// the title / content / layer triplet, applies TTL derivation from the
// workspace policy, and stamps an audit row. Caller fires
// s.persistMemory() after a successful return.
func (s *Service) ingestRuntimeMemoryLocked(in RuntimeMemoryInput) (map[string]any, error) {
	title := strings.TrimSpace(in.Title)
	content := strings.TrimSpace(in.Content)
	if title == "" || content == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_INVALID: 标题与内容不能为空")
	}
	layer := coalesce(in.Layer, "short_term")
	if layer != "short_term" && layer != "working" {
		return nil, apperr.BadReq(apperr.BadRequest, "E_MEMORY_LAYER_INVALID: 运行时仅可写入短期或工作记忆")
	}
	ws := coalesce(in.WorkspaceID, "w1")
	policy := s.memoryPolicyFor(ws)
	if s.Store.MemoryPolicies[ws] == nil {
		s.Store.MemoryPolicies[ws] = policy
	}
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)
	scope := coalesce(in.Scope, "user")
	if layer == "working" && scope == "user" {
		scope = "team"
	}
	conf := in.Confidence
	if conf <= 0 {
		conf = 0.8
	}
	item := map[string]any{
		"id": s.Store.ID("memory"), "workspaceId": ws, "ownerId": coalesce(in.OwnerID, "system"),
		"digitalPartnerId": in.DigitalPartnerID, "layer": layer, "scope": scope,
		"title": truncateRunes(title, 80), "content": truncateRunes(content, 2000),
		"classification": coalesce(in.Classification, "internal"),
		"sourceType":     coalesce(in.SourceType, "conversation"), "sourceId": coalesce(in.SourceID, "runtime"),
		"correlationId": coalesce(in.CorrelationID, s.Store.ID("memory_corr")), "confidence": conf,
		"status": "active", "createdAt": nowStr, "updatedAt": nowStr,
	}
	if layer == "short_term" {
		hours := int(toFloat(policy["shortTermTtlHours"]))
		if hours <= 0 {
			hours = 24
		}
		item["expiresAt"] = now.Add(time.Duration(hours) * time.Hour).Format(time.RFC3339)
	} else {
		days := int(toFloat(policy["workingMemoryTtlDays"]))
		if days <= 0 {
			days = 30
		}
		item["expiresAt"] = now.Add(time.Duration(days) * 24 * time.Hour).Format(time.RFC3339)
	}
	s.Store.MemoryRecords = append([]map[string]any{item}, s.Store.MemoryRecords...)
	s.appendMemoryAuditLocked(ws, coalesce(in.OwnerName, "系统"), "写入记忆", str(item["title"]), "success", str(item["correlationId"]))
	return item, nil
}