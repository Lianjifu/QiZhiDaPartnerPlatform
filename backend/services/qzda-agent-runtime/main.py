#!/usr/bin/env python3
"""Launcher for qzda-agent-runtime FastAPI service.

Run from the service root (services/qzda-agent-runtime/) so the
relative import `app.main:app` resolves; mirrors the Dockerfile's
`uvicorn app.main:app` command.
"""
from __future__ import annotations

import os

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("QZDA_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("QZDA_BIND_PORT", "8091") or "8091")
    print(f"qzda-agent-runtime on http://{host}:{port}")
    uvicorn.run("app.main:app", host=host, port=port, reload=False)