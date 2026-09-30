"""OpenAI-compatible LLM adapter with local stub fallback."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def invoke_openai_compatible(
    prompt: str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> str | None:
    base = (base_url or env("DE_LLM_BASE_URL")).strip()
    if not base:
        return None
    key = (api_key if api_key is not None else env("DE_LLM_API_KEY")).strip()
    model_name = (model or env("DE_LLM_MODEL", "gpt-4o-mini")).strip() or "gpt-4o-mini"
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
        with urllib.request.urlopen(req, timeout=float(env("DE_LLM_TIMEOUT", "20"))) as resp:
            body = json.loads(resp.read().decode() or "{}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None
    choices = body.get("choices") or []
    if not choices:
        return None
    msg = (choices[0].get("message") or {}).get("content")
    return str(msg) if msg else None


def chunk_text(text: str, size: int = 24) -> list[str]:
    chars = list(text or "")
    if size <= 0:
        return [text]
    return ["".join(chars[i : i + size]) for i in range(0, len(chars), size)]


def build_run_prompt(payload: dict) -> str:
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

