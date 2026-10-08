"""Sidecar tool dispatch for /v1/run — knowledge.retrieve hits qzda-rag; other tools use snapshot."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable


def env(name: str, default: str = "") -> str:
    """安全读取环境变量:先取 os.environ,空值/未设置时回退到 default,并自动去除首尾空白。"""
    return (os.environ.get(name) or default).strip()


def retrieve_published(
    query: str,
    *,
    rag_url: str | None = None,
    correlation_id: str = "",
    docs: list[Any] | None = None,
    timeout: float = 3.0,
) -> dict[str, Any]:
    """调用 qzda-rag 的 /v1/retrieve 端点做已发布(publishedOnly=true)知识检索。

    端点来源(显式参数 > 环境变量 > 默认本地端口):
      - rag_url        : QZDA_RAG_URL,默认 http://127.0.0.1:8092
      - timeout        : 3.0 秒
      - docs           : 可选 scope 限定,仅当显式传入时才下发

    返回:始终是 dict,至少包含 query / correlationId;网络/超时/JSON 异常或响应
    非 dict 时降级为 {"results": [], "backend": "unavailable"} 形状,避免上游崩溃。
    """
    base = (rag_url or env("QZDA_RAG_URL") or "http://127.0.0.1:8092").rstrip("/")
    payload: dict[str, Any] = {"query": query, "correlationId": correlation_id, "publishedOnly": True}
    # 类型守卫:只接受 list;非 list 一律视为未提供,避免把 str / dict 误塞给 RAG 端。
    if isinstance(docs, list):
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
    """把本次启用的工具列表展开为一段 LoopEvent(type=tool)事件序列。

    分发策略:
      - knowledge.retrieve:调用 retrieve(默认 retrieve_published)取 hits,
        产出 status=ok 事件,附带 hitCount / hits / backend 字段;
        snapshot.docs 若存在会作为 scope 限定透传给 retrieve(类型非 list 时忽略)
      - memory.recall:直接从 snapshot.memoryProvenance 取已缓存的来源列表,
        不发起网络请求,产出 source="snapshot" 事件,并附带 snapshot.capturedAt
        作为 asOf 时间戳,缺失时降级为空串
      - 其它工具:产出 status=skipped 事件,reason 标明 sidecar 只观测注册,
        真正执行仍由 Go Harness 负责(remote dispatch 尚未完全接入)

    返回顺序:先 knowledge.retrieve,再按 tools 原顺序遍历其余工具(并跳过 kr)。
    retrieve 参数可在测试时替换为 stub,默认实现负责打 qzda-rag。
    """
    snap = snapshot if isinstance(snapshot, dict) else {}
    events: list[dict[str, Any]] = []

    # 透传 snapshot.docs 给 retrieve_published 作为 RAG 端 scope 限定;
    # 非 list 一律视为未提供,避免下游收到畸形 docs 触发 4xx。
    docs = snap.get("docs") if isinstance(snap.get("docs"), list) else None
    # 快照捕获时间(Go 控制面在生成 snapshot 时打的墙钟戳,ISO 8601);
    # 客户端据此判断 memory.recall 事件的新旧;缺失时降级为空串,不臆造。
    as_of = str(snap.get("capturedAt") or snap.get("now") or "")

    if "knowledge.retrieve" in tools:
        hits = retrieve(user_input, correlation_id=corr, docs=docs)
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
                "backend": hits.get("backend", "") if isinstance(hits, dict) else "",
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
                    "asOf": as_of,
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
