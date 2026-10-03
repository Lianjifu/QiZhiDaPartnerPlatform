#!/usr/bin/env python3
"""Smoke tests for published-only vector index."""
from __future__ import annotations

import os
import sys

# Import from service root (parent of tests/).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.vector import VectorIndex  # noqa: E402,F401


def test_published_only_filter() -> None:
    idx = VectorIndex()
    n = idx.reindex(
        [
            {"docId": "1", "title": "ok", "snippet": "redis cache", "status": "published"},
            {"docId": "2", "title": "draft", "snippet": "secret", "status": "draft"},
        ]
    )
    assert n == 1
    hits = idx.search("redis")
    assert len(hits) == 1
    assert hits[0]["docId"] == "1"


def test_cosine_ranks_relevant() -> None:
    idx = VectorIndex()
    idx.reindex(
        [
            {"docId": "a", "title": "缓存手册", "snippet": "Redis 热点 key", "status": "published"},
            {"docId": "b", "title": "账单", "snippet": "发票与付款", "status": "published"},
        ]
    )
    hits = idx.search("Redis 缓存")
    assert hits[0]["docId"] == "a"


if __name__ == "__main__":
    test_published_only_filter()
    test_cosine_ranks_relevant()
    print("rag vector tests ok")