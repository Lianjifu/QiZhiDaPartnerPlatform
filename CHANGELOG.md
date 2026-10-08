# Changelog

所有「未发布」的破坏性变更记录在本文档顶部。
发布后请将 `## Unreleased` 区块移入带日期的版本段落,并保留 git tag 可追溯。

---

## Unreleased — 运行模式收敛为 `dev` / `pro` 与 `VITE_API_MODE`

> 破坏性变更：环境模式与 mock 开关统一为两种模式，单项覆盖开关全部移除。

- 后端：`QZDA_ENV`（`demo` / `development` / `staging` / `production`）替换为 `QZDA_MODE=dev|pro`，默认 `dev`；未知值按 `pro` 处理。
- 后端：新增 `QZDA_DATA_BACKEND=pg|memory`（仅 dev 生效，`memory` 为内存 + ACME seed，原 `QZDA_ENV=demo`）。
- 后端：删除 `QZDA_BAN_MOCK_TOKEN`、`QZDA_BAN_DEMO_TOKEN`、`QZDA_ALLOW_DEMO_TOKEN`、`QZDA_ALLOW_MOCK_IDENTITY`、`QZDA_ALLOW_DEMO_IDENTITY`、`QZDA_FORCE_OIDC`、`QZDA_ALLOW_PASSWORD_LOGIN`、`QZDA_REQUIRE_VAULT`、`QZDA_REQUIRE_SKILL_SIGNATURE`、`QZDA_FORCE_DEV_KEYPAIR`、`QZDA_BAN_DEV_KEYPAIR`、`QZDA_ALLOW_RUNTIME_STUB`、`QZDA_EMBEDDED_CHAT`、`QZDA_ENSURE_GENERAL`、`QZDA_TEMPORAL_FAIL_CLOSED`、`QZDA_OIDC_ALLOW_DEV_CODES`；行为由 `QZDA_MODE` 决定。`qzda-agent-runtime` 的 stub 同样跟随 `QZDA_MODE`，删除 `QZDA_ALLOW_RUNTIME_STUB`。
- 后端：skill 签名策略不再可关闭；dev 接受任意已信任 key，pro 要求工作区 key。
- 前端：`VITE_USE_DEMO` / `VITE_USE_MOCK` 替换为 `VITE_API_MODE=api|demo`（默认 `api`）；`api` 构建不再包含 mock 数据，`demo` 模式在渲染前动态加载 mock。
- 前端：删除未被引用的 `features/dashboard/mock.ts`；`@qzda/web-api` 不再 re-export mock 模块。
- 后端：pro 登录必须校验真实账号（`platform.auth_accounts`，PBKDF2-SHA256 哈希密码），角色来自账号记录；新增 `qzda-account` 命令管理账号。dev 仍不校验密码。
- 后端：OIDC 不再接受 `code=admin` 等开发码（非 dev 模式），userinfo 失败直接报错，不再伪造身份。
- 后端：pro 模式供应商凭据不再要求 Vault，改为 AES-256-GCM 加密后存入数据库（需配置 `QZDA_CREDENTIAL_KEY`），明文凭据在 pro 下不会被读取。
- 前端：登录页默认密码仅在开发态预填，生产构建不包含演示密码。

---

## Unreleased — 环境变量前缀重命名 `DE_*` → `QZDA_*`

> Brand phase 4 — 把上一轮刻意保留的 138 个 `DE_*` ops 命名空间环境变量统一
> 改成 `QZDA_*`, 与 `de-* → qzda-*` 服务前缀对齐。

### Breaking change（运维迁移清单）

