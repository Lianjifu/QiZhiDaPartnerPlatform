# infra/postgres

| 项 | 值 |
|----|----|
| 镜像 | postgres:16-alpine |
| 端口 | 5432 |
| Compose | 默认(单进程 Docker 部署,无 profile) |
| 消费者 | **qzda-app**(M10 单进程 monolith) |
| DSN | `postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable` |
| 迁移 | `deploy/migrations/*.sql`(compose-up 后 idempotent apply) |

数据保留在 `qzda_pg` 卷;迁移只在首次创建数据卷时执行。

升级:换 minor 镜像后 `make compose-up`(镜像会拉新 tag,但 schema 不会自动升级)。
重置:`make db-reset-dev` → drop schema 后由 qzda-app 重启自动重新 hydrate。
