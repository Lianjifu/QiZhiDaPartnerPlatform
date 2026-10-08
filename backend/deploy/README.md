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

四个容器都跑在同一台 host(本机 Colima / 生产 Docker Engine),没有跨主机
服务发现、没有 Envoy mesh、没有 K8s。`docker compose up` 一条命令拉起全部。

## 2. 启动

### 2.1 完整 Docker 栈(主路径)

```bash
cd backend
make run           # 自动拉起 Colima → docker compose up -d → 等所有 healthcheck 通过
make compose-ps    # 确认所有 6 个容器 running/healthy
make compose-logs  # 滚动日志(默认尾 100 行)
```

| 容器 | 端口 | 镜像 | 角色 |
|------|------|------|------|
| `qzda-postgres` | 5432 | postgres:16-alpine | 控制面持久化 + 审计 |
| `qzda-redis` | 6379 | redis:7-alpine | rate-limit + audit bus + KV 缓存 |
| `qzda-sandbox` | 8093 | qzda-sandbox:local | skill 沙箱执行(gVisor seccomp=unconfined) |
| `qzda-rag` | 8092 | qzda-rag:local | 向量检索 backend |
| `qzda-app` | 8100 | qzda-app:local | Go 单进程控制面(M10 折叠) |
| `qzda-gateway` | 8089 | qzda-gateway:local | Python 反向代理,8089 → 8100 |

### 2.2 仅本机 Go 控制面(debug)

不需要完整 docker 栈时,可直接 `go run`:

```bash
cd backend
make run-app       # 启动 PG/Redis + go run ./cmd/qzda-app(连本机 PG/Redis)
make run-demo      # 内存 + ACME seed,无 PG(纯 demo)
```

### 2.3 沙箱 gVisor 启用

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

`make run` 时通过 `deploy/.env` 注入到所有容器。完整变量清单见
[`deploy/.env.example`](./.env.example)。最常用:

| 变量 | 默认 | 说明 |
|------|------|------|
| `QZDA_MODE` | `dev` | `dev`(PG 持久化,可选内存)/ `pro`(双人审批 + Vault + OIDC + 强制签名);见 [环境与数据模式](../../docs/环境与数据模式.md) |
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
make smoke
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

`make compose-up` 自动等所有 healthy 才退出。

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

- `compose-up-temporal` / `compose-up-oidc` / `compose-up-authentik` /
  `compose-up-kafka` / `compose-up-mtls` / `compose-up-spiffe` /
  `compose-up-opa` / `compose-up-search` /
  `compose-up-obs` / `compose-up-staging` / `compose-up-replica` /
  `compose-up-full` / `compose-up-monolith-workflow` — K8s / 分布式组件
  全部下线,单机部署不再需要
- `compose-up-coarse` — M10 折叠到 qzda-app,不存在
- 所有 OIDC / Vault / Temporal / Kafka / OPA / OpenSearch /
  Prometheus / Grafana / SPIFFE / mTLS 相关 env 变量 — 单进程部署不需要
- `QZDA_MILVUS_URI` — 已替换为 `QZDA_PGVECTOR_URL`(同 PG 实例的 pgvector 扩展)
- K8s / Helm / kubectl 相关说明 — 已迁移到单机 Docker

详见 [`docs/数字伙伴平台-技术规格说明.md`](../../docs/数字伙伴平台-技术规格说明.md)
与 [`CHANGELOG.md`](../../CHANGELOG.md)(M10 折叠 + Phase 4 重命名)。
