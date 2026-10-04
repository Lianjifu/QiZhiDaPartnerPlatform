# Changelog

所有「未发布」的破坏性变更记录在本文档顶部。
发布后请将 `## Unreleased` 区块移入带日期的版本段落,并保留 git tag 可追溯。

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