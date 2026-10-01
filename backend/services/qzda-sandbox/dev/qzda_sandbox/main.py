#!/usr/bin/env python3
"""Backward-compat launcher and test re-exports for qzda-sandbox FastAPI service."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SERVICE = _ROOT / "services" / "qzda-sandbox"
if str(_SERVICE) not in sys.path:
    sys.path.insert(0, str(_SERVICE))

from app.sandbox import verify_run_token  # noqa: E402,F401

if __name__ == "__main__":
    import uvicorn

    from app.sandbox import strip_forbidden_env

    strip_forbidden_env()
    os.environ.setdefault("DE_SANDBOX_REQUIRE_ISOLATION", "0")
    host = os.environ.get("DE_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("DE_BIND_PORT", "8093"))
    from app.sandbox import sandbox_mode

    print(f"qzda-sandbox on http://{host}:{port} sandbox={sandbox_mode()} (no control-plane DSN)")
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
