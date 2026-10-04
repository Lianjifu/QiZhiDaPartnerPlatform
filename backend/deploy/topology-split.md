# 服务拓扑（M10 后单进程）

## 当前形态 — monolith（联调 / demo / 单租户）

**主路径**：`make compose-up-monolith` 或 `make run` → gateway `:8089` → **qzda-app `:8100`** + **qzda-sandbox `:8093`**。

| 单元 | 端口 | 内含模块 |
|------|------|----------|
| qzda-gateway | 8089 | Envoy `envoy.monolith.yaml` 或 dev `services/qzda-gateway/main.py` |
| **qzda-app** | 8100 | **sys + collab + cap + workflow**（`ModeApp` / `DomainAll`） |
| qzda-sandbox | 8093 | 技能沙箱执行（必须独立） |
| qzda-agent-runtime | 8091 | Python sidecar，按需（`DE_RUNTIME_MODE=remote`） |
| qzda-rag | 8092 | Python sidecar，按需 |
| Temporal worker | (进程内) | `DE_WORKFLOW_WORKER=1 DE_TEMPORAL_HOST=...` 时由 qzda-app 启动 goroutine |

`qzda-app` 单进程内同时挂载 sys / collab / employee / cap / workflow 全部域逻辑。所有 collection 由 `DomainAll` 单一写域拥有；`CanWrite(collection)` 永远返回 true。

可选 Temporal worker：`make compose-up-monolith-workflow` 或 `DE_WITH_WORKFLOW=1 scripts/dev-stack/run-stack.sh`。

```bash
cd backend && make compose-up-monolith
# 裸跑：make run-app & make skill &
# dev-stack：scripts/dev-stack/run-stack.sh（默认 monolith）
```

## 进程内组成

| 子模块 | 范围 |
|--------|------|
| **sys** | platform / ops / 设置 / policy / audit |
| **collab** | session / task / 审核 / 流式回合 |
| **employee** | 岗位 / 装配 / 上岗 |
| **cap** | model / knowledge / memory / skill 清单 / channel |
| **workflow** | 流程版本 / 试运行（HTTP）+ 可选 Temporal worker |

## 历史方案 — coarse 四进程（已退役）

> M10 把 `qzda-sys` / `qzda-collab` / `qzda-cap` / `qzda-workflow` 折叠到 `qzda-app`，coarse 拓扑不再部署。下方记录保留作为历史参考。

| 单元 | 端口 | 内含模块 |
|------|------|----------|
| qzda-gateway | 8089 | Envoy `envoy.coarse.yaml`（已删除） |
| qzda-sys | 8100 | platform · ops · policy · audit |
| qzda-collab | 8101 | collab · employee |
| qzda-cap | 8102 | model · knowledge · memory · skill · channel |
| qzda-workflow | 8103 | workflow HTTP + Temporal Worker |
| qzda-agent-runtime / qzda-rag / qzda-sandbox | 8091–8093 | FastAPI |

已退役：`qzda-core:8080`、旧 `qzda-policy:8094` / `qzda-audit:8095`、`envoy.split.yaml`、独立 `qzda-policy:8104` / `qzda-audit:8105`、`qzda-sys` / `qzda-collab` / `qzda-cap` / `qzda-workflow`（M10 折叠）、`scripts/dev-stack/gateway-proxy.py`。

## 启动

```bash
cd backend && make compose-up-monolith   # 默认
# FE Vite 默认代理 → :8089
```

## 单进程护栏

- `ServiceMode` 仅 `ModeApp`（运行态）+ `ModeAll`（测试态）。`ParseServiceMode` 接受旧值 `sys` / `collab` / `cap` / `workflow` 全部归 `ModeApp`，向后兼容。
- 策略评估在 qzda-app 进程内由 `internal/policy.Engine` 直接处理；`/api/zero-trust/evaluate` 与 `/v1/evaluate` 都走本进程。
- 审计写入：本进程本地 sink（PG / Redis / Kafka / OpenSearch），组合输出。
- 多活最小集：`DE_REPLICA_MODE=standby` 拒写；standby 优先 `DE_DATABASE_REPLICA_URL`；`pg_is_in_recovery()` 为真则强制 standby。可选 `make compose-up-replica` 起本机从库 `:5433`。不上 cn-east/south 双活 K8s。

## 未来切分路径（按需触发）

下列拆分 **不再自动发生**，仅当业务规模 / 团队边界 / 故障隔离需求触发时手动执行：

| 触发条件 | 拆出动作 |
|----------|----------|
| workflow 编排延迟抖动 | 把 Temporal worker 拆出到独立 `qzda-workflow` 二进制 |
| Python Harness 远程化需要常驻进程 | `qzda-agent-runtime` 必起，`DE_RUNTIME_MODE=remote` |
| 沙箱执行排队 / 资源占用上升 | 把 `qzda-sandbox` 横向扩多实例 |

每次拆分复用同套六边形包：`internal/server` → `internal/{platform,policy,audit,collab,cap,workflow}`，handler 不改、契约不变。详见 [`docs/后端单进程方案.md`](../../docs/后端单进程方案.md)。