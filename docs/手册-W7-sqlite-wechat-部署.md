# W7 部署手册 — SQLite 持久化 + WeChat 同步渠道

> 状态：实施就绪
> 日期：2026-09-08
> 前置：ADR-028（SQLite 双栈）+ ADR-029（WeChat 渠道）
> 关系：本手册是 W7 两项功能（SQLite / WeChat）的运维配套；不写 ADR 决策

## 1. SQLite 持久化（DE_STORE_BACKEND=sqlite）

### 1.1 何时启用

- **单机 / 演示 / 边缘部署** — 没有 PG 时落盘到本地文件
- **WAL 模式** — 默认开启 `PRAGMA journal_mode=WAL` + `busy_timeout=5s` + `foreign_keys=ON`
- **生产** — 仍走 PG（infra.OpenPostgres）；SQLite 仅作为 in-memory 之外的次选

### 1.2 配置

| Env | 默认 | 说明 |
|---|---|---|
| `DE_STORE_BACKEND` | _空_（in-memory） | 设为 `sqlite` 启用 |
| `DE_SQLITE_PATH` | `data/store.db` | SQLite 文件路径；目录不存在会先 mkdir |

### 1.3 启动

```bash
mkdir -p data
DE_STORE_BACKEND=sqlite DE_SQLITE_PATH=data/store.db \
  ./qzda-app -mode app
# → log: sqlite durability: hooked PersistFunc path=data/store.db
```

Open 失败（权限 / 磁盘满 / 锁文件）会**降级回 in-memory** 并写日志，不 panic：

```
sqlite durability: open failed (data/store.db): unable to open database file
— falling back to in-memory
```

### 1.4 现象对照

| 现象 | 可能原因 | 怎么查 |
|---|---|---|
| 启动后 log 没有 `sqlite durability: hooked` | env 没读到 / 拼写错 | `echo $DE_STORE_BACKEND`；服务端进程用 `os.Getenv` 不继承 shell export，看 systemd unit / docker compose env |
| 进程退出后数据没了 | 走的是 in-memory fallback | 看启动日志有没有 `open failed` / `falling back to in-memory` |
| `database is locked` | 多进程同时写 | 默认 `busy_timeout=5s`；并发请求排队；不要同目录起两个进程 |
| `disk I/O error` | 磁盘满 / fs 只读 | `df -h $DE_SQLITE_PATH`；容器里 `data` 是不是 tmpfs |
| WAL 文件 (`*.db-wal`) 残留 | 进程被 SIGKILL 没机会 checkpoint | 启动时自动 `PRAGMA wal_checkpoint(TRUNCATE)`；不需手工 |

### 1.5 端到端 smoke

```bash
DE_STORE_BACKEND=sqlite DE_SQLITE_PATH=/tmp/test.db ./qzda-app -mode app &
PID=$!

# 1) 写一个 task
curl -sf -X POST -H "Authorization: Bearer mock-admin-token" \
  -H 'Content-Type: application/json' \
  -d '{"title":"smoke"}' http://127.0.0.1:8089/api/tasks

# 2) 看 SQLite 里有 row
sqlite3 /tmp/test.db 'SELECT count(*) FROM kv_documents;'
# → 1

# 3) 重启进程，数据应还在
kill $PID; DE_STORE_BACKEND=sqlite DE_SQLITE_PATH=/tmp/test.db ./qzda-app -mode app &
curl -sf -H "Authorization: Bearer mock-admin-token" \
  http://127.0.0.1:8089/api/tasks | jq '.data | length'
# → 1
```

### 1.6 已知边界

- **schema 对齐 PG** — `platform.kv_documents` 表结构与 PG 版本同形；不要混用两端
- **shrink-heavy 走 replaceCollection** — 性能：大批量删除时整体重写比 PG 快；批量插入时 upsertMany 优于事务
- **多副本** — 当前是单文件锁；多实例部署会因 `database is locked` 退化；W6-P3 计划加 LiteFS / rqlite
- **无加密** — 文件明文；敏感字段在 PG 端加密，SQLite 端不要存 secrets
- **备份** — `sqlite3 $DE_SQLITE_PATH '.backup /tmp/x.db'` 在线备份；不要直接 `cp`

---

## 2. WeChat 同步渠道

### 2.1 模式识别

`internal/weixin.Credentials` 自动识别两种形态：

| 形态 | 触发条件 | 用途 |
|---|---|---|
| **ilink sidecar**（个人号） | `Credentials.Mode = "ilink"` | 通过本地 sidecar 进程（ilink-bot）转发消息 |
| **Open API**（公众号 / 企业号） | `Credentials.Mode = "openapi"` | 直接调微信 Open API；需要 `AppID + AppSecret` |

