package server_test

// 集成测试 — 覆盖 §6.3 集成测试用例中尚未在
// auth_production_test.go / auth/http_test.go 验证的场景。
//
// 已覆盖的（详见各文件）:
//   I1   密码登录成功 (黑盒): auth_production_test.go::TestPasswordLoginAllowedWithEscapeHatch
//   I2   强制 OIDC 拒绝密码: auth_production_test.go::TestPasswordLoginBlockedWhenForceOIDC
//   I3   Ban mock 拒绝密码:  auth_production_test.go::TestPasswordLoginBlockedWhenBanMockWithoutAllow
//   I5   OIDC dev-code 回调: auth/http_test.go::TestOIDCCallbackStubCode
//   I7   mock token 被拒:   auth/http_test.go::TestMiddlewareRejectsMockTokenWhenBanMock
//
// 本文件补:
//   I4   OIDC 未配置时 /api/auth/oidc/login 返回 stub 元数据
//   I6   无 Authorization header 访问受保护路由返 401
//   I8   BanMock 时 x-mock-* 头被中间件拒
//   I1'  Login 默认 demo 环境返 mock-admin-token 字面量
//
// L1–L4（前端登出）不在本包;前端单测在 packages/api/src/*.mock.test.ts
// 已覆盖 login 调用,登出为客户端纯操作,无后端联调需求。
// L4（旧 token 复活）作为已知 gap,记录在 docs/整合方案/登录模块整合方案.md §八。

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// envelope mirrors {ok, data, error} used by pkg/response.
type envelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error *errBody        `json:"error,omitempty"`
}

type errBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// TestOIDCLoginStubWhenNotConfigured 覆盖 I4 —
// 未配置 QZDA_OIDC_ISSUER 时,/api/auth/oidc/login 必须返回
// {enabled: false, hint, stubCallback, state} 而非真实授权 URL。
func TestOIDCLoginStubWhenNotConfigured(t *testing.T) {
	t.Setenv("QZDA_OIDC_ISSUER", "")
	t.Setenv("QZDA_OIDC_CLIENT_ID", "")
	t.Setenv("QZDA_OIDC_CLIENT_SECRET", "")

	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/oidc/login?state=test-state", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	var env envelope
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("envelope parse: %v body=%s", err, rr.Body.String())
	}
	if !env.OK {
		t.Fatalf("want ok=true, got %+v", env)
	}
	var stub map[string]any
	if err := json.Unmarshal(env.Data, &stub); err != nil {
		t.Fatalf("data parse: %v raw=%s", err, string(env.Data))
	}
	if enabled, _ := stub["enabled"].(bool); enabled {
		t.Fatalf("want enabled=false, got %v", stub["enabled"])
	}
	if _, ok := stub["stubCallback"]; !ok {
		t.Fatalf("want stubCallback in stub payload, got keys=%v", keysOf(stub))
	}
	if _, ok := stub["state"]; !ok {
		t.Fatalf("want state in stub payload, got keys=%v", keysOf(stub))
	}
}

// TestProtectedRouteReturns401WithoutToken 覆盖 I6 —
// /api/workspaces 无 Authorization header 必须返 401 + 标准 error 包络。
func TestProtectedRouteReturns401WithoutToken(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	var env envelope
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("envelope parse: %v body=%s", err, rr.Body.String())
	}
	if env.OK {
		t.Fatalf("want ok=false, got %+v", env)
	}
	if env.Error == nil || env.Error.Code == "" {
		t.Fatalf("want non-empty error code, got %+v", env)
	}
}

// TestMockIdentityHeadersRejectedInPro 覆盖 I8 —
// QZDA_MODE=pro 时 x-mock-* 头被中间件拒为 401 (IdentityMockForbidden)。
// 这是身份伪造路径(不只 token 伪造)的关闭测试。
func TestMockIdentityHeadersRejectedInPro(t *testing.T) {
	t.Setenv("QZDA_MODE", "pro")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("x-mock-role", "admin")
	req.Header.Set("x-mock-user-id", "u1")
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
}

// TestLoginReturnsMockAdminTokenLiteral 守住行为契约 —
// 默认 dev 环境(QZDA_MODE 未设置)下 /api/auth/login 返 mock-admin-token,
// 整合后 token 字面量必须未变(下游 FE 烟雾测试依赖此字符串)。
func TestLoginReturnsMockAdminTokenLiteral(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"email":"admin@acme.com","password":"any"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	var env envelope
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("envelope parse: %v body=%s", err, rr.Body.String())
	}
	if !env.OK {
		t.Fatalf("want ok=true, got %+v", env)
	}
	var data map[string]any
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatalf("data parse: %v", err)
	}
	if tok, _ := data["token"].(string); tok != "mock-admin-token" {
		t.Fatalf("want mock-admin-token, got %q — mock token literal must be preserved", tok)
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
