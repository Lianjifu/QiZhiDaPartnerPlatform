# qzda-cap · channel · Weixin（个人微信 / ilink）

对齐 [cc-connect](https://github.com/chenhg5/cc-connect) `platform/weixin`（与企业微信协议不同）。

## 凭据

| 字段 | 说明 |
|------|------|
| `token` | ilink Bot Bearer（扫码 setup / bind） |
| `base_url` | 默认 `https://ilinkai.weixin.qq.com` |
| `allow_from` / `account_id` / `route_tag` | 可选 |

## 验证

短调用 `POST ilink/bot/getupdates`

## 出站

`POST ilink/bot/sendmessage`，**必须**带 `context_token`（投递 body 或凭证缓存；通常先收一条用户消息）。

## 入站

控制面不托管长轮询；由侧车 `getUpdates` 承接。`connectionMode=long_poll`。

## 实现

`backend/internal/weixin`
