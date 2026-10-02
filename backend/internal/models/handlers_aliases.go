package models

import (
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// ListModelRoutes → GET /api/model/routes (legacy FE alias).
// Returns the ModelRoutes collection scoped to the caller's workspace.
func (s *Service) ListModelRoutes(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	ws := s.WorkspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, p := range s.Store.ModelRoutes {
		if str(p["workspaceId"]) == ws {
			out = append(out, p)
		}
	}
	return out, nil
}

// CreateModelRoute → POST /api/model/routes (legacy FE alias).
func (s *Service) CreateModelRoute(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.DecodeMap(r)
	dataScope := coalesce(str(body["dataScope"]), "internal")
	egress := body["egressAllowed"] == true
	pin := policyInputApproveWithData(id, dataScope, egress)
	if err := s.EvaluateWrite(r, "model", "run", pin); err != nil {
		return nil, apperr.Forbidden(apperr.EgressBlocked, "受限数据不允许出境")
	}
	if dataScope == "restricted" && egress {
		return nil, apperr.Forbidden(apperr.EgressBlocked, "受限数据不允许出境")
	}
	limit := 100.0
	if n, ok := body["budgetLimitUsd"].(float64); ok {
		limit = n
	}
	if limit <= 0 {
		return nil, apperr.BadReq(apperr.BudgetExceeded, "预算必须大于 0")
	}
	item := map[string]any{
		"id": s.Store.ID("mr"), "workspaceId": s.WorkspaceID(r),
		"name": coalesce(str(body["name"]), "新路由"), "level": coalesce(str(body["level"]), "P1"),
		"primaryModelId": body["primaryModelId"], "fallbackModelIds": body["fallbackModelIds"],
		"budgetLimitUsd": limit, "dataScope": dataScope,
		"egressAllowed": egress, "status": "draft",
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	s.Store.ModelRoutes = append([]map[string]any{item}, s.Store.ModelRoutes...)
	if s.AppendAudit != nil {
		s.AppendAudit(s.WorkspaceID(r), id.Name, "创建模型路由", str(item["name"]), "success", "")
	}
	return item, nil
}

// ListModelBudgets → GET /api/model/budgets (legacy FE alias).
func (s *Service) ListModelBudgets(r *http.Request) (any, error) {
	id := s.IdentityFrom(r.Context())
	if err := requireModelRead(id); err != nil {
		return nil, err
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.ModelBudgets, nil
}

// ListUsage → GET /api/usage. Tries the M7 UsageSink first (live feed), then
// falls back to the in-store UsageMeters slice.
func (s *Service) ListUsage(r *http.Request) (any, error) {
	ws := s.WorkspaceID(r)
	if s.UsageSink != nil {
		if rows, err := s.UsageSink.List(r.Context(), ws, 100); err == nil && len(rows) > 0 {
			return rows, nil
		}
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0)
	for _, u := range s.Store.UsageMeters {
		if str(u["workspaceId"]) == ws || str(u["workspaceId"]) == "" {
			out = append(out, u)
		}
	}
	return out, nil
}

// policyInputApproveWithData builds a policy.Input populated with the actor
// id plus the data-class / egress decision. Mirrors the legacy call site:
// `policy.Input{DataClass: scope, EgressExternal: egress, ApproverID: id.ID,
// SubmitterID: id.ID}` for the model/run resource.
func policyInputApproveWithData(id *auth.Identity, dataClass string, egress bool) PolicyInputValue {
	return PolicyInputValue{
		ApproverID:     id.ID,
		SubmitterID:    id.ID,
		DataClass:      dataClass,
		EgressExternal: egress,
	}
}
