#!/usr/bin/env python3
"""Launcher for qzda-sandbox FastAPI service.

Run from the service root (services/qzda-sandbox/) so the relative
import `app.main:app` resolves; mirrors the Dockerfile's
`uvicorn app.main:app` command.
"""
from __future__ import annotations

import os

if __name__ == "__main__":
    import uvicorn

    from app.sandbox import sandbox_mode, strip_forbidden_env

    strip_forbidden_env()
    os.environ.setdefault("QZDA_SANDBOX_REQUIRE_ISOLATION", "0")
    host = os.environ.get("QZDA_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("QZDA_BIND_PORT", "8093") or "8093")
    print(f"qzda-sandbox on http://{host}:{port} sandbox={sandbox_mode()} (no control-plane DSN)")
    uvicorn.run("app.main:app", host=host, port=port, reload=False)