package server

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

var oidcStates sync.Map // state → expiry unix

func newOIDCState() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	state := hex.EncodeToString(b)
	oidcStates.Store(state, time.Now().Add(10*time.Minute).Unix())
	return state
}

func consumeOIDCState(state string) bool {
	if state == "" {
		return false
	}
	v, ok := oidcStates.LoadAndDelete(state)
	if !ok {
		return false
	}
	exp, _ := v.(int64)
	return time.Now().Unix() <= exp
}

func (s *Server) oidcLogin(r *http.Request) (any, error) {
	state := r.URL.Query().Get("state")
	if state == "" {
		state = newOIDCState()
	} else {
		oidcStates.Store(state, time.Now().Add(10*time.Minute).Unix())
	}
	if !s.OIDC.Enabled {
		return map[string]any{
			"enabled":      false,
			"hint":         "设置 DE_OIDC_ISSUER / DE_OIDC_CLIENT_ID 后启用 Authentik/Dex OIDC",
			"stubCallback": "/api/auth/oidc/callback?code=admin&state=" + state,
			"state":        state,
		}, nil
	}
	url, err := s.OIDC.AuthURL(state)
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, err.Error())
	}
	return map[string]any{"enabled": true, "authorizationUrl": url, "state": state}, nil
}

func (s *Server) oidcCallback(r *http.Request) (any, error) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if s.OIDC.Enabled && !s.OIDC.AllowDevCodes {
		if !consumeOIDCState(state) {
			return nil, apperr.UnauthorizedErr("无效或过期的 OIDC state")
		}
	} else if state != "" {
		consumeOIDCState(state) // best-effort clear
	}

	id, err := s.OIDC.ExchangeCode(r.Context(), code)
	if err != nil {
		return nil, apperr.UnauthorizedErr(err.Error())
	}
	token, err := auth.Sign(*id, 24*time.Hour)
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, "签发令牌失败")
	}
	s.Store.Lock()
	s.Store.AppendAudit(id.WorkspaceID, id.Name, "OIDC 登录", "auth", "success", "")
	s.Store.Unlock()
	return map[string]any{"token": token, "user": id}, nil
}
