# API 路由清单（对齐 Mock）

响应信封：`{ "ok": true, "data": ... }` / `{ "ok": false, "error": { "code", "message" } }`。

认证：`Authorization: Bearer <token>`；工作区：`x-workspace-id`。

## 地基 / 治理

| Method | Path |
|--------|------|
| POST | `/api/auth/login` |
| GET/POST | `/api/workspaces` |
| GET | `/api/workspaces/:id/{members,quota,…}` |
| GET | `/api/access/governance` |
| GET/PATCH | `/api/zero-trust/*` |
| GET | `/api/audit-center` |

## 数字伙伴 / 任务

| Method | Path |
|--------|------|
| GET/POST | `/api/digital-employees` |
| GET | `/api/digital-employees/overview` |
| POST | `/api/digital-employees/:id/{lifecycle,release,evaluate,configuration,…}` |
| GET/POST | `/api/tasks`、`/api/tasks/:id/transition` |

## 模型 / 渠道（Mock 命名）

| Method | Path |
|--------|------|
| GET/POST | `/api/model-providers` |
| POST | `/api/model-providers/discover-models` → `{ models:[{id,name}], source, suggestedProtocol, … }`（真实拉取） |
| POST | `/api/model-providers/test-connection` → `{ status:healthy, latencyMs }`（接入前探活，不落库） |
| GET | `/api/model-providers/:id/impact` |
| POST | `/api/model-providers/:id/{test,disable}` |
| PATCH/DELETE | `/api/model-providers/:id` |
| GET/POST | `/api/model-routing/policies` |
| PATCH | `/api/model-routing/policies/:id/draft` |
| POST | `/api/model-routing/policies/:id/{validate,publish,unpublish,rollback}` |
| GET | `/api/model-routing/policies/:id/versions` |
| POST | `/api/model-routing/failover-tests` → `{ fromModelId, toModelId, correlationId, status }` |
| GET | `/api/model-governance/overview`、`/api/model-audit` |
| GET/POST | `/api/channel-control/deployments`、`policies` |
| GET | `/api/channel-control/overview`、`dead-letters`、`audit`、`inbound` |
| POST | `/api/channel/feishu/events/:deploymentId`（公开：challenge / 验签 / 入站） |
| GET/POST | `/api/channel/wecom/events/:deploymentId`（公开：URL 验证 / 加解密入站） |
| POST | `/api/channel/dingtalk/events/:deploymentId`（公开：机器人 HTTP 回调验签） |

模型错误码：`E_PROVIDER_*`、`E_POLICY_*`、`E_BUDGET_EXCEEDED`、`E_EGRESS_BLOCKED`、`E_RATE_LIMITED` 等（见 `pkg/errors`）。

## 协作

| Method | Path |
|--------|------|
| GET/POST | `/api/sessions`、`/api/slash-commands` |
| GET/POST | `/api/conversations`、`/api/conversations/:id`、`…/stream`、`…/tasks`、`…/messages` |
| GET/POST | `/api/copilot/conversations`、`/api/copilot/conversations/:id`、`…/messages`、`…/stream`（SSE；Connect：`/connect/de.collab.v1.CollabService/*`） |
| POST | `/api/copilot/conversations/:id/messages/:mid/feedback`（点赞/点踩 → 自进化候选） |
| POST | `/api/actions/:id/approve`、`/api/actions/:id/execute`（双重审批 / 受控执行） |
| POST | `/api/model-invoke`、`/api/model-invoke/stream`（qzda-cap：按供应商凭据真实 LLM；Copilot SSE 经此调用） |

### Copilot SSE 事件（节选）

| event | 说明 |
|-------|------|
| `stage` | `memory` / `runtime` / `meter` 等；`memory` 可带 `provenance[{id,title,layer,score}]` |
| `route` | `mode`（direct/react/plan_exec/multi_agent）+ `policyLevel` / `policyId` |
| `agent` | 多智能体督导/委派/回执 |
| `plan` / `reflect` / `tool` / `delta` | 计划、反思、工具、增量文本 |
| `evolve` | Self-Evolution 候选（kind/status/title） |
| `done` | 含 `messageId`、`memoryProvenance`、`evolveCandidates` |

## 自进化 / 记忆治理

| Method | Path |
|--------|------|
| GET/POST | `/api/memory/*`（overview / records / candidates / refinement / policy / audit） |
| GET | `/api/evolve/candidates` |
| POST | `/api/evolve/candidates/:id/{approve,reject}`（`memory_promote` 单签；`skill_patch`/`routing_hint` 需 admin 首签 + auditor 会签；生效仅为工作记忆或 draft） |
| POST | `/api/evolve/dream/run`（短期→工作压缩；body 可选 `conversationId`） |

## 能力页最小集

| Method | Path |
|--------|------|
| GET | `/api/knowledge/{docs,packages,sources,governance,…}` |
| GET/POST | `/api/workflows`、`/api/workflows/:id/{draft,publish,run,versions}` |
| GET | `/api/skills`、`/api/skills/catalog`、`/api/skills/governance/overview` |
| GET | `/api/billing`、`/api/backups`、`/api/notification-channels`、`/api/api-keys`、`/api/webhooks-config` |
| POST | `/api/backups`、`/api/backups/:id/{approve,reject,restore-drill}`（双签 / 恢复演练） |
| GET | `/api/operations/overview`、`/api/home/kpis`（live-aggregate） |
| GET | `/metrics`（Prometheus 文本；OTel 桥后续） |

拆分与 mTLS 目标见 [`deploy/topology-split.md`](../deploy/topology-split.md)。  
**Monolith（方案 A）**：上述 sys/collab/cap 路由均由 **qzda-app:8100** 提供；网关 **8089** → `envoy.monolith.yaml`。  
详见 [`contract-gap.md`](contract-gap.md)。
