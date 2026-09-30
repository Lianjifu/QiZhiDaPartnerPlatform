package server

import (
	"log"
	"net/http"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Server) ensureChannelSessionAPI(r *http.Request) (any, error) {
	if r.Method != http.MethodPost {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持 POST")
	}
	body, _ := decodeMap(r)
	ws := coalesce(str(body["workspaceId"]), s.workspaceID(r))
	channel := str(body["channel"])
	threadID := coalesce(str(body["channelThreadId"]), str(body["threadId"]))
	deployID := coalesce(str(body["deploymentId"]), str(body["channelDeploymentId"]))
	employeeID := str(body["digitalPartnerId"])
	actorID := str(body["actorId"])
	if actor := identityFrom(r.Context()); actor != nil && actorID == "" {
		actorID = actor.ID
	}
	sessID, convID, created := s.ensureChannelSession(ws, channel, threadID, deployID, employeeID, actorID)
	if sessID == "" {
		return nil, apperr.BadReq(apperr.ChannelThreadUnbound, "无法绑定渠道会话")
	}
	if created {
		s.Store.Persist("sessions")
		s.Store.Persist("conversations")
		s.Store.Persist("messages")
	}
	return map[string]any{
		"sessionId": sessID, "conversationId": convID, "created": created,
	}, nil
}

func (s *Server) upsertSkillCatalogAPI(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.UnauthorizedErr("请先登录")
	}
	body, _ := decodeMap(r)
	if str(body["id"]) == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少技能 id")
	}
	s.Store.Lock()
	s.upsertSkillCatalogLocked(body)
	s.Store.Unlock()
	s.persistSkills()
	return body, nil
}

func (s *Server) upsertSkillCatalogLocked(item map[string]any) {
	if item == nil || !s.Store.CanWrite("skills") {
		return
	}
	sid := str(item["id"])
	if sid == "" {
		return
	}
	for _, existing := range s.Store.Skills {
		if str(existing["id"]) != sid {
			continue
		}
		for k, v := range item {
			existing[k] = v
		}
		return
	}
	s.Store.Skills = append([]map[string]any{cloneMap(item)}, s.Store.Skills...)
}

func (s *Server) applyWorkflowSkillCatalog(actor *auth.Identity, skill map[string]any, r *http.Request) {
	if skill == nil {
		return
	}
	item := cloneMap(skill)
	if str(item["kind"]) == "" {
		item["kind"] = "workflow"
	}
	if str(item["runtime"]) == "" {
		item["runtime"] = "qzda-workflow"
	}
	item["source"] = "workflow"
	if s.ownsCapRuntime() {
		s.Store.Lock()
		s.upsertSkillCatalogLocked(item)
		if str(item["lifecycleStatus"]) == "enabled" || str(item["status"]) == "published" {
			if s.Store.CapabilityCatalog == nil {
				s.Store.CapabilityCatalog = map[string]any{}
			}
			wfs, _ := s.Store.CapabilityCatalog["workflows"].([]map[string]any)
			sid := str(item["id"])
			found := false
			for _, w := range wfs {
				if str(w["id"]) == sid {
					found = true
					break
				}
			}
			if !found {
				s.Store.CapabilityCatalog["workflows"] = append([]map[string]any{{
					"id": sid, "name": str(item["name"]), "meta": "流程技能 · " + coalesce(str(item["version"]), "—"),
				}}, wfs...)
			}
		}
		s.Store.Unlock()
		s.persistSkills()
		return
	}
	if r == nil {
		r, _ = http.NewRequest(http.MethodPost, "/", nil)
	}
	if actor != nil && r.Header.Get("Authorization") == "" {
		r = s.requestWithActor(r, actor, str(item["workspaceId"]))
	}
	if _, err := s.peerPOST(r, capBaseURL(), "/api/internal/skill-catalog", item); err != nil {
		s.Store.AppendAudit(str(item["workspaceId"]), coalesce(actorName(actor), "workflow"), "同步流程技能目录失败", str(item["id"]), "failed", err.Error())
	}
}

