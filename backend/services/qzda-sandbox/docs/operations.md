# 运维 runbook(operations)

## Compose profile 选择

qzda-sandbox 必须**独立部署**（不能并入 qzda-app）。M10 后控制面只有 `qzda-app` 单进程，沙箱与 qzda-app 共 docker-compose，由 `qzda-app` 调用。

| Profile | 部署 | Network |
|---|---|---|
| monolith（当前默认，唯一形态） | `qzda-sandbox` 与 `qzda-app` 共 docker-compose,8093 ↔ 8100 内部互联 | `qzda_exec_net` 双挂 |

启动:

```bash
cd backend
make compose-up-monolith    # 默认(快速联调)
```

详细规则与不能并入 qzda-app 的原因见
[`backend/deploy/topology-split.md`](../../../deploy/topology-split.md)(line 11)。

## 资源配额(Compose + cgroup 双层)

Compose 层(`backend/deploy/compose.yml`):

- `cpus: 2.0`、`memory: 1024M`、`pids_limit: 128`
- `read_only: true` + `tmpfs: /tmp:64m, /var/run:8m`
- `cap_drop: ALL` + `cap_add: CHOWN/SETUID/SETGID/DAC_OVERRIDE`
- `no-new-privileges: true`

Cgroup 层(`app/main.py:_pids_limit / _memory_limit_bytes`,
`app/sandbox.py:_default_prlimit`):

| | Default env | 含义 |
|---|---|---|
| Container pid limit | compose `pids_limit: 128` | 全容器进程数 |
| Per-exec NPROC | `QZDA_SANDBOX_DEFAULT_PIDS=64` | `prlimit(2)` 派发上限 |
| Per-exec CPU | `QZDA_SANDBOX_DEFAULT_CPU_SECS=30` | 超时触发 SIGXCPU |
| Per-exec AS | `QZDA_SANDBOX_DEFAULT_MEM_MB=512` | 虚拟地址上限 |

Healthz probe cadence(Compose):

```yaml
interval: 30s
retries: 3
start_period: 60s
```

## /healthz + readiness

- `GET /healthz` **同时承担存活 + 就绪**,见 [`api.md`](api.md)。
- `status: ok` + `controlPlaneReachable: false` 才算"真健康"。
- `sandbox: process` 意味着 gVisor 没启用,**生产应告警**(只兜底 dev)。

## gVisor(runsc)启用

**安装 runsc 二进制**

```bash
curl -fsSL https://gvisor.dev/archive/nightly/latest/runsc \
  -o /usr/local/bin/runsc && chmod +x /usr/local/bin/runsc
runsc install
```

**容器内探测当前 runtime**([`app/sandbox.py:81-118`](../app/sandbox.py)):

- 读 `/proc/version`,含 `gvisor` 字串 → runsc 容器
- 读 `/dev/kvm` 决定 `runsc-kvm` / `runsc-ptrace`
- 读 `/proc/1/cmdline` 兜底识别 `runsc-kvm` / `runsc` / `runc` / 兜底 `process`
- 镜像入口 `docker-entrypoint.sh` 探测后把结果写到 `QZDA_SANDBOX_RUNTIME_DETECTED`

**macOS / 无 KVM host** — 走 `runsc-ptrace`,性能差但稳定。Linux + `/dev/kvm` 暴露
则走 `runsc-kvm`,+200ms 启动开销,syscall 层拦截。

> 关于 colima 上 gVisor 探测的细节、镜像启动 IndexError、service 改名时间线 —
> 见 auto-memory 条目 `sandbox_colima_runsc.md`(比 doc 更详细的本地 footgun)。

## Egress 代理自愈

`app/egress_proxy.py:supervisor_loop()` 每 10s 一次
`socket.create_connection(("127.0.0.1", 8080), timeout=1)`;失败 → `stop()` 再 `start()`,
指数退避封顶 30s。指标 `egress_proxy_up{instance}`(0/1)。

