package skills

import (
	"net/http"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// upsertSkillCatalogLocked is the package-private mutation that
// upsertSkillCatalogAPI delegates to. Mirrors server.Server.upsertSkillCatalogLocked.
func (s *Service) upsertSkillCatalogLocked(item map[string]any) {
	if item == nil {
		return
	}
	sid := str(item["id"])
	if sid == "" {
		return
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, existing := range s.Store.Skills {
		if str(existing["id"]) != sid {
			continue
		}
		for k, v := range item {
			existing[k] = v
		}
		return
	}
	s.Store.Skills = append([]map[string]any{cloneMapLocal(item)}, s.Store.Skills...)
}

// cloneMapLocal is a local shallow clone (avoid colliding with handlers.go).
func cloneMapLocal(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// upsertSkillCatalogAPI — POST /api/internal/skill-catalog. Mirrors
// server.Server.upsertSkillCatalogAPI.
func (s *Service) upsertSkillCatalogAPI(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.UnauthorizedErr("请先登录")
	}
	body, _ := decodeMap(r)
	if str(body["id"]) == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少技能 id")
	}
	s.upsertSkillCatalogLocked(body)
	s.persistSkills()
	return body, nil
}

// skillInvocationAPI — POST /api/internal/skill/invocation. Mirrors
// server.Server.skillInvocationAPI.
func (s *Service) skillInvocationAPI(r *http.Request) (any, error) {
	if r.Method != http.MethodPost {
		return nil, apperr.BadReq(apperr.BadRequest, "仅支持 POST")
	}
	body, _ := decodeMap(r)
	ws := coalesce(s.WorkspaceID(r), str(body["workspaceId"]))
	skillID := str(body["skillId"])
	if skillID == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少 skillId")
	}
	durationMs := intFrom(body["durationMs"])
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
