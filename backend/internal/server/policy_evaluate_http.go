package server

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/policy"
	"github.com/qizhida-partner-platform/backend/pkg/response"
)

// handleLocalPolicyEvaluate serves POST /v1/evaluate. qzda-policy retired in M10;
// in-process policy.Engine only.
func (s *Server) handleLocalPolicyEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ActorID          string `json:"actorId"`
		ActorRole        string `json:"actorRole"`
		WorkspaceID      string `json:"workspaceId"`
		Resource         string `json:"resource"`
		Action           string `json:"action"`
		SubmitterID      string `json:"submitterId"`
		ApproverID       string `json:"approverId"`
		PublishedBinding bool   `json:"publishedBinding"`
		EgressExternal   bool   `json:"egressExternal"`
		DataClass        string `json:"dataClass"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		response.JSON(w, http.StatusBadRequest, response.Envelope{
			OK: false, Error: &response.ErrorBody{Code: "E_BAD_REQUEST", Message: "invalid json"},
		})
		return
	}
	eng := s.Policy
	if eng == nil {
		eng = policy.New()
	}
	dec := eng.Evaluate(r.Context(), policy.Input{
		ActorID: req.ActorID, ActorRole: req.ActorRole, WorkspaceID: req.WorkspaceID,
		Resource: req.Resource, Action: req.Action,
		SubmitterID: req.SubmitterID, ApproverID: req.ApproverID,
		PublishedBinding: req.PublishedBinding, EgressExternal: req.EgressExternal, DataClass: req.DataClass,
	})
	response.OK(w, map[string]any{
		"allow": dec.Allow, "reason": dec.Reason, "policyId": dec.PolicyID,
		"requireDualSign": dec.RequireDualSign, "evaluatedAt": dec.EvaluatedAt,
	})
}
