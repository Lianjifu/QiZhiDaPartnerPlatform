# 单进程 Docker 部署

> 本仓库后端采用 **单进程 Docker Compose** 部署:Go 控制面单二进制(M10 折叠
> 后)+ Python 沙箱 / RAG / 网关三个独立容器,数据依赖 Postgres + Redis。
> 没有微服务拆分,没有 K8s/Helm。Coarse 四进程(qzda-sys/collab/cap/workflow)
> 已在 M10 折叠到 qzda-app。

## 1. 架构(单机)

```
   :8089 qzda-gateway (Python 反向代理,stdio BaseHTTPRequestHandler)
       │
       ▼
   :8100 qzda-app (Go 单进程,M10 monolith)
       │
       ├── postgres:5432  (control plane + audit + KV durable)
       └── redis:6379     (rate-limit + audit bus + cache)

   :8093 qzda-sandbox (Python,沙箱执行,RunToken HMAC + gVisor/seccomp)
   :8092 qzda-rag     (Python FastAPI,向量检索:pgvector 同 PG 实例 / vector-memory 回退)
```

所有进程都跑在同一台 host(本机 Colima / 生产 Docker Engine),没有跨主机
服务发现、没有 Envoy mesh、没有 K8s。

**两种部署形态**(compose.yml 同时定义了全部 6 个服务):

| 形态 | Docker 里跑什么 | 应用进程跑哪 | 入口 |
|------|----------------|-------------|------|
| **A · 本机联调(默认)** | 只有 PG + Redis | gateway / 控制面 / 沙箱 / RAG / 前端跑宿主机进程 | 仓库根 `make run-app` |
| **B · 全 Docker** | 全部 6 个服务 | 都在容器里 | `docker compose -f deploy/compose.yml up -d --build` |

## 2. 启动

### 2.1 本机联调(主路径)

```bash
make run-app       # 仓库根：launchd 监管的全栈（PG/Redis 在 Docker，其余宿主机进程）
make run-app-status # 看进程与端口
make run-app-stop   # 停栈
```

形态 A 下 Docker 只负责有状态的两件：

```bash
cd backend
make compose-up     # 只起 postgres + redis 两个容器
make compose-ps     # 确认 qzda-postgres / qzda-redis healthy
make compose-logs   # 滚动日志(默认尾 100 行)
```

### 2.2 全 Docker 栈

```bash
cd backend
docker compose -f deploy/compose.yml up -d --build
docker compose -f deploy/compose.yml ps
```

| 容器 | 端口 | 镜像 | 角色 |
|------|------|------|------|
| `qzda-postgres` | 5432 | postgres:16-alpine | 控制面持久化 + 审计 |
| `qzda-redis` | 6379 | redis:7-alpine | rate-limit + audit bus + KV 缓存 |
| `qzda-sandbox` | 8093 | qzda-sandbox:local | skill 沙箱执行(gVisor seccomp=unconfined) |
| `qzda-rag` | 8092 | qzda-rag:local | 向量检索 backend |
| `qzda-app` | 8100 | qzda-app:local | Go 单进程控制面(M10 折叠) |
| `qzda-gateway` | 8089 | qzda-gateway:local | Python 反向代理,8089 → 8100 |

> compose.yml 的 `build.context` 目前写成**绝对路径**（指向某台开发机），换机器或换目录要改成 `../..`（仓库根）才能构建。

### 2.3 仅本机 Go 控制面(debug)

不需要完整 docker 栈时,可直接 `go run`:

```bash
cd backend
make run-app       # 启动 PG/Redis + go run ./cmd/qzda-app(连本机 PG/Redis)
make run-demo      # 内存 + ACME seed,无 PG(纯 demo)
```

