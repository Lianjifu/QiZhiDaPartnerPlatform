#!/usr/bin/env python3
"""Gateway for monolith stack: all API traffic → qzda-app :8100.

Mirrors the qzda-rag / qzda-sandbox launcher pattern so the dev-stack
script can `python3 services/qzda-gateway/main.py` and a container
can `CMD ["python3", "main.py"]` with no extra wiring.

Env (all optional):
  QZDA_BIND_HOST      — listen host (default 127.0.0.1)
  QZDA_BIND_PORT      — listen port for this proxy (default 8089)
  QZDA_BACKEND_PORT   — upstream qzda-app port (default 8100)
"""
from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.request

SKIP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length",
    "content-encoding", "host", "date", "server",
}


def is_stream_path(path: str) -> bool:
    return "/stream" in path


class GatewayHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    backend_port = 8100  # overridden in main() below

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stderr.flush()

    def _write_response_headers(self, status, headers):
        self.send_response(status)
        for k, v in headers.items():
            if k.lower() not in SKIP:
                self.send_header(k, v)
        self.end_headers()

    def _proxy_stream(self, resp, status, headers):
        self._write_response_headers(status, headers)
        if self.command == "HEAD":
            return
        while True:
            chunk = resp.read(8192)
            if not chunk:
                break
            self.wfile.write(chunk)
            self.wfile.flush()

    def _proxy_buffered(self, data, status, headers):
        # Upstream Content-Length is stripped in SKIP; without re-adding it,
        # HTTP/1.1 keep-alive clients hang waiting for EOF → Vite proxy 503.
        self.send_response(status)
        for k, v in headers.items():
            if k.lower() not in SKIP:
                self.send_header(k, v)
        body = b"" if self.command == "HEAD" else (data or b"")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _proxy(self):
        url = f"http://127.0.0.1:{self.backend_port}{self.path}"
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        req = urllib.request.Request(url, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in SKIP:
                req.add_header(k, v)
        stream = is_stream_path(self.path)
        timeout = 180 if stream else 60
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if stream:
                    self._proxy_stream(resp, resp.status, resp.headers)
                    return
                data = resp.read()
                self._proxy_buffered(data, resp.status, resp.headers)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            return
        except urllib.error.HTTPError as e:
            if stream:
                self._proxy_stream(e, e.code, e.headers)
                return
            self._proxy_buffered(e.read(), e.code, e.headers)
        except Exception as e:
            data = f"gateway proxy error: {e}".encode()
            try:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                return

    def do_GET(self):
        self._proxy()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_PATCH(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()

    def do_OPTIONS(self):
        self._proxy()

    def do_HEAD(self):
        self._proxy()


def main() -> None:
    host = os.environ.get("QZDA_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("QZDA_BIND_PORT", "8089") or "8089")
    backend_port = int(os.environ.get("QZDA_BACKEND_PORT", "8100") or "8100")
    GatewayHandler.backend_port = backend_port
    print(f"qzda-gateway on http://{host}:{port} → 127.0.0.1:{backend_port}", flush=True)
    try:
        ThreadingHTTPServer((host, port), GatewayHandler).serve_forever()
    except OSError as e:
        print(f"qzda-gateway bind failed on {host}:{port}: {e}", file=sys.stderr, flush=True)
        raise SystemExit(1) from e


if __name__ == "__main__":
    main()