`/v1/execute` 响应 `egressProxyUp: false` 时,前端可据此提示"网络出口策略已停用"。

## Rate limit 观测

[`app/rate_limit.py`](../app/rate_limit.py) 实现 token-bucket,per
`(workspaceId, actorId)` + per-IP,滑动 60s,默认 `QZDA_SANDBOX_RATE_LIMIT_PER_MIN=60`。

指标 `rate_limit_rejected_total{scope}`(scope ∈ ws / actor / ip)。

## Prometheus + OTel

Scrape target: `qzda-sandbox:8093/metrics`,已在 `backend/deploy/obs/prometheus.yml:26` 配置。
关键 series 见 [`api.md`](api.md) 的 `/metrics` 段。

OTel:

- `OTEL_EXPORTER_OTLP_ENDPOINT` 环境变量设置后发远端
- correlation_id 通过 OTel span attribute + 子进程 env (`QZDA_SANDBOX_CORRELATION_ID`)
  端到端 trace

## 常见 footgun

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| `lsof -i :8093` 报两个 listener | host `services/qzda-sandbox/main.py` 与容器 uvicorn 都起了 8093 | 杀 host,只用容器(详细见 auto-memory `sandbox_port_conflict.md`) |
| `/v1/execute` 始终 401 `runToken expired` | 控制面与沙箱时钟漂移 > 60s | ntpdate / chrony 对齐 |
| `QZDA_SANDBOX_SANDBOX=gvisor-local` 沙箱降级 `process` | 没设 runsc | 见上文 *gVisor 启用* |
| `sealelf: not found` 容器启动失败 | Dockerfile builder stage 缺 `libc6-dev`,本机 `Makefile` 没跑 `make bake` | `make bake` 重 build |
| `egressProxyUp: false` 持续 | 127.0.0.1:8080 起不来 | 检查 `EgressProxy.start()` 日志;`lsof -i :8080` 看端口冲突 |
| `skill package signature check failed` | builtin / 用户上传包签名不匹配 | 重签(`cmd/sign-skill`)或重传原 `.skill` 包 |

## Backup / log path / 持久化

- **日志** — stdout/stderr → `docker logs qzda-sandbox`(单进程 uvicorn + tini)。
- **制品** — `app.docx_gen.artifact_dir()` 默认容器内 `/artifacts/{correlation_id}/`,
  Compose bind mount 到 host;重启容器**保留**(volume),查文档等;
  不在容器里有持久层(除 `/artifacts/`)。
- **配置** — `/etc/qzda/skill-run-secret` 是 secret mount,容器只读,不进镜像层。
- **审计** — Python `audit_hooks.summary()` 经响应回 Go 控制面;最终 audit row
  在控制面 PG `audit.events`。

## Build / 镜像

```bash
# 本地 build
docker build -f services/qzda-sandbox/Dockerfile -t qzda-sandbox:local .
# 跑
docker run --rm -p 8093:8093 -v $PWD/backend/secrets/skill-run-secret:/etc/qzda/skill-run-secret:ro \
  --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
  --security-opt seccomp=unconfined --security-opt no-new-privileges=true \
  qzda-sandbox:local
```

## 已知 follow-up(PR4 范围)

- `MIGRATION-de-to-qzda.md` 内容陈旧但仍有 4 处 live 引用 — 需协同更新
- ~~`backend-contract.yml:75` 检查 `deploy/qzda-sandbox/seccomp.json`,但实际只在
  `deploy/qzda-skill-runtime/seccomp.json` — workflow path drift~~ → 已解决
  (2026-10-04 迁至 `deploy/qzda-sandbox/`)
- `docs/后端微服务重构方案.md:162` 写 `/v1/skills/execute`,实际是 `/v1/execute`
- Go fallback 路径(`internal/server/skill_artifacts.go` 等 5 处陈旧绝对路径)待清理

这些 PR3 不动,留给后续 PR。