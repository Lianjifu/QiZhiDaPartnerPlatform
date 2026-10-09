#!/usr/bin/env node
// Minimal static + proxy server for the production FE bundle.
// Serves /Users/LIANJIFU/ops/QiZhiDaPartnerPlatform/frontend/web/dist on :8010 and
// proxies /api + /healthz to the QZDA gateway on :8089.
// Replaces vite preview (which has no proxy config).

import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8010);
const HOST = process.env.HOST ?? '127.0.0.1';
const DIST = process.env.DIST ?? '/Users/LIANJIFU/ops/QiZhiDaPartnerPlatform/frontend/web/dist';
const PROXY_TARGET = process.env.PROXY_TARGET ?? 'http://127.0.0.1:8089';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/') path = '/index.html';
  // SPA fallback: anything without a file extension falls back to index.html
  if (!extname(path)) path = '/index.html';
  const fullPath = normalize(join(DIST, path));
  if (!fullPath.startsWith(DIST)) {
    res.writeHead(403); return res.end('forbidden');
  }
  if (!existsSync(fullPath) || !statSync(fullPath, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  const mime = MIME[extname(fullPath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
  createReadStream(fullPath).pipe(res);
}

function proxyToGateway(req, res) {
  const target = new URL(PROXY_TARGET);
  const opts = {
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
  };
  const upstream = http.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error', (err) => {
    console.error('[proxy]', req.method, req.url, '→', err.message);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { message: 'upstream error: ' + err.message } }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (url.startsWith('/api/') || url === '/api' || url.startsWith('/healthz')) {
    return proxyToGateway(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end('method not allowed');
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`[fe-prod] serving ${DIST} on http://${HOST}:${PORT}, proxying /api,/healthz → ${PROXY_TARGET}`);
});
