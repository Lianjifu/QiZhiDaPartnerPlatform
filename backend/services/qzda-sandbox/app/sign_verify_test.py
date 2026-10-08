"""``sign_verify.py`` 单元测试 — 不依赖 docker / 网络 / FastAPI。

覆盖:
- 完整 happy path(发布密钥签名 + 清单一致) → 通过
- marker 缺失 / signed_by 不在 trusted / 缺公钥 → 失败
- 签名无效 / 载荷身份不符 / 清单不一致(脚本被改) → 失败
- SKILL.md 篡改 / 缺失 → 失败
- QZDA_SANDBOX_TRUSTED_KEY_IDS 未设 → fail-closed
"""
from __future__ import annotations

import base64
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import sign_verify

KEY_ID = "ed25519:testrelease01"


@pytest.fixture
def release_key(monkeypatch: pytest.MonkeyPatch):
    priv = Ed25519PrivateKey.generate()
    pub_b64 = base64.b64encode(
        priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    ).decode("ascii")
    monkeypatch.setenv("QZDA_SANDBOX_TRUSTED_KEY_IDS", KEY_ID)
    monkeypatch.setenv(sign_verify.RELEASE_KEYS_ENV, f"{KEY_ID}={pub_b64}")
    return priv


@pytest.fixture
def pkg(tmp_path, release_key):
    root = tmp_path / "sk-test"
    (root / "scripts").mkdir(parents=True)
    (root / "SKILL.md").write_text("# test\n", encoding="utf-8")
    (root / "scripts" / "run.py").write_text("print('ok')\n", encoding="utf-8")
    _sign(root, release_key)
    return root


def _sign(pkg_path, priv, *, key_id: str = KEY_ID, manifest: str | None = None) -> None:
    manifest = manifest or sign_verify.manifest_sha256(str(pkg_path))
    payload = sign_verify.signing_payload(key_id, pkg_path.name, manifest)
    marker = {
        "signed_by": key_id,
        "sha256": sign_verify.compute_skill_md_sha256(str(pkg_path)),
        "manifest_sha256": manifest,
        "payload": payload.decode("utf-8"),
        "signature": base64.b64encode(priv.sign(payload)).decode("ascii"),
    }
    (pkg_path / sign_verify.MARKER_FILENAME).write_text(json.dumps(marker), encoding="utf-8")


def _marker(pkg_path) -> dict:
    return json.loads((pkg_path / sign_verify.MARKER_FILENAME).read_text(encoding="utf-8"))


def _write_marker(pkg_path, marker: dict) -> None:
    (pkg_path / sign_verify.MARKER_FILENAME).write_text(json.dumps(marker), encoding="utf-8")


def test_happy_path(pkg):
    assert sign_verify.verify_package_signature(str(pkg)) == (True, "")


def test_no_trusted_keys_fails_closed(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("QZDA_SANDBOX_TRUSTED_KEY_IDS", raising=False)
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "trusted" in reason


def test_missing_marker(pkg):
    (pkg / sign_verify.MARKER_FILENAME).unlink()
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "missing marker" in reason


def test_untrusted_signer(pkg, release_key):
    _sign(pkg, release_key, key_id="ed25519:someoneelse")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "untrusted signer" in reason


def test_no_public_key_configured(pkg, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(sign_verify.RELEASE_KEYS_ENV, "")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "no release public key" in reason


def test_forged_signature_rejected(pkg, release_key):
    other = Ed25519PrivateKey.generate()
    _sign(pkg, other)
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "signature verification failed" in reason


def test_modified_script_rejected(pkg):
    (pkg / "scripts" / "run.py").write_text("print('pwned')\n", encoding="utf-8")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "differ from the signed manifest" in reason


def test_added_file_rejected(pkg):
    (pkg / "scripts" / "extra.py").write_text("x = 1\n", encoding="utf-8")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "differ from the signed manifest" in reason


def test_pycache_is_ignored(pkg):
    cache = pkg / "scripts" / "__pycache__"
    cache.mkdir()
    (cache / "run.cpython-312.pyc").write_bytes(b"\x00")
    assert sign_verify.verify_package_signature(str(pkg)) == (True, "")


def test_payload_identity_mismatch_rejected(pkg):
    marker = _marker(pkg)
    marker["payload"] = marker["payload"].replace("sk-test", "sk-other")
    _write_marker(pkg, marker)
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "payload" in reason


def test_marker_without_signature(pkg):
    marker = _marker(pkg)
    del marker["signature"]
    _write_marker(pkg, marker)
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok and "signature" in reason


def test_tampered_skill_md(pkg):
    (pkg / "SKILL.md").write_text("# evil\n", encoding="utf-8")
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok


def test_missing_skill_md(pkg):
    (pkg / "SKILL.md").unlink()
    ok, reason = sign_verify.verify_package_signature(str(pkg))
    assert not ok


def test_compute_skill_md_sha256_lower_fallback(tmp_path):
    (tmp_path / "skill.md").write_text("x", encoding="utf-8")
    assert sign_verify.compute_skill_md_sha256(str(tmp_path)) is not None
