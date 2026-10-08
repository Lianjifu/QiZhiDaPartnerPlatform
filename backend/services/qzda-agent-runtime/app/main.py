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
    """判断是否允许在缺少 LLM 配置时降级到本地 stub 实现。

    跟随 QZDA_MODE:仅 dev(未设置视为 dev)允许;pro 或无法识别的值一律拒绝,
    从而触发 503。与控制面 runtimeenv 的 fail-closed 规则一致。
    """
    return (env("QZDA_MODE") or "dev").lower() == "dev"


def _sse(event: str, payload: dict[str, Any]) -> str:
    """把事件字典序列化为单条 SSE 帧:`event: <name>\\ndata: <json>\\n\\n`。

    使用 ensure_ascii=False 以原样保留中文等非 ASCII 字符,避免前端双重转义。
    """
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.get("/healthz")
@app.get("/")
def healthz() -> dict[str, str]:
    """健康检查端点,同时挂载在 /healthz 和 /。

    模式判定(供运维/前端做能力探测):
      - openai-compatible: 已配置 QZDA_LLM_BASE_URL
      - stub            : 未配 base_url 但显式开启 stub 降级
      - unconfigured    : 两者都未配置,所有 LLM 请求会回 503
    """
    if env("QZDA_LLM_BASE_URL"):
        mode = "openai-compatible"
    elif _allow_stub():
        mode = "stub"
    else:
        mode = "unconfigured"
    return {"status": "ok", "service": "agent-runtime", "mode": mode}


@app.post("/v1/invoke")
async def invoke(request: Request) -> Any:
    """单次 /v1/invoke:直接请求 LLM 拿一次性答复,不走 LoopEvent 流。

    请求体容错:JSON 解析失败或非 dict 时降级为 {};prompt 兼容 input/prompt 双字段;
    baseUrl/apiKey/model 同时接受 camelCase 和 snake_case。

    返回路径:
      - LLM 成功: {output, graph, nodes, provider="openai-compatible"}
      - LLM 失败但允许 stub:本地 stub 返回,provider="stub"
      - LLM 失败且不允许 stub:503 + E_RUNTIME_UNAVAILABLE
    """
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
                "message": "Set QZDA_LLM_BASE_URL (and optional QZDA_LLM_API_KEY / QZDA_LLM_MODEL), or run with QZDA_MODE=dev for legacy stub.",
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
    """执行一次 agent run,以 SSE(text/event-stream)流出全部 LoopEvent 事件。

    关键步骤:
      1. 容错解析请求体,从 envelope/snapshot 派生 corr、snap_id、model_id
      2. build_run_prompt 拼装最终 prompt 并调用 LLM;失败时按 stub 策略降级
      3. enabled_tools 抽取本次可调用的工具列表(来自 payload.enabledTools 或 snapshot.toolRegistry)
      4. 内部 gen() 把 iter_run_events 的每个事件用 _sse 包装成 SSE 帧逐条 yield
      5. 返回 StreamingResponse;客户端按 stage=running → tool → delta → done 顺序消费
    """
    # 容错解析请求体:任何异常(空 body / 非法 JSON / Content-Type 不匹配)都视为空 dict,
    # 避免单次坏请求让整个 SSE 连接在还没建立时就崩;后续 isinstance 再保一道类型契约。
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        data = {}
    # FastAPI 实际保证 request.json() 返回 dict,但历史/边界场景(空 body 解析为 None 等)曾
    # 出现非 dict 结果;这里再保一道,把 list / str / None 统一降到 {}。
    if not isinstance(data, dict):
        data = {}

    # envelope / snapshot 都是可选嵌套对象,非 dict 一律视为空;
    # 这样下游 .get() 永远拿到 dict,避免 KeyError / TypeError,链式取值更安全。
    envelope = data.get("envelope") if isinstance(data.get("envelope"), dict) else {}
    snapshot = data.get("snapshot") if isinstance(data.get("snapshot"), dict) else {}

    # correlationId 三路兜底:envelope(主,Go 控制面带的运行信封) > snapshot > 顶层;
    # 空时降级为 "" —— 空串仍可作为日志关联键,不会让下游 str() / json.dumps 触发 NoneType。
    corr = str(envelope.get("correlationId") or snapshot.get("correlationId") or data.get("correlationId") or "")
    snap_id = str(snapshot.get("id") or "")
    model_id = str(data.get("modelId") or data.get("model") or "")

    # build_run_prompt 内部会合并 snapshot.system + enabledTools 工具行,再拼接 user 输入;
    # 这里直接传整张 data,让 llm.py 自己挑字段,职责内聚在 llm 层。
    prompt = build_run_prompt(data)
    # 显式把 model_id 透传给 LLM 客户端;空串归 None,客户端内部会回退到 env 默认 model,
    # 而不是把空串当字面量 model 名发给上游(那会让 LLM 端报 400)。
    llm = invoke_openai_compatible(prompt, model=model_id or None)
    provider = "openai-compatible"
    if llm is None:
        # LLM 不可用且未开 stub 降级,直接 503 拒绝整个 run;
        # 此处不能走 SSE —— 连接还没建立,客户端也还没收到任何事件帧,
        # 返回 JSON 错误响应更符合 HTTP 语义,也方便调用方重试/降级。
        if not _allow_stub():
            return JSONResponse(
                status_code=503,
                content={
                    "error": "E_RUNTIME_UNAVAILABLE",
                    "message": "agent-runtime has no LLM; set QZDA_LLM_BASE_URL or run with QZDA_MODE=dev",
                    "correlationId": corr,
                },
            )
        # stub 路径:用纯字符串占位当 LLM 输出,同时把 provider 标为 "stub",
        # 客户端据此识别这是降级响应(不影响事件流顺序,后续 tool/delta/done 照常发)。
        llm = f"[runtime stub] 已处理：{data.get('input') or ''}"
        provider = "stub"

    # 工具列表与用户输入都从原 data 取(不依赖 LLM 结果),
    # 保证 stub 路径也有完整的 stage → tool → delta → done 事件流,联调时不会断流。
    tools = enabled_tools(data)
    user_input = str(data.get("input") or data.get("prompt") or "")

    def gen() -> Iterator[str]:
        """SSE 帧生成器:把 iter_run_events 的每条事件转成 `event: ...\\ndata: ...\\n\\n` 帧。

        event 名取自 ev.get("type"),缺失时回退为 "message" 以保证 SSE 协议合法。
        """
        # iter_run_events 已经按 stage → tool → delta → done 排好序并把所有工具事件
        # 一次性展开,gen() 只做"逐条 emit",不再二次排序,避免惰性求值打乱顺序。
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
            # ev["type"] 通常是 "stage" / "tool" / "delta" / "done";
            # 缺失时回退 "message" 以保证 SSE 协议合法(SSE 规范要求 event 名非空)。
            yield _sse(str(ev.get("type") or "message"), ev)

    # 返回 text/event-stream 响应;FastAPI 异步消费 gen() 的每个 yield,
    # 浏览器 EventSource / fetch+SSE 客户端按 event 名分发回调,
    # 关闭连接(客户端断开/超时)时 gen() 自动停止迭代,无需手动 cancel。
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.exception_handler(404)
async def not_found(_request: Request, _exc: Exception) -> JSONResponse:
    """FastAPI 全局 404 兜底处理器,统一返回 {error: "not found"}。"""
    return JSONResponse(status_code=404, content={"error": "not found"})
