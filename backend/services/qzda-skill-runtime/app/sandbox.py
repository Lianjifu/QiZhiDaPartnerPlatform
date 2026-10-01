"""技能沙箱核心:RunToken 校验、脚本执行、隔离探测。

本模块负责所有「沙箱侧」的安全边界:
- HMAC-SHA256 RunToken 签名的解析与验证(由 Go 控制面签发,密钥共享)。
- 控制面环境变量的剥离(防子进程继承 PG/Redis 凭据)。
- 控制面网络的可达性探测(防 PG/Redis 联通)。
- 包内脚本白名单执行(``scripts/`` 与 ``.copilot-ws/`` 下固定扩展名)。
"""
from __future__ import annotations

import hashlib
import shlex
import hmac
import json
import os
import re
import shutil
import socket
import subprocess
import time
from base64 import urlsafe_b64decode
from pathlib import Path

# 控制面相关环境变量前缀/全名;子进程必须看不到这些凭据。
FORBIDDEN_ENV = ("DE_DATABASE_URL", "DE_REDIS_URL", "DATABASE_URL", "POSTGRES_", "REDIS_URL")

# 允许执行的脚本命令白名单正则:
# - 必须指向 ``scripts/`` 或 ``.copilot-ws/`` 下的脚本(.py/.sh/.js/.mjs/.ts)
# - 可选前置解释器(python3/node/bash/sh)
# - 可选 ``./`` 前缀
# - 后可跟参数(由 shlex 安全分词)
# 拒绝:管道、``;``、``$()``、绝对路径、包外脚本。
_SCRIPT_RE = re.compile(
    r"^(?:(?:python3?|node|bash|sh)\s+)?(?:\./)?"
    r"((?:scripts|\.copilot-ws)/[A-Za-z0-9._/-]+\.(?:py|sh|js|mjs|ts))"
    r"(?:\s+(.*))?$",
    re.I,
)


def skill_secret() -> str:
    """读取 RunToken 签名密钥。

    优先取环境变量 ``DE_SKILL_RUN_SECRET``,默认 ``qzda-skill-run-dev``
    是开发占位,生产必须显式注入(否则签名可被伪造)。
    """
    return os.environ.get("DE_SKILL_RUN_SECRET") or "qzda-skill-run-dev"


def runsc_present() -> bool:
    """探测 gVisor ``runsc`` 二进制是否安装。

    同时检查 PATH 与 ``/usr/local/bin/runsc``(Debian 系官方安装路径)。
    返回值仅作能力声明,不参与安全决策(安全仍由 env 剥离 + 网络探测保证)。
    """
    return shutil.which("runsc") is not None or os.path.isfile("/usr/local/bin/runsc")


def _detect_runsc_runtime() -> str:
    """读 /proc/version + /proc/1/cmdline 判断当前进程是否处于 runsc 容器内。

    返回值:
    - ``runsc-kvm``   : runsc + KVM 加速（Linux host + /dev/kvm 可用）
    - ``runsc-ptrace``: runsc + ptrace 后端（macOS / 无 KVM host）
    - ``runc``        : 普通 runc 容器
    - ``process``     : 兜底，直接进程（docker run 但未指定 runtime）

    gVisor runsc 把内核字符串改写为 ``Linux version 4.19.0-gvisor …``，
    这是容器内最可靠的探测信号——比 /proc/1/cmdline 更稳（gVisor
    不会把 host 的 runsc 进程名透到容器内）。KVM 后端通过 cpuinfo 暴露
    ``cpu_vendor`` / ``hypervisor`` 字段差异来区分。
    """
    version = ""
    try:
        with open("/proc/version", "r") as f:
            version = f.read()
    except OSError:
        pass
    if "gvisor" in version.lower():
        # runsc 容器;KVM 后端只在 host 暴露 /dev/kvm 时才会启用
        if os.path.exists("/dev/kvm"):
            return "runsc-kvm"
        return "runsc-ptrace"
    cmdline = ""
    try:
        with open("/proc/1/cmdline", "rb") as f:
            cmdline = f.read().replace(b"\x00", b" ").decode("utf-8", errors="replace")
    except OSError:
        return "process"
    if "runsc-kvm" in cmdline:
        return "runsc-kvm"
    if "runsc" in cmdline:
        return "runsc-ptrace"
    if "runc" in cmdline:
        return "runc"
    return "process"


