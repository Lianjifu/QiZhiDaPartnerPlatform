package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	runtimev1 "github.com/qizhida-partner-platform/backend/gen/qzda/runtime/v1"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/scope"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// handleConnect is the legacy Connect-JSON envelope gateway
// ({ok,data}) used by early FE smoke. Prefer buf-generated handlers
// mounted by mountConnectRPC (Protobuf / Connect-JSON codecs).
func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "Connect 仅支持 POST"))
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/connect/")
	// If a formal Connect handler is registered for this procedure, let the
	// ServeMux route win — this function is only reached for the catch-all
	// when path does not match a mounted service prefix. Keep JSON envelope
	// for StreamTurn SSE-shaped clients and unknown methods.
	body, _ := decodeMap(r)
	corr := coalesce(str(body["correlationId"]), coalesce(str(body["correlation_id"]), s.Store.ID("corr")))

	switch path {
	case "qzda.collab.v1.CollabService/CreateConversation":
		id := identityFrom(r.Context())
		title := coalesce(str(body["title"]), "新会话")
		deID := coalesce(str(body["digitalPartnerId"]), str(body["digital_employee_id"]))
		item := map[string]any{
			"id": s.Store.ID("conv"), "workspaceId": s.workspaceID(r),
			"title": title, "digitalPartnerId": deID,
			"updatedAt": time.Now().UTC().Format(time.RFC3339),
		}
		s.Store.Lock()
		s.Store.Conversations = append([]map[string]any{item}, s.Store.Conversations...)
		if id != nil {
			s.Store.AppendAudit(s.workspaceID(r), id.Name, "创建协作会话", title, "success", corr)
		}
		s.Store.Unlock()
		writeConnect(w, item, nil)
	case "qzda.collab.v1.CollabService/StreamTurn":
		cid := coalesce(str(body["conversationId"]), str(body["conversation_id"]))
		if cid == "" {
			writeErr(w, apperr.BadReq(apperr.BadRequest, "缺少 conversation_id"))
			return
		}
		payload, _ := json.Marshal(map[string]any{
			"content":           coalesce(str(body["content"]), str(body["message"])),
			"digitalPartnerId": coalesce(str(body["digitalPartnerId"]), str(body["digital_employee_id"])),
			"correlationId":     corr,
		})
		r.Body = ioNopCloser(strings.NewReader(string(payload)))
		r.URL.Path = "/api/copilot/conversations/" + cid + "/stream"
		r.Header.Set("x-correlation-id", corr)
		s.copilotStream(w, r)
	case "qzda.rag.v1.RagService/Retrieve":
		data, err := s.retrievePublished(r, body, corr)
		writeConnect(w, data, err)
	case "qzda.runtime.v1.RuntimeService/Invoke":
		out := s.runtimeReply(coalesce(str(body["input"]), str(body["prompt"])), coalesce(str(body["modelId"]), coalesce(str(body["model"]), "sonnet-4")), nil)
		writeConnect(w, map[string]any{
			"output": out, "graph": "minimal", "correlationId": corr, "tokens": len([]rune(out)),
		}, nil)
	case "qzda.runtime.v1.RuntimeService/Run":
		runReq := &runtimev1.RunRequest{
			Input:        coalesce(str(body["input"]), str(body["prompt"])),
			ModelId:      coalesce(str(body["modelId"]), str(body["model"])),
			Envelope:     envelopeFromRunJSON(body),
			Snapshot:     snapshotFromRunJSON(body),
			LoopMode:     contract.LoopModeToProto(coalesce(str(body["loopMode"]), str(body["loop_mode"]))),
			EnabledTools: stringSlice(body["enabledTools"]),
			MaxSteps:     int32(intFrom(body["maxSteps"])),
		}
		if runReq.Envelope != nil && runReq.Envelope.CorrelationId == "" {
			runReq.Envelope.CorrelationId = corr
		}
		var events []map[string]any
		emit := func(typ, stage string, extra map[string]any) {
			ev := map[string]any{"type": typ, "stage": stage, "correlationId": corr}
			for k, v := range extra {
				ev[k] = v
			}
			events = append(events, ev)
		}
		in := s.reactInputFromRunRequest(r, runReq, emit)
		if in.CorrelationID == "" {
			in.CorrelationID = corr
		}
		out := s.runRuntimeTurn(r.Context(), in)
		if out.Err != nil {
			writeErr(w, out.Err)
			return
		}
		writeConnect(w, map[string]any{
			"type": "done", "text": out.Text, "correlationId": corr,
			"snapshotId":  coalesce(runReq.GetSnapshot().GetId(), str(body["snapshotId"])),
			"runtimeMode": runtimeMode(),
			"mode":        out.Mode,
			"events":      events,
			"replay":      false,
		}, nil)
	case "qzda.collab.v1.CollabService/ReplayTurn":
		cid := coalesce(str(body["conversationId"]), str(body["conversation_id"]))
		corr := coalesce(str(body["correlationId"]), str(body["correlation_id"]))
		rec := s.CopSvc.LookupContextSnapshotCtx(r.Context(), s.workspaceID(r), cid, corr)
		if rec == nil {
			writeErr(w, apperr.NotFoundErr(apperr.ReplayNotFound, "回合快照不存在"))
			return
		}
		writeConnect(w, map[string]any{
			"snapshot": rec, "events": rec["events"], "correlationId": corr, "replay": true,
		}, nil)
	case "qzda.partner.v1.PartnerService/ResolveActive":
		data, err := s.resolveActiveEmployee(r, coalesce(str(body["digitalPartnerId"]), str(body["digital_partner_id"])))
		writeConnect(w, data, err)
	case "qzda.policy.v1.PolicyService/GetAccessGovernance":
		data, err := s.accessGovernance(r)
		writeConnect(w, data, err)
	case "qzda.policy.v1.PolicyService/EvaluateZeroTrust":
		id := identityFrom(r.Context())
		data, err := s.evaluateZeroTrust(id, coalesce(str(body["resource"]), ""), coalesce(str(body["action"]), ""),
			coalesce(str(body["classification"]), ""), body["external"] == true, corr)
		writeConnect(w, data, err)
	case "qzda.audit.v1.AuditService/ListAuditCenter":
		data, err := s.auditCenter(r)
		writeConnect(w, data, err)
	case "qzda.audit.v1.AuditService/ExportAudit":
		data, err := s.auditExport(r)
		writeConnect(w, data, err)
	case "qzda.platform.v1.PlatformService/ListWorkspaces":
		data, err := s.listWorkspaces(r)
		writeConnect(w, data, err)
	case "qzda.platform.v1.PlatformService/CreateWorkspace":
		data, err := s.createWorkspace(r)
		writeConnect(w, data, err)
	default:
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "未知 Connect 方法: "+path))
	}
}

