"""Skill 包签名验证 — 标记文件机制。

**策略**:由 ``tools/sign_builtin_packages.py`` 用发布密钥(Ed25519)签名,产出
marker 文件 ``<packagePath>/.signed``;沙箱用公钥验签,并校验包内全部文件的清单:

.. code-block:: json

    {
      "signed_by": "ed25519:abc12345",
      "sha256": "<hex of SKILL.md>",
      "manifest_sha256": "<hex of sorted file-hash manifest>",
      "payload": "<canonical JSON of keyId/package/manifestSha256>",
      "signature": "<base64 Ed25519 signature over payload>"
    }

**运行时校验**:
1. ``<packagePath>/.signed`` 存在 → 否则 403。
2. ``signed_by`` 在 ``QZDA_SANDBOX_TRUSTED_KEY_IDS`` 里(逗号分隔) → 否则 403。
3. ``QZDA_SANDBOX_RELEASE_PUBLIC_KEYS``(``keyId=base64公钥``,逗号分隔)中有该 keyId 的公钥,
   且 ``signature`` 是对 ``payload`` 的有效 Ed25519 签名 → 否则 403。
4. ``payload`` 必须等于由 keyId、包目录名、manifest_sha256 规范化得到的载荷 → 否则 403。
5. 重算包内全部文件的清单 sha256,必须等于 ``manifest_sha256``(脚本、SKILL.md 任何改动都会失败)→ 否则 403。
6. 现读 ``SKILL.md`` SHA256 与 ``sha256`` 一致 → 否则 403。

**Notes**:
- ``.signed`` 本身和 ``__pycache__`` 不进清单;包内出现符号链接直接拒绝。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path


MARKER_FILENAME = ".signed"
RELEASE_KEYS_ENV = "QZDA_SANDBOX_RELEASE_PUBLIC_KEYS"


def _trusted_key_ids() -> list[str]:
    """从 ``QZDA_SANDBOX_TRUSTED_KEY_IDS`` 读 CSV,strip 空;空列表 = 不信任何 key。

    找不到 env 时返回 ``[]``,所有 ``signed_by`` 都会判失败 — fail-closed。
    """
    raw = (os.environ.get("QZDA_SANDBOX_TRUSTED_KEY_IDS") or "").strip()
    if not raw:
        return []
    return [k.strip() for k in raw.split(",") if k.strip()]


def manifest_sha256(package_path: str) -> str:
    """包内全部文件(排除 ``.signed`` 与 ``__pycache__``)的清单 sha256。

    清单格式:按相对路径排序的 ``"<rel>\\t<sha256hex>\\n"`` 行。符号链接直接报错。
    """
    root = Path(package_path)
    lines: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            full = Path(dirpath) / name
            if full.is_symlink():
                raise ValueError(f"symlink not allowed in signed package: {full.name}")
            if name == MARKER_FILENAME or not full.is_file():
                continue
            rel = full.relative_to(root).as_posix()
            lines.append(f"{rel}\t{hashlib.sha256(full.read_bytes()).hexdigest()}\n")
    lines.sort()
    return hashlib.sha256("".join(lines).encode("utf-8")).hexdigest()


def signing_payload(key_id: str, package_name: str, manifest: str) -> bytes:
    """签名载荷的规范 JSON(键排序、无空白)。发布工具与校验共用。"""
    return json.dumps(
        {"keyId": key_id, "package": package_name, "manifestSha256": manifest},
        sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")


def _release_public_key(key_id: str) -> bytes | None:
    raw = os.environ.get(RELEASE_KEYS_ENV, "")
    for item in raw.split(","):
        kid, sep, pub_b64 = item.strip().partition("=")
        if sep and kid.strip() == key_id:
            try:
                key = base64.b64decode(pub_b64.strip(), validate=True)
            except ValueError:
                return None
            return key if len(key) == 32 else None
    return None


def _ed25519_verify(pub_raw: bytes, signature_b64: str, payload: bytes) -> bool:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    try:
        sig = base64.b64decode(signature_b64, validate=True)
        Ed25519PublicKey.from_public_bytes(pub_raw).verify(sig, payload)
        return True
    except (ValueError, InvalidSignature):
        return False


def read_marker(package_path: str) -> dict | None:
    """读 ``<package_path>/.signed`` JSON,失败返 ``None``。"""
    p = Path(package_path) / MARKER_FILENAME
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def compute_skill_md_sha256(package_path: str) -> str | None:
    """计算 ``<package_path>/SKILL.md`` 的 SHA256 hex,文件不存在返 None。"""
    p = Path(package_path) / "SKILL.md"
    if not p.is_file():
        # 兼容 skill.md 小写
        p = Path(package_path) / "skill.md"
        if not p.is_file():
            return None
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def verify_package_signature(package_path: str) -> tuple[bool, str]:
    """校验包签名 marker,返回 ``(ok, reason)``。

    - ``ok=True, reason=""`` → 通过。
    - ``ok=False, reason="..."`` → 失败原因(用于审计 reason 列)。
    """
    trusted = _trusted_key_ids()
    if not trusted:
        return False, "no trusted signing keys configured (QZDA_SANDBOX_TRUSTED_KEY_IDS unset)"
    marker = read_marker(package_path)
    if not marker:
        return False, f"missing marker {MARKER_FILENAME!r}"
    signed_by = str(marker.get("signed_by") or "").strip()
    if signed_by not in trusted:
        return False, f"untrusted signer: {signed_by!r}"
    signature = str(marker.get("signature") or "").strip()
    manifest_claim = str(marker.get("manifest_sha256") or "").strip()
    if not signature or not manifest_claim:
        return False, "marker missing signature or manifest_sha256"
    pub = _release_public_key(signed_by)
    if pub is None:
        return False, f"no release public key configured for {signed_by!r} ({RELEASE_KEYS_ENV})"
    payload = signing_payload(signed_by, Path(package_path).name, manifest_claim)
    if str(marker.get("payload") or "") != payload.decode("utf-8"):
        return False, "marker payload does not match package identity"
    if not _ed25519_verify(pub, signature, payload):
        return False, "release signature verification failed"
    try:
        actual_manifest = manifest_sha256(package_path)
    except (OSError, ValueError) as exc:
        return False, f"package manifest unreadable: {exc}"
    if actual_manifest != manifest_claim:
        return False, "package files differ from the signed manifest"
    expected_sha = str(marker.get("sha256") or "").strip()
    if not expected_sha:
        return False, "marker missing sha256"
    actual_sha = compute_skill_md_sha256(package_path)
    if actual_sha is None:
        return False, "SKILL.md missing"
    if actual_sha != expected_sha:
        return False, f"SKILL.md sha256 mismatch (expected {expected_sha[:12]}, got {actual_sha[:12]})"
    return True, ""