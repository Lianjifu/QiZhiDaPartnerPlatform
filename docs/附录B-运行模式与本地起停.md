# 附录 B · 运行模式、数据与本地起停

> 导航：[← 索引](./README.md) · [附录 A 跨模块底座](./附录A-跨模块底座.md)

---

## B.1 三套环境

前端 `VITE_API_MODE` 与后端 `QZDA_MODE` 组合决定环境：

| 环境 | 前端 `VITE_API_MODE` | 后端 `QZDA_MODE` | 后端 | 说明 |
|---|---|---|---|---|
| **生产** | `api` | `pro` | 需要（PG；OIDC 可选） | 双人审批，禁 mock 身份与 mock token；真实账号登录（PBKDF2-SHA256）或企业 OIDC；供应商凭据 AES-256-GCM 加密入库（`QZDA_CREDENTIAL_KEY`），配置 Vault 时优先写入 Vault |
| **开发** | `api` | `dev` | 需要（PG，可选内存） | 本机联调，允许 mock 身份与 mock token |
| **演示** | `demo` | 不需要 | 无 | 浏览器内 mock，不请求任何后端 |

---

## B.2 后端总开关 `QZDA_MODE`

**唯一真相源**：`backend/internal/runtimeenv/env.go`（`FromEnv()` `:18`）。

```go
switch strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_MODE"))) {
case "", "dev":
    return ModeDev
default:
    return ModePro        // 拼错的值也 fail-closed 到 pro
}
```

`Mode` 上挂的行为开关（`env.go:29-57`）：

| 方法 | dev | pro | 语义 |
|---|---|---|---|
| `MemoryStore()` | `QZDA_DATA_BACKEND=memory` 时为真 | **恒假** | 是否走内存 store + ACME seed |
| `PersistEnabled()` | 非 memory 时真 | 真 | 是否持久化 |
| `AllowsMockIdentity()` | 真 | 假 | 是否接受 `x-mock-*` 头 |
| `BanMockToken()` | 假 | 真 | 是否拒绝 `mock-*-token` 并签发 JWT |
| `RequiresVault()` | 假 | 真 | 凭据是否必须写 Vault |
| `DualApproval()` | 假 | 真 | 是否启用 SoD / 双签闸 |
| `AutoProvisionsSkillKeys()` | 真 | 假 | 首次启动是否自动生成开发签名密钥对 |
| `EnsureGeneralEmployeeAllowed()` | 仅 memory | 假 | 是否种入内置通用员工 |

`QZDA_DATA_BACKEND` 只影响 dev；pro 忽略它，强制 Postgres。模式相关的单项覆盖开关（`QZDA_BAN_MOCK_TOKEN` / `QZDA_ALLOW_MOCK_IDENTITY` / `QZDA_FORCE_OIDC` / `QZDA_EMBEDDED_CHAT`）**已全部移除**，行为完全由 `QZDA_MODE` 决定。

---

## B.3 前端 API 模式

`VITE_API_MODE` = `api` | `demo`，默认 `api`；其他值在应用启动时报错。

| `VITE_API_MODE` | 请求去向 | mock 代码 |
|---|---|---|
| `api`（默认） | 真实网关（同源 `/api` → Vite proxy → `:8089`） | 不打包 |
| `demo` | 浏览器内 mock handler，不请求后端 | 动态加载 |

前端统一请求层：`frontend/web/src/services/query.ts` — `useApiQuery`（`:8`）/ `useApiMutation`（`:44`）/ `useApiUploadMutation`（`:77`），自动注入 `currentWorkspaceId`（默认 `w1`）到 `x-workspace-id`。

---

## B.4 部署拓扑

默认 **monolith**：`qzda-gateway:8089` → `qzda-app:8100`（sys + collab + cap + workflow 全域）+ `qzda-sandbox:8093`（必须独立）；`qzda-agent-runtime:8091` / `qzda-rag:8092` 按需。Temporal worker 可进程内启动（`QZDA_WORKFLOW_WORKER=1` + `QZDA_TEMPORAL_HOST`）。详见 [`backend/deploy/topology-split.md`](../backend/deploy/topology-split.md)。

| 进程 | 端口 | 技术栈 | 职责 |
|---|---|---|---|
| `qzda-gateway` | 8089 | Python 反向代理 | 统一入口；`/healthz` |
| `qzda-app` | 8100 | Go | 控制面全域（单进程 monolith） |
| `qzda-sandbox` | 8093 | Python FastAPI | 技能执行（**必须独立**） |
| `qzda-agent-runtime` | 8091 | Python | Agent sidecar，按需 |
| `qzda-rag` | 8092 | Python | RAG sidecar，按需 |