func writeConnect(w http.ResponseWriter, data any, err error) {
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
}

func (s *Server) resolveActiveEmployee(r *http.Request, deID string) (any, error) {
	deID = strings.TrimSpace(deID)
	if deID == "" {
		return map[string]any{"active": true, "skipped": true}, nil
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, e := range s.Store.Employees {
		if str(e["id"]) != deID {
			continue
		}
		if str(e["workspaceId"]) != ws {
			continue
		}
		life := str(e["lifecycle"])
		active := life == "active" || life == "published"
		reason := ""
		if !active {
			reason = "数字伙伴未上岗: " + life
		}
		return map[string]any{
			"id": e["id"], "name": e["name"], "role": e["role"], "department": e["department"],
			"description": e["description"], "responsibilities": e["responsibilities"],
			"prohibitedActions": e["prohibitedActions"], "capabilities": e["capabilities"],
			"boundaryPolicy": e["boundaryPolicy"],
			"lifecycle":      life, "active": active, "reason": reason,
		}, nil
	}
	return map[string]any{"id": deID, "active": false, "reason": "未找到数字伙伴"}, nil
}

func (s *Server) retrievePublished(r *http.Request, body map[string]any, corr string) (any, error) {
	query := str(body["query"])
	ws := s.workspaceID(r)
	if hits := s.knowledgeSvc.RAGRetrieveForConnect(r.Context(), query, ws, corr); hits != nil {
		s.recordUsageWS(ws, "rag", 1, corr)
		return s.filterRAGHitsByScope(r, hits), nil
	}
	viewer := identityFrom(r.Context())
	s.Store.RLock()
	var results []map[string]any
	published := 0
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != ws {
			continue
		}
		if str(d["status"]) != "published" {
			continue
		}
		// Honor per-doc scope ACL (role:/employee:/conversation:) — without
		// this filter the panel path returns HR-private / role-scoped docs
		// to non-privileged viewers (the eval path filters via
		// scope.Allowed; the retrieval path did not).
		if !scope.Allowed(scopeDocFromMap(d), scopeViewerFromIdentity(viewer, ws)) {
			continue
		}
		published++
		if query == "" || strings.Contains(str(d["title"]), query) {
			results = append(results, map[string]any{
				"docId": d["id"], "title": d["title"], "score": 0.8,
				"snippet": "已发布知识命中：" + str(d["title"]), "status": "published",
			})
		}
	}
	s.Store.RUnlock()
	s.recordUsageWS(ws, "rag", 1, corr)
	fallback := map[string]any{"query": query, "results": results, "backend": "published-memory", "correlationId": corr}
	if productionLikeEnv() && published > 0 {
		fallback["degraded"] = true
		fallback["backend"] = "published-memory-degraded"
		fallback["code"] = string(apperr.RuntimeUnavailable)
		fallback["warning"] = "向量检索不可用，已降级到已发布关键词检索"
	}
	return fallback, nil
}

