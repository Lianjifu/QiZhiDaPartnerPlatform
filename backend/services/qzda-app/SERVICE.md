# qzda-app

Monolith control plane — **sys + collab + cap + workflow** in one Go process. `qzda-app` 是当前阶段（联调 + demo + 单租户开发）的唯一控制面进程。

| 项 | 值 |
|----|-----|
| 模式 | `QZDA_SERVICE=app` / `ModeApp`（旧值 sys / collab / cap / workflow 也归 ModeApp） |
| 端口 | `8100`（`QZDA_APP_ADDR`） |
| 写域 | `DomainAll`（全 PG 集合） |
| 侧车 | `qzda-sandbox :8093`（必须）；可选 `qzda-agent-runtime :8091` / `qzda-rag :8092` |
| Temporal worker | 可选进程内 goroutine（`QZDA_WORKFLOW_WORKER=1 QZDA_TEMPORAL_HOST=...`） |

## 启动

```bash
cd backend
make run-app              # 本机裸跑
make run-app-workflow     # + 进程内 Temporal worker
make compose-up-monolith
make smoke-monolith
```

## 环境变量

| Variable | Default | Description |
|----------|---------|-------------|
| `QZDA_APP_ADDR` | `:8100` | Listen address |
| `QZDA_RUNTIME_MODE` | `local` | 进程内 ReAct Harness（不启 qzda-agent） |
| `QZDA_SANDBOX_RUNTIME_URL` | `http://127.0.0.1:8093` | 技能沙箱 |
| `QZDA_TEMPORAL_HOST` | — | 非空启用进程内 Temporal worker |
| `QZDA_WORKFLOW_WORKER` | `0` | `1` 启用进程内 Temporal worker（需 `QZDA_TEMPORAL_HOST`） |

## 与历史 coarse 拓扑的关系

- `qzda-sys` / `qzda-collab` / `qzda-cap` / `qzda-workflow` 已在 M10 折叠到 `qzda-app`，二进制不再维护。
- 不再提供 `compose-up-coarse` / `run-sys` / `run-collab` / `run-cap` / `run-workflow` 等目标。
- 当前阶段不引入新的 Go 微服务；详见 [`docs/后端单进程方案.md`](../../../docs/后端单进程方案.md) §1.2（按需切分）。