package server

import (
	"log"
	"net/http"
)

type copilotPostTurnPayload struct {
	WorkspaceID       string           `json:"workspaceId"`
	OwnerID           string           `json:"ownerId"`
	OwnerName         string           `json:"ownerName"`
	DigitalPartnerID string           `json:"digitalPartnerId"`
	ConversationID    string           `json:"conversationId"`
	CorrelationID     string           `json:"correlationId"`
	MessageID         string           `json:"messageId"`
	UserMessage       string           `json:"userMessage"`
	AssistantText     string           `json:"assistantText"`
	Mode              string           `json:"mode"`
	ReflectRounds     int              `json:"reflectRounds"`
	ToolCalls         []map[string]any `json:"toolCalls"`
	MemoryIngest      *runtimeMemoryInput `json:"memoryIngest,omitempty"`
}

func (s *Server) delegateCopilotPostTurn(r *http.Request, payload copilotPostTurnPayload) ([]map[string]any, string) {
	if s.ownsCapRuntime() {
		return nil, ""
	}
	req := r
	if req == nil {
		req, _ = http.NewRequest(http.MethodPost, "/", nil)
	}
	data, err := s.peerPOST(req, capBaseURL(), "/api/internal/copilot/post-turn", payload)
	if err != nil {
		log.Printf("delegate copilot post-turn: %v", err)
		return nil, err.Error()
	}
	out, _ := data.(map[string]any)
	if out == nil {
		return nil, ""
	}
	memErr, _ := out["memoryError"].(string)
	cands, _ := out["evolveCandidates"].([]any)
	created := make([]map[string]any, 0, len(cands))
	for _, c := range cands {
		if m, ok := c.(map[string]any); ok {
			created = append(created, m)
		}
	}
	return created, memErr
}

func (s *Server) delegatePurgeConversationMemory(r *http.Request, ws, convID string) {
	if s.ownsCapRuntime() || convID == "" {
		return
	}
	req := r
	if req == nil {
		req, _ = http.NewRequest(http.MethodPost, "/", nil)
	}
	if _, err := s.peerPOST(req, capBaseURL(), "/api/internal/memory/purge-conversation", map[string]any{
		"workspaceId":    ws,
		"conversationId": convID,
	}); err != nil {
		log.Printf("delegate purge conversation memory %s: %v", convID, err)
	}
}

func (s *Server) delegateSkillInvocation(r *http.Request, ws string, skill map[string]any, durationMs int, ok bool, actor, source string) {
	if s.ownsCapRuntime() || skill == nil || str(skill["id"]) == "" {
		return
	}
	req := r
	if req == nil {
		req, _ = http.NewRequest(http.MethodPost, "/", nil)
	}
	if _, err := s.peerPOST(req, capBaseURL(), "/api/internal/skill/invocation", map[string]any{
		"workspaceId": ws,
		"skillId":     str(skill["id"]),
		"durationMs":  durationMs,
		"ok":          ok,
		"actor":       actor,
		"source":      source,
	}); err != nil {
		log.Printf("delegate skill invocation %s: %v", str(skill["id"]), err)
	}
}
