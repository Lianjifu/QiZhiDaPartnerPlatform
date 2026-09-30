# qzda-rag

FastAPI RAG service on port **8092**. Published-only retrieval with in-memory vector index or optional Milvus.

## Endpoints

- `GET /healthz` — `{status, service, mode, backend, indexed}`
- `POST /v1/retrieve` — semantic search
- `POST /v1/sync` — full reindex
- `POST /v1/ingest` — upsert published docs

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DE_BIND_HOST` | `127.0.0.1` | Bind address |
| `DE_BIND_PORT` | `8092` | Bind port |
| `DE_MILVUS_URI` | — | Milvus URI (optional) |

## Run locally

```bash
cd backend
pip install -r services/qzda-rag/requirements.txt
# optional Milvus:
pip install -r services/qzda-rag/requirements-milvus.txt
python3 runtimes/de_rag/main.py
# or
cd services/qzda-rag && uvicorn app.main:app --host 127.0.0.1 --port 8092
```

## Docker

Per-service Dockerfile includes Milvus deps:

```bash
docker build -t qzda-rag:local backend/services/qzda-rag
docker run -p 8092:8092 -e DE_MILVUS_URI=... qzda-rag:local
```

Compose (`deploy/compose.yml`) builds from `services/qzda-rag/Dockerfile`.
