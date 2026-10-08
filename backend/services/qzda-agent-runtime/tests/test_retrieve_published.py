"""HTTP smoke tests for tools.retrieve_published.

覆盖四条关键路径:正常返回、RAG 不可达、非 dict 响应、publishedOnly=true 契约。
不依赖真实 qzda-rag,用 unittest.mock 拦截网络。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from unittest.mock import MagicMock, patch

# Import from service root (parent of tests/).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.tools import retrieve_published  # noqa: E402


def _mock_urlopen(body_bytes: bytes) -> MagicMock:
    """构造一个 urlopen 返回值:支持 `with` 上下文 + read() 返回 body_bytes。

    关键点:`with urlopen(...) as resp:` 时,resp 绑定到 __enter__() 的返回值,
    MagicMock 默认会返回**另一个**新的 MagicMock,所以必须显式让 __enter__
    返回自身,否则代码侧的 resp.read() 拿到的是未经配置的 MagicMock。
    """
    resp = MagicMock()
    resp.read = MagicMock(return_value=body_bytes)
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def test_retrieve_success() -> None:
    """正常路径:RAG 返回带 results / backend 的响应,字段原样保留 + 补 query/corr。"""
    body = json.dumps(
        {
            "results": [{"docId": "d1", "title": "入职流程"}],
            "backend": "milvus",
        }
    ).encode("utf-8")
    with patch.object(urllib.request, "urlopen", return_value=_mock_urlopen(body)):
        out = retrieve_published("入职流程", correlation_id="c1")
    assert out["results"] == [{"docId": "d1", "title": "入职流程"}]
    assert out["backend"] == "milvus"
    assert out["query"] == "入职流程"
    assert out["correlationId"] == "c1"


def test_retrieve_unavailable() -> None:
    """降级路径:URLError(连接拒绝/超时)→ backend=unavailable 且 results=[]。"""
    with patch.object(
        urllib.request, "urlopen", side_effect=urllib.error.URLError("conn refused")
    ):
        out = retrieve_published("hello", correlation_id="c2")
    assert out == {
        "query": "hello",
        "results": [],
        "backend": "unavailable",
        "correlationId": "c2",
    }


def test_retrieve_non_dict_response() -> None:
    """降级路径:RAG 返回 JSON 数组(非 dict)→ 同样归为 unavailable,不上抛。"""
    with patch.object(urllib.request, "urlopen", return_value=_mock_urlopen(b"[1, 2, 3]")):
        out = retrieve_published("hello", correlation_id="c3")
    assert out["backend"] == "unavailable"
    assert out["results"] == []
    assert out["query"] == "hello"
    assert out["correlationId"] == "c3"


def test_retrieve_published_only_in_payload() -> None:
    """契约:无论是否传 docs,RAG 请求体都带 publishedOnly=true 且不发空 docs 字段。"""
    captured: dict = {}

    def fake_urlopen(req: urllib.request.Request, timeout: float = 0):  # noqa: ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        captured["url"] = req.full_url
        return _mock_urlopen(b'{"results": [], "backend": "stub"}')

    with patch.object(urllib.request, "urlopen", side_effect=fake_urlopen):
        retrieve_published("hello", correlation_id="c4")
    payload = captured["body"]
    assert payload["publishedOnly"] is True
    assert payload["query"] == "hello"
    assert payload["correlationId"] == "c4"
    assert "docs" not in payload  # 未传 docs 时不应带上字段
    assert captured["url"].endswith("/v1/retrieve")


def test_retrieve_passthrough_docs() -> None:
    """契约:显式传 docs 时会原样下发,类型非 list 时 retrieve 不带 docs 字段。"""
    captured: dict = {}

    def fake_urlopen(req: urllib.request.Request, timeout: float = 0):  # noqa: ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _mock_urlopen(b'{"results": [], "backend": "stub"}')

    with patch.object(urllib.request, "urlopen", side_effect=fake_urlopen):
        # 正常传 list: 应原样下发
        retrieve_published("q", docs=["d1", "d2"])
    assert captured["body"]["docs"] == ["d1", "d2"]

    with patch.object(urllib.request, "urlopen", side_effect=fake_urlopen):
        # 传非 list: retrieve_published 内部 isinstance 守卫应过滤,不发 docs
        retrieve_published("q", docs="oops")  # type: ignore[arg-type]
    assert "docs" not in captured["body"]


if __name__ == "__main__":
    test_retrieve_success()
    test_retrieve_unavailable()
    test_retrieve_non_dict_response()
    test_retrieve_published_only_in_payload()
    test_retrieve_passthrough_docs()
    print("agent-runtime retrieve_published tests ok")