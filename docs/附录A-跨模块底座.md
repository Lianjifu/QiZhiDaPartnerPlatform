# 附录 A · 跨模块底座

> 导航：[← 索引](./README.md) · [附录 B 运行模式与本地起停](./附录B-运行模式与本地起停.md)

以下能力横切全部模块，不属于任一单一模块，但被多个模块依赖。

---

## A.1 请求链路总览

```text
浏览器
  │  Authorization: Bearer <token>
  │  x-workspace-id: <ws>
  ▼
qzda-gateway :8089            Envoy（envoy.monolith.yaml）统一入口
  ▼
qzda-app :8100
  │  auth.Middleware.RequireAuth      认证 + 角色写门（internal/auth/middleware.go:62）
  │  server.route() 的 switch 分发      internal/server/server.go:751（255 分支 / 196 路径）
  ▼
internal/<模块>/               各模块 Service 门面（Store + Deps 函数字段）
  │  写路径：evaluateWriteLocked → policy.Engine.Evaluate
  ▼
store.Store                   内存集合 + RWMutex
  │  PersistCollection / PersistDelete
  ▼
Postgres 16（Docker only）
```

**响应信封**（`backend/pkg/response/`）：成功 `{ok:true, data}`，失败 `{ok:false, error:{code, message}}`。`response.OK` / `response.Created` / `response.Fail` / `response.Decode` 是唯一出口。

**错误码**：`backend/pkg/errors/errors.go` 定义 107 个 `E_*` 常量，构造器 `New` / `Forbidden` / `NotFoundErr` / `BadReq` / `Conflict` / `UnauthorizedErr` / `Unavailable`。

---

## A.2 认证与角色门

实现位置：`internal/auth/middleware.go`（`Middleware.RequireAuth`，`:62`）。

| 环节 | 行为 |
|---|---|
| 免鉴权路径 | `bypassPaths()`（健康检查、登录、分享链接、渠道 webhook）——**无 Identity 放行** |
| 缺凭证 | `Authorization` 头缺失 → `apperr.UnauthorizedErr("缺少认证凭证")` |
| mock 头拒绝 | 生产态出现 `x-mock-*` 头 → `apperr.IdentityMockForbidden`（401）；`mock-` 前缀 token 同理 |
| 令牌解析 | `m.Parse(token)` 失败 → `apperr.UnauthorizedErr("无效令牌")` |
| auditor 写门 | `id.Role == "auditor"` 且方法非 GET/HEAD/OPTIONS → `m.AuditorWriteGate` 判 403 |
| user 写门 | `id.Role == "user"` → `m.UserWriteGate` 判 403 |
| 产物下载特例 | `/api/skill-artifacts/*` 的 GET/HEAD：**有** Authorization 就解析 identity 供网关审计；**没有**不算 401，由网关策略 `QZDA_ARTIFACT_REQUIRE_AUTH` 决定 |

**权限矩阵**：`internal/auth/permissions.go:8` `RolePermissions` + `:36` `Has(id, "<resource>.<verb>")`。各模块自建 `requireXRead` / `requireXWrite` 助手（如 `internal/knowledge/helpers.go:87,96`、`internal/skills/handlers.go:14,20`），越权抛 `E_*_READ_FORBIDDEN` / `E_*_WRITE_FORBIDDEN`。

---

## A.3 写路径策略闸

入口：`internal/server/policy_write.go:20` `evaluateWriteLocked(r, resource, action, extra)`。

```text
evaluateWriteLocked
  ├─ identityFrom(ctx) == nil → apperr.UnauthorizedErr("未登录")
  ├─ 填入 ActorID / ActorRole / WorkspaceID / Resource / Action
  ├─ 仅当 action == "approve" 才填 ApproverID = 当前用户
  │    （若对 submit/release 也填，会与 SubmitterID 相同 → 误触发「提交人不可自批」）
  ├─ decidePolicy → policy.Engine.Evaluate
  ├─ 无论 allow / deny 都 AppendAudit("policy:"+action, resource, result, reason)
  └─ deny → apperr.Forbidden(apperr.RoleForbidden, reason)
```

