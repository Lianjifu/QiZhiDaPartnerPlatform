#!/usr/bin/env python3
"""Backward-compat launcher and test re-exports for qzda-rag FastAPI service."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SERVICE = _ROOT / "services" / "qzda-rag"
if str(_SERVICE) not in sys.path:
    sys.path.insert(0, str(_SERVICE))

from app.main import BACKEND, INDEX  # noqa: E402,F401
from app.vector import (  # noqa: E402,F401
    COLLECTION,
    DEFAULT_PUBLISHED,
    DIM,
    MilvusIndex,
    VectorIndex,
    build_index,
    cosine,
    dense_embed,
    embed,
    tokenize,
)

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("DE_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("DE_BIND_PORT", "8092"))
    print(f"qzda-rag on http://{host}:{port} backend={BACKEND}")
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
