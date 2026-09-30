# qzda-cap · channel · Feishu

飞书/Lark 渠道接入对齐 [cc-connect](https://github.com/chenhg5/cc-connect) 的企业自建应用模式。

## 凭据（Vault JSON）

| 字段 | 说明 |
|------|------|
| `app_id` / `app_secret` | 开放平台凭据 |
| `domain` | 默认 `https://open.feishu.cn`；国际 `https://open.larksuite.com` |
| `encrypt_key` | 可选；启用加密策略后用于验签与 AES 解密 |
| `verification_token` | 可选；校验事件来源 |

路径：`vault://channel-deployments/{id}/credential`

## 验证（Probe）

`POST /api/channel-control/deployments/{id}/verify`

1. `tenant_access_token/internal`
2. `bot/v3/info` → 回填 `botOpenId` / `botName`

## 出站投递

`POST /api/channel-control/deliveries`（主部署为 feishu）→ `im/v1/messages`

## 事件接收模式（`connectionMode`）

创建部署时可选：

| 值 | 说明 |
|----|------|
| `websocket`（推荐，本地） | 对齐 cc-connect：开放平台选「使用长连接接收事件」。本机/侧车主动连飞书 WebSocket，**无需公网**。不生成 `webhookPath`。 |
| `webhook` | 开放平台选「将事件发送至开发者服务器」。需公网/隧道；创建后返回 `webhookPath` / `webhookUrl`。 |

兼容别名：`ws` / `long_connection` → 归一为 `websocket`。未传时后端默认 `websocket`（与控制台一致）；显式传 `webhook` 才生成回调路径。

### Webhook 入站

公开回调（无需 Bearer；靠 Encrypt Key / Verification Token）：

```http
POST /api/channel/feishu/events/{deploymentId}
```

能力：

- `url_verification` → 原样返回 `challenge`
- Encrypt Key 时校验 `X-Lark-Signature`
- 解密 `encrypt` 字段（AES-256-CBC）
- 归一 `im.message.receive_v1` → `ChannelInbound`
- 列表：`GET /api/channel-control/inbound`

设置 `DE_PUBLIC_BASE_URL` 可拼出绝对 `webhookUrl`。订阅 `im.message.receive_v1`。

### WebSocket 长连接

开放平台「事件与回调」选 **使用长连接接收事件**，订阅 `im.message.receive_v1`。入站由 WebSocket 侧车承接（与 cc-connect 相同）；控制面负责凭证、验证（`tenant_access_token` + `bot/v3/info`）与出站 Open API。

## 实现

- `backend/internal/feishu` — client + webhook crypto
- `handlers_channels.go` / `handlers_feishu_webhook.go`