**静态基线**（`internal/policy/remote.go:33` `evaluateLocal`）——6 条：

| PolicyID | 条件 | 结果 |
|---|---|---|
| `baseline.auditor_readonly` | auditor 且非读动作 | deny「审计角色只读」 |
| `baseline.restricted_egress` | `restricted` 数据 + 外部出口 + resource ∈ {model, channel} | deny「受限数据禁止外部出口」 |
| `baseline.sod` | action ∈ {approve, publish, release} 且 SubmitterID == ApproverID | deny「职责分离：提交人不可自批」+ `RequireDualSign` |
| `baseline.release_admin` | action ∈ {approve, publish, release} 且角色非 admin | deny「发布/批准需要管理员」+ `RequireDualSign` |
| `baseline.published_binding` | resource ∈ {employee_binding, capability} + action=bind + 未绑定已发布版本 | deny「仅可绑定已发布能力版本」 |
| `baseline.default_allow` | 其余 | allow |

**远端 OPA**：设 `QZDA_OPA_URL` 时改为 `POST {url}/v1/data/de/authz/result`，2 秒超时；**失败静默回退本地规则**（`remote.go:22-30`）。

**动态零信任**是第二层，由业务侧显式调用 `EvaluateZeroTrust(...)`，判定顺序见 [M14](./M14-持续验证.md)。两层互不替代，都要求 `Allow`。

---

## A.4 双签与职责分离

实现位置：`internal/server/dual_approval.go`。

| 函数 | 行 | 语义 |
|---|---|---|
| `requiresPeerApprovalGate` | `:17` | 生产态且非 admin → 需要他人会签 |
| `requireProductionDualApproval` | `:25` | 提交人 == 审批人 → `apperr.SODSelfApproval` |
| `highRiskNeedsCountersign` | `:47` | risk / dataClass ∈ {high, restricted, confidential, secret} → 需第二签名人 |
| `maybeHoldForCountersign` | `:63` | 记录首签人并置 `pending_countersign`；同一人二次签 → `SODSelfApproval` |

这四个函数在 `server.go:1578-1580 / 1713-1715 / 1782-1784 / 1858-1860` 以**函数字段**注入给 skills / copilot / tasks / partners 等模块复用——各模块的 `Deps` 里拿到的是同一套实现。

---

## A.5 持久化模型

`internal/store/persist.go` + `internal/infra/kv.go` + `internal/infra/kernel.go`。

### 三类存储目标

| 目标 | 写入入口 | 表 | 结构 |
|---|---|---|---|
| **KV 通用表** | `infra.KVStore.UpsertMany` / `ReplaceCollection` / `DeleteMany`（`kv.go:28,61,66`） | `platform.kv_documents` | `(collection, workspace_id, id, payload JSONB, updated_at)`，PK 前三列 |
| **Kernel 表** | `infra.KernelStore.UpsertCollection` / `DeleteMany` | `collab.sessions` · `collab.messages` · `collab.context_snapshots` · `cap.channel_inbound` | 由 `kernel.Owns(collection)` 判定（`kernel.go:58`） |
| **专用表** | 各自 sink | `platform.workspaces` · `platform.memberships` · `policy.decisions` · `audit.events` · `platform.usage_meters` · `rag_published_docs` · `memory_vectors` · `platform.auth_accounts` | 迁移 `0001`–`0006` |

### 写策略

| 集合类型 | 行为 |
|---|---|
| 默认 | **增量 upsert**（`kv.UpsertMany`） |
| `replaceOnPersist` | 整表替换（`kv.ReplaceCollection`）——目前只有 `channel_dlq`、`channel_audit`（`persist.go:16`），因为它们体积小、删除频繁 |
| `employees` | **专用串行化 hook**（`internal/apprun/run.go:195`）：所有写 `employees` 的 goroutine 共用一把 mutex，避免并发 DELETE-all + INSERT 把已删行复活 |
| Kernel 表 | 整表 upsert；删除同时清 legacy kv 副本（`apprun/run.go:183`） |

