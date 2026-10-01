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
