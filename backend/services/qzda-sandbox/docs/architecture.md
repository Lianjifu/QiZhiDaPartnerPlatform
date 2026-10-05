# 架构(architecture)

## 组件图(模块依赖)

```
HTTP request
   │
   ▼
app/main.py         FastAPI 入口 + 路由(/healthz、/v1/execute、/v1/artifacts/{name})
   │
   ├─► app/rate_limit.py        阶段 4 #6 — 进程内 token-bucket
   │       per (workspaceId, actorId) + per-IP,鉴权前先 hit,防"假 token 真 flood"
   │
   ├─► app/sandbox.py           RunToken HMAC 鉴权 + 网络隔离探测 + cgroup 探测
   │       ├── app/sign_verify.py     阶段 4 #3 — skill 包 .signed marker 校验
   │       ├── app/audit_hooks.py     阶段 3 — Python 层 syscall 计数
   │       └── (subprocess.run)
   │              ├── libqzda_egress.so     LD_PRELOAD — 非环回 connect 重定向到代理
   │              ├── /tmp/qzda-bootstrap/sitecustomize.py
   │              │     Python 子进程 DnsGate(phase 2:空 allowlist 仍安装)
   │              │     + audit_hooks.install_audit_hooks()(QZDA_SANDBOX_AUDIT=1 时)
   │              └── preexec_fn=make_preexec()     prlimit(RLIMIT_NPROC/AS/CPU)
   │
   ├─► app/egress_proxy.py      阶段 2 — 常驻 127.0.0.1:8080 stdlib 出口代理
   │       阶段 4 #8 supervisor thread 每 10s 探活 + 指数退避重启
   │       └── app/egress.py      DnsGate + 子进程代理 fork
   │
   ├─► app/docx_gen.py          内置 DOCX 生成(不启子进程,纯 python-docx)
   │       └── app/artifact_harvest.py    扫包目录采集 Office/PDF 制品
   │
   └─► app/telemetry.py         OTel tracing + Prometheus metric
           (OTEL_EXPORTER_OTLP_ENDPOINT 决定是否真发远端 collector)
```

## 解释器白名单(PR2)

[`app/sandbox.py:34-39`](../app/sandbox.py) 定义 `_SCRIPT_RE`(路径白名单,接受
任意扩展名);真正的解释器白名单是同一文件
[`SUPPORTED_SUFFIXES = (".py", ".sh")`](../app/sandbox.py) 守在 dispatch 阶段。

**为什么收缩:** Node.js 脚本在 ptrace 后端的 gVisor 容器里跑不起来(node 没装),
却**不**返回明确错误 — 只得到 127 + 假成功信号,给上层审计造成"跑通"的错觉。
PR2 (`7ed63a9`) 把这一路关死:

- 路径层 `_SCRIPT_RE` 接受任意 `.ext`,匹配后做 `safe_under` 防穿越
- dispatch 层 `if lower.endswith(".py") / ".sh" ... else: return False, "unsupported_interpreter"`
- builtin manifest 同步剔除 Node-only 的 `pptx` / `spreadsheets`(`disabledSkills` 字段),
  Python 重写到位前不会重新 seed

详细测试见 [`app/sandbox_test.py`](../app/sandbox_test.py)。

## RunToken 流(数字标号与 [`app/main.py:183`](../app/main.py) 一致)

1. **签发** — Go 控制面 `qzda-app` 在 `internal/auth/runtoken.go` 用共享 HMAC 密钥
   (`QZDA_SANDBOX_RUN_SECRET`)签 `v1.<payload>.<sig>`,claims 含 `workspaceId` /
   `skillId` / `allowedEgress` / `exp`。
2. **调用** — 调用方 `POST /v1/execute` 带 body JSON + 上述 token。
3. **rate limit** — `app/rate_limit.py` 在鉴权前先 hit 一次(防止假 token 真 flood)。
5. **HMAC 验证** — [`app/main.py:245`](../app/main.py) 调
   [`app/sandbox.py:verify_run_token`](../app/sandbox.py);`iat` ±60s,`exp` 未过期。
6. **进程环境隔离** — [`app/main.py:265`](../app/main.py) 二次过滤 `QZDA_DATABASE_URL`
   等控制面变量;`denyControlPlane=False` 显式拒绝。
7. **网络隔离探测** — [`app/main.py:272`](../app/main.py) 调
   [`control_plane_probe`](../app/sandbox.py);`QZDA_SANDBOX_REQUIRE_ISOLATION=1` 时
   PG/Redis 可达 → 403。
