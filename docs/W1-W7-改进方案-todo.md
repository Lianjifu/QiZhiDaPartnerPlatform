# 7 周改进方案 — 实施进度总览（Todo 清单）

> **生成日期**：2026-09-08
> **状态**：审计快照（4 路并发审查）
> **口径**：后端 = 已合并到 `main` 的代码；前端 = `frontend/web/src` + `frontend/packages/*`；横切 = ADR / 手册 / 指标 / 权限 / CI / env flag。
> **下一步**：按本文 `P0` 段落地，每完成一段把 `[ ]` 改为 `[x]` 并写 commit 哈希。

## 0. 总览

| 段 | 项数 | ✅ 完成 | 🟡 部分 | ⚪ 未做 | 完成率 |
|----|----:|------:|------:|------:|-----:|
| 后端 W1（Skill Vetter / Gateway 硬墙 / Catalog / DS） | 4 | 3 | 1 | 0 | 75% |
| 后端 W2（SubAgent / 3-列 / Vault） | 3 | 3 | 0 | 0 | 100% |
| 后端 W3（ExpertInbox / HotReload / Preview） | 3 | 2 | 1 | 0 | 67% |
| 后端 W4（Heartbeat / VisualDiff） | 2 | 2 | 0 | 0 | 100% |
| 后端 W5（SelfImproving / Multimodal） | 2 | 2 | 0 | 0 | 100% |
| 后端 W6（PM SOP / Canvas） | 2 | 1 | 1 | 0 | 50% |
| 后端 W7（SQLite / WeChat-Sync） | 2 | 1 | 1 | 0 | 50% |
| 前端 9 项 | 9 | 9 | 0 | 0 | 100% |
| 横切（ADR × 16 / 手册 × 8 / 指标 × 10 / 权限 × 4 / env × 11 / CI × 3） | ~52 | 52 | 0 | 0 | 100% |
| **合计** | **83** | **79** | **4** | **0** | **95%** |

**关键结论**（2026-09-08，审计后修正）：
- W1（Skill 安全）：D1 vetter ✅ + D3 gateway ✅ + D4 catalog ✅ + **D2 签名 🟡**（证据字段含 phantom `cmd/check-skill`） — 3 ✅ + 1 🟡
- W2（Agent OS）：**D1 publisher key ✅ + D2 vault ✅ + D3 subagent ✅**（3 项实现均完整，证据列已补齐边界测试：revoke / cross-workspace / 4-trust-tier / vault cache hit / 引擎 cancel-panic-timeout） — **3 ✅ + 0 🟡**
- W3（ExpertInbox / HotReload / Preview）：**D1 expert-inbox 🟡**（实现路径实为 `handlers_expert_inbox.go`，非独立包） + D2 ✅ + D3 ✅ — 2 ✅ + 1 🟡
- W4（Heartbeat / VisualDiff）：D1 + D2 — 2/2 ✅
- W5（SelfImproving / Multimodal）：D1 + D2 — 2/2 ✅
- W6（PM SOP / Canvas）：**D1 PM SOP 🟡**（集成测实际 7 个，原文档误记 8） + D2 ✅ — 1 ✅ + 1 🟡
- W7（SQLite / WeChat）：D1 ✅ + **D2 WeChat 🟡**（包测实际 20 个，原文档误记 22；无 `handlers_weixin_test.go`，端到端仅 `m4_execution_test.go` 间接覆盖） — 1 ✅ + 1 🟡
- 前端：FE-1..FE-9 ✅ — **9 ✅ + 0 🟡**（FE-8 Workflow Canvas 已完成：react-flow `features/workflow-canvas/` + 后端 workflow endpoints，commits `21a0e74` + `b309c31`）
- 横切：ADR × 16 ✅ + 手册 × 8 ✅ + 指标 × 10 ✅ + 权限 × 4 ✅ + env × 11 ✅ + CI × 3 ✅ — 52 ✅
- 性能 / 可靠性硬化：P1-1 cancel/Shutdown + P1-2 panic recover + P1-3 close 注册 + P1-4 Kafka 注入 — 6 commits ✅（见 §11）；外加本轮补的 **2 个 close 尾巴**：`infra.OpenSearchAudit.Close()` (`10731fe`) + `Store.Close()` 幂等 drain (`8d175e5`)
- 「已知小事项」收尾：`deprecation` 注释 3 处（`approveActionLegacy` / `StampLegacy` / `KnowledgeGraphCanvasLegacy`）+ docs typo 5 处（Gague→Gauge / `<8MB`→`<8 MB` / 重复 `## 2.`→`## 5.` + cascading / ADR-025→ADR-032 / ADR-027→ADR-035） — commit `6fc378c`
- 合计 **95%** 完成（79 ✅ / 4 🟡 / 0 ⚪ = 83 项；上一档 90% → 95% ≈ 收 4 ⚪ + W2 段全部 ✅ 后的稳定态）；剩余 **4 项 🟡** 均为「证据 / 计数澄清」类（phantom path / 实际测试数 vs 文档数），无功能缺口

---

## 1. 后端 — W1（Skill 安全）

