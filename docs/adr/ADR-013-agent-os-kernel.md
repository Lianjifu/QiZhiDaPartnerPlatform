# ADR-013 · Agent OS 内核边界与契约

- **状态**：已接受
- **日期**：2026-08-18
- **阶段**：4（规模化 · 生产最小闭环）
- **替代**：无；落实 [`docs/后端架构规划.md`](../后端架构规划.md) §8 / §9–§11

## 背景

现仓专家协作主路径跑在 **de-app monolith**（`ModeApp`，`:8100`）或 coarse 下的 **de-collab**（`copilotStream`）。历史上曾用 `de-core` 单体，已退役。图上 11 层能力已有代码切片，但 **ABI 未冻结**：Runtime IDL 仅为 `Invoke` 占位，入站渠道无统一 Envelope，Context 无法按 `correlationId` 重建，SSE 事件形状与 Connect 流式不完全一致。

阶段 0 冻结内核契约，使阶段 1（Session Routing / Snapshot / Replay）与阶段 2（拆 `de-agent-runtime`）共用同一套类型，禁止再长 REST 方言。

## 决策

### 1. 内核与控制面

| 归属 | 写服务（目标） | 阶段 0/1 落地 |
|---|---|---|
| Envelope · Session · Message · Task | de-collab | Go 单体模块，IDL = `de.collab.v1` |
| ContextSnapshot | de-collab（创建） / runtime（只读消费） | 回合结束落盘；Replay 只读 |
| MemoryRecord | de-memory | 现 `MemoryRecords` |
| RunRequest / LoopEvent | de-agent-runtime | IDL = `de.runtime.v1`；`DE_RUNTIME_MODE=local` 进程内 Go Harness，`remote` 走 sidecar `/v1/run` |
| PolicyDecision | de-policy | `evaluateZeroTrust` 返回值必须是四态枚举 |
| AuditEvent | de-audit | 每回合带同一 `correlationId` |

**硬约束（不可违背）：**

1. 业务真相源在 Go；AI 编排只在 Runtime / RAG / Skill Runtime。
2. 工作区/租户由服务端推导，不信任客户端伪造。
3. 凭据仅引用/掩码。
4. 生产写：审批 + SoD；auditor 只读。
5. 数字伙伴只引用已发布能力版本。
6. 长期记忆不得直接进入知识资产。
7. 不可信代码必须沙箱（阶段 2+）。
8. `api-gateway` ≠ `agent-gateway` ≠ `cap-model`（进程可暂合并，契约边界必须切开）。

### 2. 统一 Envelope

所有 Callers（Web SSE、OpenAPI、飞书/企微/钉钉 webhook）进入内核前必须规范化为 `de.common.v1.Envelope`：

`tenantId, workspaceId, actorId, channel, channelThreadId, sessionId, employeeId, correlationId, classification, sessionMode, riskLevel`

- `channel` 是 **入站 Caller 种类**（web / api / feishu / wecom / dingtalk），不是投递目录里的 `ChannelKind` 全集。
- `channelThreadId` 用于 Session Routing（如飞书 `chatId`）。
- `sessionMode` 仅 `investigate` | `execute`（线格式）；proto 枚举见 `SessionMode`。
- `riskLevel` 仅 `low` | `medium` | `high`。

### 3. ContextSnapshot

Builder 输出必须可落盘、可按 `correlationId` 重建 prompt。字段：

`id, correlationId, system, historyTurns, memoryProvenance[], ragHits, toolRegistry[], builtAt, employeeId, sessionMode`

Replay **禁止**再调用模型或工具；只返回 snapshot + 已落盘 Loop/SSE 事件摘要。

### 4. 流式事件

对外 SSE 与对内 Connect `StreamTurn` / `Runtime.Run` 共用事件类型词表：

`stage | delta | message_start | message_delta | message_done | tool | route | evidence | done | error`

同一 `correlationId` 下可通过 `message_start` / `message_delta` / `message_done` 产生多条 assistant 气泡；无 `messageId` 的 `delta` 保持单气泡兼容。

`done` 必须携带 `correlationId`；生产路径应携带 `snapshotId`。

### 5. PolicyDecision

零信任求值只允许：`allow | mask | approval_required | deny`。`deny` 映射 `E_ZERO_TRUST_DENY`，不得用自由文本代替枚举。

### 6. 错误码

机器码以 `E_*` 为唯一词表，定义在 `backend/pkg/errors` 与契约测试中。禁止各服务自造同义不同码。HTTP 映射：4xx 客户端/权限、409 冲突、429 限流、503 下游不可用。

