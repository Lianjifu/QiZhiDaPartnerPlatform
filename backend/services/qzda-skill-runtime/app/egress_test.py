"""DNS 网关 + 域名匹配的纯单元测试(不需要网络)。

覆盖:
- ``host_allowed`` 精确匹配 / 后缀匹配 / 空 allowlist
- ``DnsGate`` 不安装时走原生;安装后拒绝非 allowlist
- ``parse_csv_host_list`` 边界
- ``EgressProxy`` 跨请求聚合(Phase 3)
"""
from __future__ import annotations

import socket

from app.egress import DnsGate, host_allowed, parse_csv_host_list
from app.egress_proxy import EgressProxy


def test_host_allowed_exact() -> None:
    assert host_allowed("wttr.in", ["wttr.in"]) is True


def test_host_allowed_subdomain() -> None:
    # v1.api.weather.gov 应匹配 api.weather.gov
    assert host_allowed("v1.api.weather.gov", ["api.weather.gov"]) is True


def test_host_allowed_miss() -> None:
    assert host_allowed("example.com", ["wttr.in"]) is False


def test_host_allowed_subdomain_partial_label() -> None:
    # evilexample.com 没有点号,不应被 example.com 命中(防 prefix hijack)
    assert host_allowed("evilexample.com", ["example.com"]) is False


def test_host_allowed_subdomain_match() -> None:
    # evil.example.com 含点号,作为 example.com 的真子域,允许匹配(对齐 Go hostAllowed 语义)
    assert host_allowed("evil.example.com", ["example.com"]) is True


def test_host_allowed_case_insensitive() -> None:
    assert host_allowed("WTTR.IN", ["wttr.in"]) is True
    assert host_allowed("wttr.in", ["WTTR.in"]) is True


def test_host_allowed_empty_allowed() -> None:
    assert host_allowed("wttr.in", []) is False
    assert host_allowed("wttr.in", [""]) is False


def test_dns_gate_install_then_getaddrinfo_blocks() -> None:
    """安装 DnsGate 后,不在 allowlist 的域名必须被阻断 + 记录 used。"""
    gate = DnsGate(["wttr.in"])
    original = socket.getaddrinfo
    gate.install()
    try:
        # 不在 allowlist 的域名:必须抛 gaierror(-2) 且 message 含 "not in allowlist"
        raised = False
        try:
            socket.getaddrinfo("evil.example.com", None)
        except socket.gaierror as exc:
            raised = True
            assert exc.errno == -2, f"expected errno=-2, got {exc.errno}"
            assert "not in allowlist" in str(exc), f"unexpected msg: {exc}"
        assert raised, "evil.example.com 应该被 DnsGate 阻断"

        # allowlist 内域名应该放行(解析结果由 OS 决定,这里只断言没有 "not in allowlist")
        try:
            socket.getaddrinfo("wttr.in", None)
        except socket.gaierror as exc:
            assert "not in allowlist" not in str(exc), (
                f"allowlist 内 host 不应被我们自己阻断: {exc}"
            )

        # 域名应被记录到 used_hosts
        used = gate.used_hosts()
        assert "evil.example.com" in used, f"used hosts 缺记录: {used}"
    finally:
        # 还原 getaddrinfo,防止污染其它测试
        socket.getaddrinfo = original


def test_dns_gate_ip_literal_skips_allowlist_when_non_empty() -> None:
    """allowlist 非空时,IP literal 仍走原生(由 runsc / iptables 兜底)。

    注:空 allowlist 会自动开启 deny_all 模式,见下条测试。
    """
    gate = DnsGate(["wttr.in"])
    original = socket.getaddrinfo
    gate.install()
    try:
        # 127.0.0.1 应该走原生路径,不会抛 gaierror(-2) "not in allowlist"
        try:
            socket.getaddrinfo("127.0.0.1", None)
        except socket.gaierror as exc:
            assert "not in allowlist" not in str(exc), (
                f"IP literal 在非 deny-all 模式下不应被 DnsGate 阻断: {exc}"
            )
            assert "ip literal" not in str(exc), (
                f"IP literal 在非 deny-all 模式下不应被 DnsGate 阻断: {exc}"
            )
    finally:
        socket.getaddrinfo = original