| ID | 项 | 状态 | 证据 / 缺口 | 下一步 |
|---|---|---|---|---|
| W1-D1 | Skill Vetter（内容危险模式） | ✅ 完成 | `internal/skills/vetter/` 已联通 builtin + import 两条 server 路径（`builtin_skills.go:296`、`handlers_skills_package.go:38`），正确排序在 signer 之前；audit 行写入（denied / warn / allow=无）；`cmd/verify-skill --vet=strict` CLI parity；`internal/server/skill_vetter_integration_test.go` 3 个集成测试；`cmd/check_skill/` 已清理 |
| W1-D2 | Skill 签名（ed25519 + trust store） | ✅ 完成 | `signing/keystore.go`、`signing/canonical.go`、`signing/signer.go`、`cmd/sign-skill`、`cmd/verify-skill`、`hard_delete_persist_test.go`；13+ 测试通过 | — |
| W1-D3 | Gateway 硬墙（SSRF / path traversal / size / mime） | ✅ 完成 | `internal/gateway/artifact_gateway.go` + `artifact_gateway_test.go`（11 个测试）；3 个 handler 路由改造 `serveSkillArtifact` / `serveSkillArtifactPreview` / `serveSkillArtifactSlidePNG`；env `DE_ARTIFACT_MAX_BYTES`（默认 100 MB）/`DE_ARTIFACT_REQUIRE_AUTH`（默认 true）；ext 白名单放在 stat 前避免 404 vs 415 信息泄漏；2 个 commit (`fcee0c7`, `e0d3edc`) | ADR-019 ✅（[ADR-019](../adr/ADR-019-gateway-hardening.md)） |
| W1-D4 | Catalog / DS 数据源契约 | ✅ 完成 | 新 `internal/catalog/`：`Option{ID,Name,Meta,Kind}` + `Section map[Kind][]Option` + `Source{Kind,Fetch(ctx,ws)}` 接口 + `Registry{Assemble, FailOpen}` + 纯函数 `MergeOptions` + `StaticSource`（内存 / Web channel 注入）；`Section` 空 kind 仍为非 nil 空 slice；workspace 隔离 = source 责任；fail-open / fail-closed + ctx 取消语义 | ADR-036 + 10 个 contract 测试（跨源合并 / workspace / ctx 传递 / fail-mode / 空 Name / SortedNames 确定性） |

**W1 退出门槛**：CI `make skill-gate` 已入库（`.github/workflows/skill-gate.yml`）；34 builtin skills 全过。

---

## 2. 后端 — W2（Agent OS 多 Agent + Vault）

| ID | 项 | 状态 | 证据 / 缺口 | 下一步 |
|---|---|---|---|---|
| W2-D1 | Workspace Publisher Key（per-workspace Ed25519 + sidecar） | ✅ 完成 | commit `9ecc607`；`handlers_workspaces_publisher*.go`、`cmd/sign-skill-pack`；sidecar 解析内联于 `handlers_workspaces_publisher.go` + `skill_package.go`（无独立 `parse_sidecar.go` 文件）；22 个测试（含 revoke / cross-workspace / 4-trust-tier 解析 / 归档 roundtrip）；4-trust-tier `workspace-active`/`workspace-rotated`/`global`/`dev-auto`；policy `any`/`workspace`/`off` | — |
| W2-D2 | Vault 集成（dev keypair / 私钥 / 模型凭据） | ✅ 完成 | `signing.SignerResolver` 接口（`Signer/TrustedKey/BackedByVault`）+ `signing.VaultKeyStore`（`vault:skill-keys/<keyID>` 路径，base64 私钥，本地缓存）+ `vault.Client.PutMap/ResolveMap` 批量；VaultKeyStore / SignerResolver 定义在 `signing/keystore.go`（非 `vault_keystore.go`；测试文件 `vault_keystore_test.go`）；`Server.SkillSigner` slot + `bootstrapVaultSkillSigning()`（`DE_VAULT_ADDR` + `DE_SKILL_KEYSTORE=vault` 启用，probe 失败回退 dev）；11 个新测试；commit `217924c`；ADR-021 已出 | — |
| W2-D3 | SubAgent（多 Agent 委派 / merge opinions） | ✅ 完成 | `internal/agentos/subagent.go`（Engine / Task / Run 全部内联于此，**无独立 `engine.go` 文件**）：`Engine{MaxConc, DefaultTimeout, OnMetric}` + `Run(ctx, tasks []Task)`；semaphore 限并发 + per-task `context.WithTimeout` + panic-recover 转 `failed/panic_recovered` + 父 ctx 取消传播；`mergeParticipantOpinions` 保留为线性拼接策略；`metrics.SubAgentBuckets` + scrape 输出 `de_subagent_run_seconds_sum/count/avg` + `de_subagent_run_total{status}`；env `DE_SUBAGENT_MAX_CONCURRENCY`（默认 4） | ADR-022 + 11 包测（concurrency bounded / panic recovered / timeout / parent cancel / fn error / onMetric）；既有 `dispatchParticipants` / `mergeParticipantOpinions` 测试 100% 兼容 |

---

## 3. 后端 — W3（ExpertInbox / HotReload / Preview）

| ID | 项 | 状态 | 证据 / 缺口 | 下一步 |
|---|---|---|---|---|
| W3-D1 | ExpertInbox（邮件 / IM 类聚合） | 🟡 部分 | store 加 `ExpertInbox []map[string]any`，路由 `GET /api/expert-inbox` + `POST /api/expert-inbox/:id/review` + `POST /api/expert-inbox`；状态机 `pending → approved/rejected/dismissed`；workspace 隔离；audit 行；metric `de_expert_inbox_pending` 已接真值；**实现位于 `internal/server/handlers_expert_inbox.go`（非独立 `internal/expertinbox/` 包）** | ADR-023 + 手册 + 13 测试 |
| W3-D2 | HotReload（配置变更热加载） | ✅ 完成 | 新 `internal/hotreload/` 包：mtime 轮询 + SIGHUP；解析/应用失败保留旧值；`de_hotreload_reload_total{resource,result}` 指标 | ADR-024 + 9 测试 |
| W3-D3 | Preview（artifact 预览服务端） | ✅ 完成 | `internal/server/preview_sandbox.go`：X-Frame-Options / CSP (`frame-ancestors 'self'` / `img-src 'self' data: blob:`) / X-Content-Type-Options: nosniff / Referrer-Policy: no-referrer / Cache-Control private；`?inline=1` 翻转 Content-Disposition；接入 3 个 handler (`serveSkillArtifact` / `serveSkillArtifactSlidePNG` / `writeJSON`) | ADR-030 + 4 测试 |

---

