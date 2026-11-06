# 企智搭 · 数字伙伴平台 — 功能模块文档

> **口径**：本目录只记录**本仓已实现并可验证**的能力。尚未落地的目标形态一律不写。
> **真相源**：[`../README.md`](../README.md) · [`frontend/web/src/App.tsx`](../frontend/web/src/App.tsx) · [`features/role-nav/role-nav.ts`](../frontend/web/src/features/role-nav/role-nav.ts) · [`backend/internal/server/server.go`](../backend/internal/server/server.go) 路由表 · [`backend/api/routes.md`](../backend/api/routes.md) · 各 `backend/internal/<pkg>/`

本目录按**每个功能模块一份文档**组织。本文是索引与通用约定；部署拓扑另见 [`backend/deploy/topology-split.md`](../backend/deploy/topology-split.md) 与 [`backend/README.md`](../backend/README.md)。

---

## 0. 阅读说明

### 0.1 实现度标记

| 标记 | 含义 |
|---|---|
| ✅ | 前端页面 + 后端路由齐备，可在默认栈（monolith + PG）上交互验证 |
| ◐ | 已实现但有明确边界（依赖外部服务时的降级行为等），边界就地注明 |

> 「◐」后的注解指出该模块的边界所在（如 RAG sidecar、Temporal、语义检索），详见各模块的「边界」小节。

### 0.2 角色与可见性

平台三个角色 `admin` / `user` / `auditor`，侧栏与页面可见性以 [`role-nav.ts`](../frontend/web/src/features/role-nav/role-nav.ts) 的 `ROLE_NAV` 为准，路由准入以 `App.tsx` 的 `<ProtectedRoute roles=[…] permission=…>` 为准。

| 角色 | 能力边界 |
|---|---|
| `admin` | 全量读写；发布审批可自批；计费与平台设置写面 |
| `user` | 协作 / 已授权伙伴 / 已发布能力；无模型、记忆、渠道、平台设置的入口与写权 |
| `auditor` | 广泛只读 + 审计导出；不参与决策与执行，但签署位仍可按策略参与高风险会签 |

> 权限的**服务端**实现是另一套：写路径经 [`internal/policy`](../backend/internal/policy/engine.go) 评估（`Decision{Allow, RequireDualSign}`），并叠加 [`internal/server/dual_approval.go`](../backend/internal/server/dual_approval.go) 的双签与 SoD 规则。前端守卫只是体验层，不是安全边界。

### 0.3 文档约定

- 各模块文档的「前端」路径相对 `frontend/web/src/`，「后端」路径相对 `backend/`
- 路由前缀以 `server.go` 的 `route()` switch 为准（当前 257 个路由分支、196 个路径）
- 每份模块文档结构统一为：**功能 → 前端 → 后端 → 调用链 → 落库集合总表 → 边界 → 关联模块**
- 「调用链」小节按能力逐条给出 **前端组件 → API 路由 → handler（文件:行）→ 校验 → 落库集合/表 → 错误码**

---

## 1. 模块地图

### 1.1 角色侧栏（真相源 `role-nav.ts`）

| 角色 | 分组 | 菜单项 |
|---|---|---|
| `user` | 运营 | 运营总览 |
| | 协作 | 专家协作 · 任务中心 |
| | 编排 | 数字伙伴 · 工作流程 |
| | 能力 | 知识中心 · 技能中心 |
| `admin` | 运营 | 运营总览 |
| | 协作 | 专家协作 · 任务中心 |
| | 编排 | 数字伙伴 · 工作流程 |
| | 能力 | 模型服务 · 知识中心 · 技能中心 · 记忆中心 · 消息渠道 |
| `auditor` | 审计 | 审计中心 · 持续验证 |
| | 核查 | 任务核查 · 协作记录 · 伙伴档案 · 流程版本 · 知识引用 · 技能权限 · 记忆策略 · 模型审计 |

> 侧栏文案按角色切换同一路由：`/partners` 在 `user`/`admin` 侧显示「数字伙伴」，在 `auditor` 侧显示「伙伴档案」；`/knowledge` → 「知识中心 / 知识检索 / 知识引用」，`/skills` → 「技能中心 / 技能清单 / 技能权限」，`/tasks` → 「任务中心 / 我的待办 / 任务核查」，`/copilot` → 「专家协作 / 协作记录」，`/memory` → 「记忆中心 / 记忆策略」，`/models` → 「模型服务 / 模型审计」。

### 1.2 模块一览

