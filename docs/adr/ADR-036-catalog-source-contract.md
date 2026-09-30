# ADR-036 — Catalog 数据源契约

- 状态：已接受
- 日期：2026-09-08
- 替代：[W1-W7-改进方案-todo.md §1 W1-D4](../../docs/W1-W7-改进方案-todo.md) 的"无 `internal/catalog/` 包"
- 关系：被 `internal/server/handlers_capability_catalog.go` 现有两条路径（local-store + peer fetch）复用；当前 handler 维持 600 行不变，仅作为契约落地。

## 1. 上下文

`/api/digital-employee-capability-catalog` 装配 6 类资产（model / skill / tool / workflow / knowledge / channel），数据来源有 4 种：

| 来源 | 现状 | 触发条件 |
|---|---|---|
| 本地 store（in-process） | `buildCapabilityCatalogFromStoreLocked` | `ModeAll` / fallback |
| qzda-cap peer HTTP（capability 子域） | `fetchCapCatalogParts` | `ModeCollab` |
| qzda-workflow peer HTTP（workflow 子域） | `fetchWorkflowCatalogParts` | `ModeCollab` 或 `ModeApp` + `DE_WORKFLOW_URL` |
| 始终注入 | "Web" channel | 全部路径 |

所有四条路径都各自解析 `map[string]any` 列表、手写去重（`seenSkill` / `seenTool` / `seenModel` / `seenCh`）、手写 workspace 过滤。问题：

| 维度 | 现状 | 风险 |
|---|---|---|
| Source 抽象 | 无 | 每次新增 peer / store shard 都要复制 seen-set 模板 |
| Option 类型 | 无（裸 `map[string]any`） | 4 个测试都需要类型断言；handler 与 store / peer 紧耦合 |
| 去重规则 | 4 份散落 `seen[key] = true` | `seenCh` 用 `name` 做 key，`seenSkill` 也用 `name` — 但 channel 的 dedup key 在某些路径用 `id` 而非 `name`，行为不一致 |
| Workspace 隔离 | 散落 if | 偶尔漏掉 → peer 数据泄漏 |
| 错误传播 | "Soft-fail: still try local" | 失败时 cat 部分为 `nil` slice，下游 range panic 隐患 |
| 单元测试 | 顶层 `capability_catalog_test.go` 走 httptest 整路径 | 无法验证 dedup 规则本身；要起 `httptest.NewServer` 才能跑 |

W1-D4 的真实价值是「Source 抽象 + 单元可测的合并契约」 — 即 handler 与数据源的解耦。

候选方案：

| 方案 | 优 | 劣 |
|---|---|---|
| 维持裸 `map[string]any` + 4 份 seen-set | 改 0 行 | 上述 6 项全部不解决 |
| 引入 `internal/catalog/` 包（本文） | Source / Option 类型化；MergeOptions 纯函数；contract test 覆盖 dedup / workspace / fail-mode | 多 1 个包，handler 暂不直接用（保留 600 行） |
| 直接重构 handler | 看起来"完成" | 风险大；现有 7 个 cap_catalog 测试需重写 |

本文采用方案 2 — 先落地契约 + 测试，下次再 handler-side 替换。

## 2. 决策

新增 `internal/catalog/catalog.go`：

| 组件 | 角色 |
|---|---|
| `Option{ID,Name,Meta,Kind}` | 单一下拉条目；Name 为 dedup key |
| `Section map[Kind][]Option` | 完整装配结果；空 kind 为空 slice 而非 nil（防 range panic） |
| `KindSkill / KindTool / KindMCP / KindWorkflow / KindKnowledge / KindChannel / KindModel` | 7 个常量；未知 Kind 仍可 merge（Section 是 map 不是 enum） |
| `Source interface { Kind() string; Fetch(ctx, ws) ([]Option, error) }` | 数据源契约；workspace 过滤由 source 负责 |
| `Registry{Sources, FailOpen}` | 聚合多 source；`Assemble(ctx, ws) (Section, []error)` |
| `MergeOptions(base, extra []Option) []Option` | 纯函数；按 Name 去重，首个胜出；空 Name 丢弃 |
| `StaticSource{K, Opts}` | 内存 source；测试 / Web channel 注入 |

行为细则：

| 维度 | 决策 |
|---|---|
| Dedup key | `strings.TrimSpace(Name)`；首遇胜出 |
| Workspace 隔离 | **Source 责任**；Registry 不二次猜测（契约明确） |
| 错误处理 | `FailOpen=true` 时收集所有 err 继续；`=false` 时首个 err 即停（仍返回部分 Section 防 nil panic） |
| 空 Name | 在 source 层（StaticSource）与 Registry 层双重 drop |
| Context | `Assemble` 在每个 source 调用前检查 `ctx.Err()`；已取消的 ctx 立即停 |
| Sort | 不在 Registry 内排序；UI 按需下游 sort（保留插入顺序便于 snapshot 断言） |
| `platformTools` / `runtimeTools` | 不进 catalog（capability 标志而非 sourced asset） |

## 3. 拒绝依赖

- **ent / sqlc**：Section 不持久化，纯内存
- **prometheus / otel**：handler 自行接 metrics，不污染 catalog 契约
- **jsoniter / mapstructure**：Option 已是纯 struct，不需要

## 4. 实现

| 文件 | 角色 |
|---|---|
| `backend/internal/catalog/catalog.go` | Source / Option / Registry / MergeOptions / StaticSource |
| `backend/internal/catalog/catalog_test.go` | 10 个 contract 测试：跨源合并、workspace 隔离、ctx 传递、fail-open / fail-closed、empty-Name drop、SortedNames 确定性、StaticSource Kind 填充 |

## 5. 后续（不进本 PR）

| 任务 | 触发条件 |
|---|---|
| `localSource` / `peerCapSource` / `peerWorkflowSource` 实现 `Source` | handler 重构时（独立 ADR） |
| `handlers_capability_catalog.go` 从 600 行瘦身 | 上述 3 个 source 落地后 |
| Option 加 `Score float64` | 未来按 score 排序 |
| Source 加 `Priority()` 返回同 Kind 多 source 的优先级 | qzda-collab 模式需要 cap > local 时 |

## 6. 回退

- `internal/catalog/` 是新包；handler 不 import 则无任何影响
- 不改 `handlers_capability_catalog.go`；`TestCapabilityCatalogAggregatesLiveAssets` / `TestCapabilityCatalogCollabFetchesCapPeers` 仍 green
- 不写 `platformTools` / `runtimeTools`；下游 handler 仍自行注入