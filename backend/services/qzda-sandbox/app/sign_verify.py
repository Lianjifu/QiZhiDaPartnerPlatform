"""Skill 包签名验证 — 标记文件机制。

**策略选择**:不在 Python 侧跑 ed25519 verify(避免与 Go 端 canonical JSON
规范各搞一套),改用 Go 端签名流程产出的 marker 文件 ``<packagePath>/.signed``:

.. code-block:: json

    {
      "signed_by": "ed25519:abc12345",   // 来自 Signer.KeyID()
      "signed_at": "2026-10-01T08:00:00Z",
      "skill_id": "weather",
      "sha256": "<hex of SKILL.md>"       // 防签名后篡改 SKILL.md
    }

**运行时校验**:
1. ``<packagePath>/.signed`` 存在 → 否则 403。
2. ``signed_by`` 在 ``QZDA_SANDBOX_TRUSTED_KEY_IDS`` 列表里(逗号分隔) → 否则 403。
3. 现读 ``SKILL.md`` SHA256 与 ``.signed.sha256`` 一致 → 否则 403。

**怎么生成 marker**:在 build pipeline 跑一次 ``tools/sign-skill`` Go 程序
(用仓里已有的 ``services/qzda-sandbox/signing`` Ed25519 + Signer.KeyID)。

**Notes**:
- ``.signed`` 本身不进 SKILL.md sha256(否则签名时不存在,验证时存在,永远失败)。
- ``sha256`` 只对 SKILL.md 计算;``scripts/*.py`` 一旦改动,Go 端
  SkillPackageAttach 会重新触发 build pipeline 重签。
- 这个 marker 不是"证明包可信"的最终武器,而是"运行时不应该被悄悄改"
  的最小防线 — 真正的"包来自谁"由 Go 端 SkillPackageAttach 在导入时把关。
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


MARKER_FILENAME = ".signed"


def _trusted_key_ids() -> list[str]:
    """从 ``QZDA_SANDBOX_TRUSTED_KEY_IDS`` 读 CSV,strip 空;空列表 = 不信任何 key。

    找不到 env 时返回 ``[]``,所有 ``signed_by`` 都会判失败 — fail-closed。
    """
    raw = (os.environ.get("QZDA_SANDBOX_TRUSTED_KEY_IDS") or "").strip()
    if not raw:
        return []
    return [k.strip() for k in raw.split(",") if k.strip()]


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
    expected_sha = str(marker.get("sha256") or "").strip()
    if not expected_sha:
        return False, "marker missing sha256"
    actual_sha = compute_skill_md_sha256(package_path)
    if actual_sha is None:
        return False, "SKILL.md missing"
    if actual_sha != expected_sha:
        return False, f"SKILL.md sha256 mismatch (expected {expected_sha[:12]}, got {actual_sha[:12]})"
    return True, ""