| ID | 模块 | 路由 | 后端前缀 | 实现度 | 文档 |
|---|---|---|---|---|---|
| M01 | 运营总览 | `/home` | `/api/home/*`、`/api/operations/overview` | ✅ | [M01-运营总览.md](./M01-运营总览.md) |
| M02 | 专家协作 | `/copilot` | `/api/copilot/*`、`/api/conversations/*`、`/api/model-invoke*` | ✅ ◐ RAG sidecar | [M02-专家协作.md](./M02-专家协作.md) |
| M03 | 任务中心 | `/tasks` | `/api/tasks/*`、`/api/scheduled-tasks/*` | ✅ | [M03-任务中心.md](./M03-任务中心.md) |
| M04 | 工作区 | `/workspaces` | `/api/workspaces/*` | ✅ | [M04-工作区.md](./M04-工作区.md) |
| M05 | 数字伙伴 | `/partners` | `/api/partners/*`、`/api/partner-*` | ✅ | [M05-数字伙伴.md](./M05-数字伙伴.md) |
| M06 | 工作流程 | `/workflows` | `/api/workflows/*`、`/api/workflow-templates/*`、`/api/workflow-skills/*` | ✅ ◐ Temporal 可选 | [M06-工作流程.md](./M06-工作流程.md) |
| M07 | 模型服务 | `/models` | `/api/model-providers/*`、`/api/model-routing/*`、`/api/models/*` | ✅ | [M07-模型服务.md](./M07-模型服务.md) |
| M08 | 知识中心 | `/knowledge` | `/api/knowledge/*` | ✅ ◐ 语义检索 | [M08-知识中心.md](./M08-知识中心.md) |
| M09 | 技能中心 | `/skills` | `/api/skills/*`、`/api/skill-integrations/*`、`/api/mcp-connections` | ✅ | [M09-技能中心.md](./M09-技能中心.md) |
| M10 | 记忆中心 | `/memory` | `/api/memory/*`、`/api/evolve/*` | ✅ | [M10-记忆中心.md](./M10-记忆中心.md) |
| M11 | 消息渠道 | `/channels` | `/api/channel-control/*`、`/api/channel/*/events/*` | ✅ | [M11-消息渠道.md](./M11-消息渠道.md) |
| M12 | 平台设置 | `/settings` | `/api/tenant/*`、`/api/billing/*`、`/api/backups/*`、`/api/api-keys`、`/api/webhooks-config` | ✅ | [M12-平台设置.md](./M12-平台设置.md) |
| M13 | 访问控制 | `/settings?tab=access` | `/api/access/*`、`/api/release-approvals/*` | ✅ | [M13-访问控制.md](./M13-访问控制.md) |
| M14 | 持续验证 | `/settings?tab=zeroTrust` | `/api/zero-trust/*` | ✅ | [M14-持续验证.md](./M14-持续验证.md) |
| M15 | 审计中心 | `/settings?tab=auditCenter` | `/api/audit-center*` | ✅ | [M15-审计中心.md](./M15-审计中心.md) |

**附录（跨模块）**

| 文档 | 内容 |
|---|---|
| [附录A-跨模块底座.md](./附录A-跨模块底座.md) | 工作区隔离 · 身份角色 · 双签 SoD · 沙箱 · 凭据 · 持久化 · 办公开箱装配明细 |
| [附录B-运行模式与本地起停.md](./附录B-运行模式与本地起停.md) | `QZDA_MODE` dev/pro 矩阵 · 冷启动 · 硬删除 · 岗位包 · 本地启动 |

> 旧「智能体市场」页与 `/agents`、`/digital-employees` 页面路由已移除；编排主路径仅为 `/partners`。`/api/agents*` 为只读遗留投影，前端主路径不依赖。

---

## 2. 端到端闭环

### 流程 A · 数字伙伴上岗

```text
岗位配置（职责 / 禁区 / 记忆策略）
  → 能力装配（仅各中心已发布版本）
  → 评测门禁（evaluate）
  → 发布审批（submit → approve；admin 自批 / 非 admin 他人批 / 高风险双签）
  → 上岗（release）→ 运行管理 / 记忆沉淀
  → 知识候选 → 知识中心审核入库
```

涉及模块：[M05 数字伙伴](./M05-数字伙伴.md) · [M13 访问控制](./M13-访问控制.md) · [M08 知识中心](./M08-知识中心.md) · [M10 记忆中心](./M10-记忆中心.md)

### 流程 B · 专家协作处置

```text
选中在岗伙伴 → 模型路由（policyLevel + riskLevel 下限）
  → 知识检索（bootstrap retrieve）→ ReAct 回合（≤10 步）
  → 工具调用（边界策略求交集）
  → 写操作：双签 + 零信任决策 → 落地
  → 任务中心跟进（可选）→ 渠道通知（可选）→ 审计关联 ID
```

