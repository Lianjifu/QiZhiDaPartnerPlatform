#!/usr/bin/env python3
"""Backward-compat launcher for qzda-agent-runtime FastAPI service."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SERVICE = _ROOT / "services" / "qzda-agent-runtime"
if str(_SERVICE) not in sys.path:
    sys.path.insert(0, str(_SERVICE))

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("DE_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("DE_BIND_PORT", "8091") or "8091")
    print(f"qzda-agent-runtime on http://{host}:{port}")
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
