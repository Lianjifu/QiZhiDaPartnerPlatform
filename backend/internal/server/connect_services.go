package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/qizhida-partner-platform/backend/gen/qzda/audit/v1/auditv1connect"
	collabv1 "github.com/qizhida-partner-platform/backend/gen/qzda/collab/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/collab/v1/collabv1connect"
	commonv1 "github.com/qizhida-partner-platform/backend/gen/qzda/common/v1"
	partnerv1 "github.com/qizhida-partner-platform/backend/gen/qzda/partner/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/partner/v1/partnerv1connect"
	"github.com/qizhida-partner-platform/backend/gen/qzda/platform/v1/platformv1connect"
	"github.com/qizhida-partner-platform/backend/gen/qzda/policy/v1/policyv1connect"
	ragv1 "github.com/qizhida-partner-platform/backend/gen/qzda/rag/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/rag/v1/ragv1connect"
	runtimev1 "github.com/qizhida-partner-platform/backend/gen/qzda/runtime/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/runtime/v1/runtimev1connect"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// mountConnectRPC registers buf-generated Connect handlers for unified modes.
func (s *Server) mountConnectRPC(mux *http.ServeMux) {
	mode := s.Mode
	if mode == "" {
		mode = ModeAll
	}
	s.mountConnectRPCForMode(mux, mode)
}

// mountConnectRPCForMode registers Connect handlers owned by this deployment unit.
func (s *Server) mountConnectRPCForMode(mux *http.ServeMux, mode ServiceMode) {
	all := mode.IsUnified()
	if all || mode == ModeCap {
		p, h := ragv1connect.NewRagServiceHandler(&ragConnect{s})
		mux.Handle(p, h)
		p, h = runtimev1connect.NewRuntimeServiceHandler(&runtimeConnect{s})
		mux.Handle(p, h)
	}
	if all || mode == ModeCollab {
		p, h := collabv1connect.NewCollabServiceHandler(&collabConnect{s})
		mux.Handle(p, h)
		p, h = partnerv1connect.NewPartnerServiceHandler(&partnerConnect{s})
		mux.Handle(p, h)
	}
	if all || mode == ModePolicy || (mode == ModeSys && sysAbsorbsCrosscutting()) {
		p, h := policyv1connect.NewPolicyServiceHandler(&policyConnect{s})
		mux.Handle(p, h)
	}
	if all || mode == ModeAudit || (mode == ModeSys && sysAbsorbsCrosscutting()) {
		p, h := auditv1connect.NewAuditServiceHandler(&auditConnect{s})
		mux.Handle(p, h)
	}
	if all || mode == ModeSys {
		p, h := platformv1connect.NewPlatformServiceHandler(&platformConnect{s})
		mux.Handle(p, h)
	}
}

type ragConnect struct{ s *Server }