模式由 env 决定：

| Env | 默认 | 说明 |
|---|---|---|
| `DE_WEIXIN_MODE` | _空_（off） | `ilink` / `openapi`；空 = 渠道关闭 |
| `DE_WEIXIN_APP_ID` | _空_ | 公众号 / 企业号 AppID（openapi 必填） |
| `DE_WEIXIN_APP_SECRET` | _空_ | AppSecret（openapi 必填） |
| `DE_WEIXIN_TOKEN` | _空_ | 回调签名 Token（公众号加密必填） |
| `DE_WEIXIN_AES_KEY` | _空_ | 回调加解密 EncodingAESKey（43 字符，base64 解码 32 字节） |
| `DE_WEIXIN_ILINK_URL` | _空_ | sidecar URL（ilink 必填，如 `http://127.0.0.1:9000`） |

`mode=ilink` 时只读 `ILINK_URL`；`mode=openapi` 时读 `APP_ID` + `APP_SECRET` + `TOKEN` + `AES_KEY`。

### 2.2 公众号回调加解密

`internal/weixin.VerifySignature` / `EncryptCallback` / `DecryptCallback` 实现微信官方 AES-CBC + SHA1 签名。

**签名校验**：`signature = sha1(token + timestamp + nonce)`，与 query `signature` 比对。

**加解密**：
- 加密：`AES-CBC(EncodingAESKey, PKCS#7)`；输出 base64；包 XML `<Encrypt>...</Encrypt>`
- 解密：剥 `<Encrypt>` → base64 decode → AES-CBC 解 → 去 PKCS#7 padding → 第一个 \n 后是明文

### 2.3 路由

| 路由 | 用途 |
|---|---|
| `GET  /api/channel/wecom/events/<botID>` | 企业微信回调（已在 server.go 旧路由上注册） |
| `POST /api/channel/wecom/events/<botID>` | 企业微信回调（已在 server.go 旧路由上注册） |
| `POST /api/channel/feishu/events/<botID>` | 飞书回调（public allowlist） |
| `POST /api/channel/dingtalk/events/<botID>` | 钉钉回调（public allowlist） |

WeChat 个人号（ilink）走 sidecar 主动 poll，**不进 server 路由**。

### 2.4 现象对照

| 现象 | 可能原因 | 怎么查 |
|---|---|---|
| `mode=openapi` 启动后 `access_token` 一直是空 | AppID / AppSecret 错 | `curl https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=$ID&secret=$SEC` 看 `errcode` |
| 公众号回调验签 401 | Token 拼写错 / 大小写 | 微信后台 → 开发 → 基本配置 → Token 必须完全一致 |
| 收不到加密回调 | `AES_KEY` 长度不对 | EncodingAESKey 是 43 字符；少 1 位就解不开 |
| ilink sidecar 502 | sidecar 没起 / 端口错 | `curl $DE_WEIXIN_ILINK_URL/healthz`；sidecar 日志 |
| 消息发出去了但用户收不到 | Open API 没白名单 IP | 公众号 → IP 白名单；企业号 → 可信 IP |

### 2.5 端到端 smoke（openapi）

```bash
DE_WEIXIN_MODE=openapi \
DE_WEIXIN_APP_ID=wxd... \
DE_WEIXIN_APP_SECRET=... \
DE_WEIXIN_TOKEN=mytoken \
DE_WEIXIN_AES_KEY=$(head -c 43 /dev/urandom | base64) \
./qzda-app -mode app

# 1) 拿 access_token
curl -sf http://127.0.0.1:8089/api/channel/wecom/probe \
  -H 'Authorization: Bearer mock-admin-token' | jq .data
# → { "ok": true, "mode": "openapi", "accessTokenCached": true }

# 2) 触发回复（模拟回调）
curl -sf -X POST \
  'http://127.0.0.1:8089/api/channel/wecom/events/test?signature=...&timestamp=...&nonce=...' \
  -H 'Content-Type: text/xml' \
  --data-binary @tests/fixtures/weixin/incoming.xml
```

### 2.6 已知边界

- **限流** — 公众号 5000 次 / 分钟；超了会被微信 45009 拒；客户端不重试
- **access_token 缓存** — 默认 7000s（比官方 7200s 短 200s 留 buffer）；重启进程不丢失（重启前刷盘）
- **企业号 vs 公众号** — 接口同源但权限模型不同；Credentials 共用同一份 env
- **个人号风控** — ilink 模式依赖第三方 sidecar；微信对个人号自动化管控严格，被封号风险自担
- **多租户** — 当前是单 appid；多公众号需要每个一组 env / 启动多实例