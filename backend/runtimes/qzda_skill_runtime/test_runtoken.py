#!/usr/bin/env python3
"""Unit checks for skill-runtime RunToken verification (no HTTP server)."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
from base64 import urlsafe_b64encode

# Import from same directory
sys.path.insert(0, os.path.dirname(__file__))
os.environ["DE_SKILL_RUN_SECRET"] = "test-secret"
import main  # noqa: E402


def mint(skill: str, ws: str, actor: str, exp: int) -> str:
    payload = urlsafe_b64encode(
        json.dumps({"skillId": skill, "workspaceId": ws, "actorId": actor, "exp": exp}).encode()
    ).decode().rstrip("=")
    sig = hmac.new(b"test-secret", payload.encode(), hashlib.sha256).hexdigest()
    return f"v1.{payload}.{sig}"


def main_test() -> None:
    ok, err, claims = main.verify_run_token(mint("sk1", "w1", "u1", int(time.time()) + 60))
    assert ok and claims["skillId"] == "sk1", (ok, err, claims)
    ok, err, _ = main.verify_run_token(mint("sk1", "w1", "u1", int(time.time()) - 10))
    assert not ok and "expired" in err
    ok, err, _ = main.verify_run_token("v1.bad.deadbeef")
    assert not ok
    print("skill_runtime runtoken ok")


if __name__ == "__main__":
    main_test()
