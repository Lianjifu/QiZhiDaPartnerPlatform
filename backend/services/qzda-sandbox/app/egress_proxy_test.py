"""出口代理集成测试:启动本地代理 + 用 urllib 验证 CONNECT / 绝对 URI 拦截。

不需要外网——通过本地 loopback 模拟上游(upstream echo server)。
"""
from __future__ import annotations

import http.client
import http.server
import socket
import socketserver
import threading
import time
import urllib.request

import pytest

from app.egress_proxy import EgressProxy


class _UpstreamEcho:
    """最小 HTTP echo server:返回 200 + body "hello"."""

    def __init__(self) -> None:
        self._srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _UpstreamHandler)
        self._srv.daemon_threads = True
        self._thread = threading.Thread(target=self._srv.serve_forever, daemon=True)
        self._thread.start()
        self.port = self._srv.server_address[1]

    def stop(self) -> None:
        self._srv.shutdown()
        self._srv.server_close()


class _UpstreamHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002
        return

    def do_GET(self):  # noqa: N802
        body = b"hello-from-upstream"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(body)

    def do_CONNECT(self):  # noqa: N802
        # 这层不期望有 CONNECT 进来;不过兼容一下避免破坏连接
        self.send_error(400, "echo server does not support CONNECT")


def _wait_for_port(host: str, port: int, timeout: float = 2.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError(f"port {host}:{port} not ready in {timeout}s")


@pytest.fixture
def upstream() -> _UpstreamEcho:
    s = _UpstreamEcho()
    try:
        yield s
    finally:
        s.stop()


@pytest.fixture
def proxy(upstream: _UpstreamEcho) -> EgressProxy:
    # 用 0 端口让 OS 分配空闲,避免与并行测试抢端口
    p = EgressProxy(bind_host="127.0.0.1", bind_port=0)
    p.start()
    # 我们用的是动态端口,但 EgressProxy 暴露的 bind_port 是 0——读真实端口
    real_port = p._server.server_address[1]  # type: ignore[union-attr]
    p.bind_port = real_port  # type: ignore[misc]
    yield p
    p.stop()


def _host_port(p: EgressProxy) -> tuple[str, int]:
    return p.bind_host, p.bind_port  # type: ignore[return-value]


def test_set_allowed_lowercases(proxy: EgressProxy) -> None:
    proxy.set_allowed(["WTTR.in", "  api.weather.gov "])
    assert "wttr.in" in proxy.allowed
    assert "api.weather.gov" in proxy.allowed
    assert "WTTR.in" not in proxy.allowed


def test_set_allowed_clears_used(proxy: EgressProxy) -> None:
    proxy.set_allowed(["wttr.in"])
    proxy._record_used("wttr.in")
    assert proxy.used_hosts() == ["wttr.in"]
    proxy.set_allowed(["wttr.in", "api.weather.gov"])
    assert proxy.used_hosts() == [], "set_allowed 必须清零 used_hosts,防串扰"


def test_absolute_uri_allowed(proxy: EgressProxy, upstream: _UpstreamEcho) -> None:
    """绝对 URI GET 走 _do_forward,host 在 allowlist 时透传到 upstream。"""
    proxy.set_allowed(["127.0.0.1"])
    host, port = _host_port(proxy)
    # urllib 默认发的是 `GET / HTTP/1.1` 而非 absolute URI,会让代理 403。
    # 用 http.client 直接拼 absolute URI 触发代理的 _do_forward 路径。
    conn = http.client.HTTPConnection(host, port, timeout=5)
    try:
        conn.request("GET", f"http://127.0.0.1:{upstream.port}/")
        resp = conn.getresponse()
        assert resp.status == 200, f"allowed host 应透传: got {resp.status}"
        assert resp.read() == b"hello-from-upstream"
    finally:
        conn.close()
    assert "127.0.0.1" in proxy.used_hosts()


def test_absolute_uri_denied(proxy: EgressProxy, upstream: _UpstreamEcho) -> None:
    proxy.set_allowed(["wttr.in"])
    host, port = _host_port(proxy)
    # 用 urlopen + Request 拿不到 error message,改用 http.client 直接拼
    conn = http.client.HTTPConnection(host, port, timeout=5)
    try:
        conn.request("GET", f"http://127.0.0.1:{upstream.port}/")
        resp = conn.getresponse()
        assert resp.status == 502, f"disallowed host 应被 502: got {resp.status}"
        body = resp.read().decode("utf-8", errors="replace")
        assert "egress denied" in body
    finally:
        conn.close()
    # 即使 upstream 真能响应,代理层也要先拒
    assert "127.0.0.1" in proxy.denied_hosts()