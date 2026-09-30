# qzda-cap · channel · DingTalk

钉钉渠道对齐 [cc-connect](https://github.com/chenhg5/cc-connect) `platform/dingtalk`。

## 凭据（Vault JSON）

| 字段 | 说明 |
|------|------|
| `client_id` / `client_secret` | 开放平台 AppKey / AppSecret |
| `robot_code` | 可选，默认=client_id |
| `domain` | 默认 `https://api.dingtalk.com` |

## 验证

`POST …/deployments/{id}/verify` → `POST /v1.0/oauth2/accessToken`

## 出站

`/v1.0/robot/oToMessages/batchSend`（`sampleMarkdown`），target = staff userId

## 入站

| 模式 | 说明 |
|------|------|
| **stream**（默认） | 与 cc-connect 一致，无需公网；由侧车长连接承接 |
| **webhook** | `POST /api/channel/dingtalk/events/{id}`，校验 `timestamp`+`sign`（HMAC-SHA256） |

## 实现

`backend/internal/dingtalk`