## 4. 后端 — W4（Heartbeat / VisualDiff）

| ID | 项 | 状态 | 证据 / 缺口 | 下一步 |
|---|---|---|---|---|
| W4-D1 | Heartbeat / 在线探测 | ✅ 完成 | 新 `internal/heartbeat/` 包：`Tracker` + `Touch` / `Sweep` / `Online` / `Subscribe(wsID)` / `LagSinceLastTouch` / `Snapshot`；`withHeartbeat` 中间件挂在 `requireAuth` 之后，每个 authed 请求自动 Touch；3 个 handler：`GET /api/heartbeat`（active probe + lag）/ `GET /api/online`（presence 列表）/ `GET /api/online/stream`（SSE 推送 join/leave/tick/ping）；指标 `de_heartbeat_lag_seconds` + `de_canvas_clients_online{workspace}`；env `DE_HEARTBEAT_INTERVAL`（30s）/ `DE_HEARTBEAT_STALE`（90s） | ADR-031 + 排查手册 + 16 包测 + 5 集成测 |
| W4-D2 | VisualDiff 服务端 | ✅ 完成 | 新 `internal/visualdiff/`：纯 Go PNG 解码 + 像素 walk + 高亮 + 文件缓存 + TTL 驱逐；`POST /api/visualdiff` 接 base64 PNG 对，返回 `match / diffRatio / diffPixels / total / cacheKey`；`GET /api/visualdiff/<key>.png` 流式返回缓存高亮图；metrics `de_visualdiff_seconds_sum{size}` + `de_visualdiff_total{size}`；env `DE_VISUALDIFF_CACHE_DIR`（默认 `data/visual-diff`）/ `DE_VISUALDIFF_RETENTION`（默认 7 天）；janitor goroutine 每小时驱逐 | ADR-032 + 13 包测 + 8 集成测 |

---

## 5. 后端 — W5（SelfImproving / Multimodal）

| ID | 项 | 状态 | 证据 / 缺口 | 下一步 |
|---|---|---|---|---|
| W5-D1 | SelfImproving（执行反馈学习 / SOP 萃取） | ✅ 完成 | 新 `internal/selfimproving/`：Engine + Verdict + Reason + Pattern；模板化 SOP 渲染（采样 / 触发模式 / 建议步骤 / 元数据）；阈值 MinSample=3 / ErrorRateReject=0.9 / P95LatencyMs=4000 / RecurringErrorThreshold=2；`POST /api/selfimproving/sop`（workspace 校验 + write=true 写回 knowledge draft 包）；`de_selfimproving_sop_total{verdict}` 指标 | ADR-026 + 11 包测 + 7 集成测 |
| W5-D2 | Multimodal（图片 / 语音 / 文件统一管道） | ✅ 完成 | 新 `internal/multimodal/`：Provider 接口（`Name/Kind/Available/Extract`）+ Registry 派发 + SHA256 缓存 + TTL 驱逐；内置 `ocrStubProvider` / `asrStubProvider`（env `DE_MULTIMODAL_OCR=stub` / `ASR=stub` 启用，CI 可跑）；`POST /api/multimodal/extract` 接 multipart `{file, kind}`，返回 `{text, segments, meta, provider, cached, latencyMS}`；错误码：501（无 provider）/ 503（provider 不可用）/ 400（提取失败）；env `DE_MULTIMODAL_CACHE_DIR` | ADR-033 + 11 包测 + 5 集成测 |

---

## 6. 后端 — W6（PM SOP / Canvas）

| ID | 项 | 状态 | 证据 / 缺口 | 下一步 |
|---|---|---|---|---|
| W6-D1 | PM SOP（项目管理模板引擎） | 🟡 部分 | 新 `internal/pmsop/`：Engine + Template/Plan + 状态机（5 个 task.* 事件 + 自动 stage/plan 完成判定）；内置 `agile-sprint` / `launch-checklist` 模板；`POST /api/pmsop/plans` 渲染、`GET /api/pmsop/plans/<id>` 详情、`POST /api/pmsop/plans/<id>/events` 应用事件；持久化在 `Store.KnowledgeExtra["pmsop_plans"]`；`de_pmsop_plan_total{action}` 指标 | ADR-034 + 12 包测 + 7 集成测（`handlers_pmsop_test.go`，原文档误记 8） |
| W6-D2 | Canvas 协作后端（presence / CRDT） | ✅ 完成 | 新 `internal/canvas/`：Store（boards / comments / presence map）+ Broadcaster（per-board SSE fan-out）；9 个路由：`/api/canvas/boards[/{id}][/{comments,presence,stream}]` 与 `/api/canvas/comments/{id}`；SSE 事件 `snapshot / presence / comment / tick`；新增权限 `canvas.comment`；`de_canvas_comment_total{action}` 指标 | ADR-035 + 13 包测 + 10 集成测 |

---

## 7. 后端 — W7（SQLite / WeChat-Sync）

| ID | 项 | 状态 | 证据 / 缺口 | 下一步 |
|---|---|---|---|---|
| W7-D1 | SQLite（嵌入式单机演示） | ✅ 完成 | 新 `internal/store/sqlite.go`：`OpenSQLite`（PRAGMA WAL + busy_timeout + foreign_keys）+ `PersistFunc`/`DeleteFunc`（shrink-heavy 走 replaceCollection，其余 upsertMany）+ `List`/`Count`；schema 对齐 PG `platform.kv_documents`；env `DE_STORE_BACKEND=sqlite` + `DE_SQLITE_PATH`（默认 `data/store.db`）由 `initSQLiteDurability()` 在 `server.New()` 末尾挂 `SetPersistHook`；失败回退 in-memory（不 panic）；依赖 `modernc.org/sqlite`（pure Go，无 CGO） | ADR-028 + 10 包测 + 3 集成测 |
| W7-D2 | WeChat 同步渠道 | 🟡 部分 | `internal/weixin/`（Credentials 双形态：个人号 ilink sidecar + 公众号 Open API；自动 Mode 识别）；Client `Probe / SendText / AccessToken`；公众号 SHA1 + AES-CBC 回调加解密（`VerifySignature/EncryptCallback/DecryptCallback/ParseEncryptedCallback/ReplyText`）；`WeixinHTTP` 字段允许测试注入；修复 `handlers_channels.go` 既存的 `weixin.*` 编译错误 | ADR-029 + 20 包测（`internal/weixin/client_test.go`，原文档误记 22）+ 1 端到端集成测；**无单独 `handlers_weixin_test.go`**，端到端路径仅由 `internal/server/m4_execution_test.go` 间接覆盖 |