---

## B.5 启动

```bash
# 演示（前端浏览器内 mock，不请求后端）
cd frontend/web && npm run dev:demo

# 演示（后端内存，dev + memory，不写 PG）
cd backend && make run-demo

# 本机联调全栈（dev，PG 持久化）——仓库根，一条命令
# Docker 只跑 PG + Redis，gateway / 控制面 / 沙箱 / RAG / 前端跑宿主机进程（launchd 监管）
make run-app
# 或只重启、不重建
launchctl kickstart -k "gui/$(id -u)/com.qizhida.dev-stack"

# 改 Go 后必须重编再重启
cd backend && make build
launchctl kickstart -k "gui/$(id -u)/com.qizhida.dev-stack"

# 全 Docker 栈（形态 B：6 个容器全在 Docker）
cd backend && docker compose -f deploy/compose.yml up -d --build

# 生产（pro）
QZDA_MODE=pro docker compose -f backend/deploy/compose.yml up -d
```

**Postgres 只使用 Docker**：本机联调禁止再跑 Homebrew / 本机 Postgres——`QZDA_DATABASE_URL` 的 `127.0.0.1:5432` 必须指向 Compose 服务 `qzda-postgres`（`postgres:16-alpine`）。启动前执行 `bash scripts/dev-stack/ensure-docker-postgres.sh`（或 `cd backend && make infra-env`），脚本会停掉占用 5432 的 Homebrew Postgres、拉起 `qzda-postgres` 并校验版本为 16.x。

---

## B.6 账号管理（生产）

账号存放在 `platform.auth_accounts`（迁移 `0006_auth_accounts.sql`），密码以 PBKDF2-SHA256 哈希保存（`internal/auth/password.go`）。命令行管理时密码从 stdin 读取，不出现在命令行参数里：

```bash
printf '%s\n' "$PASSWORD" | QZDA_DATABASE_URL=... go run ./cmd/qzda-account add --email admin@corp.example --role admin --name "平台管理员"
printf '%s\n' "$PASSWORD" | QZDA_DATABASE_URL=... go run ./cmd/qzda-account set-password --email admin@corp.example
QZDA_DATABASE_URL=... go run ./cmd/qzda-account disable --email admin@corp.example
```

OIDC 需配置 `QZDA_OIDC_ISSUER` / `QZDA_OIDC_CLIENT_ID` / `QZDA_OIDC_CLIENT_SECRET`（实现见 `internal/auth/oidc.go` · `oidc_discovery.go`）；`QZDA_OIDC_REDIRECT_URL` 默认 `http://127.0.0.1:8010/login/oidc/callback`，需在 IdP 登记。演示环境不显示 OIDC 按钮。

---

## B.7 冷启动行为

PG 持久化模式下 `apprun` 使用 `store.NewEmpty()`，**禁止「空库 PersistNow(seed)」**。启动流程（`backend/internal/apprun/run.go`）：

| 步骤 | 位置 | 行为 |
|---|---|---|
| 建 schema | `run.go:138-140` | `infra.KernelStore.Ensure` 执行 kernel 建表 |
| 挂持久化钩子 | `run.go:168-188` | `SetPersistHook` / `SetDeleteHook`：kernel 集合走 `KernelStore`，`replaceOnPersist` 集合整表替换，其余增量 upsert |
| 串行化 employees | `run.go:195-204` | 专用 mutex，避免并发 DELETE-all + INSERT 复活已删行 |
| hydrate | `run.go:206+` | 逐集合读回 PG 行；kernel 集合有 kv fallback（`run.go:227`） |
| 稳定壳工作区 | — | 确保 `w1`（名称「默认工作区」）存在；即使库里已有自建工作区（如 `workspace-1`）仍补齐 `w1`，并按 owner/成员重建内存访问授权，避免重启后列表被 JWT 固定 `w1–w4` 滤空 |
| builtin 技能 | `EnsureBuiltinSkillsReady` | builtin 技能目录 + 各工作区 `autoInstall` 岗位包（`general` / `office`） |
| builtin 知识 | `EnsureBuiltinKnowledgeReady` | 办公开箱知识包 published |
| builtin 流程 | `EnsureBuiltinWorkflowsReady` | 出厂流程模板；个人模板 `wft-user-*` 不覆盖 |
| 内存态补充 | `EnsureGeneralEmployeeAllowed` | 仅 `dev + memory` 时补通用员工；`de-office` 随通用伙伴路径写入 |

---

## B.8 硬删除必须走 PersistDelete

