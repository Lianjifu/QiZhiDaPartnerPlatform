# qzda-sys

| 项 | 值 |
|----|----|
| 端口 | **8100** |
| 模式 | `DE_SERVICE` / ModeSys |
| 部署 | **coarse 四进程**；monolith 默认使用 **qzda-app** |
| 模块 | platform · policy · audit · ops |
| 逻辑层 | L10 · L11 · L12 · L13 |

吸收原 `qzda-policy:8094` 的 `/v1/evaluate` 与审计中心写路径（本地 sink）。

```bash
cd backend && make run-sys          # 单进程 sys
make compose-up-coarse              # 四进程
# monolith 默认：
make run-app
```
