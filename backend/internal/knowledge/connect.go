package knowledge

import (
	"context"
	"net/http"

	"connectrpc.com/connect"
	ragv1 "github.com/qizhida-partner-platform/backend/gen/qzda/rag/v1"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// ragConnect implements the buf-generated RagServiceHandler interface
// (qzda.rag.v1.RagService). The legacy binding lived in
// internal/server/connect_services.go L41-L116; the move keeps the
// interface intact so Connect-RPC clients (qzda-collab, qzda-eval,
// qzda-cap) see no API change.
//
// Note: Retrieve + SyncPublished are the only two RPCs the legacy
// binding implemented. They map onto the Service's HTTP-shape
// retrievePublishedNormalized + KnowledgeSyncPublishedConnect.
type ragConnect struct {
	svc *Service
}

// NewConnect wraps a Service for the Connect binding. The returned
// value is what mountConnectRPCForMode passes to
// ragv1connect.NewRagServiceHandler in server.go. The wrapper type
// stays package-private (matches the partners package convention) so
// the only stable surface a caller depends on is the buf-generated
// RagServiceHandler interface.
func NewConnect(svc *Service) *ragConnect {
	return &ragConnect{svc: svc}
}

// Retrieve answers qzda.rag.v1.RagService.Retrieve — reads the
// requested query + correlationId from the wire, delegates to
// Service.retrievePublishedNormalized via the Connect-shaped HTTP
// request, and projects the result onto the ragv1.RetrieveResponse
// proto shape.
//
// The Connect-side HTTP request is synthesized with the Connect
// headers + a query/correlationId body so the legacy M07 handler
// keeps working without an import cycle.
func (c *ragConnect) Retrieve(ctx context.Context, req *connect.Request[ragv1.RetrieveRequest]) (*connect.Response[ragv1.RetrieveResponse], error) {
	if c.svc == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, apperr.NotFoundErr(apperr.NotFound, "知识中心未启动"))
	}
	r := requestFromConnect(ctx, req.Header())
	corr := req.Msg.GetCorrelationId()
	if corr == "" {
		corr = c.svc.Store.ID("corr")
	}
	body := map[string]any{"query": req.Msg.GetQuery(), "correlationId": corr}
	raw, err := c.svc.retrievePublishedNormalized(r, body, corr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	out := &ragv1.RetrieveResponse{Query: req.Msg.GetQuery(), CorrelationId: corr, Backend: "knowledge-control-plane"}
	if m, ok := raw.(map[string]any); ok {
		if b := str(m["backend"]); b != "" {
			out.Backend = b
		}
		if results, ok := m["results"].([]map[string]any); ok {
			for _, hit := range results {
				out.Results = append(out.Results, &ragv1.RetrieveHit{
					DocId:   str(hit["docId"]),
					Title:   str(hit["title"]),
					Snippet: str(hit["snippet"]),
					Score:   toFloat(hit["score"]),
					Status:  coalesce(str(hit["status"]), "published"),
				})
			}
		} else if arr, ok := m["results"].([]any); ok {
			for _, x := range arr {
				hit, _ := x.(map[string]any)
				if hit == nil {
					continue
				}
				out.Results = append(out.Results, &ragv1.RetrieveHit{
					DocId:   str(hit["docId"]),
					Title:   str(hit["title"]),
					Snippet: str(hit["snippet"]),
					Score:   toFloat(hit["score"]),
					Status:  coalesce(str(hit["status"]), "published"),
				})
			}
		}
	}
	return connect.NewResponse(out), nil
}

// SyncPublished answers qzda.rag.v1.RagService.SyncPublished —
// echoes the requested doc count. The legacy implementation was a
// stub (no-op sidecar push), and that's preserved here so external
// clients see the same response shape as before M07 P2.
func (c *ragConnect) SyncPublished(ctx context.Context, req *connect.Request[ragv1.SyncPublishedRequest]) (*connect.Response[ragv1.SyncPublishedResponse], error) {
	_ = ctx
	if c.svc == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, apperr.NotFoundErr(apperr.NotFound, "知识中心未启动"))
	}
	n := int32(len(req.Msg.GetDocs()))
	return connect.NewResponse(&ragv1.SyncPublishedResponse{Indexed: n}), nil
}

// requestFromConnect synthesizes a minimal *http.Request carrying the
// Connect headers so the legacy M07 handler (which expects an
// *http.Request via the workspace / identity headers) keeps working
// without an import of internal/server/.
//
// Mirrors the partnerConnect.buildConnectHTTPRequest helper but
// scoped to the M07 module so the server package stays clean.
func requestFromConnect(ctx context.Context, h http.Header) *http.Request {
	r, _ := http.NewRequestWithContext(ctx, http.MethodPost, "/", nil)
	if h != nil {
		for k, vs := range h {
			for _, v := range vs {
				r.Header.Add(k, v)
			}
		}
	}
	return r
}
