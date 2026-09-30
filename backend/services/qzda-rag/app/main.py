"""RAG FastAPI service: published-only retrieve with vector-memory or optional Milvus."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.vector import COLLECTION, VectorIndex, build_index

INDEX, BACKEND = build_index()

app = FastAPI(title="qzda-rag", version="1.0.0")


def _indexed_count() -> int:
    n = len(getattr(INDEX, "docs", []) or [])
    if BACKEND == "milvus":
        try:
            n = INDEX.client.get_collection_stats(COLLECTION).get("row_count", n)  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass
    return n


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
    # Avoid falling through to the process-global INDEX, which may contain demo seeds.
    if "docs" in data:
        docs = data.get("docs") or []
        if BACKEND != "milvus":
            tmp = VectorIndex()
            tmp.reindex(docs if isinstance(docs, list) else [])
            results = tmp.search(data.get("query") or "")
            backend = "vector-memory"
        else:
            INDEX.reindex(docs if isinstance(docs, list) else [])
            results = INDEX.search(data.get("query") or "")
            backend = BACKEND
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


@app.exception_handler(404)
async def not_found(_request: Request, _exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": "not found"})
