# infra/redis

| 项 | 值 |
|----|----|
| 镜像 | redis:7-alpine |
| 端口 | 6379 |
| 消费者 | **qzda-app**（monolith）或 qzda-sys / qzda-collab（coarse：会话、审计 bus） |
| URL | `redis://127.0.0.1:6379/0` |