### 7. 身份

生产默认拒绝 `x-mock-role` / `x-mock-user-id` 伪造与 `mock-*` token。判定顺序：

1. `DE_ALLOW_MOCK_IDENTITY=true` 逃生舱（仅联调）
2. `DE_ALLOW_MOCK_IDENTITY=false` 强制关闭
3. `DE_ENV` 为 `staging|production` → 双人审批等生产治理；`DE_BAN_MOCK_TOKEN` 仅禁用演示 token，不再单独触发生产审批
4. `DE_ENV=development`（默认）→ PG 真源、空库不灌 ACME seed；硬删须 `PersistDelete`（含 kernel sessions/messages/snapshots）
5. 其余本地默认允许演示身份（仅 `DE_ENV=demo` 或显式 `DE_ALLOW_DEMO_TOKEN`）

数据模式全文见 `docs/环境与数据模式.md`。

缺失有效身份 → `E_UNAUTHORIZED`。生产路径同时禁用 runtime stub（`DE_ALLOW_RUNTIME_STUB` 在生产信号下无效）。

## 阶段 1 落地（2026-08-18）

| 项 | 实现 |
|---|---|
| K4 Session Routing | 飞书 webhook：`workspaceId + feishu + chatId` 复用会话；文本入站走 `copilotStream` |
| K5 Snapshot / Replay | 回合落盘 `context_snapshots`；`GET /api/copilot/conversations/{id}/turns/{correlationId}/replay` 与 Connect `ReplayTurn` 只读 |
| K6 身份 | 生产拒绝 mock token / mock 头；`E_IDENTITY_MOCK_FORBIDDEN` |
| K3 硬拒绝 | 开 SSE 前求值 ZT；`deny` → `E_ZERO_TRUST_DENY`；生产禁用 runtime stub |

未纳入本切片：整库迁 PG（K1）、Context 独立模块化（K2）、企微完整入站。

## 阶段 2 落地（2026-08-18）

本切片是执行面生产最小闭环，**不**拆 16 个微服务、不把完整 ReAct 迁到 Python、不上 Milvus/gVisor 集群。

| 项 | 实现 |
|---|---|
| Runtime ABI | `copilotStream` 只经 `runRuntimeTurn` → `Runtime.Run`；Connect `RuntimeService/Run` 同源 |
| 双跑 | `DE_RUNTIME_MODE=local\|remote`（`sidecar`/`python` 视作 remote）；默认 local |
| local | 进程内 Go Harness（ReAct / Plan-Exec / 工具 / 技能） |
| remote | `POST {DE_AGENT_RUNTIME_URL}/v1/run`，消费 SSE LoopEvent；sidecar `done` 不转成 Copilot `type=done` |
| 失败 | remote 不可用 → `E_RUNTIME_UNAVAILABLE`；生产不 stub、不默默 failover |
| Failover | 仅 `DE_RUNTIME_FAILOVER_LOCAL=true` 且非生产时允许回落 local |
| 向量 RAG | 优先 `de-rag`；生产 sidecar 失败则关键词降级，SSE/REST `degraded` 仍返回 hits |
| 技能沙箱 | 生产关闭 `DE_SKILL_TEST_SIM`；runtime 不可达 → `E_RUNTIME_UNAVAILABLE` |
| Replay | 只读已落盘 snapshot/events，禁止再调 Runtime / LLM / 工具 |

未纳入本切片：完整工具循环迁 Python、Milvus 生产集群、gVisor 技能隔离集群。

## 阶段 3 落地（2026-08-18）

本切片是企业加固生产最小闭环，**不**拆微服务、不上 Temporal/Milvus/gVisor 生产集群、不做钉钉完整入站/会签/评测集门禁。

| 项 | 实现 |
|---|---|
| 企微 Session Routing | webhook 解密后按 `workspaceId + wecom + (ChatId 或 user:FromUserName)` 复用会话；文本入站走同一 `copilotStream` / Envelope；出站失败进 DLQ |
| 流程 → 技能 | 仅已发布且试运行成功的流程可 `publish-as-skill`；生产技能状态为 `pending_approval` |
| Temporal fail-closed | 配置了 `DE_TEMPORAL_HOST` 且生产 / `DE_TEMPORAL_FAIL_CLOSED` 时不可达 **不** 回落 local，映射 `E_RUNTIME_UNAVAILABLE` |
| 双人审批 | 生产上岗 / 路由发布 / 知识发布须 SoD（申请人不能自批）；备份恢复沿用既有 SoD |
| Vault | 生产 `resolveProviderCredential` 不回落 `ModelSecrets` 明文 |
| 用量硬门禁 | 生产默认开启；可用 `DE_MODEL_BUDGET_ENFORCE=0` 关闭 |
| 运营总览 | `governance` 补 `pendingEmployeeReleases` / `pendingRouting` / `pendingKnowledge` / `pendingWorkflowSkills`；无数则为 0 |