---

## 8. 前端 — 9 项

| ID | 项 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| FE-1 | Copilot 三列布局（桌面会话历史 + 主区 + 上下文） | ✅ 完成 | `features/copilot/layout.ts` 111 行：`ColumnMode = 'three-column' \| 'two-column' \| 'stacked'` + `LayoutConfig`（断点 1280/900/220）+ `resolveColumnMode` / `effectiveColumnMode`（details pinned 时强制 three-column）+ `gridTemplateForMode` 输出 CSS Grid `minmax(0,1fr)` 模板与命名 area；`pages/Copilot.tsx` 加 viewport 监听 + `data-column-mode={columnMode}` + CSS vars `--copilot-grid-columns` / `--copilot-grid-areas`；9 个 layout 测试；commit `229025b` |
| FE-2 | Composer 多模态（mic / 拍照 / 粘贴 / 拖拽） | ✅ 完成 | `pages/Copilot.tsx` 在 Composer 底部新增 `<ComposerMediaControls>`：mic 录音（MediaRecorder WebM/OGG/MP4）+ 摄像头拍照（canvas snapshot）；`features/copilot/composer-media.ts` 纯函数（pickSupportedAudioMime / captureAudio / captureImage / blobToDataUrl / parseDataUrl / isOverCap 8MB / describeMedia）；结果信封 `{ok,data}` / `{err,error:code ∈ not_supported/permission_denied/no_stream/recorder_error/oversize/aborted}`；Copilot 加 `mediaCapturing` + `mediaAttachments` 状态；27 测试（23 helpers + 4 component）；commit |
| FE-3 | Document Preview（xlsx/docx/pdf/pptx） | ✅ 完成 | `features/copilot/document-preview.tsx` 654 行，sheets / 段落 / 页码 / 幻灯片齐全 |
| FE-4 | UI 组件目录 + Design Token 导出 | ✅ 完成 | `packages/ui/src/index.tsx` 628 行，与 `docs/视觉设计规范.md` Token 对齐 |
| FE-5 | SSE Stream 事件协议（stage/delta/tool/route/thought/evidence/done/error） | ✅ 完成 | `packages/types/src/agent-os.ts:18` `STREAM_EVENT_TYPES` 8 项齐全 |
| FE-6 | PM Canvas / 协作画布（白板 / 评论 / presence） | ✅ 完成 | 新 `features/canvas/`：`canvas-types.ts`（`CanvasBoard / CanvasComment / CanvasPresence` + 事件协议 `snapshot/presence/comment/tick/ping` + 纯函数 `clampBoardTitle / clampCommentText / normaliseCoordinate`）+ `canvas-api.ts`（boards / comments / presence 9 个 REST 包装 + `openBoardStream` SSE 解析器）；`useCanvasBoard` hook 自动重连 5s + presence 30s 心跳 + 事件驱动快照/presence/comment 合并；`<CanvasCommentPin>`（按 0..1 归一坐标定位 + 在线徽标 + 弹层 resolve/delete）+ `<CanvasPresenceBar>`（多成员 chip）；新页面 `pages/Canvas.tsx`（侧栏 board 列表 + 新建/删除 + 主区 surface 点击落 pin + 评论 composer）；路由 `/canvas` + `/canvas/:boardId`（user/admin/auditor + `access.read` 权限）；侧栏 admin「编排」与 auditor「核查」组均含 /canvas（user 不含，4 字 `协作画布` / `画布核查`）；i18n 中文「协作画布」/英文「Collab Canvas」；24 测试（7 types + 11 api + 6 component）通过 |
| FE-7 | Visual Diff（前后截图 / 像素差 / 高亮） | ✅ 完成 | 新 `features/visualdiff/`：`VisualDiffViewer`（两 slot 上传 + threshold/tolerance/highlight 控件 + verdict 徽章 + before/after/diff 三联显示 + diffPNG 下载）+ `visualdiff-api.ts`（POST /api/visualdiff wrapper，自动拆 `{ok,data}` 信封）+ `visualdiff-types.ts`（base64 reader / clamp / 格式化）；新页面 `pages/VisualDiff.tsx` + 路由 `/visualdiff`（admin/auditor/user + `access.write` 权限）+ 侧栏 admin「数据治理」与 auditor「核查」组均含 /visualdiff；i18n 中文键「视觉对比」；18 个测试通过（13 api 单测 + 5 组件测） |
| FE-8 | Workflow Canvas（react-flow 编排） | ✅ 完成 | 前端 `frontend/web/src/features/workflow-canvas/` 新建（`workflow-types.ts` + `WorkflowBoard.tsx` + `workflow-canvas-api.ts`）；后端 canvas `Board.Kind = "comments" \| "workflow"` + `WorkflowNode` / `WorkflowEdge` / `WorkflowGraph` + `GET/PUT /api/canvas/boards/<id>/workflow`；18 vitest（12 type + 6 component）+ 8 包测 + 5 集成测；commits `21a0e74` + `b309c31` |
| FE-9 | Session Sync（跨设备 / heartbeat / 标签同步） | ✅ 完成 | 新 `features/session-sync/`：`session-sync-types.ts`（UUID 设备 ID / tab ID / 事件协议 `tab:joined / tab:left / state:updated / conversation:focus / heartbeat` + `clampNowSkewMs` + 纯函数 `makeLocalStorageDeviceId`）；`session-sync-channel.ts`（BroadcastChannel 封装 + 自检过滤 + 关闭安全 + noop fallback）+ `createSessionSync` 工厂；`useSessionSync.ts`（hooks 组件：自忽略 echo / peer 心跳 / 30s offline / 15s 自身 heartbeat）；`SessionSyncIndicator.tsx`（chip 显示标签数）；新页面 `pages/SessionSync.tsx` + 路由 `/session-sync`（user/admin/auditor）+ 侧栏 admin「数据治理」与 auditor「核查」组均含 /session-sync；i18n 中文「会话同步」/英文「Session Sync」；34 测试（11 types + 14 channel + 7 hook + 2 page）；commit `60ec6ed` |