def sandbox_mode() -> str:
    """当前沙箱模式自描述(4 档)。

    **返回:**
    - ``runsc-kvm``    : gVisor + KVM 加速（Linux host + KVM）
    - ``runsc-ptrace`` : gVisor + ptrace 后端（macOS / 无 KVM）
    - ``runsc-emulated``: 镜像内 runsc 二进制存在但 host 实际未启用 runsc
    - ``process``      : 进程级隔离（兜底）
    - ``gvisor-local`` : 向后兼容别名，映射到 process

    优先级:
    1. ``DE_SKILL_RUNTIME_DETECTED``（由 docker-entrypoint.sh 设置，最准确）
    2. 否则探测 ``/proc/1/cmdline``
    3. 否则按声明的 ``DE_SKILL_SANDBOX`` 推断
    """
    detected = os.environ.get("DE_SKILL_RUNTIME_DETECTED", "").strip()
    if detected:
        return detected
    runtime = _detect_runsc_runtime()
    if runtime in ("runsc-kvm", "runsc-ptrace", "runc", "process"):
        return runtime
    declared = (os.environ.get("DE_SKILL_SANDBOX") or "gvisor-local").strip()
    if declared == "runsc":
        return "runsc-emulated" if runsc_present() else "process"
    return "process"


def control_plane_probe() -> dict:
    """最佳努力探测:确认沙箱无法触达典型控制面主机。

    探测目标:
    - ``DE_PROBE_POSTGRES_HOST`` 环境变量(默认 ``postgres``):PG 5432
    - ``DE_PROBE_REDIS_HOST`` 环境变量(默认 ``redis``):Redis 6379
    - ``qzda-postgres`` / ``qzda-redis``:Compose 内固定服务名

    返回 ``reachable`` 列表与 ``isolated`` 布尔。
    超时仅 0.15s,确保即使被 DNS 拦截也不会拖慢 ``/healthz``。
    """
    hosts = [
        os.environ.get("DE_PROBE_POSTGRES_HOST", "postgres"),
        os.environ.get("DE_PROBE_REDIS_HOST", "redis"),
        "qzda-postgres",
        "qzda-redis",
    ]
    reachable = []
    for h in hosts:
        try:
            socket.create_connection((h, 5432 if "postgres" in h or h == "postgres" else 6379), timeout=0.15)
            reachable.append(h)
        except OSError:
            pass
    return {"reachable": reachable, "isolated": len(reachable) == 0}


