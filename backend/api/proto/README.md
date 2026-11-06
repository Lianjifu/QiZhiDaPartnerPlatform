# Connect-RPC / Protobuf IDL

服务定义位于 `de/{common,platform,policy,audit,collab,employee,runtime,rag}/v1`。

内核 ABI（见[附录A 跨模块底座](../../../docs/附录A-跨模块底座.md)）：`de.common.v1` Envelope / ContextSnapshot；`CollabService.ReplayTurn`；`RuntimeService.Run`。

```bash
cd backend && make buf-generate
```

已生成并挂载：

| 路径 | 说明 |
|------|------|
| `/de.*.Service/*` | 正式 Connect（Protobuf / Connect-JSON） |
| `/connect/de.*.Service/*` | 遗留 `{ok,data}` JSON 信封（兼容早期联调） |

生成物见 [`gen/`](../../gen)。