"""技能沙箱的出口代理:127.0.0.1:8080 stdlib HTTP 代理。

为什么要有这个:
- ``socket.getaddrinfo`` monkey-patch 只能拦住 Python stdlib。
- 真正执行 skill 脚本的子进程可能是 curl / urllib3 / node fetch / Go net/http,
  都会自动读 ``HTTPS_PROXY`` / ``HTTP_PROXY`` 环境变量。
- 我们的子进程环境里强制注入 ``HTTPS_PROXY=http://127.0.0.1:8080``,
  所有"守规矩"的 HTTP 客户端会先连本地代理。
- 代理只放行 allowlist 内的域名,其他 → 502。

支持的协议:
- ``CONNECT host:port HTTP/1.1`` (HTTPS 隧道,主要场景)
- ``GET http://host/path HTTP/1.1`` 绝对 URI (HTTP 代理,部分 client 默认)
- ``GET /path HTTP/1.1`` 不带 host — 视为本地 fetch,不查 allowlist,
  但通常 skill 不会走这条路;直接放行避免误伤。

不做:
- 不做 SOCKS 代理(技能客户端不会用)。
- 不做 TLS 终结(只是透传字节)。
- 不重试 / 不持久连接优化;skill 短链 1 次调用最多几十个请求,性能 OK。

线程模型:
- 单实例 + 后台 daemon 线程跑 HTTPServer。
- ``set_allowed`` 由 FastAPI request 路径调用(锁保护)。
- 每次代理请求结束记录 used_hosts,供审计聚合。
"""
from __future__ import annotations

import http.client
import http.server
import socket
import socketserver
import threading
from typing import Iterable

from app.egress import host_allowed


class _ProxyHandler(http.server.BaseHTTPRequestHandler):
    """按 BaseHTTPRequestHandler 协议处理 CONNECT + 绝对 URI GET/POST。

    实例属性由 ``EgressProxy.server`` 在 handle 前注入
    (``server.allowed`` / ``server.used`` / ``server.lock``),
    通过 server 间接拿,避免 protocol_version 改动。
    """

    # 关闭默认 access log(每条请求都打 stderr 太吵;真正排查用 egress_used)
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    # ---- CONNECT:HTTPS 隧道 -----------------------------------------------
    def do_CONNECT(self) -> None:
        # path 形如 "wttr.in:443"
        target = self.path
        if ":" not in target:
            self.send_error(400, "bad CONNECT target")
            return
        host, _, port_s = target.rpartition(":")
        try:
            port = int(port_s)
        except ValueError:
            self.send_error(400, "bad CONNECT port")
            return
        proxy: "EgressProxy" = self.server._proxy  # type: ignore[attr-defined]
        if not host_allowed(host, proxy.allowed):
            proxy._record_denied(host)
            self.send_error(502, f"egress denied: {host} not in allowlist")
            return
        try:
            upstream = socket.create_connection((host, port), timeout=10)
        except OSError as exc:
            self.send_error(502, f"upstream connect failed: {exc}")
            return
        proxy._record_used(host)
        # 200 响应后做裸 socket 桥接
        try:
            self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            self.wfile.flush()
        except OSError:
            upstream.close()
            return
        self._tunnel(upstream)

    def _tunnel(self, upstream: socket.socket) -> None:
        """在客户端与 upstream 之间双向拷贝。"""
        client = self.connection
        client.settimeout(None)
        upstream.settimeout(None)
        import select

        try:
            while True:
                r, _, _ = select.select([client, upstream], [], [], 60)
                if not r:
                    break
                for s in r:
                    other = upstream if s is client else client
                    try:
                        data = s.recv(8192)
                    except OSError:
                        return
                    if not data:
                        return
                    try:
                        other.sendall(data)
                    except OSError:
                        return
        finally:
            upstream.close()

    # ---- 绝对 URI / 普通 GET/POST ----------------------------------------
    def _do_forward(self, method: str) -> None:
        # 区分"绝对 URI"(代理模式)和"普通 path"(直连模式,本服务不会跑在边缘)
        if self.path.startswith("http://") or self.path.startswith("https://"):
            from urllib.parse import urlparse

            u = urlparse(self.path)
            host = (u.hostname or "").lower()
            proxy: "EgressProxy" = self.server._proxy  # type: ignore[attr-defined]
            if not host_allowed(host, proxy.allowed):
                proxy._record_denied(host)
                self.send_error(502, f"egress denied: {host} not in allowlist")
                return
            proxy._record_used(host)
            # 转发到上游
            if u.scheme == "http":
                conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=10)
            else:
                conn = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=10)
            try:
                # 把 path + query 重新拼回
                full = u.path or "/"
                if u.query:
                    full += "?" + u.query
                # 剥掉 proxy-only headers
                headers = {k: v for k, v in self.headers.items()
                           if k.lower() not in ("proxy-connection",)}
                conn.request(method, full, body=self.rfile.read(int(self.headers.get("Content-Length") or 0))
                            if self.headers.get("Content-Length") else None,
                            headers=headers)
                resp = conn.getresponse()
                self.send_response(resp.status, resp.reason)
                for k, v in resp.getheaders():
                    if k.lower() in ("transfer-encoding", "connection"):
                        continue
                    self.send_header(k, v)
                self.end_headers()
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except OSError as exc:
                self.send_error(502, f"upstream error: {exc}")
            finally:
                try:
                    conn.close()
                except Exception:  # noqa: BLE001
                    pass
            return
        # 普通 path — 不是代理语义,403 即可,避免误判为本地服务
        self.send_error(403, "proxy expects absolute URI or CONNECT")

    def do_GET(self) -> None:  # noqa: N802
        self._do_forward("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._do_forward("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self._do_forward("PUT")

    def do_DELETE(self) -> None:  # noqa: N802
        self._do_forward("DELETE")

    def do_HEAD(self) -> None:  # noqa: N802
        self._do_forward("HEAD")


class _ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """ThreadingMixIn 让每个连接一个线程;HTTPServer 提供 socket 监听。

    daemon_threads=True 让主进程退出时后台线程不会卡住。
    """

    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr: tuple[str, int], handler: type[http.server.BaseHTTPRequestHandler]) -> None:
        super().__init__(addr, handler)
        self._proxy: "EgressProxy | None" = None  # 由 EgressProxy 注入