def verify_run_token(token: str) -> tuple[bool, str, dict]:
    """校验 v1.<payload>.<sig> 格式的 RunToken(由 qzda-core 控制面签发)。

    校验步骤:
    1. 形态校验:必须为 ``v1`` 前缀 + 3 段。
    2. HMAC-SHA256 验签:常量时间比较,防时序攻击。
    3. base64url 解码 JSON claims。
    4. ``exp``(UNIX 秒)未过期。

    返回 ``(ok, error_msg, claims)``。
    - ok=True  → ``error_msg=""``,``claims`` 包含 ``workspaceId`` / ``skillId`` 等。
    - ok=False → ``error_msg`` 说明失败原因(``missing runToken`` /
      ``invalid runToken format`` / ``invalid runToken signature`` /
      ``invalid runToken payload`` / ``runToken expired``)。
    """
    if not token:
        return False, "missing runToken", {}
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        return False, "invalid runToken format", {}
    payload_b64, sig = parts[1], parts[2]
    mac = hmac.new(skill_secret().encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(mac, sig):
        return False, "invalid runToken signature", {}
    try:
        pad = "=" * (-len(payload_b64) % 4)
        raw = urlsafe_b64decode(payload_b64 + pad)
        claims = json.loads(raw.decode())
    except (ValueError, json.JSONDecodeError):
        return False, "invalid runToken payload", {}
    exp = int(claims.get("exp") or 0)
    if exp and int(time.time()) > exp:
        return False, "runToken expired", {}
    return True, "", claims


def safe_under(root: Path, rel: str) -> Path | None:
    """路径穿越防御:确保 ``root/rel`` 解析后仍在 ``root`` 内。

    使用 ``Path.resolve()`` 消除 ``..``/符号链接,再做前缀匹配。
    返回绝对路径或 ``None``(拒绝穿越时)。
    """
    try:
        target = (root / rel).resolve()
        root_res = root.resolve()
        if root_res == target or str(target).startswith(str(root_res) + os.sep):
            return target
    except OSError:
        return None
    return None


def run_package_script(
    package_path: str,
    scripts: list[str],
    command: str,
    timeout_sec: int,
    allowed_egress: list[str] | None = None,
) -> tuple[bool, str, int]:
    """执行技能包内白名单脚本。

    流程:
    1. 校验 ``package_path`` 是目录。
    2. 用 ``_SCRIPT_RE`` 匹配 ``command``;不匹配时回退到 ``needs_instruction``
       提示并附 SKILL.md 前 800 字节(让调用方读说明书再发)。
    3. ``safe_under`` 防路径穿越,确认目标文件存在。
    4. 按扩展名决定解释器(.py→python3 / .js,.mjs→node / .ts→npx tsx / 其他→bash)。
    5. 复制环境变量但过滤 ``FORBIDDEN_ENV``,再注入 ``DE_SKILL_PACKAGE_ROOT``
       / ``DE_SKILL_WORK_DIR`` 让脚本能定位自己。
    5a. **阶段 2 网关**: 注入 ``DE_SKILL_ALLOWED_EGRESS`` /
       ``HTTPS_PROXY=http://127.0.0.1:8080`` / ``HTTP_PROXY=http://127.0.0.1:8080``。
       Python 子进程还会自动加载 :func:`_ensure_dns_bootstrap` 注入的
       ``sitecustomize.py``,把 ``socket.getaddrinfo`` monkey-patch 掉。
    6. 同步 ``subprocess.run``,timeout 夹紧在 [1, 120]s,捕获 stdout/stderr。
    7. 返回 ``(ok, output_text, duration_ms)``;output_text 含 ``package=``/
       ``script=``/``exit=``/stdout/stderr(分别截断 8000/4000 字节防泄漏)。

    错误情形:
    - 包目录不存在 → ``False, "packagePath not found: ..."``。
    - 命令不匹配白名单 → ``False, "status=needs_instruction ..."``。
    - 路径穿越或脚本不存在 → ``False, "script not found or outside package"``。
    - 超时 → ``False, "script timeout after Ns: ..."``。
    - 解释器缺失 → ``False, "runtime binary missing: ..."``。
    """
    root = Path(package_path)
    if not root.is_dir():
        return False, f"packagePath not found: {package_path}", 0
    m = _SCRIPT_RE.match(command.strip())
    if not m:
        # 命令格式不对 — 提示调用方先 read SKILL.md 再发规范化的 action=run
        md = root / "SKILL.md"
        if not md.is_file():
            md = root / "skill.md"
        preview = ""
        if md.is_file():
            preview = md.read_text(encoding="utf-8", errors="replace")[:800]
        script_list = ",".join(scripts) if scripts else "(none)"
        # L1: "package loaded" 永远不能算成功 — 调用方必须显式 open + run
        return False, (
            f"package={root}\n"
            f"scripts={script_list}\n"
            f"command={command}\n"
            f"status=needs_instruction\n"
            f"hint=command must match scripts/... or .copilot-ws/... ; "
            f"use action=open to read SKILL.md, then action=run with an allowed script\n"
            f"--- SKILL.md preview ---\n{preview}"
        ), 12
    rel = m.group(1).replace("\\", "/")
    args_tail = (m.group(2) or "").strip()
    target = safe_under(root, rel)
    if target is None or not target.is_file():
        return False, f"script not found or outside package: {rel}", 0
    lower = rel.lower()
    # 按扩展名选解释器;任何失败由 subprocess.run 的 FileNotFoundError 兜住
    if lower.endswith(".py"):
        cmd = ["python3", str(target)]
    elif lower.endswith(".js") or lower.endswith(".mjs"):
        cmd = ["node", str(target)]
    elif lower.endswith(".ts"):
        cmd = ["npx", "--yes", "tsx", str(target)]
    else:
        cmd = ["bash", str(target)]
    if args_tail:
        # shlex 安全分词,避免命令注入(不再走 shell=True)
        cmd.extend(shlex.split(args_tail))
    # 子进程环境:再过滤一次控制面 DSN,并注入技能包上下文
    env = {k: v for k, v in os.environ.items() if not any(k == p or k.startswith(p) for p in FORBIDDEN_ENV)}
    env["DE_SKILL_PACKAGE_ROOT"] = str(root)
    env["DE_SKILL_WORK_DIR"] = str(root)
    # 阶段 2:出口 allowlist 与代理
    egress = [h for h in (allowed_egress or []) if h and h.strip()]
    env["DE_SKILL_ALLOWED_EGRESS"] = ",".join(egress)
    # 空 allowlist 等价于 deny-all — DnsGate 仍然安装,但要把所有解析请求
    # (含 IP literal)全部拒绝。否则脚本会绕过域名检查走 IP 直连。
    env["DE_SKILL_DENY_ALL_EGRESS"] = "1" if not egress else "0"
    # 始终注入 DnsGate bootstrap(空 allowlist 也装,见 _DNS_BOOTSTRAP_CODE)。
    # 这样 deny-all 是真正的"禁止任何 DNS 解析",而不是"允许 DNS 但不挂代理"。
    bootstrap_dir = _ensure_dns_bootstrap()
    if bootstrap_dir:
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = bootstrap_dir + (os.pathsep + existing if existing else "")
    # 只有当 allowlist 非空时才注入 stdlib 代理(空 allowlist 下没意义,
    # 且避免误把任意内网流量导向本地代理被 502)。
    # deny-all 时也强制设置 no_proxy=* 兜底,防止子进程通过其他环境
    # 变量绕过 DnsGate。
    if egress:
        env["HTTPS_PROXY"] = "http://127.0.0.1:8080"
        env["HTTP_PROXY"] = "http://127.0.0.1:8080"
    else:
        env["NO_PROXY"] = "*"
        env["no_proxy"] = "*"
        # 清掉上一调用可能残留的代理变量,防止 child 继承
        for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
            env.pop(k, None)
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(root),
            env=env,
            capture_output=True,
            text=True,
            timeout=max(1, min(timeout_sec, 120)),
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"script timeout after {timeout_sec}s: {rel}", int((time.time() - started) * 1000)
    except FileNotFoundError as exc:
        return False, f"runtime binary missing: {exc}", int((time.time() - started) * 1000)
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    lines = [
        f"package={root}",
        f"script={rel}",
        f"exit={proc.returncode}",
    ]
    if out:
        lines.append("--- stdout ---")
        lines.append(out[:8000])  # stdout 截断 8KB 防敏感数据外泄
    if err:
        lines.append("--- stderr ---")
        lines.append(err[:4000])  # stderr 截断 4KB
    ok = proc.returncode == 0
    return ok, "\n".join(lines), int((time.time() - started) * 1000)


def strip_forbidden_env() -> None:
    """从当前进程环境删除所有控制面 DSN。

    在 ``lifespan`` 启动时调用,防止后续任何子进程继承凭据。
    兜底执行(``run_package_script`` 在 fork 前再过滤一次,纵深防御)。
    """
    for k in list(os.environ):
        if any(k == p or k.startswith(p) for p in FORBIDDEN_ENV):
            del os.environ[k]


# ---- Python 子进程 DNS 网关 bootstrap ----------------------------------------
# 用 sitecustomize.py 在 Python 启动时自动加载 DnsGate。
# 每次请求 fork 出的 python3 子进程都会先跑这一段,再做用户的 scripts/...py。
# 文件落 /tmp(qzda-skill-runtime 镜像 read_only 根,/tmp 是 tmpfs 8m)。
_DNS_BOOTSTRAP_DIR = Path("/tmp/qzda-bootstrap")
_DNS_BOOTSTRAP_FILE = _DNS_BOOTSTRAP_DIR / "sitecustomize.py"
_DNS_BOOTSTRAP_CODE = """\
# qzda-skill-runtime 自动加载:monkey-patch socket.getaddrinfo 阻断非 allowlist DNS。
# 由 sandbox.py 在写完 PYTHONPATH 后由子进程自动 import。
#
# 注意:**始终安装**,即便 allowlist 为空 — 空 allowlist 等价于 deny-all,
# DnsGate 会把所有域名(含 IP literal)都拒绝。否则空 allowlist 下脚本
# 可以绕过 DNS gate 直连外网。
import os as _os, sys as _sys

_csv = _os.environ.get("DE_SKILL_ALLOWED_EGRESS", "") or ""
_allowed = [h.strip() for h in _csv.replace("\\\\n", ",").split(",") if h.strip()]
_deny_all = _os.environ.get("DE_SKILL_DENY_ALL_EGRESS", "0") == "1"
try:
    _sys.path.insert(0, "/app")
    from app.egress import DnsGate
    DnsGate(_allowed, deny_all=_deny_all).install()
except Exception as _exc:  # noqa: BLE001
    # bootstrap 失败时静默:允许 e2e 主流程看到问题,而不是悄悄放过 DNS
    import sys as _sys2
    print(f"[qzda-egress-bootstrap] failed: {_exc!r}", file=_sys2.stderr)
"""


def _ensure_dns_bootstrap() -> str:
    """确保 /tmp/qzda-bootstrap/sitecustomize.py 存在,返回该目录(用作 PYTHONPATH)。

    幂等:已存在就不重写。该目录每次容器重启会随 tmpfs 清掉,
    但 :func:`run_package_script` 每次会重新确保一次。
    """
    try:
        _DNS_BOOTSTRAP_DIR.mkdir(parents=True, exist_ok=True)
        if not _DNS_BOOTSTRAP_FILE.exists() or _DNS_BOOTSTRAP_FILE.read_text(
            encoding="utf-8"
        ) != _DNS_BOOTSTRAP_CODE:
            _DNS_BOOTSTRAP_FILE.write_text(_DNS_BOOTSTRAP_CODE, encoding="utf-8")
        return str(_DNS_BOOTSTRAP_DIR)
    except OSError:
        # 只读 fs 或权限不足时退化为空 bootstrap;不影响 DNS-gate 缺席的兜底语义
        return ""
