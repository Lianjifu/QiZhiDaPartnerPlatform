package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	platformv1 "github.com/qizhida-partner-platform/backend/gen/qzda/platform/v1"
)

type platformConnect struct{ s *Server }

func (c *platformConnect) ListWorkspaces(ctx context.Context, req *connect.Request[platformv1.ListWorkspacesRequest]) (*connect.Response[platformv1.ListWorkspacesResponse], error) {
	r := requestFromConnect(ctx, req.Header())
	r.Method = http.MethodGet
	raw, err := c.s.listWorkspaces(r)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}
	out := &platformv1.ListWorkspacesResponse{}
	for _, w := range mapsFromAny(raw) {
		out.Items = append(out.Items, workspaceToProto(w))
	}
	return connect.NewResponse(out), nil
}

func (c *platformConnect) CreateWorkspace(ctx context.Context, req *connect.Request[platformv1.CreateWorkspaceRequest]) (*connect.Response[platformv1.Workspace], error) {
	r := requestFromConnect(ctx, req.Header())
	r.Method = http.MethodPost
	payload, _ := json.Marshal(map[string]any{
		"name": req.Msg.GetName(), "region": req.Msg.GetRegion(), "plan": req.Msg.GetPlan(),
	})
	r.Body = ioNopCloser(strings.NewReader(string(payload)))
	r.ContentLength = int64(len(payload))
	r.Header.Set("Content-Type", "application/json")
	raw, err := c.s.createWorkspace(r)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	m, _ := raw.(map[string]any)
	return connect.NewResponse(workspaceToProto(m)), nil
}

func workspaceToProto(w map[string]any) *platformv1.Workspace {
	if w == nil {
		return &platformv1.Workspace{}
	}
	return &platformv1.Workspace{
		Id:              str(w["id"]),
		TenantId:        str(w["tenantId"]),
		Name:            str(w["name"]),
		Region:          str(w["region"]),
		Plan:            str(w["plan"]),
		Status:          str(w["status"]),
		OwnerId:         str(w["ownerId"]),
		MemberCount:     int32(intFrom(w["memberCount"])),
		ComplianceScore: int32(intFrom(w["complianceScore"])),
		CreatedAt:       str(w["createdAt"]),
	}
}
