package knowledge

import (
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// CreateKnowledgeSource → POST /api/knowledge/sources
func (s *Service) CreateKnowledgeSource(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "数据源名称必填")
	}
	kind := coalesce(str(body["kind"]), "REST API")
	endpoint := strings.TrimSpace(str(body["endpoint"]))
	if kind == "Webhook" {
		ws := s.Deps.WorkspaceID(r)
		endpoint = "/hooks/knowledge/" + ws + "/" + s.Store.ID("wh")
	} else if endpoint == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "连接地址必填")
	}
	schedule := coalesce(str(body["schedule"]), "每 1 小时")
	if kind == "Webhook" {
		schedule = "事件推送"
	}
	credentialHint := strings.TrimSpace(str(body["credentialHint"]))
	ws := s.Deps.WorkspaceID(r)
	item := map[string]any{
		"id": s.Store.ID("ks"), "workspaceId": ws, "name": name,
		"kind": kind, "schedule": schedule, "endpoint": endpoint,
		"lastSync": "尚未同步", "documents": 0, "status": "attention",
	}
	if credentialHint != "" {
		item["credentialHint"] = credentialHint
	}
	s.Store.Lock()
	srcs := knowledgeSliceMaps(s.Store.KnowledgeExtra["sources"])
	s.Store.KnowledgeExtra["sources"] = append([]map[string]any{item}, srcs...)
	s.appendKnowledgeAuditLocked(ws, id.Name, "接入知识数据源", name, "success", "")
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return normalizeSourceItem(item), nil
}

// SyncKnowledgeSource → POST /api/knowledge/sources/{id}/sync
//
// Mark the source healthy, increment the document count, and create a
// placeholder doc for the synced content. This is the legacy stub
// implementation — the production sync path goes through the
// connect_gateway service and is bounded by Service.RAGRetrieveForConnect.
func (s *Service) SyncKnowledgeSource(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		return nil, apperr.BadReq(apperr.BadRequest, "路径无效")
	}
	srcID := parts[3]
	ws := s.Deps.WorkspaceID(r)
	s.Store.Lock()
	// unlocked 防止 defer 二次 Unlock；spawn persist 必须在 Unlock 之后。
	unlocked := false
	defer func() {
		if !unlocked {
			s.Store.Unlock()
		}
	}()
	srcs := knowledgeSliceMaps(s.Store.KnowledgeExtra["sources"])
	for i, src := range srcs {
		if str(src["id"]) != srcID {
			continue
		}
		if str(src["workspaceId"]) != "" && str(src["workspaceId"]) != ws {
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "数据源不在当前工作区")
		}
		src["status"] = "healthy"
		src["lastSync"] = time.Now().UTC().Format(time.RFC3339)
		n := intFrom(src["documents"]) + 1
		src["documents"] = n
		srcs[i] = src
		s.Store.KnowledgeExtra["sources"] = srcs
		// create a doc from sync
		doc := map[string]any{
			"id": s.Store.ID("kd"), "workspaceId": ws, "title": str(src["name"]) + " 同步文档",
			"source": str(src["name"]), "status": "ready", "ownerId": id.ID,
			"sizeKb": 16, "chunks": 4, "citeCount": 0,
			"snippet":   "来自数据源同步：" + str(src["name"]),
			"updatedAt": time.Now().UTC().Format(time.RFC3339),
			"quality":   map[string]any{"completeness": 75, "freshness": 95, "citationAccuracy": 80},
		}
		s.Store.KnowledgeDocs = append([]map[string]any{doc}, s.Store.KnowledgeDocs...)
		s.appendKnowledgeAuditLocked(ws, id.Name, "同步知识数据源", str(src["name"]), "success", "")
		unlocked = true
		s.Store.Unlock()
		go func() { s.Store.Persist("knowledge_docs"); s.persistKnowledgeExtra() }()
		return normalizeSourceItem(src), nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "数据源不存在")
}
