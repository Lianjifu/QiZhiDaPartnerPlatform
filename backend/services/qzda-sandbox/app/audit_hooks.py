"""Python 层 syscall 计数器:monkey-patch 关键库函数。

阶段 3 的可观测性诉求:除了 OTel + prometheus_client 暴露的请求级指标外,
还要在 Python 层拦截「子进程派生」「文件打开」「socket 连接」「exec 系列」,
记录每次发生的 (kind, allowed) 元组,作为审计与异常行为检测的事实源。

**始终不阻塞**(默认):DnsGate / 文件读取门槛由其他层把关,
本模块只计数;真正拦截由 egress_proxy / runsc seccomp 完成。

**可选强阻塞** (``QZDA_SANDBOX_AUDIT_BLOCK_OPEN=1``):在审计开启时,
额外对 ``os.open`` 做「路径不在技能包根内 / 不在 stdlib 内」就抛 ``PermissionError``。
这是开发期与 CI 期用来验证白名单覆盖率的开关,生产通常保持关闭。

设计要点:
- 一次性安装,模块级 ``_installed`` 守护,避免重复 monkey-patch。
- 模块加载时保存所有原函数引用,``_reset_for_tests()`` 恢复它们,
  允许测试用例以不同 env 反复 install / reset 而不嵌套包裹。
- ``summary()`` 导出扁平 dict,供上层 ``/v1/audit`` 之类的 endpoint 直接返回。
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
from typing import Any

from app.telemetry import init_metrics, skill_syscalls_total

# 依赖 ``skill_syscalls_total`` 计数;导入即初始化 metric 句柄。
init_metrics()


# ---- 安装状态 ----------------------------------------------------------------
_installed = False
# ``summary()`` 用的扁平计数器:key = (kind, allowed_true/false)
_summary: dict[tuple[str, str], int] = {}


def _bump(kind: str, allowed: bool) -> None:
    """同时更新 prometheus 计数器与本地 _summary 字典。"""
    label = "true" if allowed else "false"
    skill_syscalls_total.labels(kind=kind, allowed=label).inc()
    _summary[(kind, label)] = _summary.get((kind, label), 0) + 1


# ---- 路径判定辅助 ------------------------------------------------------------
def _path_allowed(path: str | bytes) -> bool:
    """``os.open`` 路径白名单:QZDA_SANDBOX_PACKAGE_ROOT / /app / sys.prefix 都算 OK。

    用 ``os.path.realpath`` 解析符号链接与 ``..``,再前缀匹配。
    若 ``QZDA_SANDBOX_PACKAGE_ROOT`` 未设置,只要路径在 stdlib 或 ``/app`` 下即放行
    (避免开发期默认阻断一切本地 IO)。
    """
    raw = os.fspath(path)
    try:
        # 这里调用 ``os.path.realpath`` 不会触发已 patch 的 ``os.open``;
        # realpath 走的是 ``os.lstat`` / ``os.readlink`` 而非 ``os.open``。
        resolved = os.path.realpath(raw)
    except OSError:
        return False
    candidates: list[str] = []
    pkg_root = os.environ.get("QZDA_SANDBOX_PACKAGE_ROOT")
    if pkg_root:
        try:
            real_root = os.path.realpath(pkg_root)
            candidates.append(real_root)
        except OSError:
            pass
    candidates.extend([
        "/app",
        sys.prefix,
        os.path.join(sys.prefix, "lib"),
        sys.exec_prefix,
    ])
    for root in candidates:
        if not root:
            continue
        # 加 os.sep 避免 /app-evil 之类的兄弟目录欺骗 startswith
        if resolved == root or resolved.startswith(root + os.sep):
            return True
    return False


# ---- 原函数引用(模块加载时即固化,供 monkey-patch 与恢复用)------------------
# 保存原函数,这样 ``_patch_*`` 永远包原版,``_reset_for_tests`` 也用原版恢复 —
# 避免在测试用例里反复 install 造成「wrapper 套 wrapper」的双计数。
_ORIG_OS_OPEN = os.open
_ORIG_POPEN_INIT = subprocess.Popen.__init__
_ORIG_SOCKET_CONNECT = socket.socket.connect
_ORIG_OS_EXECVE = os.execve
_ORIG_OS_EXECV = getattr(os, "execv", None)
_ORIG_OS_EXECVP = getattr(os, "execvp", None)
_ORIG_OS_EXECVPE = getattr(os, "execvpe", None)


# ---- monkey-patch 实现 --------------------------------------------------------
def _patch_subprocess_popen() -> None:
    """monkey-patch ``subprocess.Popen.__init__``,每次 execve 计数。"""
    original = _ORIG_POPEN_INIT

    def patched(self, *args: Any, **kwargs: Any) -> None:
        # 在原始 __init__ 之前 / 之后计数都行 — 这里放最前面,失败也计数。
        _bump("execve", True)
        return original(self, *args, **kwargs)

    subprocess.Popen.__init__ = patched  # type: ignore[method-assign]


def _patch_os_open() -> None:
    """monkey-patch ``os.open``,按路径白名单判定 allowed,可选强阻塞。"""
    original = _ORIG_OS_OPEN
    block_open = os.environ.get("QZDA_SANDBOX_AUDIT_BLOCK_OPEN") == "1"

    def patched(path: Any, flags: Any, *args: Any, **kwargs: Any) -> int:
        allowed = _path_allowed(path)
        if not allowed and block_open:
            # 强阻塞模式:非白名单路径直接拒绝,不再尝试打开。
            raise PermissionError(
                f"audit: open blocked outside package: {os.fspath(path)}",
            )
        _bump("open", allowed)
        return original(path, flags, *args, **kwargs)

    os.open = patched  # type: ignore[assignment]


def _patch_socket_connect() -> None:
    """monkey-patch ``socket.socket.connect``,允许但计数。

    真正的网络层拦截交给 DnsGate + runsc;这里只计数,
    对每次 connect 都标 allowed=true(否则会与 DnsGate 重复 false positive)。
    """
    original = _ORIG_SOCKET_CONNECT

    def patched(self, *args: Any, **kwargs: Any) -> None:
        _bump("connect", True)
        return original(self, *args, **kwargs)

    socket.socket.connect = patched  # type: ignore[method-assign]


def _patch_os_exec() -> None:
    """monkey-patch ``os.execve`` + ``os.execv`` / ``os.execvp`` / ``os.execvpe``。

    每个 wrapper 直接调用 *_ORIG* 引用,与 ``install_audit_hooks`` 无关 —
    这样反复 install 不会嵌套包裹。
    """
    for name, original in (
        ("execve", _ORIG_OS_EXECVE),
        ("execv", _ORIG_OS_EXECV),
        ("execvp", _ORIG_OS_EXECVP),
        ("execvpe", _ORIG_OS_EXECVPE),
    ):
        if original is None:
            continue

        def make_wrapper(orig: Any):  # noqa: ANN401
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                _bump("execve", True)
                return orig(*args, **kwargs)
            return wrapper

        setattr(os, name, make_wrapper(original))


# ---- 入口与测试钩子 -----------------------------------------------------------
def install_audit_hooks() -> bool:
    """安装所有审计 hook。返回 ``True`` 表示新装,``False`` 表示已存在/未启用。

    闸门:
    - ``QZDA_SANDBOX_AUDIT=1`` 未设置 → 直接返回 False,不动 monkey-patch。
    - 已安装过 → 直接返回 False(幂等)。
    """
    global _installed
    if os.environ.get("QZDA_SANDBOX_AUDIT") != "1":
        return False
    if _installed:
        return False
    _patch_subprocess_popen()
    _patch_os_open()
    _patch_socket_connect()
    _patch_os_exec()
    _installed = True
    return True


def _reset_for_tests() -> None:
    """**仅供测试** — 把所有被 patch 的函数恢复到模块加载时的原版,
    同时清空本地计数与安装标志,允许再次 ``install_audit_hooks``。

    之所以必须恢复原函数:若只清 ``_installed`` 标志,下次 install 会把已经
    被 patch 的函数再次包一层,造成「wrapper 套 wrapper」的双计数。
    """
    global _installed
    _installed = False
    _summary.clear()
    os.open = _ORIG_OS_OPEN  # type: ignore[assignment]
    subprocess.Popen.__init__ = _ORIG_POPEN_INIT  # type: ignore[method-assign]
    socket.socket.connect = _ORIG_SOCKET_CONNECT  # type: ignore[method-assign]
    os.execve = _ORIG_OS_EXECVE  # type: ignore[assignment]
    if _ORIG_OS_EXECV is not None:
        os.execv = _ORIG_OS_EXECV  # type: ignore[assignment]
    if _ORIG_OS_EXECVP is not None:
        os.execvp = _ORIG_OS_EXECVP  # type: ignore[assignment]
    if _ORIG_OS_EXECVPE is not None:
        os.execvpe = _ORIG_OS_EXECVPE  # type: ignore[assignment]


def summary() -> dict[str, int]:
    """扁平 ``summary()`` 字典,供上层 ``/v1/audit`` 直接序列化。

    形状::

        {
            "open": <总 open 次数>,
            "execve": <总 execve 次数>,
            "connect": <总 connect 次数>,
            "blocked_open": <os.open 中 allowed=false 的次数>,
        }
    """
    out: dict[str, int] = {"open": 0, "execve": 0, "connect": 0, "blocked_open": 0}
    blocked_open = 0
    for (kind, allowed_label), count in _summary.items():
        out[kind] = out.get(kind, 0) + count
        if kind == "open" and allowed_label == "false":
            blocked_open += count
    out["blocked_open"] = max(out.get("blocked_open", 0), blocked_open)
    return out