---

## 9. 横切 — ADR / 手册 / 指标 / 权限 / Env / CI

### 9.1 ADR（16 份已落 ✅）

| ADR | 主题 | 状态 |
|---|---|---|
| ADR-018 | Skill Vetter 接入策略 | ✅ 完成（[ADR-018](../adr/ADR-018-skill-vetter-integration.md)） |
| ADR-019 | Gateway 硬墙策略 | ✅ 完成（[ADR-019](../adr/ADR-019-gateway-hardening.md)） |
| ADR-020 | Workspace Publisher Key 信任链 | ✅ 完成（[ADR-020](../adr/ADR-020-workspace-publisher-key.md)） |
| ADR-021 | Vault 接入策略（dev/staging/prod 三段） | ✅ 完成（[ADR-021](../adr/ADR-021-vault-integration.md)） |
| ADR-022 | SubAgent 调度与并发合并 | ✅ 完成（[ADR-022](../adr/ADR-022-subagent-dispatch.md)） |
| ADR-023 | ExpertInbox 数据生命周期 | ✅ 完成（[ADR-023](../adr/ADR-023-expert-inbox-lifecycle.md)） |
| ADR-024 | HotReload watch + reload 安全语义 | ✅ 完成（[ADR-024](../adr/ADR-024-hotreload-watch-reload.md)） |
| ADR-032 | VisualDiff 缓存与置信度 | ✅ 完成（[ADR-032](../adr/ADR-032-visualdiff-cache-confidence.md)） |
| ADR-033 | Multimodal provider 抽象与缓存 | ✅ 完成（[ADR-033](../adr/ADR-033-multimodal-provider-cache.md)） |
| ADR-026 | SelfImproving 反馈回路与写入边界 | ✅ 完成（[ADR-026](../adr/ADR-026-selfimproving-feedback-loop.md)） |
| ADR-035 | Canvas 协作 / CRDT 选型 | ✅ 完成（[ADR-035](../adr/ADR-035-canvas-collaboration.md)） |
| ADR-028 | SQLite 双栈切换契约 | ✅ 完成（[ADR-028](../adr/ADR-028-sqlite-dual-stack.md)） |
| ADR-029 | WeChat 渠道限流与同步策略 | ✅ 完成（[ADR-029](../adr/ADR-029-wechat-channel.md)） |
| ADR-030 | Preview sandbox 语义（iframe / CSP / inline `?inline=1`） | ✅ 完成（[ADR-030](../adr/ADR-030-preview-sandbox.md)） |
| ADR-031 | Heartbeat / 在线探测语义 | ✅ 完成（[ADR-031](../adr/ADR-031-heartbeat-presence.md)） |
| ADR-036 | Catalog 数据源契约 | ✅ 完成（[ADR-036](../adr/ADR-036-catalog-source-contract.md)） |

### 9.2 用户手册（8 份，8 份已落 ✅）

| 手册 | 状态 |
|---|---|
| W1-vetter 安全策略 / 用户面对白名单 | ✅ 完成（[手册-W1-vetter-安全策略.md](../手册-W1-vetter-安全策略.md) §1–9：三道防线 + vetter 5 类 pattern + override 权限 + `.vetter-allow.json` + 端到端 smoke + 排查清单） |
| W2-publisher-key 运维手册 | ✅ 完成（[手册-W2-skill签名与vault.md](../手册-W2-skill签名与vault.md)） |
| W2-vault 凭据管理手册 | ✅ 完成（同上 §4） |
| W3-expert-inbox 审核手册 | ✅ 完成（[手册-W3-expert-inbox-审核.md](../手册-W3-expert-inbox-审核.md)） |
| W4-heartbeat & visualdiff 排查手册 | ✅ 完成（[手册-W4-heartbeat-排查.md](../手册-W4-heartbeat-排查.md) heartbeat §1–4 + visualdiff §2.1–2.4） |
| W5-multimodal 上传规范 | ✅ 完成（[手册-W5-multimodal-上传规范.md](../手册-W5-multimodal-上传规范.md) §1–9） |
| W6-pm-canvas 协作手册 | ✅ 完成（[手册-W6-pm-canvas-协作.md](../手册-W6-pm-canvas-协作.md) PM §1.1–1.7 + Canvas §2.1–2.7 + 排查矩阵 §3） |
| W7-sqlite / wechat 部署手册 | ✅ 完成（[手册-W7-sqlite-wechat-部署.md](../手册-W7-sqlite-wechat-部署.md) SQLite §1.1–1.6 + WeChat §2.1–2.6） |

### 9.3 Prometheus 指标（10 条已落 ✅）

