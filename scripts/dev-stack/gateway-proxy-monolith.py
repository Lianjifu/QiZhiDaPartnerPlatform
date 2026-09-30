#!/usr/bin/env python3
"""Gateway for monolith stack: all API traffic → qzda-app :8100."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import urllib.error
import urllib.request

BACKEND_PORT = 8100
SKIP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length",
    "content-encoding", "host", "date", "server",
}


def is_stream_path(path: str) -> bool:
    return "/stream" in path


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        return

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
        url = f"http://127.0.0.1:{BACKEND_PORT}{self.path}"
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
        except urllib.error.HTTPError as e:
            if stream:
                self._proxy_stream(e, e.code, e.headers)
                return
            self._proxy_buffered(e.read(), e.code, e.headers)
        except Exception as e:
            data = f"gateway proxy error: {e}".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

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


ThreadingHTTPServer(("127.0.0.1", 8089), H).serve_forever()
