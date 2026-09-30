# qzda-workflow

| 项 | 值 |
|----|----|
| HTTP | **8103** |
| Worker | Temporal queue `qzda-workflow` |
| 逻辑层 | L08 |
| 部署 | **可选**；monolith 默认不启，需 `make compose-up-monolith-workflow` 或 `DE_WITH_WORKFLOW=1` |

`DE_WORKFLOW_HTTP=1`（默认）启 HTTP；`DE_TEMPORAL_HOST` 非空启 Worker；`DE_WORKFLOW_WORKER=0` 可关 Worker。

```bash
cd backend && make run-workflow
make compose-up-monolith-workflow   # monolith + workflow
```
