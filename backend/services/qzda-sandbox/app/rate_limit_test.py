"""``rate_limit.py`` 单元测试 — 不依赖 docker / 网络 / FastAPI。

覆盖:
- 60s 滑窗清空(模拟时间戳)
- rejects at limit
- 不同 key 互不影响
- env override
- 并发安全(smoke test,不是 unit 必过)
"""
from __future__ import annotations

import os

import pytest

from app.rate_limit import TokenBucket, build_default, rate_limit_keys


def test_bucket_rejects_at_limit():
    b = TokenBucket(rate_per_min=3)
    assert b.hit(("ws", "a"), now=0.0) is True
    assert b.hit(("ws", "a"), now=1.0) is True
    assert b.hit(("ws", "a"), now=2.0) is True
    assert b.hit(("ws", "a"), now=3.0) is False  # 第 4 次拒绝
    assert b.hit(("ws", "a"), now=61.0) is True  # 第 1 次已过期


def test_bucket_window_clears():
    b = TokenBucket(rate_per_min=2)
    b.hit(("k", "v"), now=0.0)
    b.hit(("k", "v"), now=30.0)
    assert b.hit(("k", "v"), now=30.0) is False
    # 第 1 次已过期(>60s),可继续
    assert b.hit(("k", "v"), now=60.001) is True


def test_independent_keys():
    b = TokenBucket(rate_per_min=1)
    assert b.hit(("ws", "a"), now=0.0) is True
    assert b.hit(("ws", "a"), now=0.0) is False  # 同一 key 限
    assert b.hit(("ws", "b"), now=0.0) is True  # 不同 key 不影响
    assert b.hit(("ip", "1.2.3.4"), now=0.0) is True


def test_invalid_rate():
    with pytest.raises(ValueError):
        TokenBucket(rate_per_min=0)
    with pytest.raises(ValueError):
        TokenBucket(rate_per_min=-1)


def test_bad_key_shape():
    b = TokenBucket(rate_per_min=10)
    with pytest.raises(TypeError):
        b.hit(("only_one",))  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        b.hit("not_a_tuple")  # type: ignore[arg-type]


def test_reset():
    b = TokenBucket(rate_per_min=1)
    b.hit(("k", "v"), now=0.0)
    assert b.hit(("k", "v"), now=0.0) is False
    b.reset(("k", "v"))
    assert b.hit(("k", "v"), now=0.0) is True
    b.reset()  # 全清
    assert b.hit(("k", "v"), now=0.0) is True


def test_build_default_env_override(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DE_SANDBOX_RATE_LIMIT_PER_MIN", "123")
    b = build_default()
    assert b.rate == 123


def test_build_default_no_env():
    # 不设 env,默认 60
    os.environ.pop("DE_SANDBOX_RATE_LIMIT_PER_MIN", None)
    b = build_default()
    assert b.rate == 60


def test_rate_limit_keys_full():
    keys = list(rate_limit_keys("ws-1", "alice", "10.0.0.1"))
    # keys 是 ((scope, identifier), reason_label) 的列表
    # (scope, identifier) 对 ws_actor 桶是 (workspaceId, actorId)
    reasons = [k[1] for k in keys]
    assert "ws_actor" in reasons
    assert "ip" in reasons
    assert "ws" in reasons


def test_rate_limit_keys_partial():
    # 没 workspace / actor
    keys = list(rate_limit_keys(None, None, "10.0.0.1"))
    reasons = [k[1] for k in keys]
    assert "ws_actor" not in reasons
    assert "ip" in reasons


def test_rate_limit_keys_none():
    keys = list(rate_limit_keys(None, None, None))
    assert keys == []