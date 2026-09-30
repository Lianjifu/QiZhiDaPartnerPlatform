# Authentik（本地 OIDC）

轻量联调继续用 Dex（`make compose-up-oidc`）。需要接近生产的 IdP 时再用 Authentik。

## 启动

```bash
cd backend
make compose-up-authentik
# UI: http://127.0.0.1:9000
# 初始管理员: AUTHENTIK_BOOTSTRAP_EMAIL / AUTHENTIK_BOOTSTRAP_PASSWORD
#   默认 admin@acme.com / authentik
```

建议 Colima/Docker 内存 ≥ 6GB（Authentik + PG/Redis 较重）。

## 配置控制面 OAuth2 应用

1. 登录 Authentik Admin → **Applications** → **Providers** → **Create** → **OAuth2/OpenID Provider**
2. 名称：`qzda-platform`（历史名 `qzda-core` 可保留）；Redirect URI：`http://127.0.0.1:8089/api/auth/oidc/callback`
3. Client type：Confidential；记下 Client ID / Secret
4. **Applications** → Create，Slug 设为 `de`，绑定上述 Provider
5. 导出环境变量后启动栈：

```bash
export DE_OIDC_ISSUER=http://127.0.0.1:9000/application/o/de/
export DE_OIDC_CLIENT_ID=<client-id>
export DE_OIDC_CLIENT_SECRET=<client-secret>
export DE_OIDC_REDIRECT_URL=http://127.0.0.1:8089/api/auth/oidc/callback
export DE_FORCE_OIDC=1   # 可选：禁用密码登录
make compose-up-monolith   # 默认
# 或 make compose-up-coarse
```

浏览器打开：`http://127.0.0.1:8089/api/auth/oidc/login`

## Blueprint（可选）

`blueprints/qzda-core-oidc.yaml` 会尝试自动创建 Provider/Application（历史 Client ID=`qzda-core`，Secret=`qzda-core-secret`）。  
若版本字段不兼容，以 UI 手工配置为准；控制面已支持 Authentik discovery。