// filterRAGHitsByScope post-filters sidecar hits so the per-doc ACL applies
// even when the RAG service returns hits the sidecar's broader filter would
// have admitted. The hit-shape sidecar results may not carry scopes; we
// look the doc up in the store and drop the hit if the doc isn't visible
// to the current viewer.
func (s *Server) filterRAGHitsByScope(r *http.Request, hits any) any {
	m, ok := hits.(map[string]any)
	if !ok {
		return hits
	}
	viewer := identityFrom(r.Context())
	ws := s.workspaceID(r)
	raw, ok := m["results"]
	if !ok {
		return hits
	}
	items := knowledgeSliceMaps(raw)
	if len(items) == 0 {
		// results might be []any
		if arr, ok := raw.([]any); ok {
			for _, x := range arr {
				if im, ok := x.(map[string]any); ok {
					items = append(items, im)
				}
			}
		}
	}
	if len(items) == 0 {
		return hits
	}
	// Build docId → KnowledgeDoc lookup once.
	docByID := map[string]map[string]any{}
	s.Store.RLock()
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != ws {
			continue
		}
		if str(d["status"]) != "published" {
			continue
		}
		docByID[str(d["id"])] = d
	}
	s.Store.RUnlock()
	filtered := make([]any, 0, len(items))
	for _, h := range items {
		id := coalesce(str(h["docId"]), str(h["id"]))
		d, ok := docByID[id]
		if !ok {
			continue
		}
		if !scope.Allowed(scopeDocFromMap(d), scopeViewerFromIdentity(viewer, ws)) {
			continue
		}
		filtered = append(filtered, h)
	}
	m["results"] = filtered
	return m
}

type nopCloser struct{ *strings.Reader }

func (nopCloser) Close() error { return nil }

func ioNopCloser(r *strings.Reader) *nopCloser { return &nopCloser{Reader: r} }
