#!/usr/bin/env python3
"""wttr.in weather lookup for the ``weather`` skill.

阶段 2:此脚本被 Python 沙箱 fork 出子进程执行,
会通过 HTTPS_PROXY=http://127.0.0.1:8080 走出口代理。
代理只放行 ``SKILL.md`` front-matter ``egress`` 字段声明的域名(此处为 ``wttr.in``),
其它域名一律 502。

不要在本脚本里直接 ``pip install requests`` — 镜像只装了 stdlib +
python-docx + fastapi/uvicorn,加包要走 ``SkillContainer`` 提单。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

# SKILL.md front-matter 中声明的域名,与 Python 沙箱注入的
# QZDA_SANDBOX_ALLOWED_EGRESS 列表一致。子进程 bootstrap 还会把
# socket.getaddrinfo monkey-patch 掉,IP literal 也走不了。
ALLOWED_HOST = "wttr.in"
DEFAULT_TIMEOUT = 10.0


def get_weather(city: str) -> str:
    """请求 wttr.in 拿一行人类可读的天气。出错抛 RuntimeError 让调用方处理。"""
    city = (city or "").strip()
    if not city:
        raise RuntimeError("missing city argument")
    # wttr.in ?format=3 返回形如 "London: 🌧 +12°C" 的简短摘要。
    url = f"https://{ALLOWED_HOST}/{urllib.request.quote(city)}?format=3"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "qzda-sandbox/1.0 (+https://wttr.in)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as resp:
            body = resp.read().decode("utf-8", errors="replace").strip()
    except urllib.error.HTTPError as exc:
        # 502 一般意味着 wttr.in 不在 allowlist 或被代理拒绝(理论上不该发生,
        # 但要让日志明确反映原因)。
        raise RuntimeError(
            f"egress denied or upstream refused: HTTP {exc.code} for {exc.url}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"network error: {exc.reason}") from exc
    if not body:
        raise RuntimeError("empty response from wttr.in")
    return body


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: weather.py <city>", file=sys.stderr)
        return 1
    city = " ".join(argv[1:]).strip()
    try:
        line = get_weather(city)
    except RuntimeError as exc:
        msg = str(exc)
        if "denied" in msg.lower():
            print(f"egress denied: {msg}", file=sys.stderr)
            return 2
        print(f"weather lookup failed: {msg}", file=sys.stderr)
        return 1
    print(line)
    # 顺手把 allowedEgress / runtime 写到一行 JSON 注释,便于审计 grep;
    # 真正的 egressUsed/egressDenied 由 Python 沙箱在响应里聚合回控制面。
    print(
        json.dumps(
            {
                "city": city,
                "allowedEgress": os.environ.get("QZDA_SANDBOX_ALLOWED_EGRESS", ""),
                "httpsProxy": os.environ.get("HTTPS_PROXY", ""),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))