未纳入本切片：钉钉完整入站、会签、评测集门禁、真正 Temporal 集群。

## 阶段 4 落地（2026-08-18）

本切片是规模化生产最小闭环，**不**做 K8s 多区域主动-主动集群、不把 Slack 扩成入站 Caller（仍为投递渠道）、不会签推广到所有低风险写。

| 项 | 实现 |
|---|---|
| 钉钉 Session Routing | webhook 验签后按 `workspaceId + dingtalk + conversationId` 复用会话；文本走同一 `copilotStream` / Envelope；优先 `sessionWebhook` 回帖，失败进 DLQ |
| Slack | 保持投递目录 `ChannelKind`；**不是** Envelope 入站 Caller（契约 `INBOUND_CHANNEL_KINDS` 不含 slack） |
| 会签 | 生产高风险（`risk/classification/dataScope=high\|restricted\|confidential`）上岗/知识/**路由**：SoD 首签 → `pending_countersign` → 另一人副署；自进化 skill/routing 沿用 admin+auditor 会签 |
| 流程技能批准 | 生产 `publish-as-skill` 入 `pending_approval`；`POST /api/workflow-skills/:id/publish` 须 SoD（高风险会签）后 `lifecycleStatus=enabled` 才可装配 |
| 评测集门禁 | 生产知识发布须包级 `evaluations` 通过且 `recallAtK` ≥ `DE_EVAL_RECALL_MIN`（默认 0.7）；上岗评测分 ≥ `DE_EVAL_SCORE_MIN`（默认 80） |
| 自进化仅 draft | 批准后技能/路由只写 `draft`；生产申请人不能自批；不写 long_term / published |
| 多活最小集 | `DE_REPLICA_MODE=standby` 拒绝写（`E_REPLICA_STANDBY`）；`/healthz` `/readyz` 与运营总览露出 `instance` / `replicaRole` |

未纳入本切片：cn-east/south 双活集群、Slack inbound、会签工作流引擎、评测集独立服务。

## R5 横切进程与副本（2026-08-19）

Store 切开后允许把 Policy / Audit 从 sys 域 **拆成独立二进制**（`:8104` / `:8105`），**不是** 16 微服务。默认 monolith（de-app）与 coarse（de-sys）均在进程内吸收这两类路由；`DE_CROSSCUTTING_SPLIT=1` 时可拆开。

| 项 | 实现 |
|---|---|
| Policy / Audit 进程 | `cmd/de-policy` · `cmd/de-audit`；`DE_CROSSCUTTING_SPLIT=1` 时 sys 丢弃对应 OwnsPath / collections |
| Connect | `de.policy.v1` / `de.audit.v1` 挂在 policy、audit，以及吸收模式下的 sys |
| 多活 | `DE_REPLICA_MODE=standby` 拒写；standby 用 `DE_DATABASE_REPLICA_URL`；启动探测 `pg_is_in_recovery()` 为真则强制 standby。`/readyz` 露出 `postgresRecovery` |
| 隔离 | gVisor / Milvus 仍属 cap 后续层，**不阻塞** 本切片 |

未纳入：K8s 多区域主动-主动、Milvus/gVisor 生产集群。

## 后果

- 阶段 1 实现飞书 Session Routing、Snapshot 落盘、Replay API 时不得新增平行 DTO。
- 阶段 2 Collab 只发 `RunRequest`（含 ContextSnapshot）；Loop 只通过 `RuntimeService.Run` / `runRuntimeTurn`。remote 路径的 Python sidecar 当前是 LLM 直出 Loop（snapshot 已含 RAG/system），完整工具 dispatch 仍在 local Go。
- 前端专家协作只消费契约内 StreamEvent 字段；Mock 必须能被同一类型校验。

## 参考 IDL

- [`backend/api/proto/de/common/v1/common.proto`](../../backend/api/proto/de/common/v1/common.proto)
- [`backend/api/proto/de/collab/v1/collab.proto`](../../backend/api/proto/de/collab/v1/collab.proto)
- [`backend/api/proto/de/runtime/v1/runtime.proto`](../../backend/api/proto/de/runtime/v1/runtime.proto)
- [`backend/api/proto/de/policy/v1/policy.proto`](../../backend/api/proto/de/policy/v1/policy.proto)
