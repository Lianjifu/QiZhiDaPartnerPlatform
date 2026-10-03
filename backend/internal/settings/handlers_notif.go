package settings

import (
	"net/http"
	"strings"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// listNotificationChannels returns the notification-channel roster
// (email / sms / webhook / im) for the current workspace. R/O surface:
// configuration changes go through the per-channel PATCH endpoint
// below.
func (s *Service) listNotificationChannels(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.NotificationChannels, nil
}

// patchNotificationChannel updates a single notification channel's
// enabled flag and/or display name. Admin-only — channel config
// controls which integrations can fan out events, and a wrong toggle
// can mute real alerts. Path: /api/notification-channels/{id}.
func (s *Service) patchNotificationChannel(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if id.Role != "admin" {
		return nil, apperr.Forbidden(apperr.AdminRequired, "仅管理员可配置通知渠道")
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		return nil, apperr.NotFoundErr(apperr.NotFound, "通知渠道不存在")
	}
	cid := parts[2]
	body, _ := s.decodeMap(r)
	s.Store.Lock()
	defer s.Store.Unlock()
	for _, ch := range s.Store.NotificationChannels {
		if str(ch["id"]) != cid {
			continue
		}
		if _, ok := body["enabled"]; ok {
			ch["enabled"] = body["enabled"] == true || str(body["enabled"]) == "true"
		}
		if v := strings.TrimSpace(str(body["name"])); v != "" {
			ch["name"] = v
		}
		s.appendAudit(s.workspaceID(r), id.Name, "更新通知渠道", cid, "success", "")
		return ch, nil
	}
	return nil, apperr.NotFoundErr(apperr.NotFound, "通知渠道不存在")
}
