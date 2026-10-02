package partners

import (
	"context"
	"net/http"

	"connectrpc.com/connect"
	partnerv1 "github.com/qizhida-partner-platform/backend/gen/qzda/partner/v1"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// partnerConnect implements the buf-generated PartnerServiceHandler
// interface (qzda.partner.v1.PartnerService). The legacy binding lived
// in internal/server/connect_services.go L247-L261; the move keeps the
// interface intact so Connect-RPC clients (qzda-collab, qzda-eval,
// qzda-cap) see no API change.
type partnerConnect struct {
	s *Service
}

// newPartnerConnect wraps a Service for the Connect binding. The
// returned value is what mountConnectRPCForMode passes to
// partnerv1connect.NewPartnerServiceHandler in server.go.
func newPartnerConnect(s *Service) *partnerConnect {
	return &partnerConnect{s: s}
}

// resolveActiveFn is the signature the Connect binding needs to invoke
// the legacy resolveActiveEmployee path. server.go wires this at boot
// time so the partner package stays free of internal/server/ imports.
type resolveActiveFn func(r *http.Request, deID string) (any, error)

// ResolveActive answers qzda.partner.v1.PartnerService.ResolveActive —
// reads the requested digital-employee ID from the wire, delegates to
// the resolved-active dependency (injected at boot), and projects the
// result onto the proto shape.
//
// The dependency is looked up via Service.Deps.ResolveActiveEmployee
// which server.go binds to the legacy *Server.resolveActiveEmployee
// method value. We never reach into internal/server/ from here.
func (c *partnerConnect) ResolveActive(ctx context.Context, req *connect.Request[partnerv1.ResolveActiveRequest]) (*connect.Response[partnerv1.ResolveActiveResponse], error) {
	if c.s == nil || c.s.Deps.ResolveActiveEmployee == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, apperr.NotFoundErr(apperr.NotFound, "数字伙伴服务未启动"))
	}
	r := buildConnectHTTPRequest(req.Header())
	raw, err := c.s.Deps.ResolveActiveEmployee(r, req.Msg.GetDigitalPartnerId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	m, _ := raw.(map[string]any)
	out := &partnerv1.ResolveActiveResponse{
		Id:        str(m["id"]),
		Name:      str(m["name"]),
		Lifecycle: str(m["lifecycle"]),
		Reason:    str(m["reason"]),
		Active:    m["active"] == true,
	}
	return connect.NewResponse(out), nil
}

// buildConnectHTTPRequest constructs a minimal *http.Request carrying
// the Connect headers so Service.Deps handlers that expect an
// *http.Request (workspace ID via header, identity from context) keep
// working. Mirrors the legacy server.requestFromConnect helper but
// local to the partners package so we don't import internal/server/.
func buildConnectHTTPRequest(h http.Header) *http.Request {
	r, _ := http.NewRequest(http.MethodPost, "/", nil)
	for k, vs := range h {
		for _, v := range vs {
			r.Header.Add(k, v)
		}
	}
	return r
}

// NewPartnerConnect is the exported wrapper used by
// mountConnectRPCForMode in internal/server/connect_services.go. The
// underlying partnerConnect type stays package-private so the only
// stable surface a caller depends on is the buf-generated
// PartnerServiceHandler interface.
func NewPartnerConnect(s *Service) *partnerConnect {
	return newPartnerConnect(s)
}
