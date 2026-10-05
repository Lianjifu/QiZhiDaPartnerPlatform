# qzda-rag

FastAPI RAG service on port **8092**. Published-only retrieval with **pgvector**
(默认,同 PG 实例) 或 in-memory `vector-memory` 回退。

## Endpoints

- `GET /healthz` — `{status, service, mode, backend, indexed}`
- `POST /v1/retrieve` — semantic search
- `POST /v1/sync` — full reindex (pgvector backend 用 TRUNCATE + 重建)
- `POST /v1/ingest` — upsert published docs (pgvector 用 ON CONFLICT)

## Vector backend 选择

按 env 顺序回退:

1. **`pgvector`** — 设置 `QZDA_PGVECTOR_URL`(默认 = `QZDA_DATABASE_URL`)
   - 启动期 `CREATE EXTENSION IF NOT EXISTS vector` + `CREATE TABLE rag_published_docs (..., vector(64))`
   - reindex:TRUNCATE + 重建;ingest:ON CONFLICT (id) DO UPDATE
   - search:`1 - (vector <=> $1::vector)` cosine distance,取 top-k
   - 控制面 PG 已有,免额外容器;与平台 KV / audit 共享事务 / 备份路径
2. **`vector-memory`** — `QZDA_PGVECTOR_URL=vector-memory` 显式回退 / env 未设
   - 进程内 dict 稀疏向量,启动快,数据不持久,适合 demo

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `QZDA_BIND_HOST` | `127.0.0.1` | Bind address |
| `QZDA_BIND_PORT` | `8092` | Bind port |
| `QZDA_PGVECTOR_URL` | (fallback to `QZDA_DATABASE_URL`) | pgvector DSN。容器内默认 `postgres://de:de@postgres:5432/digital_employee?sslmode=disable` |

## Run locally

```bash
cd backend
pip install -r services/qzda-rag/requirements.txt
python3 services/qzda-rag/main.py
# or
cd services/qzda-rag && uvicorn app.main:app --host 127.0.0.1 --port 8092
```

## Docker

```bash
docker build -t qzda-rag:local backend
docker run -p 8092:8092 -e QZDA_PGVECTOR_URL=... qzda-rag:local
```

Compose (`deploy/compose.yml`) 自动 build + 注入 `QZDA_PGVECTOR_URL`
(默认 `postgres://de:de@postgres:5432/digital_employee?sslmode=disable`)。
PG 镜像为 `pgvector/pgvector:pg16-alpine`(自带 vector 扩展);
启动期由 `deploy/migrations/0004_pgvector.sql` 创建 `rag_published_docs` 表。