func (c *ragConnect) Retrieve(ctx context.Context, req *connect.Request[ragv1.RetrieveRequest]) (*connect.Response[ragv1.RetrieveResponse], error) {
	r := requestFromConnect(ctx, req.Header())
	corr := req.Msg.GetCorrelationId()
	if corr == "" {
		corr = c.s.Store.ID("corr")
	}
	body := map[string]any{"query": req.Msg.GetQuery(), "correlationId": corr}
	raw, err := c.s.retrievePublished(r, body, corr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	out := &ragv1.RetrieveResponse{Query: req.Msg.GetQuery(), CorrelationId: corr, Backend: "published-memory"}
	if m, ok := raw.(map[string]any); ok {
		if b := str(m["backend"]); b != "" {
			out.Backend = b
		}
		if results, ok := m["results"].([]map[string]any); ok {
			for _, hit := range results {
				out.Results = append(out.Results, &ragv1.RetrieveHit{
					DocId: str(hit["docId"]), Title: str(hit["title"]), Snippet: str(hit["snippet"]),
					Score: toFloat(hit["score"]), Status: coalesce(str(hit["status"]), "published"),
				})
			}
		} else if arr, ok := m["results"].([]any); ok {
			for _, x := range arr {
				hit, _ := x.(map[string]any)
				if hit == nil {
					continue
				}
				out.Results = append(out.Results, &ragv1.RetrieveHit{
					DocId: str(hit["docId"]), Title: str(hit["title"]), Snippet: str(hit["snippet"]),
					Score: toFloat(hit["score"]), Status: coalesce(str(hit["status"]), "published"),
				})
			}
		}
	}
	return connect.NewResponse(out), nil
}

func (c *ragConnect) SyncPublished(ctx context.Context, req *connect.Request[ragv1.SyncPublishedRequest]) (*connect.Response[ragv1.SyncPublishedResponse], error) {
	_ = ctx
	n := int32(len(req.Msg.GetDocs()))
	return connect.NewResponse(&ragv1.SyncPublishedResponse{Indexed: n}), nil
}

type collabConnect struct{ s *Server }

func (c *collabConnect) CreateConversation(ctx context.Context, req *connect.Request[collabv1.CreateConversationRequest]) (*connect.Response[collabv1.Conversation], error) {
	r := requestFromConnect(ctx, req.Header())
	id := identityFrom(ctx)
	ws := c.s.workspaceID(r)
	title := req.Msg.GetTitle()
	if title == "" {
		title = "新会话"
	}
	item := &collabv1.Conversation{
		Id: c.s.Store.ID("conv"), WorkspaceId: ws, Title: title,
		DigitalPartnerId: req.Msg.GetDigitalPartnerId(),
		UpdatedAt:         time.Now().UTC().Format(time.RFC3339),
	}
	c.s.Store.Lock()
	c.s.Store.Conversations = append([]map[string]any{{
		"id": item.Id, "workspaceId": item.WorkspaceId, "title": item.Title,
		"digitalPartnerId": item.DigitalPartnerId, "updatedAt": item.UpdatedAt,
	}}, c.s.Store.Conversations...)
	if id != nil {
		c.s.Store.AppendAudit(ws, id.Name, "创建协作会话", item.Title, "success", "")
	}
	c.s.Store.Unlock()
	c.s.Store.Persist("conversations")
	return connect.NewResponse(item), nil
}

func (c *collabConnect) StreamTurn(ctx context.Context, req *connect.Request[collabv1.StreamTurnRequest], stream *connect.ServerStream[collabv1.StreamTurnEvent]) error {
	msg := req.Msg
	cid := strings.TrimSpace(msg.GetConversationId())
	if cid == "" {
		return connect.NewError(connect.CodeInvalidArgument, apperr.BadReq(apperr.BadRequest, "缺少 conversation_id"))
	}
	corr := strings.TrimSpace(msg.GetCorrelationId())
	if corr == "" && msg.GetEnvelope() != nil {
		corr = msg.GetEnvelope().GetCorrelationId()
	}
	if corr == "" {
		corr = c.s.Store.ID("corr")
	}
	body := map[string]any{
		"content":           msg.GetContent(),
		"correlationId":     corr,
		"digitalPartnerId": msg.GetDigitalPartnerId(),
		"clientMsgId":       msg.GetClientMsgId(),
		"modelId":           msg.GetModelId(),
		"modeHint":          msg.GetModeHint(),
		"sessionMode":       contract.SessionModeFromProto(msg.GetSessionMode()),
		"riskLevel":         contract.RiskLevelFromProto(msg.GetRiskLevel()),
	}
	if len(msg.GetEnabledTools()) > 0 {
		body["enabledTools"] = msg.GetEnabledTools()
	}
	if env := msg.GetEnvelope(); env != nil {
		if env.GetChannel() != 0 {
			body["channel"] = contract.ChannelKindFromProto(env.GetChannel())
		}
		if env.GetChannelThreadId() != "" {
			body["channelThreadId"] = env.GetChannelThreadId()
		}
	}
	payload, _ := json.Marshal(body)
	r := requestFromConnect(ctx, req.Header())
	r.Method = http.MethodPost
	r.URL.Path = "/api/copilot/conversations/" + cid + "/stream"
	r.Body = ioNopCloser(strings.NewReader(string(payload)))
	r.ContentLength = int64(len(payload))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("x-correlation-id", corr)
	if msg.GetWorkspaceId() != "" && r.Header.Get("x-workspace-id") == "" {
		r.Header.Set("x-workspace-id", msg.GetWorkspaceId())
	}
	w := newConnectTurnWriter(stream)
	c.s.copilotStream(w, r)
	return connectErrorFromWriter(w)
}

func (c *collabConnect) ReplayTurn(ctx context.Context, req *connect.Request[collabv1.ReplayTurnRequest]) (*connect.Response[collabv1.ReplayTurnResponse], error) {
	r := requestFromConnect(ctx, req.Header())
	ws := c.s.workspaceID(r)
	corr := req.Msg.GetCorrelationId()
	cid := req.Msg.GetConversationId()
	rec := c.s.CopSvc.LookupContextSnapshotCtx(ctx, ws, cid, corr)
	if rec == nil {
		return nil, connect.NewError(connect.CodeNotFound, apperr.NotFoundErr(apperr.ReplayNotFound, "回合快照不存在"))
	}
	out := &collabv1.ReplayTurnResponse{CorrelationId: corr}
	out.Snapshot = mapToProtoSnapshot(rec)
	for _, ev := range copilot.SnapshotEvents(rec) {
		out.Events = append(out.Events, &collabv1.StreamTurnEvent{
			Type:          str(ev["type"]),
			Stage:         str(ev["stage"]),
			Text:          str(ev["text"]),
			CorrelationId: corr,
			SnapshotId:    str(rec["id"]),
			EventType:     contract.StreamEventTypeToProto(str(ev["type"])),
		})
	}
	return connect.NewResponse(out), nil
}

func mapToProtoSnapshot(rec map[string]any) *commonv1.ContextSnapshot {
	if rec == nil {
		return nil
	}
	snap := &commonv1.ContextSnapshot{
		Id:            str(rec["id"]),
		CorrelationId: str(rec["correlationId"]),
		System:        str(rec["system"]),
		HistoryTurns:  int32(intFrom(rec["historyTurns"])),
		RagHits:       int32(intFrom(rec["ragHits"])),
		PartnerId:    str(rec["partnerId"]),
		BuiltAt:       str(rec["builtAt"]),
		SessionMode:   contract.SessionModeToProto(str(rec["sessionMode"])),
	}
	if arr, ok := rec["toolRegistry"].([]string); ok {
		snap.ToolRegistry = arr
	} else if arr, ok := rec["toolRegistry"].([]any); ok {
		for _, x := range arr {
			if s := str(x); s != "" {
				snap.ToolRegistry = append(snap.ToolRegistry, s)
			}
		}
	}
	for _, p := range mapsFromAny(rec["memoryProvenance"]) {
		snap.MemoryProvenance = append(snap.MemoryProvenance, &commonv1.MemoryProvenance{
			Id: str(p["id"]), Title: str(p["title"]), Score: toFloat(p["score"]),
			Layer: contract.MemoryLayerToProto(str(p["layer"])),
		})
	}
	return snap
}

type partnerConnect struct{ s *Server }

func (c *partnerConnect) ResolveActive(ctx context.Context, req *connect.Request[partnerv1.ResolveActiveRequest]) (*connect.Response[partnerv1.ResolveActiveResponse], error) {
	r := requestFromConnect(ctx, req.Header())
	raw, err := c.s.resolveActiveEmployee(r, req.Msg.GetDigitalPartnerId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	m, _ := raw.(map[string]any)
	out := &partnerv1.ResolveActiveResponse{
		Id: str(m["id"]), Name: str(m["name"]), Lifecycle: str(m["lifecycle"]),
		Reason: str(m["reason"]), Active: m["active"] == true,
	}
	return connect.NewResponse(out), nil
}

type runtimeConnect struct{ s *Server }

func (c *runtimeConnect) Invoke(ctx context.Context, req *connect.Request[runtimev1.InvokeRequest]) (*connect.Response[runtimev1.InvokeResponse], error) {
	_ = ctx
	out := c.s.runtimeReply(req.Msg.GetInput(), "sonnet-4", nil)
	corr := req.Msg.GetCorrelationId()
	if corr == "" {
		corr = c.s.Store.ID("corr")
	}
	return connect.NewResponse(&runtimev1.InvokeResponse{
		Output: out, Graph: "minimal", CorrelationId: corr, Tokens: int32(len([]rune(out))),
	}), nil
}

func (c *runtimeConnect) Run(ctx context.Context, req *connect.Request[runtimev1.RunRequest], stream *connect.ServerStream[runtimev1.LoopEvent]) error {
	r := requestFromConnect(ctx, req.Header())
	corr := req.Msg.GetEnvelope().GetCorrelationId()
	if corr == "" {
		corr = req.Msg.GetSnapshot().GetCorrelationId()
	}
	if corr == "" {
		corr = c.s.Store.ID("corr")
	}
	snapID := req.Msg.GetSnapshot().GetId()
	emit := func(typ, stage string, extra map[string]any) {
		_ = stream.Send(loopEventFromEmit(typ, stage, corr, snapID, extra))
	}
	in := c.s.reactInputFromRunRequest(r, req.Msg, emit)
	if in.CorrelationID == "" {
		in.CorrelationID = corr
	}
	out := c.s.runRuntimeTurn(ctx, in)
	if out.Err != nil {
		_ = stream.Send(&runtimev1.LoopEvent{
			Type:  commonv1.StreamEventType_STREAM_EVENT_TYPE_ERROR,
			Stage: "runtime", Text: out.Err.Error(), CorrelationId: corr, SnapshotId: snapID,
			Meta: map[string]string{"runtimeMode": runtimeMode()},
		})
		return nil
	}
	return stream.Send(&runtimev1.LoopEvent{
		Type:          commonv1.StreamEventType_STREAM_EVENT_TYPE_DONE,
		Stage:         "done",
		Text:          out.Text,
		CorrelationId: corr,
		SnapshotId:    snapID,
		Meta:          map[string]string{"runtimeMode": runtimeMode(), "mode": out.Mode},
	})
}

func requestFromConnect(ctx context.Context, h http.Header) *http.Request {
	r, _ := http.NewRequestWithContext(ctx, http.MethodPost, "/", nil)
	r.Header = h.Clone()
	return r
}
