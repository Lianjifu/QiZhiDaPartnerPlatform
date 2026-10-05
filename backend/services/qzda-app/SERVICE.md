# qzda-app

Monolith control plane — 单 Go 进程,承载全部域逻辑(身份 / 策略 / 审计 / 资源编排
/ 协作 / 模型 / 知识 / 技能 / 渠道 / 工作流 / 运营)。M10 把历史 coarse 四进程
(qzda-sys / qzda-collab / qzda-cap / qzda-workflow) 折叠进本进程,后续不再拆回 Go
微服务。

| 项 | 值 |
|----|----|
| 模式 | `QZDA_SERVICE=app` / `ModeApp` |
| 监听 | `8100`(`QZDA_APP_ADDR`) |
| 写域 | `DomainAll`(全 PG 集合) |
| 侧车 | `qzda-sandbox :8093`(必须) / `qzda-rag :8092`(必须) |
| 反向代理 | `qzda-gateway :8089 → :8100` |

## 启动

```bash
cd backend
make run          # 完整 Docker 栈(postgres + redis + 3 应用容器)
make run-app      # 本机裸跑(需 PG/Redis 已起)
make run-demo     # 内存 + ACME seed,无 PG
make smoke        # healthz + login + skills/sessions/evaluate 端到端冒烟
```

## 核心环境变量

| Variable | Default | Description |
|----------|---------|-------------|
| `QZDA_ENV` | `development` | `development` / `demo` / `staging` / `production` |
| `QZDA_APP_ADDR` | `:8100` | Listen address |
| `QZDA_RUNTIME_MODE` | `local` | 进程内 ReAct Harness(不启 qzda-agent-runtime) |
| `QZDA_SANDBOX_RUNTIME_URL` | `http://127.0.0.1:8093` | 技能沙箱 upstream |
| `QZDA_RAG_URL` | `http://127.0.0.1:8092` | RAG backend upstream |
| `QZDA_BAN_MOCK_TOKEN` | `0` | `1` 禁用 `mock-*--token`(生产) |
| `QZDA_PUBLIC_BASE_URL` | `http://127.0.0.1:8089` | 网关对外地址 |

完整 env 清单见 [`deploy/.env.example`](../../deploy/.env.example)。

## 历史 coarse 拓扑

`qzda-sys` / `qzda-collab` / `qzda-cap` / `qzda-workflow` 已在 M10 折叠到
`qzda-app`,二进制 / Dockerfile / Compose profile 全部下线。当前阶段不引入新
的 Go 微服务;按需切分路径见 [`docs/后端单进程方案.md`](../../../docs/后端单进程方案.md)。