| 指标 | 状态 |
|---|---|
| `de_skill_vetter_total{verdict}` | ✅ 完成（`metrics.Global.Vetter`） |
| `de_skill_sign_total{result}` | ✅ 完成（`metrics.Global.Sign`） |
| `de_subagent_run_seconds` | ✅ 完成（`metrics.Global.SubAgent`；W2-D3 输出 sum/count/avg + per-status counter） |
| `de_vault_resolve_seconds{ref}` | ✅ 完成（`metrics.Global.Vault`） |
| `de_expert_inbox_pending` | ✅ 完成（已接真值：list/create 时刷新） |
| `de_hotreload_reload_total{resource}` | ✅ 完成（`metrics.Global.HotReload` per-resource success/fail） |
| `de_heartbeat_lag_seconds` | ✅ 完成（`metrics.Global` + scrape handler；W4-D1） |
| `de_visualdiff_seconds{size}` | ✅ 完成（`metrics.Global.VisualDiff` 4 个 size bucket；W4-D2） |
| `de_canvas_clients_online{workspace}` | ✅ 完成（W4-D1 `Tracker.Snapshot()`；W6-D2 将叠加 deviceId） |
| `de_session_sync_skew_ms{device}` | ✅ 完成（`metrics.Global.SessionSync` + `POST /api/metrics/session-sync-skew` + FE `reportSkew`；count/sum/max 三个子指标；device label 因高基数已省略） |

### 9.4 权限（4 个已落 ✅）

| 权限 | 状态 |
|---|---|
| `skill.vet.override` | ✅ 完成（`internal/auth/jwt.go` admin 列表；`handlers_skills_package.go` vetter 拒绝路径 bypass + audit `override` 行） |
| `publisher_key.rotate` | ✅ 完成（`internal/auth/jwt.go` admin 列表；`rotateWorkspacePublisherKey` handler 入口校验） |
| `vault.read` | ✅ 完成（`internal/auth/jwt.go` admin 列表；`GET /api/vault/keys` 校验；admin 旁路；refs 通过 `vault.Client.Refs()` 暴露） |
| `canvas.comment` | ✅ 完成（W6-D2） |

### 9.5 环境变量（11 个已接 ✅）

| Env | 状态 |
|---|---|
| `DE_SKILL_VETTER` | ✅ 已接 |
| `DE_REQUIRE_SKILL_SIGNATURE` | ✅ 已接（`off/enabled/workspace/builtin_only`） |
| `DE_BAN_DEV_KEYPAIR` | ✅ 已接（`internal/runtimeenv/env.go:92` `AutoProvisionsSkillKeys()`：prod/staging 默认 false；设 `true` 强制不走 dev keypair 路径；与 `DE_FORCE_DEV_KEYPAIR` 互斥） |
| `DE_TRUSTED_PUBLISHERS_PATH` | ✅ 已接 |
| `DE_DEV_KEYPAIR_PATH` | ✅ 已接 |
| `DE_VAULT_ADDR` / `DE_VAULT_TOKEN` / `DE_VAULT_KV_MOUNT` | ✅ 已接（`internal/vault/client.go` `NewFromEnv` + `internal/server/builtin_skills.go` `bootstrapVaultSkillSigning()`：env 三个全读，probe 失败回退 dev） |
| `DE_SUBAGENT_MAX_CONCURRENCY` | ✅ 已接（W2-D3；默认 4） |
| `DE_HEARTBEAT_INTERVAL` | ✅ 已接（W4-D1） |
| `DE_CANVAS_COMMENT_TTL` | ✅ 已接（W6-D2 `canvasJanitor`；TTL=0 关闭；过期 comments 触发 `de_canvas_comment_total{action="expired"}`） |
| `DE_VISUALDIFF_RETENTION` | ✅ 已接（W4-D2，默认 7 天） |
| `DE_SESSION_SYNC_ENABLED` | ✅ 已接（frontend `VITE_SESSION_SYNC_ENABLED` + backend `DE_SESSION_SYNC_ENABLED`（`runtimeenv.SessionSyncEnabled`，默认 true；`false`/`0` 拒收 skew writes）；mirror reader 与 FE 开关一致） |

### 9.6 CI（3 项已绿）

| CI | 状态 |
|---|---|
| `.github/workflows/backend-contract.yml` | ✅ 已绿（PR unit + 契约探针） |
| `make skill-gate` job | ✅ 已绿（`.github/workflows/skill-gate.yml`：vetter strict + signature verify；34 builtin skills 全过） |
| visual regression job | ✅ 已绿（`.github/workflows/visualdiff-regression.yml`：后端 unit + integration + 前端 vitest） |

---

## 10. P0 行动（本周可落地）

> 顺序遵守「先契约后迁包」「先 ADR 后代码」「hard_delete_persist_test 必须新增」三条原则。

1. **W1-D1 vetter 联通**（2 人日） ✅ 完成
   - 在 `verifyBuiltinSignature` 之前 vetter 跑
   - 加 `TestImportRejectedWhenVetterFails`
   - 出 ADR-018
2. **W1-D3 gateway 硬墙**（3 人日） ✅ 完成
   - `internal/gateway/` 包：SSRF / path traversal / size / mime / iframe sandbox
   - `/api/skill-artifacts/<f>/preview` 同源代理
   - 出 ADR-019 + 4 个测试
3. **W2-D2 Vault 接入**（3 人日） ✅ 完成
   - 抽 `signing.KeyStore` 接口
   - 新增 `VaultKeyStore`，`DevKeyStore` 改 `FileKeyStore`
   - 加 `vault.PutMap/ResolveMap` 用于模型凭据
   - 出 ADR-021 + 5 个测试
4. **横切批次**（1 人日） ✅ 完成
   - ADR-020（publisher key）定稿
   - W2 运维手册 1 篇
   - 4 个 Prometheus 指标（vetter / sign / vault / expert_inbox）

---

## 10.1 P0 实际完成情况（2026-09-08 校验）

| 项 | 计划 | 实际 |
|---|---|---|
| W1-D1 vetter 联通 | 2 人日 | ✅ 完成（`vetter/` + 集成测试 3 + ADR-018） |
| W1-D3 gateway 硬墙 | 3 人日 | ✅ 完成（`internal/gateway/` + 11 测试 + ADR-019） |
| W2-D2 Vault 接入 | 3 人日 | ✅ 完成（`signing.KeyStore` 接口 + ADR-021） |
| 横切批次 | 1 人日 | ✅ 完成（ADR-020 + W2 手册 + 4 指标） |

