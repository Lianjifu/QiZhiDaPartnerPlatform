"""OpenAI-compatible LLM adapter with local stub fallback."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def env(name: str, default: str = "") -> str:
    """安全读取环境变量:先取 os.environ,空值/未设置时回退到 default,并自动去除首尾空白。"""
    return (os.environ.get(name) or default).strip()


def invoke_openai_compatible(
    prompt: str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> str | None:
    """调用 OpenAI 兼容的 /chat/completions 聊天接口并返回首条 assistant 内容。

    配置来源(显式参数 > 环境变量):
      - base_url: QZDA_LLM_BASE_URL(未配置则直接返回 None,触发本地 stub 降级)
      - api_key : QZDA_LLM_API_KEY(空字符串时不下发 Authorization 头)
      - model   : QZDA_LLM_MODEL(默认 gpt-4o-mini)
      - timeout : QZDA_LLM_TIMEOUT(默认 20 秒)

    返回:首条 choice.message.content 的字符串;网络/超时/JSON 解析异常或无 choices 时返回 None。
    """
    base = (base_url or env("QZDA_LLM_BASE_URL")).strip()
    if not base:
        return None
    key = (api_key if api_key is not None else env("QZDA_LLM_API_KEY")).strip()
    model_name = (model or env("QZDA_LLM_MODEL", "gpt-4o-mini")).strip() or "gpt-4o-mini"
    url = base.rstrip("/") + "/chat/completions"
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": "You are a digital-employee runtime assistant."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {key}"} if key else {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=float(env("QZDA_LLM_TIMEOUT", "20"))) as resp:
            body = json.loads(resp.read().decode() or "{}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None
    choices = body.get("choices") or []
    if not choices:
        return None
    msg = (choices[0].get("message") or {}).get("content")
    return str(msg) if msg else None


def chunk_text(text: str, size: int = 24) -> list[str]:
    """将文本按字符切分为定长片段(按 Unicode 码点遍历,不依赖 grapheme 聚类)。

    - size <= 0:不切分,整体作为一个片段返回
    - text 为空:返回空列表
    - 默认 size=24,适合做流式输出/打字机效果
    """
    chars = list(text or "")
    if size <= 0:
        return [text]
    return ["".join(chars[i : i + size]) for i in range(0, len(chars), size)]


def build_run_prompt(payload: dict) -> str:
    """根据执行 payload 拼装最终送给 LLM 的提示词。

    组成顺序(空段自动跳过):
      1. system 段:取自 snapshot.system;若 enabledTools / snapshot.toolRegistry 非空,
         追加一行 "enabled tools: ..." 到 system 末尾
      2. user 段:取自 payload.input(优先)或 payload.prompt
      3. 用 "\\n\\n" 连接 system + user;若 system 为空则只返回 user

    容错:类型不匹配(非 dict 快照 / 非列表工具)时降级为安全默认值。
    """
    snapshot = payload.get("snapshot") if isinstance(payload.get("snapshot"), dict) else {}
    system = str(snapshot.get("system") or "").strip()
    user = str(payload.get("input") or payload.get("prompt") or "").strip()
    tools = payload.get("enabledTools") or snapshot.get("toolRegistry") or []
    
    if isinstance(tools, list) and tools:
        tool_line = "enabled tools: " + ", ".join(str(t) for t in tools if t)
        system = (system + "\n" + tool_line).strip() if system else tool_line
    if system:
        return system + "\n\n" + user
    return user