- **138 个 env 变量批量改名**：`DE_ENV` → `QZDA_ENV`、`DE_ALLOW_MOCK_IDENTITY` → `QZDA_ALLOW_MOCK_IDENTITY`、`DE_BAN_MOCK_TOKEN` → `QZDA_BAN_MOCK_TOKEN`、`DE_REQUIRE_SKILL_SIGNATURE` → `QZDA_REQUIRE_SKILL_SIGNATURE`、`DE_SANDBOX_RUNTIME_URL` → `QZDA_SANDBOX_RUNTIME_URL`、`DE_RAG_URL` → `QZDA_RAG_URL`、`DE_COLLAB_URL` → `QZDA_COLLAB_URL`、`DE_TEMPORAL_HOST` → `QZDA_TEMPORAL_HOST`、`DE_COPILOT_*` → `QZDA_COPILOT_*`、`DE_LLM_*` → `QZDA_LLM_*`、`DE_OIDC_*` → `QZDA_OIDC_*`、`DE_SANDBOX_*` → `QZDA_SANDBOX_*`、`DE_BUILTIN_*` → `QZDA_BUILTIN_*` 等共 138 项（详见 `git diff HEAD~1 -- backend/internal` 完整列表）。
- **覆盖范围**：`backend/internal/**/*.go`（139 文件）+ `backend/services/**/*.py`（38 文件）+ `scripts/dev-stack/*.sh`（3 文件）+ `backend/Makefile` / `Dockerfile` / `services/*/Dockerfile` + `backend/deploy/compose.yml` / `.env*` + `~/Library/LaunchAgents/com.qizhida.dev-stack.plist`。
- **未变更**：`backend/deploy/MIGRATION-de-to-qzda.md` 不改（历史记录）、`CHANGELOG.md` 旧条目不改（历史记录）、`backend/gen/qzda/**/*.pb.go` 不改（protobuf 自动生成，无 env 变量）、`backend/internal/auth/env.go` 的 `BanMockToken()` / `ForceOIDCLogin()` 等函数名（这些是 Go 标识符，与 env 变量解耦）。

### 运维部署

- `scripts/dev-stack/restart-stack.sh restart` 一次拉起即可，新 keeper 已自动从 `./keeper.log` 读取新 `QZDA_*` 变量。
- 生产 / staging 在 K8s ConfigMap / Helm values / systemd unit 里把 `DE_*` → `QZDA_*` 同名映射即可，无需重新理解语义。

### 验证

- `go build ./...` 通过（v1.5 后端在 env rename 后首轮完整编译通过）
- `scripts/dev-stack/restart-stack.sh restart` 后 `:8089 :8100 :8010` 三端口 200，`/api/auth/login` → `/api/skills` 端到端通。

---

## Unreleased — 品牌标识：咬合方块 VI

> 图形标改为紫橙圆角方块层叠咬合；顶栏字标上下排列；登录页白底锁合；README 收录标识资产。

## Unreleased — 品牌升级:数字工作伙伴平台 → 企智搭 · 数字伙伴平台

> Brand refactor: Digital Work Partner Platform → QiZhiDa · PartnerPlatform (企智搭 · 数字伙伴平台)
>
> 三阶段独立提交,可独立 `git revert`:
> - Phase 1 (`bff4946`) — 品牌文案
> - Phase 2 (`1fd8c65`) — 代码标识(Go module、proto、Go 类型、HTTP 路径、JSON 字段、npm name)
> - Phase 3 (`e978e14`) — 服务前缀 + infra(`de-*` → `qzda-*`、compose、envoy、Prometheus、SPIFFE、cert、OIDC、LaunchAgent)

## Unreleased — M02 专家协作 全页重构（企业级多轮对话）

> `/copilot` 页面按企业级多轮对话硬标准重构：消息变体、消息级生命周期、工具实时进度、上下文透明、每消息审计/回放、会话批量操作。

### 面向用户 / 终端使用者

- **消息变体可见**：regenerate 不再原地替换消息，而是插入变体兄弟节点。前端助手消息头部新增 `← 变体 i/N →` 切换 UI；通过 `GET /api/copilot/conversations/{cid}/messages/{mid}/variants` + `POST .../branch-active` 浏览与切换活跃变体。
- **消息级生命周期**：消息状态 `pending / in_flight / streaming / succeeded / failed / cancelled / expired / moderated` 内联在气泡头部；失败可点徽重试。
- **工具实时进度**：每条 tool call 改为 live 卡片，pending 时显示 spinner + 单 call 取消按钮；`done / error` 显示耗时 / 错误详情。

### 面向开发者 / API

- 后端新增：
  - `GET  /api/copilot/conversations/{cid}/messages/{mid}/variants` — 变体兄弟列表
  - `POST /api/copilot/conversations/{cid}/messages/{mid}/branch-active` body `{variantId}` — 切换活跃变体
  - `POST /api/sessions/bulk-archive` body `{ids: []string}` — 批量归档
  - `POST /api/sessions/bulk-export`  body `{ids, format: "json"|"md"}` — 批量导出
  - `DELETE /api/sessions/bulk` body `{ids}` — 批量硬删（连同消息切片）
- 流请求体新增可选字段 `branchFromMessageId`：非空时把本轮回答插入到指定消息的变体兄弟组，而不是产生新变体组根。
- 助手消息 map 增字段：`parentMessageId` / `branchIndex` / `isActive` / `variantsGroupId` / `auditEventId`（详见 `backend/api/models-contract.md`）。

### 面向运维 / 集成方

