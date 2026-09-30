"""LoopEvent sequence for /v1/run — tool dispatch then answer (parity with Go Harness)."""
from __future__ import annotations

from typing import Any, Iterator

from app.tools import dispatch_tools


def enabled_tools(payload: dict[str, Any]) -> list[str]:
    tools = payload.get("enabledTools") or []
    if not tools:
        snap = payload.get("snapshot") if isinstance(payload.get("snapshot"), dict) else {}
        tools = snap.get("toolRegistry") or []
    out: list[str] = []
    if isinstance(tools, list):
        for t in tools:
            name = str(t).strip()
            if name:
                out.append(name)
    return out


def tool_events(
    tools: list[str],
    *,
    corr: str,
    snap_id: str,
    user_input: str,
    snapshot: dict[str, Any] | None = None,
    retrieve=None,
) -> list[dict[str, Any]]:
    kwargs: dict[str, Any] = {
        "corr": corr,
        "snap_id": snap_id,
        "user_input": user_input,
        "snapshot": snapshot,
    }
    if retrieve is not None:
        kwargs["retrieve"] = retrieve
    return dispatch_tools(tools, **kwargs)


def iter_run_events(
    *,
    corr: str,
    snap_id: str,
    model_id: str,
    text: str,
    tools: list[str],
    user_input: str,
    provider: str,
    chunks: list[str],
    snapshot: dict[str, Any] | None = None,
    retrieve=None,
) -> Iterator[dict[str, Any]]:
    yield {
        "type": "stage",
        "stage": "runtime",
        "status": "running",
        "correlationId": corr,
        "snapshotId": snap_id,
        "modelId": model_id,
        "runtimeMode": "remote",
    }
    for ev in tool_events(
        tools, corr=corr, snap_id=snap_id, user_input=user_input, snapshot=snapshot, retrieve=retrieve
    ):
        yield ev
    for chunk in chunks:
        yield {
            "type": "delta",
            "stage": "runtime",
            "text": chunk,
            "correlationId": corr,
            "snapshotId": snap_id,
            "modelId": model_id,
        }
    yield {
        "type": "done",
        "stage": "done",
        "text": text,
        "correlationId": corr,
        "snapshotId": snap_id,
        "modelId": model_id,
        "mode": "direct",
        "runtimeMode": "remote",
        "provider": provider,
    }
