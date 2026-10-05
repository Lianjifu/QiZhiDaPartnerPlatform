"""进程内 token-bucket:per (workspaceId, actorId) + per-IP 限流。

Phase 4 #6 实现:``/v1/execute`` 入口前置鉴权,任意调用方无限刷 → 单点 DoS。
单实例 + 不持久化够用,重启清零从节点计可控;若扩到多副本,改 Redis 后端。

设计:
- 滑动 60s 窗口,每个 key 独立 deque 记录请求时间戳。
- 三个粒度的桶:workspace+actor、IP、workspace 总体(防单 ws 内 fan-out)。
- 命中超限时返回 False,handler 转 429 + Retry-After。
- 测试覆盖:窗口清空、独立 key、env override、并发安全。
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque
from typing import Iterable


class TokenBucket:
    """固定速率的滑动窗口限流器。

    ``rate_per_min=60`` 意味着每 60s 允许 60 次请求,窗口滚动;
    第 61 次请求若 60s 前那次还没过期,被拒。
    """

    def __init__(self, rate_per_min: int) -> None:
        if rate_per_min <= 0:
            raise ValueError("rate_per_min must be > 0")
        self.rate = rate_per_min
        self._buckets: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: tuple[str, str], now: float | None = None) -> bool:
        """记一次命中。返回 True = 通过,False = 超限拒绝。

        ``key=(scope, identifier)``。scope 是 ``ws`` / ``ip`` / ``global`` 等分类。
        """
        if not isinstance(key, tuple) or len(key) != 2:
            raise TypeError("key must be (scope, identifier)")
        ts = now if now is not None else time.monotonic()
        with self._lock:
            dq = self._buckets.setdefault(key, deque())
            while dq and ts - dq[0] > 60.0:
                dq.popleft()
            if len(dq) >= self.rate:
                return False
            dq.append(ts)
            return True

    def reset(self, key: tuple[str, str] | None = None) -> None:
        """清空一个 key 或全部(测试用)。"""
        with self._lock:
            if key is None:
                self._buckets.clear()
            else:
                self._buckets.pop(key, None)


def build_default() -> TokenBucket:
    """从 env 读默认值,生产 / 开发可分别覆盖。

    - ``QZDA_SANDBOX_RATE_LIMIT_PER_MIN`` 默认 60(每分钟每 ws+actor 60 次)。
    - 进程内单实例,FastAPI 启动期 init 一次。
    """
    rate = int(os.environ.get("QZDA_SANDBOX_RATE_LIMIT_PER_MIN") or "60")
    return TokenBucket(rate)


def rate_limit_keys(
    workspace_id: str | None,
    actor_id: str | None,
    client_ip: str | None,
) -> Iterable[tuple[tuple[str, str], str]]:
    """生成多层 key,返回 ``((scope, identifier), reason_label)``。

    任何一个 hit 返回 False → 拒绝,reason_label 用于响应 body 提示哪层拦截。
    """
    keys: list[tuple[tuple[str, str], str]] = []
    if workspace_id or actor_id:
        keys.append(
            ((workspace_id or "-", actor_id or "-"), "ws_actor"),
        )
    if client_ip:
        keys.append((("ip", client_ip), "ip"))
    if workspace_id:
        keys.append((("ws", workspace_id), "ws"))
    return keys