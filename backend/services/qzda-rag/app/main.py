"""RAG FastAPI service: published-only retrieve with pgvector or in-memory fallback.

pgvector 是单进程 Docker 部署的默认推荐 backend:向量存在控制面同一个
PostgreSQL 实例的 `rag_published_docs` 表(vector(64) + cosine distance),
无需额外容器,事务 / 备份 / 复制路径与控制面一致。

未配置 `QZDA_PGVECTOR_URL` 或 `QZDA_DATABASE_URL` 时回退到进程内 vector-memory
(适合 demo / 离线环境,数据不持久)。
"""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.vector import COLLECTION, DIM, PgVectorIndex, VectorIndex, build_index, dense_embed

INDEX, BACKEND = build_index()

app = FastAPI(title="qzda-rag", version="1.0.0")


def _indexed_count() -> int:
    if BACKEND == "pgvector":
        try:
            with INDEX.conn.cursor() as cur:  # type: ignore[attr-defined]
                cur.execute(f"SELECT COUNT(*) FROM {INDEX.table}")  # type: ignore[attr-defined]
                return int(cur.fetchone()[0])
        except Exception:  # noqa: BLE001
            return 0
    if BACKEND == "vector-memory":
        return len(getattr(INDEX, "docs", []) or [])
    return 0


@app.get("/healthz")
@app.get("/")
def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "rag",
        "mode": "published-only",
        "backend": BACKEND,
        "indexed": _indexed_count(),
    }


@app.post("/v1/retrieve")
async def retrieve(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        data = {}
    if not isinstance(data, dict):
        data = {}
    corr = data.get("correlationId") or ""
    # Explicit docs payload (including empty list) scopes search to that corpus.
    # Always uses VectorIndex (in-memory) so caller payload never touches the
    # process-global PG table — only admin sync/ingest writes to pgvector.
    if "docs" in data:
        docs = data.get("docs") or []
        tmp = VectorIndex()
        tmp.reindex(docs if isinstance(docs, list) else [])
        results = tmp.search(data.get("query") or "")
        backend = "vector-memory"
    else:
        results = INDEX.search(data.get("query") or "")
        backend = BACKEND
    return {
        "query": data.get("query"),
        "results": results,
        "backend": backend,
        "correlationId": corr,
        "publishedOnly": True,
    }


@app.post("/v1/sync")
async def sync(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        data = {}
    if not isinstance(data, dict):
        data = {}
    docs = data.get("docs") or []
    if BACKEND == "pgvector":
        # For pgvector backend: TRUNCATE + re-insert via reindex().
        # If we have an ingest() method that supports upsert, prefer it.
        if hasattr(INDEX, "ingest"):
            n = INDEX.ingest(docs)  # type: ignore[attr-defined]
        else:
            n = INDEX.reindex(docs)
    else:
        n = INDEX.reindex(docs)
    return {"indexed": n, "backend": BACKEND}


@app.post("/v1/ingest")
async def ingest(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        data = {}
    if not isinstance(data, dict):
        data = {}
    docs = data.get("docs") or []
    if hasattr(INDEX, "ingest"):
        n = INDEX.ingest(docs)
    else:
        n = INDEX.reindex(docs)
    return {"indexed": n, "backend": BACKEND, "mode": "ingest"}


@app.post("/v1/embed")
async def embed(request: Request) -> dict[str, Any]:
    """返回单条文本的 64-dim dense 向量(与 pgvector backend 同口径)。

    给 Go 控制面(memory / context 语义检索)用,免去在 Go 侧复制 dense_embed
    哈希逻辑。后续若启用真实 LLM embedder,这里只需替换 dense_embed 调用,
    路由契约不变。
    """
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        data = {}
    if not isinstance(data, dict):
        data = {}
    text = (data.get("text") or "").strip()
    if not text:
        return {"dim": DIM, "vector": []}
    return {"dim": DIM, "vector": dense_embed(text), "backend": BACKEND}


@app.exception_handler(404)
async def not_found(_request: Request, _exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": "not found"})
