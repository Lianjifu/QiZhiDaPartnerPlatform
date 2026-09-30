# SPIFFE 本地骨架

生产可用 SPIRE 签发短周期 SVID；本地先用 OpenSSL CA 模拟 **SPIFFE URI SAN**，供 Envoy 校验。

## 证书

```bash
cd backend
make certs            # 长周期（开发）
make certs-rotate     # 叶子证书 TTL=1 天（保留 CA）
```

默认 trust domain：`de.local`（可用 `DE_SPIFFE_TRUST_DOMAIN` 覆盖）。

| 身份 | SPIFFE ID |
|------|-----------|
| Gateway | `spiffe://de.local/ns/default/sa/qzda-gateway` |
| qzda-app（monolith） | `spiffe://de.local/ns/default/sa/qzda-app` |
| qzda-sys / qzda-collab / qzda-cap（coarse） | `spiffe://de.local/ns/default/sa/<name>` |
| qzda-platform / policy / audit / … | `spiffe://de.local/ns/default/sa/<name>` |

## Envoy 校验

```bash
make compose-up-spiffe
# https://127.0.0.1:8444 — 要求客户端证书带 SPIFFE URI（或兼容 DNS）
curl -sk --cert deploy/certs/client.crt --key deploy/certs/client.key \
  --cacert deploy/certs/ca.crt https://127.0.0.1:8444/healthz
```

## 升级到 SPIRE（后续）

1. 部署 SPIRE Server + Agent（Kubernetes 或 Compose）
2. 用 Workload API 替换 `deploy/certs/*.crt` 文件挂载
3. Envoy 改 SDS / SPIFFE SDS 动态拉取 SVID
4. 服务间 mTLS 使用各自 `sa/<service>` 身份

当前不捆绑完整 SPIRE 容器（资源重）；证书形状与 Envoy 校验路径已对齐生产 SPIFFE。
