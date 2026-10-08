# API 参考

> 5 个端点全部在 [`app/main.py`](../app/main.py)。本文档列字段 + 错误码 + 源码位置。

## GET `/healthz`

健康检查 + 隔离探测 + cgroup 配额自描述。**无鉴权**。

**响应 200**([`app/main.py:121-135`](../app/main.py)):

```json
{
  "status": "ok",
  "service": "sandbox",
  "sandbox": "runsc-ptrace",
  "runtime": "runsc-ptrace",
  "runscBinary": true,
  "runscRequested": true,
  "controlPlaneReachable": false,
  "isolation": {"reachable": [], "isolated": true},
  "runTokenRequired": true,
  "pidsLimit": 128,
  "memoryLimitBytes": 1073741824
}
```

- `sandbox` / `runtime` — 当前实际 runtime tier(`runsc-kvm` / `runsc-ptrace` /
  `runsc-emulated` / `runc` / `process`)
- `controlPlaneReachable: true` — 违反隔离契约;运维应立即告警
- `pidsLimit` / `memoryLimitBytes` — cgroup v1/v2 推断;`null` 表示无 cgroup 或 `max`

## GET `/`

同 `/healthz`,为 LB 兼容而存在。

## GET `/metrics`

Prometheus text exposition([`app/main.py:138`](../app/main.py))。

关键 series([`app/telemetry.py`](../app/telemetry.py)):

| Series | Type | 含义 |
|---|---|---|
| `skill_executions_total{status,sandbox}` | counter | 执行次数(按 status / sandbox tier) |
| `skill_execution_duration_seconds{sandbox}` | histogram | 执行耗时 |
| `skill_in_flight` | gauge | 当前并发 |
| `egress_blocked_total` | counter | egress 拒绝次数 |
| `egress_proxy_up` | gauge | 127.0.0.1:8081 代理存活(0/1) |
| `rate_limit_rejected_total{scope}` | counter | rate limit 拒绝(scope ∈ ws / ip / actor) |
| `skill_syscalls_total{syscall}` | counter | Python 层 syscall 计数 |

**无鉴权**;Compose / 网络层(`qzda_exec_net`)控制可达性。

## POST `/v1/execute`

**唯一鉴权入口**。RunToken 在 body 字段 `runToken`,Go 控制面用共享 HMAC 签出。

**Request**([`app/main.py:184-209`](../app/main.py)):

```json
{
  "runToken": "v1.<base64 payload>.<hex hmac>",
  "skillId": "weather",
  "packagePath": "/skills/weather",
  "scripts": ["scripts/fetch.sh"],
  "command": "bash scripts/fetch.sh wttr.in",
  "timeoutSec": 30,
  "correlationId": "audit-2026-10-01-abc",
  "action": "run"
}
```

- `command` 必须匹配 `_SCRIPT_RE`(白名单形式见 [`architecture.md`](architecture.md))。
  不匹配 → `status=needs_instruction`,响应 200 但 `ok=false`。
- `scripts` 是允许执行的脚本相对路径列表。
- `correlationId` 透传至 OTel span + 子进程 env。

**DOCX 路径**(特殊,不需要 `packagePath`)— `app/main.py:305` 走 `build_docx_artifact`:

```json
{
  "runToken": "v1...",
  "skillId": "docx",
  "action": "create",
  "title": "Q3 Plan",
  "content": "Section A\nSection B",
  "correlationId": "..."
}
```

**Response 200**(脚本路径,`app/main.py:370-400`):

```json
{
  "ok": true,
  "status": "executed",
  "runtime": "runsc-ptrace",
  "skillId": "weather",
  "stdout": "sandbox=...\n--- stdout ---\n...",
  "error": null,
  "durationMs": 124,
  "runTokenAccepted": true,
  "denyControlPlane": true,
  "workspaceId": "w1",
  "correlationId": "audit-2026-10-01-abc",
  "packagePath": "/skills/weather",
  "isolation": {"reachable": [], "isolated": true},
  "egressAllowed": ["wttr.in"],
  "egressUsed": ["wttr.in"],
  "egressDenied": [],
  "syscalls": {"open": 12, "connect": 3, "exec": 1, ...},
  "egressCumulative": {"used": ["wttr.in"], "denied": []},
  "egressProxyUp": true,
  "downloadPath": "/v1/artifacts/weather-out.docx",
  "artifactNames": ["weather-out.docx"]
}
```

**Errors**(`app/main.py`):

| Status | 触发 | 来源 |
|---|---|---|
| **429** | rate limit(per-`(ws,actor)` 或 per-IP) | `app/rate_limit.py` |
| **401** | RunToken 缺失 / 格式错 / HMAC 验签失败 / 已过期 | `app/sandbox.py:verify_run_token` |
| **403** | `leakedEnv` 命中控制面 DSN、`denyControlPlane=False`、控制面网络可达、`skill package signature check failed` | `app/main.py:266, 273, 293` |

**`status` 字段取值**(在响应 200 内):

- `executed` — 脚本跑完 + 退出码 0
- `failed` — 退出码非 0 / timeout / unsupported
- `noop` — 既无 packagePath 也无 command(空执行)

## GET `/v1/artifacts/{name}`

按名字下载 [`/v1/execute`](#post-v1execute) 产出的制品([`app/main.py:426`](../app/main.py))。

- 路径参数必须为扁平文件名;任何 `..` / `/` / `\` → **400 invalid artifact name**。
- 仅服务 `app.docx_gen.artifact_dir()` 下的产物;`[]=404 not found`。
- Content-Type 按扩展名推断:`.docx` / `.pptx` / `.pdf` / 兜底 `application/octet-stream`。
- **无鉴权**;网络层(`qzda_exec_net` + 网关 `x-workspace-id`)保证隔离。