class EgressProxy:
    """单实例 127.0.0.1:8080 出口代理,常驻 FastAPI 进程。

    调用流程:
    1. ``lifespan`` → ``await egress_proxy.start()``
    2. 每个 ``/v1/execute`` 请求头调 ``egress_proxy.set_allowed(claims["allowedEgress"])``
    3. 响应聚合时 ``egress_proxy.used_hosts()``
    """

    def __init__(self, bind_host: str = "127.0.0.1", bind_port: int = 8080) -> None:
        self.bind_host = bind_host
        self.bind_port = bind_port
        self._allowed: set[str] = set()
        self._used: set[str] = set()
        self._denied: set[str] = set()
        # Phase 3 跨请求聚合:进程级 append-only,供 /metrics + 审计响应使用。
        # _used / _denied 仍保留每请求 scope(set_allowed 时清零,避免跨 skill 串扰);
        # _cross_used / _cross_denied 在 set_allowed 切换时把上一分快照 union 进来,
        # 形成"自进程启动以来"的全量视图。
        self._cross_used: set[str] = set()
        self._cross_denied: set[str] = set()
        self._lock = threading.Lock()
        self._server: _ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._started = False

    @property
    def allowed(self) -> frozenset[str]:
        with self._lock:
            return frozenset(self._allowed)

    def set_allowed(self, hosts: Iterable[str]) -> None:
        with self._lock:
            self._allowed = {
                (h or "").strip().lower() for h in hosts if h and h.strip()
            }
            # 切换 allowlist 时,把当前请求的 used/denied 快照 union 进跨请求聚合,
            # 然后再清零 per-request 集合(避免跨 skill 串扰审计)。
            self._cross_used.update(self._used)
            self._cross_denied.update(self._denied)
            self._used.clear()
            self._denied.clear()

    def used_hosts(self) -> list[str]:
        with self._lock:
            return sorted(self._used)

    def denied_hosts(self) -> list[str]:
        with self._lock:
            return sorted(self._denied)

    def cumulative_used_hosts(self) -> list[str]:
        """自进程启动以来所有出现过的 used 主机(跨 set_allowed 周期聚合)。"""
        with self._lock:
            return sorted(self._cross_used)

    def cumulative_denied_hosts(self) -> list[str]:
        """自进程启动以来所有出现过的 denied 主机(跨 set_allowed 周期聚合)。"""
        with self._lock:
            return sorted(self._cross_denied)

    def _record_used(self, host: str) -> None:
        with self._lock:
            self._used.add(host.lower())

    def _record_denied(self, host: str) -> None:
        with self._lock:
            self._denied.add(host.lower())

    def start(self) -> None:
        if self._started:
            return
        # 先校验端口可用,失败抛错便于诊断
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind((self.bind_host, self.bind_port))
        finally:
            sock.close()
        srv = _ThreadingHTTPServer((self.bind_host, self.bind_port), _ProxyHandler)
        srv._proxy = self
        self._server = srv
        self._thread = threading.Thread(
            target=srv.serve_forever,
            name="qzda-egress-proxy",
            daemon=True,
        )
        self._thread.start()
        self._started = True

    def stop(self) -> None:
        if not self._started or not self._server:
            return
        self._server.shutdown()
        self._server.server_close()
        self._started = False
        self._server = None
        self._thread = None