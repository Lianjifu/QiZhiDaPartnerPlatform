"""技能沙箱的 DNS 网关 + 域名匹配子进程。

本模块负责两件事:

1. ``host_allowed(host, allowed)``  — 与 Go ``handlers_skills_policy.go``
   里的 ``hostAllowed`` 同语义:精确匹配或子域后缀匹配(如 ``api.weather.gov``
   匹配 ``api.weather.gov`` / ``v1.api.weather.gov``)。
2. ``DnsGate``  — 子进程 fork 后由 bootstrap 脚本加载,
   monkey-patch ``socket.getaddrinfo`` 把不在 allowlist 的域名
   直接抛 ``socket.gaierror``,阻断所有通过 Python stdlib 的 DNS 解析。
   不影响父进程(父进程的 socket 不动);只对 fork 后的子进程有效。

不做:
- 不处理 HTTPS_PROXY 转发(那是 egress_proxy.py 的职责)。
- 不做 IP 黑名单/白名单(只匹配域名)。如果有人用 IP 直连绕过,
  那就由 runsc 的 netstack / iptables 层兜底(阶段 2 不做)。
"""
from __future__ import annotations

import socket
import threading
from typing import Iterable


def host_allowed(host: str, allowed: Iterable[str]) -> bool:
    """域名匹配:精确匹配或后缀 ``.allowed`` 才算通过。

    与 Go ``hostAllowed`` 行为对齐。``host`` 不区分大小写;
    ``allowed`` 内的每个域名同样 lower-case 后比较。
    """
    if not host:
        return False
    h = host.strip().lower()
    for a in allowed:
        a = (a or "").strip().lower()
        if not a:
            continue
        if h == a or h.endswith("." + a):
            return True
    return False


class DnsGate:
    """DNS 解析网关。子进程 bootstrap 时调用 ``install()`` 即可。

    使用方式::

        gate = DnsGate(["wttr.in"])
        gate.install()
        # 之后所有 socket.getaddrinfo("wttr.in") 走原生解析
        # socket.getaddrinfo("evil.com") 抛 socket.gaierror

    线程安全:``install`` 在子进程 fork 后立即调用一次即可,
    之后 ``socket.getaddrinfo`` 是 OS 调用,本身线程安全。

    ``deny_all=True`` 时(空 allowlist 模式),除了域名,IP literal
    解析也直接拒绝 — 否则脚本可以拿 ``1.1.1.1`` 之类的字符串绕过
    域名 allowlist。
    """

    def __init__(self, allowed: Iterable[str], deny_all: bool = False) -> None:
        self._allowed: set[str] = {
            (a or "").strip().lower() for a in allowed if a and a.strip()
        }
        self._deny_all = bool(deny_all) or not self._allowed
        self._used: set[str] = set()
        self._lock = threading.Lock()
        self._installed = False

    @property
    def allowed(self) -> frozenset[str]:
        return frozenset(self._allowed)

    def used_hosts(self) -> list[str]:
        with self._lock:
            return sorted(self._used)

    def install(self) -> None:
        """monkey-patch ``socket.getaddrinfo``。

        只能调用一次,多次调用直接忽略。父进程不推荐调用
        (会污染宿主网络栈);设计上是 bootstrap 子进程里调用。
        """
        if self._installed:
            return
        original = socket.getaddrinfo

        def gated_getaddrinfo(host, *args, **kwargs):  # type: ignore[no-untyped-def]
            # host 可能是 None / IP 字面 / 域名;只对字符串域名做检查
            if isinstance(host, str):
                # 先取主机名(去掉端口)
                bare = host.split(":", 1)[0]
                # IP literal:deny-all 模式下也拒绝(防 IP 直连绕过)
                # 非 deny-all 模式下放行 IP(交给 runsc / iptables 兜底)
                try:
                    socket.inet_aton(bare)
                    is_ip = True
                except OSError:
                    is_ip = False
                if is_ip:
                    if self._deny_all:
                        with self._lock:
                            self._used.add(bare.lower())
                        raise socket.gaierror(
                            -2,
                            f"egress denied: {bare} (ip literal) — deny-all mode",
                        )
                    return original(host, *args, **kwargs)
                with self._lock:
                    self._used.add(bare.lower())
                if not host_allowed(bare, self._allowed):
                    raise socket.gaierror(
                        -2,
                        f"egress denied: {bare} not in allowlist",
                    )
            return original(host, *args, **kwargs)

        socket.getaddrinfo = gated_getaddrinfo  # type: ignore[assignment]
        self._installed = True


def parse_csv_host_list(raw: str) -> list[str]:
    """解析 ``DE_SKILL_ALLOWED_EGRESS`` 这类环境变量里的逗号/空白分隔域名。

    空字符串 → 空列表。空段忽略。自动 lower-case + strip。
    """
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for chunk in raw.replace("\n", ",").split(","):
        h = chunk.strip().lower()
        if not h or h in seen:
            continue
        seen.add(h)
        out.append(h)
    return out