无破坏性变更；旧调用方未传 `branchFromMessageId` 时行为与重构前一致（旧消息继续作为变体组根，`isActive=true`、`branchIndex=0`）。

## Unreleased — M10 单进程折叠

> **qzda-sys / qzda-collab / qzda-cap / qzda-workflow 折叠到 qzda-app 单进程**
>
> - 删除 4 个 Go 进程二进制及其配套 `services/qzda-{sys,collab,cap,workflow}/` 脚手架、`deploy/qzda-{sys,collab,cap,workflow}/` Docker、`scripts/dev-stack/gateway-proxy.py`、`backend/deploy/envoy/envoy.coarse.yaml`
> - `ServiceMode` 收为单一 `ModeApp`（`ModeAll` 仅测试用），`Domain` 收为单一 `DomainAll`，`CanWrite` / `ownsCollabRuntime` / `ownsCapRuntime` 永远返回 true
> - 删除 `DE_COLLAB_URL` / `DE_CAP_URL` / `DE_WORKFLOW_URL` 跨进程 catalog fetch，直接读本地 store
> - Temporal worker 折叠进 `cmd/qzda-app/main.go`，由 `DE_WORKFLOW_WORKER=1 DE_TEMPORAL_HOST=...` 启用
> - 文档同步：`docs/后端微服务重构方案.md` → `docs/后端单进程方案.md`、`backend/deploy/topology-split.md` 重写、`backend/README.md` / `README.md` / `backend/deploy/README.md` / `backend/deploy/.env.example` / `backend/deploy/obs/prometheus.yml` / `backend/deploy/certs/generate.sh` / `backend/deploy/spiffe/README.md` / `backend/deploy/networks.md` / `backend/services/*/SERVICE.md` / `backend/services/qzda-sandbox/docs/operations.md` / `backend/api/*.md` / `docs/后端架构规划.md` / `docs/数字伙伴平台-架构文档.md` / `docs/数字伙伴平台-功能模块文档.md` / `docs/整合方案/*.md` 同步
> - 保留：`qzda-app` 单进程 + `qzda-sandbox`（必须独立）+ 可选 `qzda-agent-runtime` / `qzda-rag` sidecar + `qzda-gateway` Envoy
> - 退役：`qzda-sys:8100` / `qzda-collab:8101` / `qzda-cap:8102` / `qzda-workflow:8103` 四进程

### 面向用户 / 终端使用者

- 控制台顶部品牌 Logo / 主标题 / 系统提示词已统一为「企智搭 · 数字伙伴平台」(`数字工作伙伴平台` → `数字伙伴平台`)。
- 数字工作伙伴实体改称「**数字伙伴**」,模型层 `DigitalEmployee*` → `DigitalPartner*`。
- HTTP API 路径 `/api/digital-employees/*` → `/api/partners/*`(前端同步,无 consumer 改造)。

### 面向运维 / 集成方 — 需在下一个发版窗口处理,详见 `backend/deploy/MIGRATION-de-to-qzda.md`

- **OIDC client_id `de-core` → `qzda-core`**(在 Authentik / Dex / Okta / Keycloak 等 IdP 中 rename 或重新签发)。
- **Kafka / 事件 Proto 包名 `de.audit.v1` / `de.collab.v1` / `de.policy.v1` / `de.platform.v1` / `de.rag.v1` / `de.runtime.v1` / `de.partner.v1` → `qzda.*`**(下游消费者需滚动前滚)。
- **SPIFFE trust domain `de.local` → `qzda.local`**(联邦 SPIRE bundle / federation 关系需重新协商)。
- **LaunchAgent label `com.digital-employee.dev-stack` → `com.qizhida.dev-stack`**(本地 `~/Library/LaunchAgents/` 仓库外迁移,已完成)。
- **Docker 资源命名**:容器名 / 镜像名 / 网络 (`de_net` → `qzda_net`) / 卷 (`de_pg`、`de_redis`、`de_milvus_*`、`de_opensearch`、`de_prometheus`、`de_grafana`、`de_authentik_*`) 已全部迁移到 `qzda_*`。升级到新版本前请执行 `docker compose down -v && docker volume prune -f`,避免旧 `de_*` 卷与新 `qzda_*` 冲突。

### 未变更(刻意保留)

- `DE_*` 环境变量(121 个)— ops / config 命名空间,与品牌无强耦合。
- 数据库名 `digital_employee`、数据库角色 `de` — 单独 ops 迁移排期,与品牌无关。
- Mock partner ID(`de-office` / `de-it` / `de-sre` / `de-qa` 等)— 领域语义,非品牌。