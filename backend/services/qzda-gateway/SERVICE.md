# qzda-gateway

Monolith 入口代理。Python `main.py`(stdlib `BaseHTTPRequestHandler` / `ThreadingHTTPServer`)
跑在 `:8089`,把全部 API 流量转发给 `qzda-app :8100`,处理 `/stream` 路径上的流式
响应透传 + 头过滤。

单进程 Docker 部署中,本服务是唯一的入口网关(Python,无 Envoy / 无 mTLS
中间件)。需要 TLS / 限流时由部署侧反向代理(nginx / caddy / cloud LB)前置
终止 TLS,本服务只处理 8089 纯 HTTP。

| 项 | 值 |
|----|----|
| 监听 | **8089** |
| Upstream | `qzda-app :8100` |
| 本机 dev | `python3 services/qzda-gateway/main.py`(由 `scripts/dev-stack/run-stack.sh` 拉起) |
| 容器 | `make run` 自动 build + up |

```bash
make run
# FE: VITE_API_BASE=http://127.0.0.1:8089
```

> Coarse 拓扑已在 M10 折叠到 qzda-app 单进程,网关仅承担"std HTTP → std HTTP"
> 转发与流式响应桥接。