### DurableCollections 白名单

`internal/store/persist.go:27` 列出 51 个持久化 collection（`workspaces` / `model_providers` / `employees` / `tasks` / `knowledge_docs` / `skills` / `channel_deploys` / `release_approvals` / `zt_policies` / `access_grants` / `temp_auths` / …）。**不在白名单的集合只活在内存**（如 `zt_events`、`audits`、`knowledge_extra` 的部分键）。

### 硬删除纪律

多数集合是 Upsert——只改内存切片再 `Persist` **不会**删掉 PG 旧行。硬删路径必须调 `PersistDelete` / `PersistDeleteSync`（`persist.go:96,112`）；kernel 表走 `KernelStore.DeleteMany`。详见 [附录 B §19.8](./附录B-运行模式与本地起停.md#198-硬删除必须走-persistdelete)。

---

## A.6 审计写回

```text
业务代码 Store.AppendAudit(ws, actor, action, target, result, reason)
  ├─ 内存：前插 Store.Audits（store.go:318）
  └─ 触发 auditHook → server.go:1573 appendAuditSink
       └─ infra.AuditSink.Append → audit.events（infra/auditpg.go:19）
```

旁路审计：记忆 → `Store.MemoryAudits`；渠道 → `Store.ChannelAudit`；策略判定 → `Store.AppendAudit("policy:"+action, …)`。详见 [M15](./M15-审计中心.md)。

---

## A.7 技能沙箱

实现位置：`backend/services/qzda-sandbox/`（Python FastAPI，**独立进程** `:8093`）。

| 端点 | 用途 |
|---|---|
| `POST /v1/execute` | 执行技能脚本 |
| `GET /v1/artifacts/{name}` | 取产物 |
| `GET /healthz` · `/metrics` | 健康与指标 |

### fail-closed 纪律（`app/sandbox.py` · `app/sign_verify.py`）

| 约束 | 实现 |
|---|---|
| RunToken HMAC 密钥 | 三处查找：`QZDA_SANDBOX_RUN_SECRET_FILE`（Docker secrets mount）→ `QZDA_SANDBOX_RUN_SECRET` env → 硬编码默认值；**全缺则启动即抛 RuntimeError**（`sandbox.py:48-70`） |
| 硬编码占位密钥 | `qzda-skill-run-dev` 在生产**拒收** |
| 包签名 | `QZDA_SANDBOX_TRUSTED_KEY_IDS` 未设 → 全部 `signed_by` 判失败（`sign_verify.py:44`） |
| 解释器白名单 | `.js` / `.mjs` / `.ts` **直接拒绝**（返回 `unsupported_interpreter`），不回退到别的解释器（`sandbox.py:335`） |
| 产物 | 经 `/api/skill-artifacts/` 落库并可前端 inline 预览；输出按 `dataMaskingEnabled` 脱敏（`internal/skills/handlers_execute.go`） |

### 调用链

```text
copilot 工具调用 / 技能详情页「测试」
  → POST /api/skills/execute        internal/skills/handlers_execute.go:15
  → evaluateSkillSandboxPolicyLocked + EvaluateZeroTrust + EvaluateWrite
  → auth.MintRunToken(skillID, ws, actorID, egress, 5min)
  → POST qzda-sandbox:8093/v1/execute
  → maskSkillOutput → recordSkillInvocationLocked → SkillHealth / trends
```

---

## A.8 凭据与密钥

| 场景 | 存储 | 说明 |
|---|---|---|
| 供应商凭据（模型） | `Store.ModelSecrets` + Vault 优先 | AES-256-GCM 加密，`QZDA_CREDENTIAL_KEY`；`internal/secretbox` · `internal/vault` |
| 渠道凭据 | Vault `vault://channel-deployments/{id}/credential` | 不进 PG |
| 技能注册表凭据 | `credentialRef:"vault://registries/import-reader"` | 引用式，不落密文 |
| 工作区签名密钥 | `workspace_publisher_keys` collection | 创建 / 查询 / 轮换 / 吊销（`/api/workspaces/:id/publisher-key*`） |
| 沙箱 RunToken | HMAC 签名，5 分钟 TTL | 见 A.7 |

---

## A.9 办公开箱冷启动

实现位置：`backend/builtin/` + `internal/store/builtin_general.go`，由 `EnsureBuiltin*` 系列在启动时装载。

| 资产 | 路径 | 装载函数 | 数量 |
|---|---|---|---|
| 知识包 | `backend/builtin/knowledge/office/` | `EnsureBuiltinKnowledgeReady` | **10 个**（人事 3 / 行政 4 / 销售 2 / 市场 1），冷启动即 published |
| 流程模板 | `backend/builtin/workflows/` | `EnsureBuiltinWorkflowsReady` | **21 个**（办公通用 Certified 11 + 部门 Certified 9 + 高级库 1） |
| 办公岗位包 | `backend/services/qzda-sandbox/builtin/skills/manifest.json` | `EnsureBuiltinSkillsReady` | `office` 包 **9 个技能**（冷启动 autoInstall 到各工作区） |
| 出厂伙伴 | `internal/store/builtin_general.go` | `EnsureOfficeEmployee` | `de-office` × 1 |

### 出厂伙伴 `de-office` 的装配明细

| 维度 | 内容 |
|---|---|
| 岗位 | 办公通用 · 风险 `low` · 版本 `1.0.0` · 生命周期 `active` |
| 职责 | 制度问答 · 会议纪要 · 周报汇总 · 请假出差指引 · 文档审阅 |
| 禁区 | 未经审批的生产变更 · 替代财务正式报销入账 |
| 知识 | 10 个办公知识包（`kp.hr.*` / `kp.admin.*` / `kp.sales.*` / `kp.market.*`） |
| 技能 | `summarize` · `docx` · `pdf` · `pptx` · `spreadsheets` · `diagram-maker` + 3 个通用推理助手 |
| 流程 | 6 个办公流程（`wf.office.ask_policy` · `meeting_minutes` · `weekly_report` · `doc_review` · `leave_request` · `travel_request`） |
| 工具 | `knowledge.retrieve` · `memory.recall` · `skill.read` · `time.now` · `todo_write` · `ask_user_question` · `structured_output` |
| 边界模式 | 7 个 shell 工具（`bash` `write_file` `edit_file` `execute_code` `edit_notebook` `agent` `task_stop`）为 `approval_required`；其余为 `execute` |

---

## A.10 模块编号口径

代码包注释里的 M 编号是**历史遗留**，与产品侧编号存在冲突。以本目录与 `role-nav.ts` 为准：

| 包 | 包注释写的 | 实际产品编号 |
|---|---|---|
| `internal/knowledge` | M07 知识中心 | **M08 知识中心** |
| `internal/models` | M08 模型中心 | **M07 模型服务** |
| `internal/memory` | M07 记忆中心 | **M10 记忆中心** |
| `internal/skills` | M09 技能中心 | M09 技能中心 ✓ |
| `internal/partners` | M05 数字伙伴 | M05 数字伙伴 ✓ |

---

## 相关模块

[M05 数字伙伴](./M05-数字伙伴.md) · [M13 访问控制](./M13-访问控制.md) · [M14 持续验证](./M14-持续验证.md) · [M15 审计中心](./M15-审计中心.md) · [M09 技能中心](./M09-技能中心.md)（沙箱执行） · [附录B 运行模式](./附录B-运行模式与本地起停.md)
