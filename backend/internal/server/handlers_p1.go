package server

import (
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) knowledgeExtra(key string) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	if v, ok := s.Store.KnowledgeExtra[key]; ok {
		return v, nil
	}
	return []any{}, nil
}

func (s *Server) knowledgeDocDetail(r *http.Request) (any, error) {
	id := strings.TrimPrefix(r.URL.Path, "/api/knowledge/doc/")
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["id"]) == id {
			return d, nil
		}
	}
	return map[string]any{"id": id, "title": "文档", "status": "published"}, nil
}

func (s *Server) patchKnowledgeGovernance(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "更新知识治理")
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	gov, _ := s.Store.KnowledgeExtra["governance"].(map[string]any)
	if gov == nil {
		gov = map[string]any{"workspaceId": s.workspaceID(r)}
	}
	for k, v := range body {
		gov[k] = v
	}
	s.Store.KnowledgeExtra["governance"] = gov
	s.Store.AppendAudit(s.workspaceID(r), id.Name, "更新知识治理", "governance", "success", "")
	return gov, nil
}

func (s *Server) listNotificationChannels(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.NotificationChannels, nil
}

func (s *Server) getTenantProfile(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	if s.Store.TenantProfile == nil {
		return map[string]any{"name": "ACME Corp", "tenantId": "tenant-acme", "region": "cn-east-1"}, nil
	}
	out := map[string]any{}
	for k, v := range s.Store.TenantProfile {
		out[k] = v
	}
	return out, nil
}

func (s *Server) patchTenantProfile(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅管理员可更新组织资料")
	}
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	if s.Store.TenantProfile == nil {
		s.Store.TenantProfile = map[string]any{}
	}
	for _, k := range []string{"name", "region", "status"} {
		if v := strings.TrimSpace(str(body[k])); v != "" {
			s.Store.TenantProfile[k] = v
		}
	}
	s.Store.TenantProfile["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	s.Store.TenantProfile["updatedBy"] = id.Name
	s.Store.AppendAudit("tenant", id.Name, "更新组织资料", str(s.Store.TenantProfile["name"]), "success", "")
	out := map[string]any{}
	for k, v := range s.Store.TenantProfile {
		out[k] = v
	}
	return out, nil
}

func (s *Server) patchNotificationChannel(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅管理员可配置通知渠道")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "通知渠道不存在")
	}
	cid := parts[2]
	body, _ := decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, ch := range s.Store.NotificationChannels {
		if str(ch["id"]) != cid {
			continue
		}
		if _, ok := body["enabled"]; ok {
			ch["enabled"] = body["enabled"] == true || str(body["enabled"]) == "true"
		}
		if v := strings.TrimSpace(str(body["name"])); v != "" {
			ch["name"] = v
		}
		s.Store.AppendAudit(s.workspaceID(r), id.Name, "更新通知渠道", cid, "success", "")
		return ch, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "通知渠道不存在")
}

func (s *Server) listAPIKeys(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.APIKeys, nil
}

func (s *Server) listWebhooksConfig(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.WebhooksConfig, nil
}

func (s *Server) emptyOK(r *http.Request) (any, error) { return []any{}, nil }
