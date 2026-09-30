# qzda-cap · channel · WeCom（企业微信）

对齐 [cc-connect](https://github.com/chenhg5/cc-connect) `platform/wecom`。

## 模式

| mode | 说明 |
|------|------|
| **webhook**（默认，企业自建应用） | CorpId + CorpSecret + AgentId + Token + EncodingAESKey |
| **websocket** | 智能机器人 BotId/BotSecret；入站由侧车 `wss://openws.work.weixin.qq.com` |

## 凭据（Vault JSON）

`corp_id` / `corp_secret` / `agent_id` / `callback_token` / `callback_aes_key` / `api_base_url`

## 验证 / 出站

- 验证：`GET /cgi-bin/gettoken`
- 出站：`POST /cgi-bin/message/send`（text）
- 出站服务器 IP 需加入企业可信 IP

## 入站 Webhook

```http
GET|POST /api/channel/wecom/events/{deploymentId}
```

- GET：URL 验证（解密 echostr）
- POST：验签 + AES 解密 → `ChannelInbound`

开放平台「接收消息」URL 填该路径（需 `DE_PUBLIC_BASE_URL`）。

## 实现

`backend/internal/wecom`
