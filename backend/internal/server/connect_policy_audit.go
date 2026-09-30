package server

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	auditv1 "github.com/qizhida-partner-platform/backend/gen/qzda/audit/v1"
	policyv1 "github.com/qizhida-partner-platform/backend/gen/qzda/policy/v1"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

type policyConnect struct{ s *Server }

func (c *policyConnect) GetAccessGovernance(ctx context.Context, req *connect.Request[policyv1.GetAccessGovernanceRequest]) (*connect.Response[policyv1.AccessGovernance], error) {
	r := requestFromConnect(ctx, req.Header())
	raw, err := c.s.accessGovernance(r)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}
	m, _ := raw.(map[string]any)
	out := &policyv1.AccessGovernance{GeneratedAt: str(m["generatedAt"])}
	for _, g := range mapsFromAny(m["grants"]) {
		grant := &policyv1.AccessGrant{
			Id: str(g["id"]), SubjectId: str(g["subjectId"]), SubjectName: str(g["subjectName"]),
			Role: str(g["role"]), Status: str(g["status"]),
		}
		ws, _ := toStringSlice(g["workspaceIds"])
		grant.WorkspaceIds = ws
		out.Grants = append(out.Grants, grant)
	}
	return connect.NewResponse(out), nil
}

func (c *policyConnect) EvaluateZeroTrust(ctx context.Context, req *connect.Request[policyv1.EvaluateZeroTrustRequest]) (*connect.Response[policyv1.ZeroTrustEvaluation], error) {
	r := requestFromConnect(ctx, req.Header())
	id := identityFrom(ctx)
	if id == nil {
		id = identityFrom(r.Context())
	}
	msg := req.Msg
	if strings.TrimSpace(msg.GetResource()) == "" || strings.TrimSpace(msg.GetAction()) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, apperr.BadReq(apperr.ZeroTrustEvalInvalid, "缺少 resource/action"))
	}
	raw, err := c.s.evaluateZeroTrust(id, msg.GetResource(), msg.GetAction(), msg.GetClassification(), msg.GetExternal(), msg.GetCorrelationId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	out := &policyv1.ZeroTrustEvaluation{
		Decision:      str(raw["decision"]),
		Reason:        str(raw["reason"]),
		PolicyId:      str(raw["policyId"]),
		CorrelationId: str(raw["correlationId"]),
		DecisionEnum:  contract.PolicyDecisionToProto(str(raw["decision"])),
	}
	return connect.NewResponse(out), nil
}

type auditConnect struct{ s *Server }

func (c *auditConnect) ListAuditCenter(ctx context.Context, req *connect.Request[auditv1.ListAuditCenterRequest]) (*connect.Response[auditv1.ListAuditCenterResponse], error) {
	r := requestFromConnect(ctx, req.Header())
	if ws := strings.TrimSpace(req.Msg.GetWorkspaceId()); ws != "" && r.Header.Get("x-workspace-id") == "" {
		r.Header.Set("x-workspace-id", ws)
	}
	raw, err := c.s.auditCenter(r)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}
	out := &auditv1.ListAuditCenterResponse{}
	for _, a := range mapsFromAny(raw) {
		out.Items = append(out.Items, &auditv1.AuditEvent{
			Id:            str(a["id"]),
			WorkspaceId:   str(a["workspaceId"]),
			Time:          str(a["time"]),
			Actor:         str(a["actor"]),
			Action:        str(a["action"]),
			Target:        str(a["target"]),
			Result:        str(a["result"]),
			CorrelationId: str(a["correlationId"]),
		})
	}
	return connect.NewResponse(out), nil
}

func (c *auditConnect) ExportAudit(ctx context.Context, req *connect.Request[auditv1.ExportAuditRequest]) (*connect.Response[auditv1.ExportAuditResponse], error) {
	r := requestFromConnect(ctx, req.Header())
	if ws := strings.TrimSpace(req.Msg.GetWorkspaceId()); ws != "" && r.Header.Get("x-workspace-id") == "" {
		r.Header.Set("x-workspace-id", ws)
	}
	raw, err := c.s.auditExport(r)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}
	m, _ := raw.(map[string]any)
	return connect.NewResponse(&auditv1.ExportAuditResponse{
		Id:          str(m["id"]),
		Status:      str(m["status"]),
		Filename:    str(m["filename"]),
		RecordCount: int32(intFrom(m["recordCount"])),
		Masked:      m["masked"] == true,
	}), nil
}