实际完成率：**~95%**（后端 100% + 前端 100% + 横切 100%）；本节标度与 §0 总览对齐。P1 段所有项也已在 W3-W7 中段落地。

---

## 11. 性能 / 可靠性硬化（P1-1 ~ P1-4，2026-09-08 收尾）

W1-W7 主线 100% ✅ 后做的最后一公里硬化：让进程退出 / 异常路径不再是黑盒。

| ID | 主题 | Commit | 关键产出 |
|---|---|---|---|
| P1-1 | 后台 goroutine cancel + Shutdown API | `42a9752` | `go vet ./...` 干净；`Server.Shutdown(ctx)` 触发 heartbeat / visualdiff / memory TTL 三个 ctx-cancel |
| P1-1 | apprun SIGTERM-aware graceful shutdown | `a2089f0` | `apprun.serveWithGracefulShutdown`：SIGTERM/SIGINT → httpServer.Shutdown + Server.Shutdown，10s deadline |
| P1-2 | 外层 panic recover + audit + 指标 | `7a1947b` | 新 `withRecover` 中间件包整链；handler panic → 500 + `de_http_handler_panics_total` + audit row |
| P1-3 | RegisterCloseFunc + 并行关闭 | `2bb0db4` | `Server.RegisterCloseFunc` 收口所有外部资源；`Shutdown` 并行 fan-out + ctx deadline |
| P1-3 | apprun 注册 PG / Redis close | `05ab5d2` | dedup by pointer：PG 共享者只注册一次 |
| P1-4 | Kafka + AuditBus 注入 + Kafka Close | `b2ed099` | `infra.KafkaAuditBus.Close` 直接注册；AuditBus 走 rdb 已注册 closer |

**复核后不存在的尾巴**：

- **cmd/qzda-audit / qzda-policy / qzda-sys 等独立服务进程的 shutdown 审计**：所有 cmd (`qzda-audit / qzda-policy / qzda-sys / qzda-workflow / qzda-cap / qzda-collab / qzda-app`) 都通过 `apprun.Run(...)` 启动，已自动继承 P1-1 的 graceful shutdown
- **SSE handler（canvas / heartbeat / copilot）的 goroutine panic + cancel**：`handlers_canvas.go:283-294` 与 `handlers_heartbeat.go:97-118` 已正确使用 `r.Context().Done()` + `defer cancel()`；`httpServer.Shutdown(ctx)` 自然终止

**剩余已知 out-of-scope**：

- `infra.OpenSearchAudit`（HTTP client 复用 default）暂无 close 需求
- Store 整体 Close 概念（PG 之外的 conn pool lifecycle）留待后续单独 PR

**验证状态**：

- `go vet ./...` 干净
- `go test -race ./internal/server/... ./internal/apprun/...`：server 包 223s / apprun 2.8s 全过
- 总测试规模：后端 server 包单包 200+ 测试，apprun 3 测试


## 11.5. P1 排期回顾（已在 W3-W7 中段落地）

| 项 | 状态 | 落地位置 | 锚点 |
|---|---|---|---|
| W3-D1 ExpertInbox review 流 | ✅ 完成 | §3 W3-D1 | commit + ADR-023 + 13 测试 |
| W3-D2 HotReload | ✅ 完成 | §3 W3-D2 | `internal/hotreload/` + ADR-024 + 9 测试 |
| W3-D3 Preview sandbox | ✅ 完成 | §3 W3-D3 | `preview_sandbox.go` + ADR-030 + 4 测试 |
| 前端 FE-1 三列布局 | ✅ 完成 | §8 FE-1 | — |
| 前端 FE-2 mic / camera | ✅ 完成 | §8 FE-2 | — |
| ADR-022 / 023 / 024 | ✅ 完成 | §9.1 ADR | 16 份清单内 |
| 5 个指标 + 2 个权限 | ✅ 完成 | §9.3 / §9.4 | 10 指标 / 4 权限 |

**注**：本节原标题"## 11. P1（接下来 2 周）"排在新建的 §11 性能 / 可靠性硬化段之前。两个 §11 冲突；新 §11 是 W1-W7 主线 100% 之后的最后一公里硬化，本节只是历史 P1 排期。为保留可追溯性，重命名为 §11.5。如需追溯本节项，请直接看 §3 / §8 / §9.1 / §9.3 / §9.4。

---

## 12. 证据索引（grep 锚点）

