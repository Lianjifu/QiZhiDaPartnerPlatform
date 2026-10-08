"""LoopEvent sequence for /v1/run — tool dispatch then answer (parity with Go Harness)."""
from __future__ import annotations

from typing import Any, Iterator

from app.tools import dispatch_tools


def enabled_tools(payload: dict[str, Any]) -> list[str]:
    """从运行 payload 中提取本次可调用的工具名列表。

    来源优先级:
      1. payload["enabledTools"] —— 调用方在请求体里显式声明
      2. payload["snapshot"]["toolRegistry"] —— 快照里的工具注册表(snapshot 非 dict 时降级为空)

    清洗:仅保留去掉首尾空白后非空的字符串,返回新列表,不修改原数据。
    """
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
    """为指定工具列表生成一段 LoopEvent 序列(调用 app.tools.dispatch_tools 实现)。

    透传 corr/snap_id/user_input/snapshot 给分发层;retrieve 仅在显式传入时才放进 kwargs,
    避免下游默认实现被 None 覆盖。返回完整事件列表(非迭代器),由调用方决定如何流出。
    """
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
    """按固定顺序产出一次 /v1/run 调用的全部 LoopEvent,用于 SSE 流式下发。

    事件顺序(与 Go Harness 保持对齐):
      1. stage=running —— 启动事件,runtimeMode=remote,标识 runtime 进入运行态
      2. tool_events —— 按 tools 顺序逐个分发工具并产出对应事件
      3. delta —— 按 chunks 顺序逐片下发模型增量文本(每片一条 delta 事件)
      4. done —— 终止事件,汇总最终 text、provider、runtimeMode,客户端据此收尾

    说明:这是一个生成器;在所有 delta/done 之前,tool 事件以完整列表先展开再 yield,
    保证运行期事件顺序确定,不被下游惰性求值打乱。
    """
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
