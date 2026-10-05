# 契约缺口对照（Mock vs 控制面）

真相源：`frontend/packages/api/src/mock.ts` + 页面 `useApiQuery` 路径。  
目标：`VITE_USE_MOCK=false` 时首屏 GET 非 404，关键写路径语义与 Mock 一致。  
默认后端：**qzda-gateway :8089 → qzda-app :8100**（monolith 单进程,内含 sys / collab / cap / workflow 全部域逻辑）。

## P0（控制台主路径）— 已对齐

| FE / Mock | 状态 |
|-----------|------|
| `POST /api/auth/login` | OK |
| `GET /api/workspaces` 及子资源 | OK |
| `POST /api/workspaces` | OK（创建后并入 ActorExtraWorkspaces） |
| `POST /api/copilot/conversations/:id/stream` | OK（FE `useChat` 在 `VITE_USE_MOCK=false` 时接入 SSE） |
| `GET/PATCH /api/tenant/profile` | OK |
| `PATCH /api/notification-channels/:id` | OK |
| `POST /api/backups` | OK（申请备份） |
| `GET /api/access/governance` | OK |
| `GET /api/zero-trust/*` | OK |
| `GET /api/audit-center` | OK |
| `POST /api/home/alerts/:id/acknowledge` | OK（`/ack` 兼容） |
| `GET /api/partners*` + lifecycle/release/configuration | OK（简化校验） |
| `POST /api/tasks/:id/transition` | OK（`stage`） |
| Models 控制面（providers/routing/governance/audit）字段级 | OK（M0–M7：credential 别名、discover 形状、租户隔离、impact、failover、ModelAudit、预算门禁开关） |
| `GET /api/channel-control/*` | OK（P0–P3 字段级） |
| Channels：部署字段/策略状态机/死信 DeliveryAttempt/健康指标/模板预览 | OK |
| Channels 死信重投（`POST .../dead-letters/:id/replay`）+ FE 失败处置 | OK |
| `GET /api/sessions`、`/api/conversations/*` | OK |

## P1（能力页）— 最小集已挂载

| FE / Mock | 状态 |
|-----------|------|
| Knowledge 首屏 GET 全集 | OK（种子/空数组） |
| `POST /api/knowledge/docs` + `reindex` → RAG `/v1/ingest` | OK（最小闭环） |
| Workflows `:id`/versions/draft/publish/run | OK（试跑可调 runtime/rag） |
| Skills 全中心（见下表） | OK（P0–P3） |
| Skills 商店货源（builtin / registry sync / promote）+ scope/channel | OK |
| Memory 中心（overview/records/candidates/policy/audit） | OK（P0–P2） |
| Memory expire/candidate/approve→草稿知识包 + refinement 实跑 | OK |
| Memory TTL 调度 / 长期容量门禁 / 运行时写入钩子 | OK |
| Memory 运行时接线：Copilot 流式→短期记忆；任务 completed/review→工作记忆 | OK |
| Settings notification-channels / api-keys / webhooks-config | OK |

### Skills 中心对齐明细

| 能力 | 状态 |
|------|------|
| catalog / install / uninstall / lifecycle / upgrade / import | OK（持久化 + 工作区隔离） |
| governance overview/health + 详情 permissions/governance/runtime/impact/audit | OK |
| 供应链门禁（未签名 / 高危漏洞）+ 安装预检 checks | OK |
| 沙箱策略：熔断 / 限流 / 高危命令 / egress / 输出脱敏 | OK（PATCH 立即生效） |
| `POST .../test` → Mint RunToken → `qzda-sandbox`；不可达时 `QZDA_SANDBOX_TEST_SIM` 降级 | OK（生产建议 `QZDA_SANDBOX_TEST_SIM=0`） |
| `POST /api/skills/import-package`（`.skill`/`.zip`/`.tgz`，Agent Skills `SKILL.md`）落盘 + 沙箱执行 scripts | OK |
| `GET /api/skills/catalog` → `{ items, meta }`；`channel`/`syncedAt`/`visibilityScope`/`releaseChannel` | OK |
| `POST /api/skills/catalog/publish` 工作区晋升上架（审批/可见性） | OK |
| `POST /api/skills/catalog/sync` Registry 同步 + 签名/漏洞门禁 | OK |
| `POST /api/skills/execute` 无假成功 fallback | OK |

## 任务中心（ControlledTask）字段级 — P0–P3 已对齐

| FE / Mock | 状态 |
|-----------|------|
| `GET/POST /api/tasks` | OK（create 接受派工字段；list 工作区+user 可见范围） |
| `GET /api/tasks/:id` | OK（ensureTaskShape 补齐 links/auditEvents/version） |
| `GET /api/tasks/:id/audit` | OK（返回任务内 auditEvents，非占位） |
| `POST …/transition` | OK（lifecycle FSM + 审批/风险门禁） |
| `POST …/approve` | OK（`approved` bool；协办 accept/reject） |
| `POST …/takeover` / `retry` | OK（takeoverBy；仅 risk 可 retry） |
| `POST /api/conversations/:id/tasks` | OK（写入 `links.conversationId` + Persist） |
| `PATCH /api/tasks/:id` | OK（title/assignee/priority/tags + version） |
| Persist(`tasks`) | OK（全部写路径） |
| list `?stage&risk&assignee&q&priority&agent&approval&source&blocked&archived&limit&offset&paged` | OK |
| version 乐观锁 | OK（body.version 可选校验 → 409 E_TASK_VERSION） |
| 观测 `de_task_*` | OK（created/transition/approve/reject/takeover/retry/version_conflict） |

仍属后续（非阻塞内测）：
- 服务端强制分页默认（当前无 limit 仍返回全量数组以兼容 Home）
- FE 双请求（facets + filtered list）可合并为一次聚合响应

---

## 仍属后续（其他域）

- Agents 遗留运行时写路径（import/live calls/evaluations）——会话/任务记忆写入已接线 (`IngestRuntimeMemory`)
- Digital employee 配置边界的完整 Mock 校验规则
- SPIRE SDS / 真 runsc OCI / qzda-platform·collab 拆分
- Skills：真 Vault secretRef、生产 gVisor runsc、去掉本地 policy-sim
- 非 Models/Memory 域的字段级与 Mock 100% 一致（Models/Memory 已字段级对齐）

已推进：控制面持久化、生产禁密码登录、apps 镜像、OPA/OpenSearch、Authentik、观测基线、RunToken HMAC、SPIFFE、路径拆分网关、skill 隔离与策略供应链、**P3 staging**（`make compose-up-staging` + `.env.staging`）、写路径 `evaluateWrite`（release/employee/skill/workflow）、Copilot/审计失败指标与告警、数字伙伴配置/上岗门禁向 Mock 靠拢、**记忆中心 P0–P2**（approve→草稿知识包、TTL、容量门禁、refinement 实跑）、**qzda-policy / qzda-audit 退役并入 qzda-sys**（M10 前）、**M10 qzda-sys / qzda-collab / qzda-cap / qzda-workflow 折叠到 qzda-app 单进程**。

回归：`make test` 含 `TestPageSmokeGETs` / `TestEvaluateFailsIncompleteEmployee` / `TestSkillCenterP0|P1|P2|P3*` / `TestMemory*`。