本机联调、演示模式与生产启动的完整口径见 [附录B §B.5 启动](../../docs/附录B-运行模式与本地起停.md#b5-启动)。

### 2.4 沙箱 gVisor 启用

默认 `runtime=runc`(兼容性兜底)。要启用 gVisor:

```bash
# host 安装 runsc(Linux/macOS gVisor shim)
curl -fsSL https://gvisor.dev/archive/nightly/latest/runsc \
  -o /usr/local/bin/runsc && chmod +x /usr/local/bin/runsc

# 重启 qzda-sandbox 容器时启用
QZDA_SANDBOX_RUNTIME=runsc docker compose -f deploy/compose.yml up -d qzda-sandbox
# Linux KVM:再设 QZDA_SANDBOX_RUNTIME=runsc-kvm 加速
```

qzda-sandbox 必须 `seccomp=unconfined`(gVisor 自身做 syscall 拦截),
compose.yml 已配置。

## 3. 环境变量

`deploy/.env` 里的变量通过 `make infra-env` 写入并注入到容器。完整变量清单见
[`deploy/.env.example`](./.env.example)；后端侧全部变量与默认值见
[`backend/README.md` 关键环境变量](../README.md#关键环境变量)，模式语义（`QZDA_MODE` 三档）见
[附录B §B.2](../../docs/附录B-运行模式与本地起停.md#b2-后端总开关-qzda_mode)。此处只列 Docker 部署最常用:

| 变量 | 默认 | 说明 |
|------|------|------|
| `QZDA_MODE` | `dev` | `dev`(PG 持久化,可选内存)/ `pro`(双人审批 + Vault + OIDC + 强制签名);见 [附录B](../../docs/附录B-运行模式与本地起停.md) |
| `QZDA_DATA_BACKEND` | `pg` | 仅 dev 生效:`memory` = 内存 + ACME seed,不写 PG |
| `QZDA_DATABASE_URL` | `postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable` | docker compose 内自动用 `postgres:5432` |
| `QZDA_REDIS_URL` | `redis://127.0.0.1:6379/0` | 同上,容器内用 `redis:6379` |
| `QZDA_SANDBOX_RUNTIME` | `runc` | `runsc` 启用 gVisor |
| `QZDA_SANDBOX_RUN_SECRET` | `qzda-skill-run-dev` | 控制面与沙箱共享 HMAC;生产 `openssl rand -hex 32 > deploy/secrets/skill-run-secret` 后挂进容器 |
| `QZDA_LLM_BASE_URL` / `QZDA_LLM_API_KEY` / `QZDA_LLM_MODEL` | 留空 / 留空 / `gpt-4o-mini` | OpenAI-compatible 远程供应商;留空时 dev 走内置对话,pro 必须配置 |
| `QZDA_PGVECTOR_URL` | `postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable` | 控制面 PG 已内嵌 pgvector 扩展(RAG 向量);留空走进程内 `vector-memory`(demo,不持久)。同 PG 实例,免额外容器。 |
| `QZDA_PUBLIC_BASE_URL` | `http://127.0.0.1:8089` | 网关对外地址,飞书 webhook URL hint 等 |

`QZDA_JWT_SECRET` 在 pro 模式下必填 32 字节随机串;留空走 dev fallback。

## 4. 数据模式

三套模式的完整口径（三套环境、`QZDA_MODE` 总开关、前端 API 模式、部署拓扑）见
[附录B 运行模式与本地起停](../../docs/附录B-运行模式与本地起停.md)。此处只记 Docker 侧：

```
QZDA_MODE=dev                          (本机默认)  → PG 持久化,空库不灌演示 seed
QZDA_MODE=dev QZDA_DATA_BACKEND=memory (纯内存)    → ACME seed,不写 PG;一键 reset
QZDA_MODE=pro                          (预发/生产)  → 双人审批 + Vault required + OIDC 登录
```

切换模式只需重启 `qzda-app` 容器:`QZDA_MODE=pro docker compose -f deploy/compose.yml up -d qzda-app`。

### Reset 开发库

```bash
make db-reset-dev
# → drop platform/audit/policy schema,qzda-app 重启后自动 hydrate
```

## 5. Smoke test

栈起来后,端到端冒烟:

```bash
cd backend && make smoke
# 输出:
#   healthz ok
#   workspaces ok
#   skills ok
#   sessions ok
#   evaluate ok
```

直接 `curl`:

```bash
curl -sf http://127.0.0.1:8089/healthz
TOKEN=$(curl -sf -X POST http://127.0.0.1:8089/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@acme.com","password":"x"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8089/api/skills
```

## 6. Skill 安全门禁(W1-D3)

CI 必跑,失败即阻断发布:

```bash
make skill-gate
# = make verify-builtins (Ed25519 签名 + SHA256 file list)
# + make vet-builtins   (5 类危险模式静态扫描)
```

源代码: [`services/qzda-sandbox/builtin/skills/manifest.json`](
../services/qzda-sandbox/builtin/skills/manifest.json)

## 7. 容器健康检查

每个容器自带 healthcheck:

```bash
docker inspect --format '{{.Name}} {{.State.Health.Status}}' \
  $(docker compose -f deploy/compose.yml ps -q)
# qzda-postgres   healthy
# qzda-redis      healthy
# qzda-sandbox    healthy
# qzda-rag        healthy
# qzda-app        healthy
# qzda-gateway    healthy
```

`make compose-up` 自动等 **PG + Redis** healthy 才退出（形态 A 只起这两个容器）；全 Docker 栈（形态 B）的 healthcheck 由 compose 自己把关。

## 7.5. pgvector 引导(内网 / Docker Hub 不可达时)

compose.yml 默认用 `postgres:16-alpine`(无 vector 扩展)。网络可达 Docker Hub
时,改为 `pgvector/pgvector:pg16-alpine` 即可自动带扩展。

不可达时(Docker Hub 经常被内网拦),用 `pgvector-bootstrap.sh` 手动编译装入容器:

```bash
bash scripts/dev-stack/pgvector-bootstrap.sh
# 默认找容器 qzda-postgres,可用 CONTAINER=... 覆盖
# 内部步骤:apk add build 工具链 → gh-proxy 镜像拉源码 v0.7.4
#           → PG_CONFIG=/usr/local/bin/pg_config make(绕开 clang bitcode 步骤)
#           → 装 .so + .control + vector--0.7.4.sql → 应用 0004_pgvector.sql
```

脚本是幂等的,可重跑;vector 扩展和 memory_vectors 表 CREATE IF NOT EXISTS 已
保证。Docker Hub 一旦可达,把 compose.yml postgres image 换回
`pgvector/pgvector:pg16-alpine` + 删 `volumes: - ./migrations:/docker-entrypoint-initdb.d`
即可彻底去掉本脚本(扩展由镜像自带)。

## 8. 不再使用

历史以下 target / profile 已废弃(M10 折叠 / Phase 4 重命名后):

以下 target 已从 `backend/Makefile` 删除,写文档时不要再引用:

- `compose-up-monolith` / `compose-up-monolith-workflow` — 现在的全栈入口是
  **仓库根 `make run-app`**(launchd 监管的宿主机进程栈);Docker 侧只起
  PG + Redis(`cd backend && make compose-up`)。启用进程内 Temporal worker 用
  `QZDA_WITH_WORKFLOW=1`,不再是独立 target
- `compose-up-temporal` / `compose-up-oidc` / `compose-up-authentik` /
  `compose-up-kafka` / `compose-up-mtls` / `compose-up-spiffe` /
  `compose-up-opa` / `compose-up-search` /
  `compose-up-obs` / `compose-up-staging` / `compose-up-replica` /
  `compose-up-full` — K8s / 分布式组件全部下线,单机部署不再需要
- `compose-up-coarse` — M10 折叠到 qzda-app,不存在
- `smoke-monolith` — 现为 `make smoke`(经 `:8089`)
- `test-python` — 沙箱 Python 自检改为直接跑脚本:
  `python3 services/qzda-sandbox/tests/test_runtoken.py`
- `run-app-workflow` — 改为给 `make run-app` 传 `QZDA_WORKFLOW_WORKER=1` +
  `QZDA_TEMPORAL_HOST`
- `skill` — 沙箱 `:8093` 由 `make run-app` 一并拉起
- 所有 OIDC / Vault / Temporal / Kafka / OPA / OpenSearch /
  Prometheus / Grafana / SPIFFE / mTLS 相关 env 变量 — 单进程部署不需要
- `QZDA_MILVUS_URI` — 已替换为 `QZDA_PGVECTOR_URL`(同 PG 实例的 pgvector 扩展)
- K8s / Helm / kubectl 相关说明 — 已迁移到单机 Docker

详见 [`docs/README.md`](../../docs/README.md)
与 [`CHANGELOG.md`](../../CHANGELOG.md)(M10 折叠 + Phase 4 重命名)。
