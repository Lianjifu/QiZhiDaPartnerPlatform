"""Sign skill packages with the release Ed25519 key and write ``<pkg>/.signed``.

The private key never lives in the repository. Usage (from backend/services/qzda-sandbox):

    python3 tools/sign_builtin_packages.py \
        --key ~/.qzda-release/release-ed25519.pem \
        --key-id "$(cat ~/.qzda-release/release-keyid)" \
        /path/to/data/skill-packages/w1/sk-docx [more package dirs...]

Canonicalization is shared with the sandbox verifier (app/sign_verify.py).
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from app import sign_verify  # noqa: E402


def sign_package(pkg: Path, private_key, key_id: str) -> None:
    if not (pkg / "SKILL.md").is_file() and not (pkg / "skill.md").is_file():
        raise SystemExit(f"{pkg}: SKILL.md missing")
    manifest = sign_verify.manifest_sha256(str(pkg))
    payload = sign_verify.signing_payload(key_id, pkg.name, manifest)
    signature = base64.b64encode(private_key.sign(payload)).decode("ascii")
    marker = {
        "signed_by": key_id,
        "sha256": sign_verify.compute_skill_md_sha256(str(pkg)),
        "manifest_sha256": manifest,
        "payload": payload.decode("utf-8"),
        "signature": signature,
    }
    (pkg / sign_verify.MARKER_FILENAME).write_text(json.dumps(marker, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    from cryptography.hazmat.primitives import serialization

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--key", required=True, help="path to the Ed25519 private key (PEM)")
    parser.add_argument("--key-id", required=True, help="key id, e.g. ed25519:987de9e2bcec749d")
    parser.add_argument("packages", nargs="+", help="skill package directories")
    args = parser.parse_args()

    key_path = Path(args.key).expanduser()
    private_key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    for raw in args.packages:
        pkg = Path(raw).resolve()
        if not pkg.is_dir():
            raise SystemExit(f"not a directory: {pkg}")
        sign_package(pkg, private_key, args.key_id)
        print(f"signed {pkg.name} ({args.key_id})")


if __name__ == "__main__":
    main()
