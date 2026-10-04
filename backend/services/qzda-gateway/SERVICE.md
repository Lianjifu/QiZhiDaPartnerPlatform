# qzda-gateway

Monolith 入口代理。开发态用 Python `main.py` 跑在 `:8089`,把全部 API 流量转给 `qzda-app :8100`。生产需要 TLS / SPIFFE / 限流时改用 `deploy/envoy/envoy.{monolith,mtls,spiffe}.yaml`。

| Profile | 配置 | Upstream |
|---------|------|----------|
| **monolith**（默认，唯一形态） | `services/qzda-gateway/main.py` | qzda-app:8100 |
| **monolith + mTLS** | `deploy/envoy/envoy.mtls.yaml` | qzda-app:8100 |
| **monolith + SPIFFE** | `deploy/envoy/envoy.spiffe.yaml` | qzda-app:8100 |

| 项 | 值 |
|----|----|
| 监听 | **8089** |
| 本机 dev | `python3 services/qzda-gateway/main.py`（由 `scripts/dev-stack/run-stack.sh` 拉起） |
| 容器 | `docker build -f services/qzda-gateway/Dockerfile -t qzda-gateway:local .` |

```bash
make compose-up-monolith   # 或 make run
# FE: VITE_API_BASE=http://127.0.0.1:8089
```

> Coarse 拓扑已在 M10 折叠：`envoy.coarse.yaml` 已删除，`gateway-proxy.py`（coarse 路由）已删除。
