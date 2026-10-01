"""sandbox.py interpreter whitelist — PR2 收缩到 .py/.sh。

验证对 .js / .mjs / .ts 脚本的拒绝行为是 fail-closed(返回
``unsupported_interpreter`` 错误而不是空跑 / silent 404)。这些是
PR2 收缩解释器白名单后引入的回归测试。
"""
from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from app.sandbox import run_package_script


@pytest.fixture
def skill_pkg(tmp_path: Path) -> Path:
    pkg = tmp_path / "fake-skill"
    pkg.mkdir()
    (pkg / "SKILL.md").write_text(
        "---\nname: fake\ndescription: PR2 dispatch test\n---\n\nbody\n",
        encoding="utf-8",
    )
    scripts = pkg / "scripts"
    scripts.mkdir()
    # 在每个扩展名下放一个空的可执行脚本 — interpreter dispatch 拒绝时,
    # subprocess.run 根本不会被调用(白名单 fail-closed 在前面已经 return),
    # 所以脚本能不能跑也无所谓。
    for ext in (".py", ".sh", ".js", ".mjs", ".ts"):
        path = scripts / f"dummy{ext}"
        path.write_text("#!/bin/sh\necho hi\n", encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return pkg


def _run(skill_pkg: Path, command: str) -> tuple[bool, str, int]:
    return run_package_script(
        package_path=str(skill_pkg),
        scripts=["scripts/dummy.py", "scripts/dummy.sh"],
        command=command,
        timeout_sec=5,
    )


def test_dispatch_accepts_python_script(skill_pkg: Path) -> None:
    ok, output, _ = _run(skill_pkg, "./scripts/dummy.py")
    # python3 dummy.py 会报 SyntaxError 但不会触发 unsupported_interpreter 拒绝
    assert ok is False
    assert "unsupported interpreter" not in output


def test_dispatch_accepts_shell_script(skill_pkg: Path) -> None:
    ok, output, _ = _run(skill_pkg, "bash scripts/dummy.sh")
    assert "unsupported interpreter" not in output
    # dummy.sh 是 "#!/bin/sh\necho hi" → exit 0
    assert ok is True


def test_rejects_node_mjs_script(skill_pkg: Path) -> None:
    # Node.js 解释器前缀不在 _SCRIPT_RE 白名单 — 命令直接被整体拒绝
    # (fall-through 到 SKILL.md preview)。验证点:调用方不能通过 "node xxx"
    # 形式绕过解释器白名单。
    ok, output, _ = _run(skill_pkg, "node scripts/dummy.mjs")
    assert ok is False
    assert "unsupported interpreter" in output or "needs_instruction" in output


def test_rejects_node_js_script_via_extension(skill_pkg: Path) -> None:
    # 直接给 .mjs 路径 — 没有 node 前缀,正则捕获到 .mjs 路径,
    # dispatch 在 SUPPORTED_SUFFIXES 之外返回 unsupported_interpreter。
    ok, output, _ = _run(skill_pkg, "./scripts/dummy.mjs")
    assert ok is False
    assert "unsupported interpreter" in output


def test_rejects_plain_js_script(skill_pkg: Path) -> None:
    ok, output, _ = _run(skill_pkg, "./scripts/dummy.js")
    assert ok is False
    assert "unsupported interpreter" in output


def test_rejects_typescript_script(skill_pkg: Path) -> None:
    ok, output, _ = _run(skill_pkg, "./scripts/dummy.ts")
    assert ok is False
    assert "unsupported interpreter" in output


def test_rejects_unknown_extension(skill_pkg: Path) -> None:
    # 写一个 .lua 脚本,看看非 .py/.sh 同样被拒
    (skill_pkg / "scripts" / "weird.lua").write_text("print('hi')\n", encoding="utf-8")
    ok, output, _ = _run(skill_pkg, "./scripts/weird.lua")
    assert ok is False
    assert "unsupported interpreter" in output