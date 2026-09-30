"""Agent runtime FastAPI service: Invoke + Run (LoopEvent SSE)."""
from __future__ import annotations

import json
from typing import Any, Iterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.llm import build_run_prompt, chunk_text, env, invoke_openai_compatible
from app.loop import enabled_tools, iter_run_events

app = FastAPI(title="qzda-agent-runtime", version="1.0.0")


def _allow_stub() -> bool:
    v = (env("DE_ALLOW_RUNTIME_STUB") or "").strip().lower()
    return v in ("1", "true", "yes")


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.get("/healthz")
@app.get("/")
def healthz() -> dict[str, str]:
    if env("DE_LLM_BASE_URL"):
        mode = "openai-compatible"
    elif _allow_stub():
        mode = "stub"
    else:
        mode = "unconfigured"
    return {"status": "ok", "service": "agent-runtime", "mode": mode}


@app.post("/v1/invoke")
async def invoke(request: Request) -> Any:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        data = {}
    if not isinstance(data, dict):
        data = {}
    prompt = data.get("input") or data.get("prompt") or ""
    llm = invoke_openai_compatible(
        str(prompt),
        base_url=str(data.get("baseUrl") or data.get("base_url") or "") or None,
        api_key=str(data.get("apiKey") or data.get("api_key") or "") or None,
        model=str(data.get("model") or data.get("modelId") or "") or None,
    )
    if llm is not None:
        return {
            "output": llm,
            "graph": "openai-compatible",
            "nodes": ["ingress", "llm", "egress"],
            "provider": "openai-compatible",
        }
    if not _allow_stub():
        return JSONResponse(
            status_code=503,
            content={
                "error": "E_RUNTIME_UNAVAILABLE",
                "message": "Set DE_LLM_BASE_URL (and optional DE_LLM_API_KEY / DE_LLM_MODEL), or DE_ALLOW_RUNTIME_STUB=1 for legacy stub.",
                "provider": "none",
            },
        )
    return {
        "output": f"[runtime stub] 已处理：{prompt}",
        "graph": "minimal",
        "nodes": ["ingress", "reason", "egress"],
        "provider": "stub",
    }


@app.post("/v1/run")
async def run(request: Request) -> Any:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        data = {}
    if not isinstance(data, dict):
        data = {}
    envelope = data.get("envelope") if isinstance(data.get("envelope"), dict) else {}
    snapshot = data.get("snapshot") if isinstance(data.get("snapshot"), dict) else {}
    corr = str(envelope.get("correlationId") or snapshot.get("correlationId") or data.get("correlationId") or "")
    snap_id = str(snapshot.get("id") or "")
    model_id = str(data.get("modelId") or data.get("model") or "")
    prompt = build_run_prompt(data)
    llm = invoke_openai_compatible(prompt, model=model_id or None)
    provider = "openai-compatible"
    if llm is None:
        if not _allow_stub():
            return JSONResponse(
                status_code=503,
                content={
                    "error": "E_RUNTIME_UNAVAILABLE",
                    "message": "agent-runtime has no LLM; set DE_LLM_BASE_URL or DE_ALLOW_RUNTIME_STUB=1",
                    "correlationId": corr,
                },
            )
        llm = f"[runtime stub] 已处理：{data.get('input') or ''}"
        provider = "stub"

    tools = enabled_tools(data)
    user_input = str(data.get("input") or data.get("prompt") or "")

    def gen() -> Iterator[str]:
        for ev in iter_run_events(
            corr=corr,
            snap_id=snap_id,
            model_id=model_id,
            text=str(llm),
            tools=tools,
            user_input=user_input,
            provider=provider,
            chunks=chunk_text(str(llm), 24),
            snapshot=snapshot,
        ):
            yield _sse(str(ev.get("type") or "message"), ev)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.exception_handler(404)
async def not_found(_request: Request, _exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": "not found"})
