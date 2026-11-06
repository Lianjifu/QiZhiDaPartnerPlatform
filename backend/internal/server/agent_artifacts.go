package server

import (
	"time"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
)

// offloadAgentArtifact 把过大的工具输出落成产物(P4 上下文卸载)。
//
// 产物进 agent_artifacts 集合:完整正文留在这里,模型上下文里只放一条引用,
// 需要细节时用 artifact.read 取回。落库后仍可审计、可回放。
func (s *Server) offloadAgentArtifact(in copilot.ArtifactInput) (map[string]any, error) {
	id := s.Store.ID("artifact")
	now := time.Now().UTC().Format(time.RFC3339)
	rec := map[string]any{
		"id":               id,
		"workspaceId":      in.WorkspaceID,
		"conversationId":   in.ConversationID,
		"correlationId":    in.CorrelationID,
		"digitalPartnerId": in.DigitalPartner,
		"toolName":         in.ToolName,
		"content":          in.Content,
		"runes":            len([]rune(in.Content)),
		"createdAt":        now,
	}
	s.Store.Lock()
	s.Store.AgentArtifacts = append([]map[string]any{rec}, s.Store.AgentArtifacts...)
	s.Store.Unlock()
	s.Store.Persist("agent_artifacts")
	return rec, nil
}

// readAgentArtifact 按 ID 取回产物正文。
func (s *Server) readAgentArtifact(artifactID string) (map[string]any, bool) {
	artifactID = str(artifactID)
	if artifactID == "" {
		return nil, false
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, a := range s.Store.AgentArtifacts {
		if str(a["id"]) == artifactID {
			return a, true
		}
	}
	return nil, false
}
