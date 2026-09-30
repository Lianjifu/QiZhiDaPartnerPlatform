package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/metrics"
	"github.com/qizhida-partner-platform/backend/internal/pmsop"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
)

func (s *Server) initPMsop() {
	s.PMSop = pmsop.New()
}

func (s *Server) pmsopTemplatesHandler(w http.ResponseWriter, r *http.Request) {
	if !auth.Has(identityFrom(r.Context()), "access.read") {
		writeErr(w, apperr.Forbidden(apperr.RoleForbidden, "需要 access.read 权限"))
		return
	}
	if s.PMSop == nil {
		writeErr(w, apperr.Unavailable(apperr.Unknown, "PM SOP 引擎未启用"))
		return
	}
	response.OK(w, map[string]any{"templates": s.PMSop.Templates()})
}

func (s *Server) pmsopCreatePlanHandler(w http.ResponseWriter, r *http.Request) {
	if !auth.Has(identityFrom(r.Context()), "access.write") {
		writeErr(w, apperr.Forbidden(apperr.RoleForbidden, "需要 access.write 权限"))
		return
	}
	if s.PMSop == nil {
		writeErr(w, apperr.Unavailable(apperr.Unknown, "PM SOP 引擎未启用"))
		return
	}
	id := identityFrom(r.Context())
	body, _ := decodeMap(r)
	tplID := strings.TrimSpace(str(body["templateId"]))
	if tplID == "" {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "templateId 必填"))
		return
	}
	ws := s.workspaceID(r)
	planID := strings.TrimSpace(str(body["planId"]))
	if planID == "" {
		planID = s.Store.ID("plan")
	}
	plan, err := s.PMSop.Render(tplID, planID, ws, id.Name, nil)
	if err != nil {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "模板渲染失败: "+err.Error()))
		return
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	plans := knowledgeSliceMaps(s.Store.KnowledgeExtra["pmsop_plans"])
	for _, p := range plans {
		if str(p["id"]) == planID {
			writeErr(w, apperr.Conflict("pmsop.duplicate", "planId 已存在"))
			return
		}
	}
	item := planToMap(plan)
	s.Store.KnowledgeExtra["pmsop_plans"] = append([]map[string]any{item}, plans...)
	s.appendKnowledgeAuditLocked(ws, id.Name, "创建 PM 计划", planID+" ("+tplID+")", "success", "")
	metrics.Global.PMSop.Inc("created")
	go s.persistKnowledgeExtra()
	response.OK(w, item)
}

func (s *Server) pmsopListPlansHandler(w http.ResponseWriter, r *http.Request) {
	if !auth.Has(identityFrom(r.Context()), "access.read") {
		writeErr(w, apperr.Forbidden(apperr.RoleForbidden, "需要 access.read 权限"))
		return
	}
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := []map[string]any{}
	for _, p := range knowledgeSliceMaps(s.Store.KnowledgeExtra["pmsop_plans"]) {
		if str(p["workspaceId"]) == ws {
			out = append(out, p)
		}
	}
	response.OK(w, map[string]any{"plans": out})
}

func (s *Server) pmsopPlanDetailHandler(w http.ResponseWriter, r *http.Request) {
	if !auth.Has(identityFrom(r.Context()), "access.read") {
		writeErr(w, apperr.Forbidden(apperr.RoleForbidden, "需要 access.read 权限"))
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/pmsop/plans/")
	id = strings.Trim(id, "/")
	ws := s.workspaceID(r)
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, p := range knowledgeSliceMaps(s.Store.KnowledgeExtra["pmsop_plans"]) {
		if str(p["id"]) == id && str(p["workspaceId"]) == ws {
			response.OK(w, p)
			return
		}
	}
	writeErr(w, apperr.NotFoundErr(apperr.NotFound, "plan 不存在"))
}

func (s *Server) pmsopPlanEventHandler(w http.ResponseWriter, r *http.Request) {
	if !auth.Has(identityFrom(r.Context()), "access.write") {
		writeErr(w, apperr.Forbidden(apperr.RoleForbidden, "需要 access.write 权限"))
		return
	}
	if s.PMSop == nil {
		writeErr(w, apperr.Unavailable(apperr.Unknown, "PM SOP 引擎未启用"))
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "路径无效"))
		return
	}
	planID := parts[3]
	body, _ := decodeMap(r)
	ws := s.workspaceID(r)
	evType := pmsop.EventType(strings.TrimSpace(str(body["type"])))
	if evType == "" {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "type 必填"))
		return
	}
	taskID := strings.TrimSpace(str(body["taskId"]))
	stageID := strings.TrimSpace(str(body["stageId"]))
	note := strings.TrimSpace(str(body["note"]))
	id := identityFrom(r.Context())

	var current map[string]any
	s.Store.Lock()
	plans := knowledgeSliceMaps(s.Store.KnowledgeExtra["pmsop_plans"])
	for i, p := range plans {
		if str(p["id"]) == planID && str(p["workspaceId"]) == ws {
			current = p
			plans[i] = p
			break
		}
	}
	if current == nil {
		s.Store.Unlock()
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "plan 不存在"))
		return
	}
	plan, err := planFromMap(current)
	if err != nil {
		s.Store.Unlock()
		writeErr(w, apperr.BadReq(apperr.BadRequest, "plan 解析失败: "+err.Error()))
		return
	}
	updated, err := s.PMSop.Apply(plan, pmsop.Event{
		Type:    evType,
		TaskID:  taskID,
		StageID: stageID,
		Note:    note,
		Actor:   id.Name,
	})
	if err != nil {
		s.Store.Unlock()
		writeErr(w, apperr.BadReq(apperr.BadRequest, "事件应用失败: "+err.Error()))
		return
	}
	replaced := planToMap(updated)
	for i, p := range plans {
		if str(p["id"]) == planID {
			plans[i] = replaced
			break
		}
	}
	s.Store.KnowledgeExtra["pmsop_plans"] = plans
	s.appendKnowledgeAuditLocked(ws, id.Name, "PM 计划事件 "+string(evType), planID+"/"+taskID, "success", note)
	s.Store.Unlock()
	metrics.Global.PMSop.Inc(string(evType))
	go s.persistKnowledgeExtra()
	response.OK(w, replaced)
}

// planToMap converts the engine value object into the JSON shape the
// store keeps. We round-trip via json to guarantee field stability.
func planToMap(p pmsop.Plan) map[string]any {
	js, _ := json.Marshal(p)
	out := map[string]any{}
	_ = json.Unmarshal(js, &out)
	return out
}

func planFromMap(m map[string]any) (pmsop.Plan, error) {
	js, err := json.Marshal(m)
	if err != nil {
		return pmsop.Plan{}, err
	}
	var p pmsop.Plan
	if err := json.Unmarshal(js, &p); err != nil {
		return pmsop.Plan{}, err
	}
	return p, nil
}