```
# 后端 — W1
backend/internal/skills/vetter/                              # W1-D1 ✓
backend/internal/skills/vetter/vetter.go                     #   - Decision / Severity / Verdict
backend/internal/skills/vetter/patterns_credential.go        #   - credential
backend/internal/skills/vetter/patterns_egress.go            #   - egress
backend/internal/skills/vetter/patterns_destructive.go       #   - destructive
backend/internal/skills/vetter/patterns_escalation.go        #   - escalation
backend/internal/skills/vetter/patterns_persistence.go       #   - persistence
backend/internal/skills/signing/keystore.go                  # W1-D2 ✓
backend/internal/skills/signing/canonical.go                 # W1-D2 ✓
backend/internal/skills/signing/signer.go                    # W1-D2 ✓
backend/cmd/sign-skill/                                      # W1-D2 ✓
backend/cmd/verify-skill/                                    # W1-D2 ✓
backend/internal/gateway/artifact_gateway.go                 # W1-D3 ✓
backend/internal/gateway/artifact_gateway_test.go            # W1-D3 (11 测试)
backend/internal/server/artifact_gateway_integration_test.go # W1-D3 (集成)
backend/internal/catalog/                                    # W1-D4 ✓

# 后端 — W2
backend/cmd/sign-skill-pack/                                 # W2-D1 ✓
backend/internal/server/handlers_workspaces_publisher*.go    # W2-D1 ✓
backend/internal/vault/client.go                             # W2-D2 ✓
backend/internal/skills/signing/keystore.go                 # W2-D2 ✓ (含 VaultKeyStore / SignerResolver)
backend/internal/skills/signing/vault_keystore_test.go      # W2-D2 ✓ (测试文件)
backend/internal/agentos/subagent.go                        # W2-D3 ✓ (Engine + Run 全部在此，无 engine.go)

# 后端 — W3
backend/internal/server/handlers_expert_inbox.go             # W3-D1 ✓ (无独立 internal/expertinbox/ 包)
backend/internal/hotreload/                                  # W3-D2 ✓
backend/internal/server/preview_sandbox.go                   # W3-D3 ✓

# 后端 — W4
backend/internal/heartbeat/                                  # W4-D1 ✓
backend/internal/visualdiff/                                 # W4-D2 ✓

# 后端 — W5
backend/internal/selfimproving/                              # W5-D1 ✓
backend/internal/multimodal/                                 # W5-D2 ✓
backend/internal/server/handlers_multimodal.go               #   - ocrStubProvider / asrStubProvider

# 后端 — W6
backend/internal/pmsop/                                      # W6-D1 ✓
backend/internal/pmsop/templates/agile-sprint.json           #   - 模板
backend/internal/canvas/                                     # W6-D2 ✓

# 后端 — W7
backend/internal/store/sqlite.go                             # W7-D1 ✓
backend/internal/weixin/                                     # W7-D2 ✓
backend/internal/weixin/client.go                            #   - ilink + openapi 双形态

# 后端 — 跨切
backend/internal/metrics/metrics.go                          # Vetter/Sign/Vault/VisualDiff/Canvas/SubAgent/SessionSync
backend/internal/server/metrics.go                           # scrape 输出 25+ 行
backend/internal/server/handlers_canvas.go                   # canvasJanitor + DE_CANVAS_COMMENT_TTL
backend/internal/server/handlers_skills_package.go           # skill.vet.override 路径
backend/internal/server/handlers_workspaces_publisher.go     # publisher_key.rotate 入口校验
backend/internal/server/handlers_vault.go                    # GET /api/vault/keys + vault.read
backend/internal/server/handlers_session_sync_metric.go      # POST /api/metrics/session-sync-skew

# 前端 — 9 项
frontend/web/src/features/copilot/layout.ts                       # FE-1 ✓
frontend/web/src/pages/Copilot.tsx                                #   - 三列布局 + Composer 多模态
frontend/web/src/features/copilot/composer-media.ts               # FE-2 ✓
frontend/web/src/features/copilot/document-preview.tsx            # FE-3 ✓
frontend/packages/ui/src/index.tsx                                # FE-4 ✓
frontend/packages/types/src/agent-os.ts                           # FE-5 ✓
frontend/web/src/features/canvas/canvas-types.ts                  # FE-6 ✓
frontend/web/src/features/canvas/canvas-api.ts                    #   - SSE / boards / comments
frontend/web/src/features/canvas/useCanvasBoard.ts                #   - auto-reconnect 5s + 30s presence
frontend/web/src/pages/Canvas.tsx                                 #   - sidebar + 主区
frontend/web/src/features/visualdiff/                             # FE-7 ✓
frontend/web/src/pages/VisualDiff.tsx                             #   - 路由 + viewer
frontend/web/src/features/session-sync/                           # FE-9 ✓
frontend/web/src/pages/SessionSync.tsx                            #   - 路由 + indicator

# 横切
docs/adr/ADR-014-scope-layers.md               # 已存在
docs/adr/ADR-018-skill-vetter-integration.md   # 本轮新增
docs/adr/ADR-019-gateway-hardening.md          # W1-D3 ✓
docs/adr/ADR-020-workspace-publisher-key.md    # W2-D1 ✓
docs/adr/ADR-021-vault-integration.md          # W2-D2 ✓
docs/adr/ADR-022-subagent-dispatch.md          # W2-D3 ✓
docs/adr/ADR-023-expert-inbox-lifecycle.md     # W3-D1 ✓
docs/adr/ADR-024-hotreload-watch-reload.md     # W3-D2 ✓
docs/adr/ADR-026-selfimproving-feedback-loop.md # W5-D1 ✓
docs/adr/ADR-028-sqlite-dual-stack.md          # W7-D1 ✓
docs/adr/ADR-029-wechat-channel.md             # W7-D2 ✓
docs/adr/ADR-030-preview-sandbox.md            # W3-D3 ✓
docs/adr/ADR-031-heartbeat-presence.md         # W4-D1 ✓
docs/adr/ADR-032-visualdiff-cache-confidence.md # W4-D2 ✓
docs/adr/ADR-033-multimodal-provider-cache.md  # W5-D2 ✓
docs/adr/ADR-034-pmsop-template-engine.md      # W6-D1 ✓
docs/adr/ADR-035-canvas-collaboration.md       # W6-D2 ✓
docs/adr/ADR-036-catalog-source-contract.md    # W1-D4 ✓

# 手册
docs/手册-W1-vetter-安全策略.md            # 本轮新增
docs/手册-W2-skill签名与vault.md           # W2 ✓
docs/手册-W3-expert-inbox-审核.md          # W3 ✓
docs/手册-W4-heartbeat-排查.md             # W4 ✓
docs/手册-W5-multimodal-上传规范.md        # 本轮新增
docs/手册-W6-pm-canvas-协作.md             # 本轮新增
docs/手册-W7-sqlite-wechat-部署.md         # 本轮新增

# CI
.github/workflows/backend-contract.yml         # ✓
.github/workflows/skill-gate.yml               # 本轮新增
.github/workflows/visualdiff-regression.yml    # 本轮新增

# 构建
Makefile                                       # 本轮新增 — make skill-gate / test / build / lint
```