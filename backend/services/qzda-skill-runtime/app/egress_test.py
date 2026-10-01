"""DNS 网关 + 域名匹配的纯单元测试(不需要网络)。

覆盖:
- ``host_allowed`` 精确匹配 / 后缀匹配 / 空 allowlist
- ``DnsGate`` 不安装时走原生;安装后拒绝非 allowlist
- ``parse_csv_host_list`` 边界
"""
from __future__ import annotations

import socket

from app.egress import DnsGate, host_allowed, parse_csv_host_list


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


def test_dns_gate_ip_literal_skips_allowlist() -> None:
    """IP literal 不应该被 DNS gate 拦截(它根本不查 allowlist)。"""
    gate = DnsGate([])
    original = socket.getaddrinfo
    gate.install()
    try:
        # 127.0.0.1 应该走原生路径,不会抛 gaierror(-2) "not in allowlist"
        # 注意:运行测试时 127.0.0.1 通常是真实存在的 IP,可能解析为 localhost,
        # 也可能由于 sandbox 而失败。关键是**不是**我们抛的 -2 "not in allowlist"。
        try:
            socket.getaddrinfo("127.0.0.1", None)
        except socket.gaierror as exc:
            assert "not in allowlist" not in str(exc), (
                f"IP literal 不应被 DnsGate 阻断: {exc}"
            )
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