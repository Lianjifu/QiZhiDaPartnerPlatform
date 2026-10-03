#!/usr/bin/env python3
"""Launcher for qzda-rag FastAPI service.

Run from the service root (services/qzda-rag/) so the relative
import `app.main:app` resolves; mirrors the Dockerfile's
`uvicorn app.main:app` command. Also re-exports `BACKEND` and
`INDEX` so smoke tests can `from main import ...`.
"""
from __future__ import annotations

import os

if __name__ == "__main__":
    import uvicorn

    from app.main import BACKEND, INDEX  # noqa: F401

    host = os.environ.get("DE_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("DE_BIND_PORT", "8092") or "8092")
    print(f"qzda-rag on http://{host}:{port} backend={BACKEND}")
    uvicorn.run("app.main:app", host=host, port=port, reload=False)