8. **skill 包签名** — 阶段 4 #3,见 [`app/sign_verify.py`](../app/sign_verify.py) +
   `signing/README.md`。
9. **执行** — `run_package_script` 同步 `subprocess.run`(`preexec_fn` 调
   `make_preexec` 设置 `RLIMIT_NPROC/AS/CPU`;env 注入 `LD_PRELOAD=libqzda_egress.so`
   + `HTTPS_PROXY=127.0.0.1:8080` + DnsGate bootstrap)。
10. **审计** — Python `audit_hooks.summary()` 聚合并通过响应回 Go 控制面
    `AppendAudit`(`;syscalls=…` 形状)。
11. **制品采集** — `app/artifact_harvest.py` 扫描包目录,合并 `downloadPath`,
    由 [`/v1/artifacts/{name}`](../app/main.py) 提供下载。

## 3 层 egress 强制(为什么跑不通)

| 层 | 机制 | 拦截对象 |
|---|---|---|
| 签名层 | RunToken HMAC-SHA256,Go 控制面签发 | body 字段被篡改(`claims.allowedEgress` 是唯一可信源) |
| DNS 层 | `sitecustomize.py` bootstrap,`DnsGate` monkey-patch `socket.getaddrinfo` | Python stdlib(`socket` / `urllib` / `requests`) |
| 代理层 | `127.0.0.1:8080` stdlib 出口代理,子进程 `HTTPS_PROXY` 注入 | `curl` / `wget` / `urllib3` / Go `net/http` 等守规矩的 HTTP 客户端 |
| **C 层** | `libqzda_egress.so` `LD_PRELOAD` 拦截非环回 IPv4 `connect()` | 任何直接调 `connect(2)` 的客户端(go net/http、wget、curl) |

**默认 deny-all(空 `allowedEgress`)** — [`app/sandbox.py:386-394`](../app/sandbox.py)
**强制** 装 DnsGate + 拒绝 IP literal + 清掉继承的 `HTTP_PROXY` / `HTTPS_PROXY` /
`NO_PROXY`(阶段 2 修了 deny-all bypass,见 commit `c4fdaac`)。

## cgroup / prlimit

[`app/sandbox.py:make_preexec()`](../app/sandbox.py) 在 `preexec_fn=` 里跑
`prlimit(2)`,**不需要 SYS_ADMIN**:

| Limit | 用途 | 默认(env) |
|---|---|---|
| `RLIMIT_NPROC` | 防 fork bomb | `QZDA_SANDBOX_DEFAULT_PIDS=64` |
| `RLIMIT_CPU` | 超时由 SIGXCPU 触发 | `QZDA_SANDBOX_DEFAULT_CPU_SECS=30` |
| `RLIMIT_AS` | 虚拟地址上限(不是 RSS,够用) | `QZDA_SANDBOX_DEFAULT_MEM_MB=512` |

子进程被 SIGKILL=`-9` / SIGTERM=`-15` / SIGXCPU=`24` 杀掉时,
[`app/sandbox.py:413-421`](../app/sandbox.py) 在响应里写 `rlimit_killed=true`
让上层审计知道是 X 掉而不是普通非零退出。

容器层面 `pids.max` / `mem.max` 见 [`app/main.py:_pids_limit / _memory_limit_bytes`](../app/main.py),
`/healthz` 一并返回。

## 审计 / 观测

- **Python 层** — [`app/audit_hooks.py`](../app/audit_hooks.py) 通过
  `sys.addaudithook()`(阶段 3)挂 `os.open` / `subprocess.*` / `exec*` /
  `socket.connect`,聚合 `(syscall, retval)` 计数写到响应 `syscalls` 字段。
- **Go 侧** — 控制面 [`internal/server/builtin_skills.go:auditAppend`](../../internal/server/builtin_skills.go)
  把 `syscalls=summary()` 拼到 audit detail(`;syscalls=…` 形状)。
- **Prometheus** — [`app/telemetry.py`](../app/telemetry.py) 暴露:
  - `skill_executions_total{status,sandbox}`
  - `skill_execution_duration_seconds{sandbox}`
  - `skill_in_flight`(gauge)
  - `egress_blocked_total`
  - `skill_syscalls_total`
  - `rate_limit_rejected_total{scope}`
  - `egress_proxy_up`(gauge)
- **OTel** — `OTEL_EXPORTER_OTLP_ENDPOINT` 配则发远端 collector;否则 console 导出。
- **CorrelationId** — 透传到 OTel span、子进程 env (`QZDA_SANDBOX_CORRELATION_ID`),
  端到端 trace 一致。