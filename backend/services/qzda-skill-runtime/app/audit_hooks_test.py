"""``audit_hooks.py`` 的纯单元测试 — 不依赖 docker / 网络 / FastAPI。

每个测试用例:
1. 保存原 ``os.environ``,按用例需要设置 ``DE_SKILL_AUDIT`` /
   ``DE_SKILL_PACKAGE_ROOT`` / ``DE_SKILL_AUDIT_BLOCK_OPEN``。
2. 调用 ``_reset_for_tests()`` 清掉旧安装状态与计数。
3. 调用 ``install_audit_hooks()`` 按当前 env 重新装。
4. 跑断言。
5. ``finally`` 里 ``_reset_for_tests()`` + 还原 env,确保测试隔离。

不依赖 pytest 顺序(每个用例自带 reset)。
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys

import pytest

from app import audit_hooks
from app.audit_hooks import (
    _reset_for_tests,
    install_audit_hooks,
    summary,
)
from app.telemetry import init_metrics


# 模块加载时初始化 prometheus_client 一次,确保 metric 句柄可用。
init_metrics()


@pytest.fixture(autouse=True)
def _isolate_audit_env():
    """每个用例前后隔离 env + audit 状态。

    ``autouse=True`` 让所有测试自动应用,无需在每个用例手动 fixture。
    """
    saved = dict(os.environ)
    _reset_for_tests()
    try:
        yield
    finally:
        _reset_for_tests()
        os.environ.clear()
        os.environ.update(saved)


def test_audit_disabled_when_env_unset():
    """``DE_SKILL_AUDIT`` 默认/=0 时,``subprocess.Popen.__init__`` 必须保持原样。"""
    # 显式清掉审计 env(autouse fixture 已重置过,但保险起见再设一次)。
    os.environ.pop("DE_SKILL_AUDIT", None)
    # 先记下当前 subprocess.Popen.__init__ 身份。
    original_id = id(subprocess.Popen.__init__)
    installed = install_audit_hooks()
    assert installed is False, "DE_SKILL_AUDIT 未设置时不应安装"
    # 身份必须未变 — 即 monkey-patch 没生效。
    assert id(subprocess.Popen.__init__) == original_id
    # summary 应保持 4 键 0 值(从未计数,允许前端拿到稳定的字段集)。
    assert summary() == {"open": 0, "execve": 0, "connect": 0, "blocked_open": 0}


def test_audit_installs_when_env_set():
    """``DE_SKILL_AUDIT=1`` 时,``subprocess.Popen.__init__`` 必须被替换。"""
    os.environ["DE_SKILL_AUDIT"] = "1"
    original_id = id(subprocess.Popen.__init__)
    installed = install_audit_hooks()
    assert installed is True, "DE_SKILL_AUDIT=1 应触发安装"
    patched_id = id(subprocess.Popen.__init__)
    assert patched_id != original_id, "Popen.__init__ 必须被 monkey-patch"
    # 幂等:再装一次应直接返回 False,且身份不变。
    again = install_audit_hooks()
    assert again is False, "重复 install 必须幂等"
    assert id(subprocess.Popen.__init__) == patched_id


def test_audit_counts_open():
    """``os.open`` 在包根内 → allowed;在包根外 → blocked_open 计数 +1。"""
    os.environ["DE_SKILL_AUDIT"] = "1"
    os.environ["DE_SKILL_AUDIT_BLOCK_OPEN"] = "0"  # 不强阻塞,只计数
    os.environ["DE_SKILL_PACKAGE_ROOT"] = "/skills/weather"
    install_audit_hooks()
    # 包根内路径:这里创建临时文件以避免 ENOENT,但 _path_allowed 不在乎是否存在,
    # 只看路径前缀;为了 ``os.open`` 不抛错,真造一个临时目录。
    tmp_root = os.environ["DE_SKILL_PACKAGE_ROOT"]
    # 模拟「在包根内」 — _path_allowed 用 realpath,所以必须真存在。
    # 但 audit_hooks 测试不需要真打开文件成功;只验证计数。
    # 用 O_RDONLY 打开一个真存在的系统文件就行(/etc/passwd 用于「包外」分支)。
    # 「包内」分支用 _path_allowed 直接验证,绕过真文件 IO。
    from app.audit_hooks import _path_allowed
    assert _path_allowed("/skills/weather/SKILL.md") is True
    assert _path_allowed("/etc/passwd") is False
    # 真 ``os.open`` 调用触发计数:两个真实 open(/etc/passwd 是包外的)。
    fd1 = os.open("/etc/passwd", os.O_RDONLY)
    os.close(fd1)
    fd2 = os.open("/etc/passwd", os.O_RDONLY)
    os.close(fd2)
    # 期望:open=2, blocked_open=2(都因 /etc/passwd 不在白名单)。
    snap = summary()
    assert snap["open"] == 2
    assert snap["blocked_open"] == 2


def test_audit_blocks_open_outside_root_when_env_set():
    """``DE_SKILL_AUDIT_BLOCK_OPEN=1`` 时,包外路径必须抛 ``PermissionError``。"""
    os.environ["DE_SKILL_AUDIT"] = "1"
    os.environ["DE_SKILL_AUDIT_BLOCK_OPEN"] = "1"
    os.environ["DE_SKILL_PACKAGE_ROOT"] = "/skills/weather"
    install_audit_hooks()
    with pytest.raises(PermissionError, match="audit: open blocked outside package"):
        os.open("/etc/passwd", os.O_RDONLY)


def test_audit_counts_subprocess_execve():
    """``subprocess.run`` 必须让 ``summary()["execve"] >= 1``。"""
    os.environ["DE_SKILL_AUDIT"] = "1"
    os.environ.pop("DE_SKILL_AUDIT_BLOCK_OPEN", None)
    install_audit_hooks()
    before = summary().get("execve", 0)
    # 用 ``true`` 命令(POSIX / macOS / Linux 都有),尽量避免环境差异。
    if sys.platform == "win32":
        # Windows 测试平台:用 cmd /c。
        subprocess.run(["cmd", "/c", "echo", "hi"], capture_output=True)
    else:
        subprocess.run(["true"], capture_output=True)
    after = summary().get("execve", 0)
    assert after >= before + 1, f"execve 计数应增加,before={before} after={after}"


def test_socket_connect_also_counted():
    """``socket.socket.connect`` 必须让 ``summary()["connect"] >= 1``。

    附加保护测试:任何 audit 启用后,connect 计数应被记录,
    即便这里我们故意连一个不存在的本地端口 — monkey-patch
    只计数,不阻塞,失败由 socket 自身抛 OSError。
    """
    os.environ["DE_SKILL_AUDIT"] = "1"
    install_audit_hooks()
    before = summary().get("connect", 0)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        try:
            s.connect(("127.0.0.1", 1))  # 不太可能开放的端口
        except OSError:
            pass
    finally:
        s.close()
    after = summary().get("connect", 0)
    assert after >= before + 1
