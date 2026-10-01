"""``sign_verify.py`` 单元测试 — 不依赖 docker / 网络 / FastAPI。

覆盖:
- marker 缺失 → 失败
- signed_by 不在 trusted → 失败
- SHA256 不一致 → 失败(篡改 SKILL.md 后)
- SKILL.md 缺失 → 失败
- DE_SKILL_TRUSTED_KEY_IDS 未设 → fail-closed
- 完整 happy path → 通过
"""
from __future__ import annotations

import json

import pytest

from app import sign_verify


@pytest.fixture
def pkg(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """创建临时 skill 包 + .signed marker。"""
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text("# weather\n", encoding="utf-8")
    return tmp_path


def _write_marker(pkg_path, *, signed_by: str, sha: str | None = None) -> None:
    if sha is None:
        sha = sign_verify.compute_skill_md_sha256(str(pkg_path))
    (pkg_path / ".signed").write_text(
        json.dumps({"signed_by": signed_by, "sha256": sha, "skill_id": "x"}),
        encoding="utf-8",
    )


def test_happy_path(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DE_SKILL_TRUSTED_KEY_IDS", "ed25519:abc12345,ed25519:deadbeef")
    _write_marker(pkg, signed_by="ed25519:abc12345")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert ok is True, reason


def test_no_trusted_keys_fails_closed(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("DE_SKILL_TRUSTED_KEY_IDS", raising=False)
    _write_marker(pkg, signed_by="ed25519:abc12345")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert ok is False
    assert "no trusted" in reason.lower() or "DE_SKILL_TRUSTED_KEY_IDS" in reason


def test_missing_marker(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DE_SKILL_TRUSTED_KEY_IDS", "ed25519:abc12345")
    # 不写 .signed
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert ok is False
    assert "missing marker" in reason


def test_untrusted_signer(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DE_SKILL_TRUSTED_KEY_IDS", "ed25519:abc12345")
    _write_marker(pkg, signed_by="ed25519:evilkey0")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert ok is False
    assert "untrusted" in reason


def test_tampered_skill_md(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DE_SKILL_TRUSTED_KEY_IDS", "ed25519:abc12345")
    _write_marker(pkg, signed_by="ed25519:abc12345")
    # 签名后篡改 SKILL.md
    (pkg / "SKILL.md").write_text("# weather\n# injected\n", encoding="utf-8")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert ok is False
    assert "mismatch" in reason or "sha256" in reason


def test_missing_skill_md(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DE_SKILL_TRUSTED_KEY_IDS", "ed25519:abc12345")
    _write_marker(pkg, signed_by="ed25519:abc12345")
    (pkg / "SKILL.md").unlink()
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert ok is False
    assert "SKILL.md" in reason


def test_marker_without_sha(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DE_SKILL_TRUSTED_KEY_IDS", "ed25519:abc12345")
    (pkg / ".signed").write_text(
        json.dumps({"signed_by": "ed25519:abc12345"}),  # 没 sha256
        encoding="utf-8",
    )
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert ok is False
    assert "sha256" in reason


def test_compute_skill_md_sha256_lower_fallback(pkg):
    (pkg / "SKILL.md").unlink()
    (pkg / "skill.md").write_text("# lower\n", encoding="utf-8")
    h = sign_verify.compute_skill_md_sha256(str(pkg))
    assert h is not None
    assert len(h) == 64