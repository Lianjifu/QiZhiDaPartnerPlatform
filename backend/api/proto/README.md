# Connect-RPC / Protobuf IDL

服务定义位于 `api/proto/qzda/{common,platform,policy,audit,collab,partner,runtime,rag}/v1`。

内核 ABI（见[附录A 跨模块底座](../../../docs/附录A-跨模块底座.md)）：`qzda.common.v1` Envelope / ContextSnapshot；`CollabService.ReplayTurn`；`RuntimeService.Run`。

```bash
# 生成 Go 代码（需要 buf + protoc-gen-go + protoc-gen-connect-go）
cd backend && buf generate
# 契约检查
cd backend && buf lint && buf breaking --against '.git#branch=main'
```

配置：`buf.yaml`（模块路径 `api/proto`、lint / breaking 规则）· `buf.gen.yaml`（插件与输出目录）。

已生成并挂载：

| 路径 | 说明 |
|------|------|
| `/connect/qzda.*.Service/*` | Connect 入口（Protobuf / Connect-JSON / 兼容 `{ok,data}` 信封），挂载见 `internal/server/server.go:743` → `connect_gateway.go` |

生成物见 [`gen/`](../../gen)。
