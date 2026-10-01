# qzda-skill-runtime

FastAPI skill sandbox on port **8093**. **Monolith 与 coarse 均必须独立部署**（不可并入 qzda-app）。RunToken HMAC verification and package script execution.

## Endpoints

- `GET /healthz` — sandbox status, runtime tier (runsc-kvm / runsc-ptrace / runc / process), isolation probe, cgroup limits
- `POST /v1/execute` — execute skill with RunToken
- `GET /v1/artifacts/{name}` — download generated Office/PDF artifact

## Sandbox runtime tier

镜像入口探测 `/proc/1/cmdline` + `DE_SKILL_RUNTIME_DETECTED`，实际声明四档：

| `sandbox` / `runtime` | 含义 | 启动开销 | 隔离强度 |
|----|----|----|----|
| `runsc-kvm` | gVisor + KVM（Linux host + `/dev/kvm` 可用） | +200ms | syscall 层 |
| `runsc-ptrace` | gVisor + ptrace（macOS dev / 无 KVM） | +500ms | syscall 层 |
| `runsc-emulated` | 镜像内 runsc 二进制存在却未启用 runsc | 0 | 进程级 |
| `runc` | 普通 runc 容器 | 0 | 进程级 |
| `process` | 直接进程（兜底） | 0 | 仅 env 过滤 |

`/healthz` 同步返回 `runscRequested` 与 `runscBinary` 供运维判定实际能力。

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DE_BIND_HOST` | `0.0.0.0` | Bind address |
| `DE_BIND_PORT` | `8093` | Bind port |
| `DE_SKILL_RUN_SECRET` | `qzda-skill-run-dev` | HMAC secret for RunToken |
| `DE_SKILL_SANDBOX` | `runsc` | Requested capability (runsc / gvisor-local) |
| `DE_SKILL_REQUIRE_ISOLATION` | `1` (Docker) | Reject if control-plane reachable |
| `DE_SKILL_RUNTIME_DETECTED` | (set by entrypoint) | Actual runtime tier |
| `DE_SKILL_RUNTIME` | `runc` | (compose) Docker runtime spec; set `runsc` to opt in |

On startup, control-plane DSN env vars (`DE_DATABASE_URL`, etc.) are stripped.

## Run locally

```bash
cd backend
pip install -r services/qzda-skill-runtime/requirements.txt
python3 runtimes/qzda_skill_runtime/main.py
# or
cd services/qzda-skill-runtime && uvicorn app.main:app --host 127.0.0.1 --port 8093
```

## Docker

```bash
docker build -t qzda-skill-runtime:local backend/services/qzda-skill-runtime
docker run --rm -p 8093:8093 -e DE_SKILL_REQUIRE_ISOLATION=1 qzda-skill-runtime:local
```

### gVisor (runsc) 启用

```bash
# 1. 安装 runsc（Linux host）
curl -fsSL https://gvisor.dev/archive/nightly/latest/runsc \
  -o /usr/local/bin/runsc && chmod +x /usr/local/bin/runsc
runsc install

# 2. Compose 启用 runsc
cd backend
DE_SKILL_RUNTIME=runsc make compose-up-monolith

# 3. 验证
docker exec qzda-skill-runtime cat /proc/1/cmdline | tr '\0' ' '
# 期望：…/runsc --root /var/run/docker/runsc --log runsc日志 --log-format json …
curl -s http://127.0.0.1:8093/healthz | jq .sandbox
# 期望："runsc-ptrace" 或 "runsc-kvm"

# 4. KVM 加速（Linux host + /dev/kvm 可用）
DE_SKILL_RUNTIME=runsc docker run -it --rm --runtime=runsc \
  qzda-skill-runtime:local sh
# 在容器内确认是 KVM：
cat /proc/cpuinfo | grep vmx   # 或 svm（AMD）
```

`seccomp` / `apparmor` 必须 `unconfined`（gVisor 自己实现 syscall 拦截，重复套用会与 Sentry 冲突）。

Compose (`deploy/compose.yml`) builds from `services/qzda-skill-runtime/Dockerfile`.

## 资源配额（compose 已默认）

- `cpus: 2.0` / `memory: 1024M` / `pids: 128`
- `read_only: true` + `tmpfs: /tmp:64m, /var/run:8m`
- `cap_drop: ALL` + `cap_add: CHOWN/SETUID/SETGID/DAC_OVERRIDE`
- `no-new-privileges: true`

## Egress allowlist（阶段 2）

技能脚本执行允许访问的外联域名由 `RunToken` 的 `allowedEgress` 字段签名声明，
**Python 沙箱消费该字段作为唯一可信源**（不读 body 字段，防篡改）。

### 三层强制

| 层 | 机制 | 拦截对象 |
|---|---|---|
| 签名层 | `RunToken` HMAC-SHA256，Go 控制面签发 | body 字段被篡改 |
| DNS 层 | `sitecustomize.py` bootstrap，`DnsGate` monkey-patch `socket.getaddrinfo` | Python stdlib（`socket`/`urllib`） |
| 代理层 | `127.0.0.1:8080` stdlib 出口代理，子进程 `HTTPS_PROXY` 注入 | `curl` / `requests` / `urllib3` / `node fetch` / `Go net/http` 等守规矩的 HTTP 客户端 |

### 声明流程

技能包在 `SKILL.md` front-matter 声明：

```yaml
---
name: weather
egress:
  - wttr.in
---
```

控制面读 front-matter（`internal/skills/manifest`）→ 与 admin policy 的
`allowedEgress` 求**交集**（保守：admin 可收紧，不能放宽）→ 把交集签入
`RunToken.allowedEgress` → Python 沙箱按此 allowlist 设置 `DnsGate` 与代理。

### 默认策略

`defaultSkillGovernance` 的 `allowedEgress` 在阶段 2 起为 `[]`（deny-all）。
未声明 `egress:` 的技能包 → 拒绝全部外联；admin policy 为空 → 也拒绝。

### 响应字段

`POST /v1/execute` 响应 JSON 中：

```json
{
  "egressAllowed": ["wttr.in"],
  "egressUsed":    ["wttr.in"],
  "egressDenied":  []
}
```

`egressUsed` / `egressDenied` 是 Python 沙箱聚合后的实际访问清单；写进
Go 侧 audit `detail`（`grep egress=wttr.in` 检索）。
