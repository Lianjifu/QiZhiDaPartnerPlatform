# infra/redis

| 项 | 值 |
|----|----|
| 镜像 | redis:7-alpine |
| 端口 | 6379 |
| Compose | 默认(单进程 Docker 部署,无 profile) |
| 消费者 | **qzda-app**(M10 单进程 monolith,负责 rate-limit / audit bus / KV 缓存) |
| URL | `redis://127.0.0.1:6379/0` |

无密码、纯内存(`--appendonly no`),重启数据丢失 — 持久化数据走 postgres,redis 仅做短期状态。