涉及模块：[M02 专家协作](./M02-专家协作.md) · [M07 模型服务](./M07-模型服务.md) · [M08 知识中心](./M08-知识中心.md) · [M09 技能中心](./M09-技能中心.md) · [M13 访问控制](./M13-访问控制.md) · [M14 持续验证](./M14-持续验证.md) · [M03 任务中心](./M03-任务中心.md) · [M11 消息渠道](./M11-消息渠道.md) · [M15 审计中心](./M15-审计中心.md)

### 流程 C · 知识包上线

```text
建包（基本信息）→ 添加内容（上传 / 接入来源）
  → 加工处理（切片 / 建索引）→ 检索验证（召回质量）
  → 知识图谱（实体关系）→ 发布上线（版本供伙伴引用）
```

涉及模块：[M08 知识中心](./M08-知识中心.md) · [M05 数字伙伴](./M05-数字伙伴.md)

---

## 3. 文档维护约定

- 本目录是**已实现功能**的唯一说明，任何新增能力须先落地代码再回写对应模块文档
- 路由与前端结构的真相源是代码，不是文档；发现不一致时以代码为准并同步文档
- 「目标形态」「未来规划」不写入本目录。

---

## 4. 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v3.0 | 2026-07-12 | P1–P11；OpenSearch + Milvus；Go/Python 双栈描述 |
| v3.1 | 2026-08-01 | 对齐现仓：专家协作/数字伙伴/记忆/消息渠道；平台设置八 Tab |
| v3.2 | 2026-08-17 | `/partners` 唯一页面路由；侧栏四字对齐；M01 live-aggregate |
| v3.4 | 2026-08-20 | `QZDA_ENV` 矩阵；硬删 PersistDelete；岗位包工作区安装态 |
| v3.5 | 2026-08-20 | M02 Composer 档位；Postgres 仅 Docker |
| v3.6 | 2026-08-21 | 办公开箱知识×技能×流程 + `de-office` |
| **v4.0** | **2026-11-05** | **删除全部「目标能力 / 未来规划」段落，改为实现度标记；按代码真值重写各模块分区与 Tab；知识中心改为知识包中心口径；技能中心收敛为两 Tab；补齐跨模块底座与办公开箱装配明细** |
| **v4.1** | **2026-11-05** | **《环境与数据模式》已实现内容并入本文（模式矩阵 / 冷启动 / 硬删除 / 岗位包 / 办公开箱三件套）；《技术规格说明》《架构文档》《后端架构规划》《后端单进程方案》《视觉设计规范》与各模块整合方案一并退休** |
| **v4.2** | **2026-11-05** | **按模块拆分为独立文档：本 README 为索引与通用约定，M01–M15 各一份，跨模块内容归入附录 A / B** |
| **v4.3** | **2026-11-05** | **各模块文档升级为调用链级实现说明：每条能力标注「前端组件 → API 路由 → handler(文件:行) → 校验 → 落库集合/表 → 错误码」；补落库集合总表、模块编号口径勘误与 3 处实现缺口标注** |
| **v4.4** | **2026-11-05** | **逐条校验文档内 359 处「文件:行 → 符号」引用并全部修正（行号漂移 + 导出门面名 vs 实现名不符）；另扫描全部 444 处文件引用确认均在文件行数范围内；修正路由分支数（255→257）** |
| **v4.5** | **2026-11-05** | **验证阶段发现并修复 P0 自锁死：`memory.Service.IngestRuntimeMemory` 在调用方已持 `Store.Lock()` 时二次加锁，导致协作回合与任务流转请求挂死并阻塞全后端（回归于 `4f6b588`）。恢复 lock-free 变体 `IngestRuntimeMemoryLocked`；M02 / M03 补锁契约说明** |
| **v4.6** | **2026-11-05** | **审查并修复剩余问题：① 29 个 dev/pro 模式收敛后失效的 `internal/server` 用例（pro 模式禁 mock token → 改用签名 JWT；dev 模式保留 stub 回退的语义差异；工作区 publisher key 导入因 `ed25519.PublicKey` 断言失败而全量报错的运行时缺陷）；② 工作区 freeze / archive / transfer 补 `PersistCollection`；③ 运营告警改为「任务实时推导 + `home_alert_acks` 持久化确认」，修复首页「确认」按钮必然 404；④ M02 的包内测试路由夹具从生产文件迁出，生产只保留一份路由表** |

---

*功能模块文档 v4.6 · 只描述已实现能力 · 调用链级实现说明 · 模块事实以 `qizhida-partner-platform` 代码为准*