多数集合是 **Upsert**，只改内存切片再 `Persist` **不会**删掉 PG 旧行。

| 需要硬删的路径 | 必须调用 |
|---|---|
| 会话 / 知识 / 模型供应商 / 渠道部署 / 技能卸载 / 个人流程模板（`workflow_templates`）等 | `Store.PersistDelete`（`persist.go:96`，异步）/ `PersistDeleteSync`（`:112`，同步） |
| kernel 表（`sessions` / `messages` / `context_snapshots` / `channel_inbound`） | `KernelStore.DeleteMany`（经 `SetDeleteHook` 分派，`apprun/run.go:178`） |
| 记忆记录 | **当前为软删**（`status=revoked`），不走硬删 |
| 环缓冲裁剪（`context_snapshots`、`channel_inbound`） | 对被挤出 id 调删除 |

`PersistDelete` 会先过滤空 id（`normalizeDeleteIDs`，`persist.go:123`）。

---

## B.9 工作区 Header 不可伪造

`x-workspace-id` 只能在身份已绑定成员集合内选择；显式传入未授权工作区返回 **403** `E_WORKSPACE_SCOPE`（空 Header 则回落默认 / 首选工作区）。

实现：`internal/server/context.go:201` `requireWorkspaceAccess`，在各模块写路径与资源引用处生效。

---

## B.10 联调期「演示 + 生产」混读的成因

两类常见误判：

1. **Network 里同一接口出现两次** —— React `StrictMode`（开发态）会故意双挂载，导致 `useApiQuery` 打两遍**同一个**真实网关；前端 `VITE_API_MODE=api`（默认）时只走 gateway，不存在「演示 + 生产」两套来源。
2. **单个接口响应里既有 ACME seed 又有真实数据** —— 历史版本曾用 `NewDemo()` + Persist 把演示数据写进 Postgres；切到 `dev`（PG）后只是不再**新灌** seed，但 **hydrate 会把库里已有行全部读回**。

清理残留：

```bash
psql "$QZDA_DATABASE_URL" -f backend/scripts/purge-demo-seed-ids.sql
# 或 cd backend && make db-reset-dev（危险：丢全部数据）
cd backend && make build
launchctl kickstart -k "gui/$(id -u)/com.qizhida.dev-stack"
```

---

## B.11 技能岗位包与平台工具

| 概念 | 说明 |
|---|---|
| **平台工具** | `manifest.platformTools`（如 `knowledge.retrieve`）；Go Harness **内置**，冷启动即用，**无需岗位包安装**，因此不出现在 `installed` 列表，只在 `platformTools` 清单中 |
| **通用岗位包** | 冷启动自动装到各工作区 |
| **办公岗位包** | 冷启动自动装 `office`（summarize / docx / pdf / pptx / spreadsheets / diagram-maker + 3 个通用推理助手） |
| **协作扩展 / 重依赖 / 全量** | 按需 `POST /api/skills/apply-pack/:id` 装到**当前工作区**；重依赖须审批单号 |

`GET /api/skills/packs` 按工作区返回 `installed` / `installedCount` / `missingSkills`，并附带 `platformTools` 清单；前端「平台工具 → 岗位包」据此显示「已安装」而非仅 toast。

---

## B.12 办公开箱三件套

| 资产 | 路径 | 说明 |
|------|------|------|
| 知识包 | `backend/builtin/knowledge/office/` | `kp.{hr,admin,sales,market}.*` 共 10 包（人事 3 / 行政 4 / 销售 2 / 市场 1），冷启动写入并 published |
| 流程模板 | `backend/builtin/workflows/` | `wf.office.*`（部门键 `office`）+ 部门审批 Certified + IT 高级库 |
| 场景三联 | `backend/builtin/scenarios/office/manifest.json` | 知识 · 技能 · 流程 ID 绑定 |
| 办公助手 | store 内置伙伴 `de-office` | 装配办公知识 / 技能，可在专家协作选用 |

控制台「工作流程 → 流程模板」：**平台内置 / 个人创建**分栏（个人模板支持存为模板与删除，`wft-user-*`）；部门筛默认 **办公通用**；选「全部」时统一平铺 + 分页；模板卡片展示来自场景三联的配套知识 / 技能标签。

---

## 相关模块

[M08 知识中心](./M08-知识中心.md) · [M09 技能中心](./M09-技能中心.md) · [M06 工作流程](./M06-工作流程.md) · [M04 工作区](./M04-工作区.md) · [M12 平台设置](./M12-平台设置.md) · [附录A 跨模块底座](./附录A-跨模块底座.md)
