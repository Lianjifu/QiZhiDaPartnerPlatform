package server

import (
	"context"
	"net/http"
	"os"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

type ctxKey string

const (
	workspaceKey ctxKey = "workspaceCtx"
)

// WorkspaceCtx is the resolved tenant/workspace scope for the request.
// Workspace is derived from identity membership; x-workspace-id may select
// among allowed workspaces but cannot forge access.
type WorkspaceCtx struct {
	TenantID    string
	WorkspaceID string
	ActorID     string
	Role        string
}

// identityFrom is a thin re-export of auth.IdentityFrom for callers in
// server/. The identity itself is set on the context by auth.Middleware.
func identityFrom(ctx context.Context) *auth.Identity {
	return auth.IdentityFrom(ctx)
}

func withWorkspace(ctx context.Context, ws *WorkspaceCtx) context.Context {
	return context.WithValue(ctx, workspaceKey, ws)
}

func workspaceFrom(ctx context.Context) *WorkspaceCtx {
	v, _ := ctx.Value(workspaceKey).(*WorkspaceCtx)
	return v
}

// requireAuth composes auth.Middleware.RequireAuth (Bearer parse + mock
// rejection + role gates) with this server's workspace merge + resolution.
// server/ owns the workspace logic because it depends on s.Store and the
// in-memory workspace model.
func (s *Server) requireAuth(next http.Handler) http.Handler {
	authGate := s.authMW.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := identityFrom(r.Context())
		if id == nil {
			// authMW already short-circuited bypass paths; if we get here
			// with no identity, the route was bypass-eligible and we still
			// need to attach an empty workspace so downstream handlers
			// don't NPE on workspaceFrom().
			r = r.WithContext(withWorkspace(r.Context(), &WorkspaceCtx{WorkspaceID: "w1"}))
			next.ServeHTTP(w, r)
			return
		}
		// Merge workspaces created after login (mock tokens have fixed membership).
		if s.Store != nil {
			s.Store.RLock()
			extra := append([]string{}, s.Store.ActorExtraWorkspaces[id.ID]...)
			if id.Role == "admin" {
				for _, w := range s.Store.Workspaces {
					if str(w["tenantId"]) != id.TenantID {
						continue
					}
					if wid := str(w["id"]); wid != "" {
						extra = append(extra, wid)
					}
				}
			} else {
				for _, w := range s.Store.Workspaces {
					if str(w["ownerId"]) == id.ID {
						if wid := str(w["id"]); wid != "" {
							extra = append(extra, wid)
						}
					}
				}
			}
			s.Store.RUnlock()
			for _, ws := range extra {
				if !contains(id.WorkspaceIDs, ws) {
					id.WorkspaceIDs = append(id.WorkspaceIDs, ws)
				}
			}
			if id.WorkspaceID == "" || !contains(id.WorkspaceIDs, id.WorkspaceID) {
				if contains(id.WorkspaceIDs, "w1") {
					id.WorkspaceID = "w1"
				} else if len(id.WorkspaceIDs) > 0 {
					id.WorkspaceID = id.WorkspaceIDs[0]
				}
			}
		}

		wsCtx, err := resolveWorkspaceCtx(id, r.Header.Get("x-workspace-id"), r.URL.Path, r.Method)
		if err != nil {
			writeErr(w, err)
			return
		}

		next.ServeHTTP(w, r.WithContext(withWorkspace(r.Context(), wsCtx)))
	}))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.isStandby() && !replicaWriteAllowedMethod(r.Method) {
			writeErr(w, apperr.Unavailable(apperr.ReplicaStandby, "当前实例为 standby，拒绝写入"))
			return
		}
		authGate.ServeHTTP(w, r)
	})
}

func envFlagTrue(key string) bool {
	v := strings.TrimSpace(os.Getenv(key))
	return v == "1" || strings.EqualFold(v, "true")
}

func envFlagFalse(key string) bool {
	v := strings.TrimSpace(os.Getenv(key))
	return v == "0" || strings.EqualFold(v, "false")
}

func productionLikeEnv() bool {
	// Dual-approval / production governance: DE_ENV=staging|production only.
	// DE_BAN_MOCK_TOKEN no longer implies production-like behavior.
	return runtimeenv.FromEnv().DualApproval()
}

// resolveWorkspaceCtx picks an allowed workspace from membership.
// If header is empty → identity.WorkspaceID (or first membership).
// If header is set but not in membership → hard 403 (cannot forge), except
// workspace-bootstrap routes (GET /api/workspaces) which soft-fallback so the
// client can recover a valid selection.
func resolveWorkspaceCtx(id *auth.Identity, headerWS, path, method string) (*WorkspaceCtx, error) {
	if id == nil {
		return nil, apperr.UnauthorizedErr("未登录")
	}
	allowed := id.WorkspaceIDs
	if len(allowed) == 0 && id.WorkspaceID != "" {
		allowed = []string{id.WorkspaceID}
	}
	if len(allowed) == 0 {
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "账号未绑定任何工作区")
	}

	ws := strings.TrimSpace(headerWS)
	if ws == "" {
		ws = id.WorkspaceID
	}
	if ws == "" {
		ws = preferredWorkspaceID(allowed)
	}
	ok := false
	for _, a := range allowed {
		if a == ws {
			ok = true
			break
		}
	}
	if !ok {
		if strings.TrimSpace(headerWS) != "" && !workspaceBootstrapPath(path, method) {
			return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权访问其他工作区资源")
		}
		ws = preferredWorkspaceID(allowed)
	}
	return &WorkspaceCtx{
		TenantID:    id.TenantID,
		WorkspaceID: ws,
		ActorID:     id.ID,
		Role:        id.Role,
	}, nil
}

func workspaceBootstrapPath(path, method string) bool {
	return method == http.MethodGet && path == "/api/workspaces"
}

func preferredWorkspaceID(allowed []string) string {
	for _, a := range allowed {
		if a == "w1" {
			return "w1"
		}
	}
	if len(allowed) > 0 {
		return allowed[0]
	}
	return ""
}

func (s *Server) workspaceID(r *http.Request) string {
	if ws := workspaceFrom(r.Context()); ws != nil && ws.WorkspaceID != "" {
		return ws.WorkspaceID
	}
	if id := identityFrom(r.Context()); id != nil && id.WorkspaceID != "" {
		return id.WorkspaceID
	}
	return "w1"
}

func (s *Server) requireWorkspaceAccess(id *auth.Identity, workspaceID string) error {
	if id == nil {
		return apperr.UnauthorizedErr("未登录")
	}
	for _, w := range id.WorkspaceIDs {
		if w == workspaceID {
			return nil
		}
	}
	if id.WorkspaceID != "" && id.WorkspaceID == workspaceID {
		return nil
	}
	return apperr.Forbidden(apperr.WorkspaceScope, "无权访问其他工作区资源")
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, x-workspace-id, x-tenant-id, x-mock-role, x-mock-actor, x-mock-user-id, x-mock-permissions")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