func (s *Server) copilotPostTurnAPI(r *http.Request) (any, error) {
	if r.Method != http.MethodPost {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持 POST")
	}
	if !s.ownsCapRuntime() {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅 cap 进程可处理 post-turn")
	}
	body, _ := decodeMap(r)
	ws := coalesce(str(body["workspaceId"]), s.workspaceID(r))
	id := identityFrom(r.Context())
	ownerID := str(body["ownerId"])
	ownerName := str(body["ownerName"])
	if id != nil {
		if ownerID == "" {
			ownerID = id.ID
		}
		if ownerName == "" {
			ownerName = id.Name
		}
	}
	var memoryErr string
	s.Store.Lock()
	if raw, ok := body["memoryIngest"].(map[string]any); ok && len(raw) > 0 {
		in := runtimeMemoryInput{
			WorkspaceID:       coalesce(str(raw["workspaceId"]), ws),
			OwnerID:           coalesce(str(raw["ownerId"]), ownerID),
			OwnerName:         coalesce(str(raw["ownerName"]), ownerName),
			DigitalPartnerID: str(raw["digitalPartnerId"]),
			Title:             str(raw["title"]),
			Content:           str(raw["content"]),
			SourceType:        str(raw["sourceType"]),
			SourceID:          str(raw["sourceId"]),
			CorrelationID:     str(raw["correlationId"]),
			Layer:             str(raw["layer"]),
			Scope:             str(raw["scope"]),
			Classification:    str(raw["classification"]),
			Confidence:        toFloat(raw["confidence"]),
		}
		if _, err := s.ingestRuntimeMemoryLocked(in); err != nil {
			memoryErr = err.Error()
			s.appendMemoryAuditLocked(ws, coalesce(ownerName, "系统"), "写入记忆", truncateRunes(str(raw["title"]), 40), "failed", str(raw["correlationId"]))
		}
	}
	created := s.runPostTurnEvolutionLocked(evolveTurnInput{
		WorkspaceID:       ws,
		OwnerID:           ownerID,
		OwnerName:         ownerName,
		DigitalPartnerID: str(body["digitalPartnerId"]),
		ConversationID:    str(body["conversationId"]),
		CorrelationID:     str(body["correlationId"]),
		MessageID:         str(body["messageId"]),
		UserMessage:       str(body["userMessage"]),
		AssistantText:     str(body["assistantText"]),
		Mode:              str(body["mode"]),
		ReflectRounds:     toInt(body["reflectRounds"]),
		ToolCalls:         asMapSlice(body["toolCalls"]),
	})
	s.Store.Unlock()
	go s.persistEvolve()
	return map[string]any{
		"evolveCandidates": created,
		"memoryError":      memoryErr,
	}, nil
}

func (s *Server) purgeConversationMemoryAPI(r *http.Request) (any, error) {
	if r.Method != http.MethodPost {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持 POST")
	}
	if !s.ownsCapRuntime() {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅 cap 进程可清理记忆")
	}
	body, _ := decodeMap(r)
	ws := coalesce(str(body["workspaceId"]), s.workspaceID(r))
	convID := str(body["conversationId"])
	if convID == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少 conversationId")
	}
	s.Store.Lock()
	deleted := s.removeMemoryForConversationLocked(ws, convID)
	s.Store.Unlock()
	if s.Store.CanWrite("memory_records") {
		if len(deleted) > 0 {
			if err := s.Store.PersistDeleteSync("memory_records", deleted...); err != nil {
				log.Printf("persist-delete memory_records: %v", err)
			}
		}
		s.Store.Persist("memory_records")
	}
	return map[string]any{"deleted": len(deleted), "conversationId": convID}, nil
}

func (s *Server) skillInvocationAPI(r *http.Request) (any, error) {
	if r.Method != http.MethodPost {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持 POST")
	}
	if !s.ownsCapRuntime() {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅 cap 进程可处理 skill invocation")
	}
	body, _ := decodeMap(r)
	ws := coalesce(str(body["workspaceId"]), s.workspaceID(r))
	skillID := str(body["skillId"])
	if skillID == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少 skillId")
	}
	durationMs := toInt(body["durationMs"])
	ok := boolFrom(body["ok"])
	actor := str(body["actor"])
	source := str(body["source"])
	s.Store.Lock()
	var sk map[string]any
	if _, found := s.findSkillLocked(ws, skillID); found != nil {
		sk = found
	} else {
		for _, item := range s.Store.Skills {
			if str(item["id"]) == skillID {
				sk = item
				break
			}
		}
	}
	if sk != nil {
		s.recordSkillInvocationLocked(ws, sk, durationMs, ok, actor, source)
	}
	s.Store.Unlock()
	s.persistSkillHealth()
	return map[string]any{"ok": true}, nil
}

func actorName(id *auth.Identity) string {
	if id == nil {
		return ""
	}
	return id.Name
}
