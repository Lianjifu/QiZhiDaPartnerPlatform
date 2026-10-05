"""Sidecar tool dispatch for /v1/run — knowledge.retrieve hits qzda-rag; other tools use snapshot."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def retrieve_published(
    query: str,
    *,
    rag_url: str | None = None,
    correlation_id: str = "",
    docs: list[Any] | None = None,
    timeout: float = 3.0,
) -> dict[str, Any]:
    base = (rag_url or env("QZDA_RAG_URL") or "http://127.0.0.1:8092").rstrip("/")
    payload: dict[str, Any] = {"query": query, "correlationId": correlation_id, "publishedOnly": True}
    if docs is not None:
        payload["docs"] = docs
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        base + "/v1/retrieve",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode() or "{}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return {"query": query, "results": [], "backend": "unavailable", "correlationId": correlation_id}
    if not isinstance(body, dict):
        return {"query": query, "results": [], "backend": "unavailable", "correlationId": correlation_id}
    body.setdefault("query", query)
    body.setdefault("correlationId", correlation_id)
    return body


def dispatch_tools(
    tools: list[str],
    *,
    corr: str,
    snap_id: str,
    user_input: str,
    snapshot: dict[str, Any] | None = None,
    retrieve: Callable[..., dict[str, Any]] = retrieve_published,
) -> list[dict[str, Any]]:
    snap = snapshot if isinstance(snapshot, dict) else {}
    events: list[dict[str, Any]] = []
    if "knowledge.retrieve" in tools:
        hits = retrieve(user_input, correlation_id=corr)
        results = hits.get("results") if isinstance(hits, dict) else []
        n = len(results) if isinstance(results, list) else 0
        events.append(
            {
                "type": "tool",
                "stage": "react",
                "name": "knowledge.retrieve",
                "status": "ok",
                "id": "tc_bootstrap_kr",
                "correlationId": corr,
                "snapshotId": snap_id,
                "args": {"query": user_input},
                "hits": results if isinstance(results, list) else [],
                "hitCount": n,
                "backend": (hits or {}).get("backend") if isinstance(hits, dict) else "",
            }
        )
    for name in tools:
        if name == "knowledge.retrieve":
            continue
        if name == "memory.recall":
            prov = snap.get("memoryProvenance") or []
            events.append(
                {
                    "type": "tool",
                    "stage": "react",
                    "name": "memory.recall",
                    "status": "ok",
                    "id": "tc_memory_recall",
                    "correlationId": corr,
                    "snapshotId": snap_id,
                    "hits": prov if isinstance(prov, list) else [],
                    "source": "snapshot",
                }
            )
            continue
        events.append(
            {
                "type": "tool",
                "stage": "react",
                "name": name,
                "status": "skipped",
                "id": f"tc_{name.replace('.', '_')}",
                "correlationId": corr,
                "snapshotId": snap_id,
                "reason": "sidecar observes registry; execution stays on Go until remote dispatch is complete",
            }
        )
    return events
