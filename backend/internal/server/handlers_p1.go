package server

import (
	"net/http"
	"strings"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// M09 P2: platform-settings handlers (listNotificationChannels,
// getTenantProfile, patchTenantProfile, patchNotificationChannel,
// listAPIKeys, listWebhooksConfig, emptyOK) were extracted to
// backend/internal/settings/. This file now hosts only the knowledge
// trio (knowledgeExtra / knowledgeDocDetail / patchKnowledgeGovernance).
// The workflow trio (workflowByID / listWorkflowGenerations /
// generateWorkflow) and publishWorkflowAsSkillLocked live in the
// workflows package (M06 P2 extraction).

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