def test_dns_gate_deny_all_blocks_domain_and_ip() -> None:
    """空 allowlist 自动进入 deny-all 模式:域名 + IP literal 都被阻断。

    这是 Phase 2 修复 deny-all 旁路的核心断言:即便 allowlist 为空,
    脚本也不能通过 ``socket.getaddrinfo`` 直连任何 host(包括 IP 字面)。
    """
    gate = DnsGate([])  # 空 allowlist → 自动 deny_all
    assert gate._deny_all is True, "空 allowlist 必须开启 deny_all"
    original = socket.getaddrinfo
    gate.install()
    try:
        # 域名必须抛 gaierror("not in allowlist")
        raised = False
        try:
            socket.getaddrinfo("wttr.in", None)
        except socket.gaierror as exc:
            raised = True
            assert "not in allowlist" in str(exc), f"unexpected msg: {exc}"
        assert raised, "deny-all 下 wttr.in 应被阻断"

        # IP literal 必须抛 gaierror("ip literal")
        raised = False
        try:
            socket.getaddrinfo("1.1.1.1", None)
        except socket.gaierror as exc:
            raised = True
            assert "ip literal" in str(exc), f"unexpected msg: {exc}"
        assert raised, "deny-all 下 1.1.1.1(IP literal)应被阻断"

        # used 应该记录两个尝试
        used = gate.used_hosts()
        assert "wttr.in" in used and "1.1.1.1" in used, f"used 缺记录: {used}"
    finally:
        socket.getaddrinfo = original


def test_dns_gate_explicit_deny_all_with_allowlist() -> None:
    """显式 deny_all=True 即便配了 allowlist,IP literal 仍然被阻断。"""
    gate = DnsGate(["wttr.in"], deny_all=True)
    original = socket.getaddrinfo
    gate.install()
    try:
        # 域名:正常 resolve(在 allowlist 内)
        try:
            socket.getaddrinfo("wttr.in", None)
        except socket.gaierror as exc:
            assert "not in allowlist" not in str(exc), (
                f"wttr.in 应被放行: {exc}"
            )

        # IP literal:即便有 allowlist,deny_all=True 也要阻断
        raised = False
        try:
            socket.getaddrinfo("8.8.8.8", None)
        except socket.gaierror as exc:
            raised = True
            assert "ip literal" in str(exc), f"unexpected msg: {exc}"
        assert raised, "deny_all=True 下 8.8.8.8(IP literal)应被阻断"
    finally:
        socket.getaddrinfo = original


def test_parse_csv() -> None:
    assert parse_csv_host_list("") == []
    assert parse_csv_host_list("wttr.in") == ["wttr.in"]
    assert parse_csv_host_list("wttr.in,API.weather.gov , ") == [
        "wttr.in",
        "api.weather.gov",
    ]
    assert parse_csv_host_list("wttr.in,wttr.in") == ["wttr.in"]
    # newline 当作 comma
    assert parse_csv_host_list("wttr.in\napi.weather.gov") == [
        "wttr.in",
        "api.weather.gov",
    ]


def test_egress_proxy_cumulative_aggregation() -> None:
    """cumulative_*_hosts 应该跨 set_allowed 周期聚合,但 per-request 仍只含当前请求。

    Phase 3 行为:进程自启动以来出现过的主机被永久累计到 _cross_used / _cross_denied,
    set_allowed 切换时把当前请求的 _used / _denied union 进 _cross_*,然后再清零
    per-request 集合(避免跨 skill 串扰审计)。
    """
    proxy = EgressProxy()
    # 第一次 set_allowed:host a.com 被 record
    proxy.set_allowed(["a.com"])
    proxy._record_used("a.com")
    # 第二次 set_allowed:host b.com 被 record;同时 a.com 应被并入 cross
    proxy.set_allowed(["b.com"])
    proxy._record_used("b.com")
    proxy._record_denied("evil.com")
    # 第三次 set_allowed 触发 flush:b.com / evil.com 并入 cross
    # (设计上 _used / _denied 在下一次 set_allowed 时清零前 union 进 _cross_*)
    proxy.set_allowed(["c.com"])
    used_cum = proxy.cumulative_used_hosts()
    denied_cum = proxy.cumulative_denied_hosts()
    assert "a.com" in used_cum, f"a.com 跨请求丢失: {used_cum}"
    assert "b.com" in used_cum, f"b.com 跨请求丢失: {used_cum}"
    assert "evil.com" in denied_cum, f"evil.com 跨请求丢失: {denied_cum}"
    # 当前请求的 _used 仍只含 c.com(向后兼容)
    assert proxy.used_hosts() == [], f"per-request 已 flush,应为空: {proxy.used_hosts()}"
    assert proxy.denied_hosts() == []