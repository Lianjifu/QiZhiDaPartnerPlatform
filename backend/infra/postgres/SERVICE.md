# infra/postgres

| 项 | 值 |
|----|----|
| 镜像 | postgres:16-alpine |
| 端口 | 5432 |
| Compose | 默认（无 profile） |
| 消费者 | **qzda-app**（monolith）或 qzda-sys / qzda-collab / qzda-cap / qzda-workflow（coarse） |
| DSN | `postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable` |
| 迁移 | `deploy/migrations/*.sql`（compose-up 后 idempotent apply） |

备份：`pg_dump` / 卷 `qzda_pg`。升级：换 minor 镜像后 `make compose-up`。
