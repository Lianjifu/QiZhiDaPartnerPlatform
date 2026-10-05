# qzda-sandbox

> Python 技能 / MCP 执行沙箱。`port 8093`,**必须独立部署**(不能并入 `qzda-app`)。
> 见 [`backend/deploy/topology-split.md:11`](../../deploy/topology-split.md) 的
> 必须独立部署规则。

## 端点

| Method | Path | 用途 | Source |
|---|---|---|---|
| `GET` | `/healthz` | 健康检查 + 隔离探测 + cgroup 配额 | [`app/main.py:108`](app/main.py) |
| `GET` | `/` | 服务自描述 banner(同 `/healthz`) | [`app/main.py:109`](app/main.py) |
| `GET` | `/metrics` | Prometheus exposition | [`app/main.py:138`](app/main.py) |
| `POST` | `/v1/execute` | RunToken 鉴权后执行技能脚本 / 生成 DOCX | [`app/main.py:183`](app/main.py) |
| `GET` | `/v1/artifacts/{name}` | 拉取执行产出的 Office / PDF 制品 | [`app/main.py:426`](app/main.py) |

## 文档导航

| 主题 | 路径 |
|---|---|
| 架构 / 组件 / RunToken / 3 层 egress / cgroup | [architecture.md](docs/architecture.md) |
| API 字段 / 响应 schema / 错误码 | [api.md](docs/api.md) |
| 安全模型 / Phase 2/3/4 hardening / 解释器白名单 / 签名 | [security.md](docs/security.md) |
| 运维 runbook / gVisor / 常见 footgun | [operations.md](docs/operations.md) |
| W1-D2 + W2-D1 签名 / 发布流水线(builtin + workspace publisher) | [signing/README.md](signing/README.md) |
| Compose / 端口 / secrets | [`backend/deploy/README.md`](../../deploy/README.md) · [`backend/deploy/topology-split.md`](../../deploy/topology-split.md) |

## 环境变量(quick ref)

完整说明见 [`backend/deploy/README.md:82`](../../deploy/README.md) 和
[`app/sandbox.py:42-69, 130-145, 228-232, 360-394`](app/sandbox.py)。本表只列
**最常被运维调整**的几个。

| Var | 默认 | 用途 |
|---|---|---|
| `QZDA_BIND_HOST` / `QZDA_BIND_PORT` | `0.0.0.0` / `8093` | uvicorn bind |
| `QZDA_SANDBOX_RUN_SECRET_FILE` | `/etc/qzda/skill-run-secret` | RunToken HMAC key 文件(fail-closed) |
| `QZDA_SANDBOX_RUN_SECRET` | (无) | 兼容用 env 注入 HMAC;**生产拒收 `qzda-skill-run-dev` 占位值** |
| `QZDA_SANDBOX_REQUIRE_ISOLATION` | `1` (Docker) | 控制面可达时 fail-closed |
| `QZDA_SANDBOX_RUNTIME_DETECTED` | (entrypoint 设置) | 实际 runsc / runc / process,`/healthz` 反射 |
| `QZDA_SANDBOX_SANDBOX` | `runsc` | 声明期望的隔离模式 |
| `QZDA_SANDBOX_AUDIT` / `QZDA_SANDBOX_AUDIT_BLOCK_OPEN` | `0` | Python `audit_hooks` 开关 |
| `QZDA_SANDBOX_DEFAULT_PIDS` / `CPU_SECS` / `MEM_MB` | `64` / `30` / `512` | `prlimit` per-exec 默认 |
| `QZDA_SANDBOX_RATE_LIMIT_PER_MIN` | `60` | token-bucket 阈值(per `(ws, actor)` + per-IP) |
| `QZDA_SANDBOX_TRUSTED_KEY_IDS` | (CSV) | 信任的 Ed25519 publisher KeyID 列表 |

## 网络

- 拥有 `qzda_exec_net`（`qzda-app` 双挂以调用）。详见 [`backend/deploy/networks.md:6`](../../deploy/networks.md)。
- 容器内 `seccomp=unconfined`(gVisor 自己实现 syscall 拦截,重复套用会与 Sentry 冲突)。

## 现状

| 阶段 | commit | 内容 |
|---|---|---|
| Phase 2 egress | `16b22bc` | signed `allowedEgress` + DnsGate + 127.0.0.1:8080 代理 |
| Phase 3 观测 | `9333776` | 父进程 audit_hooks + Prometheus / OTel + `AppendAudit` `;syscalls=…` |
| Phase 4 收口 | `c4fdaac` | LD_PRELOAD、签名收紧、prlimit、proxy 自愈、rate limit、parent DnsGate、workspace env |
| PR2 白名单 | `7ed63a9` | 解释器收缩到 `.py`/`.sh`;`pptx` / `spreadsheets` 临时剔除 builtin |