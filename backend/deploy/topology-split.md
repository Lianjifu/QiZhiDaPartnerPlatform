# 服务拆分拓扑（粗粒度 + monolith）

## 方案 A — monolith（本地 / SME 默认）

**主路径**：`make compose-up-monolith` 或 `make run` → gateway `:8089` → **qzda-app `:8100`** + **qzda-skill `:8093`**。

| 单元 | 端口 | 内含模块 |
|------|------|----------|
| qzda-gateway | 8089 | Envoy `envoy.monolith.yaml` 或 dev `gateway-proxy-monolith.py` |
| **qzda-app** | 8100 | **sys + collab + cap**（`ModeApp` / `DomainAll`） |
| qzda-skill-runtime | 8093 | 技能沙箱执行（必须独立） |
| qzda-workflow（可选） | 8103 | 不用工作流时可不启 |

不启：qzda-agent（`DE_RUNTIME_MODE=local` 默认进程内 Harness）、qzda-rag（按需）。

可选工作流：`make compose-up-monolith-workflow` 或 `DE_WITH_WORKFLOW=1 scripts/dev-stack/run-stack.sh`。

```bash
cd backend && make compose-up-monolith
# 裸跑：make run-app & make skill &
# dev-stack：DE_STACK=monolith scripts/dev-stack/run-stack.sh（默认）
```

## 方案 coarse — 四进程（规模化）

**路径**：`make compose-up-coarse` → gateway `:8089` → `8100–8103` + FastAPI `8091–8093`。

| 单元 | 端口 | 内含模块 |
|------|------|----------|
| qzda-gateway | 8089 | Envoy `envoy.coarse.yaml` |
| qzda-sys | 8100 | platform · ops；**默认仍吸收** policy · audit |
| qzda-collab | 8101 | collab · employee |
| qzda-cap | 8102 | model · knowledge · memory · skill · channel |
| qzda-workflow | 8103 | workflow HTTP + Temporal Worker |
| qzda-policy（可选） | 8104 | access · zero-trust · `/v1/evaluate` · release-approvals |
| qzda-audit（可选） | 8105 | audit-center；读 `audit.events` |
| qzda-agent-runtime / qzda-rag / qzda-skill-runtime | 8091–8093 | FastAPI |

已退役：`qzda-core:8080`、旧细端口 `qzda-policy:8094` / `qzda-audit:8095`、`envoy.split.yaml`。

独立 policy/audit：`DE_CROSSCUTTING_SPLIT=1` 加在 qzda-sys 上，并 `make run-policy` / `make run-audit`。不上 16 微服务。gVisor / Milvus 仍是 cap 后续层，不阻塞本切片。

## 启动

```bash
cd backend && make compose-up-monolith   # 默认
# coarse：make compose-up-coarse
# FE Vite 默认代理 → :8089
```

## 切流说明

- `ServiceMode` 过滤路由；共享 PG KV 水合。
- collab/cap：`DE_POLICY_URL=http://qzda-sys:8100`（`/v1/evaluate`）；切开后可改 `http://qzda-policy:8104`。
- 审计写入：各进程本地 sink（PG / Redis / Kafka / OpenSearch）。独立 qzda-audit 读 `audit.events`，不另起会签引擎。
- Envoy 使用 Docker DNS：`qzda-sys` / `qzda-collab` / `qzda-cap` / `qzda-workflow`。
- 多活最小集：`DE_REPLICA_MODE=standby` 拒写；standby 优先 `DE_DATABASE_REPLICA_URL`；`pg_is_in_recovery()` 为真则强制 standby。可选 `make compose-up-replica` 起本机从库 `:5433`。不上 cn-east/south 双活 K8s。
