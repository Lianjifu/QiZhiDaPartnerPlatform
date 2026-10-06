"""Vector index backends: in-memory (default) and pgvector (recommended).

pgvector 是单进程 Docker 部署的默认推荐:把向量存在同一个 PostgreSQL 实例,
不需要额外容器,事务 / 备份 / 复制路径与控制面一致。

Milvus 已下线(commit e88eb2a 删除 deploy/milvus profile 与 infra/milvus/)。
"""
from __future__ import annotations

import math
import os
import re

DEFAULT_PUBLISHED = [
    {
        "docId": "rag-seed-1",
        "title": "故障手册-缓存",
        "snippet": "检查 Redis 慢查询与热点 key",
        "score": 0.91,
        "status": "published",
    },
    {
        "docId": "rag-seed-2",
        "title": "发布手册-灰度",
        "snippet": "先金丝雀 5% 流量再全量",
        "score": 0.88,
        "status": "published",
    },
]

_TOKEN = re.compile(r"[\w一-鿿]+", re.UNICODE)
COLLECTION = "rag_published_docs"
DIM = 64


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]


def embed(text: str) -> dict[str, float]:
    counts: dict[str, float] = {}
    for t in tokenize(text):
        counts[t] = counts.get(t, 0.0) + 1.0
    norm = math.sqrt(sum(v * v for v in counts.values())) or 1.0
    return {k: v / norm for k, v in counts.items()}


def dense_embed(text: str, dim: int = DIM) -> list[float]:
    """Deterministic hashing trick → fixed-dim unit vector for pgvector."""
    vec = [0.0] * dim
    for t in tokenize(text):
        h = hash(t)
        vec[h % dim] += 1.0
        vec[(h // dim) % dim] += 0.5
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(k, 0.0) for k, v in a.items())


class VectorIndex:
    def __init__(self) -> None:
        self.docs: list[dict] = []
        self.vectors: list[dict[str, float]] = []
        self.reindex(DEFAULT_PUBLISHED)

    def reindex(self, docs: list[dict]) -> int:
        published = [d for d in docs if (d.get("status") or "published") == "published"]
        self.docs = published
        self.vectors = [embed(f"{d.get('title', '')} {d.get('snippet', '')}") for d in published]
        return len(published)

    def ingest(self, docs: list[dict]) -> int:
        """Upsert published docs (chunk-light: one vector per doc)."""
        by_id = {
            str(d.get("docId") or d.get("id")): d
            for d in self.docs
            if str(d.get("docId") or d.get("id"))
        }
        for d in docs:
            if (d.get("status") or "published") != "published":
                continue
            did = str(d.get("docId") or d.get("id") or "")
            if not did:
                continue
            by_id[did] = d
        return self.reindex(list(by_id.values()))

    def search(self, query: str, top_k: int = 8) -> list[dict]:
        qv = embed(query)
        scored: list[tuple[float, dict]] = []
        for doc, vec in zip(self.docs, self.vectors):
            score = cosine(qv, vec)
            q = (query or "").lower()
            if q and score <= 0:
                blob = f"{doc.get('title', '')} {doc.get('snippet', '')}".lower()
                if q in blob:
                    score = 0.35
            if not q:
                score = float(doc.get("score") or 0.5)
            if score > 0:
                hit = dict(doc)
                hit["score"] = round(score, 4)
                scored.append((score, hit))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [h for _, h in scored[:top_k]]


class PgVectorIndex:
    """PG-backed vector index via pgvector extension.

    Reads QZDA_PGVECTOR_URL (falls back to QZDA_DATABASE_URL, since pgvector
    lives in the same Postgres instance as the control plane). On first
    use, ensures `CREATE EXTENSION vector` + `CREATE TABLE rag_published_docs`.

    Reindex is destructive (TRUNCATE) — acceptable since this is the dev/demo
    RAG store; production should manage rows via Knowledge publish flow.
    """

    def __init__(self, dsn: str) -> None:
        import psycopg
        from pgvector.psycopg import register_vector

        self.dsn = dsn
        self.conn = psycopg.connect(dsn, autocommit=True)
        self.table = COLLECTION
        register_vector(self.conn)
        with self.conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cur.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {COLLECTION} (
                    id          TEXT PRIMARY KEY,
                    title       TEXT        NOT NULL,
                    snippet     TEXT        NOT NULL,
                    status      TEXT        NOT NULL DEFAULT 'published',
                    vector      vector({DIM}) NOT NULL,
                    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        self.reindex(DEFAULT_PUBLISHED)

    def reindex(self, docs: list[dict]) -> int:
        published = [d for d in docs if (d.get("status") or "published") == "published"]
        with self.conn.cursor() as cur:
            cur.execute(f"TRUNCATE {COLLECTION}")
            if not published:
                return 0
            rows = [
                (
                    str(d.get("docId") or d.get("id")),
                    str(d.get("title") or "")[:512],
                    str(d.get("snippet") or "")[:2048],
                    "published",
                    dense_embed(f"{d.get('title', '')} {d.get('snippet', '')}"),
                )
                for d in published
            ]
            cur.executemany(
                f"INSERT INTO {COLLECTION} (id, title, snippet, status, vector) VALUES (%s, %s, %s, %s, %s)",
                rows,
            )
        return len(rows)

    def ingest(self, docs: list[dict]) -> int:
        published = [d for d in docs if (d.get("status") or "published") == "published"]
        with self.conn.cursor() as cur:
            cur.executemany(
                f"""
                INSERT INTO {COLLECTION} (id, title, snippet, status, vector)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    snippet = EXCLUDED.snippet,
                    status = EXCLUDED.status,
                    vector = EXCLUDED.vector,
                    updated_at = NOW()
                """,
                [
                    (
                        str(d.get("docId") or d.get("id") or ""),
                        str(d.get("title") or "")[:512],
                        str(d.get("snippet") or "")[:2048],
                        "published",
                        dense_embed(f"{d.get('title', '')} {d.get('snippet', '')}"),
                    )
                    for d in published
                    if d.get("docId") or d.get("id")
                ],
            )
        return len(published)

    def search(self, query: str, top_k: int = 8) -> list[dict]:
        qvec = dense_embed(query)
        with self.conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, title, snippet, status,
                       1 - (vector <=> %s::vector) AS score
                  FROM {COLLECTION}
                 ORDER BY vector <=> %s::vector
                 LIMIT %s
                """,
                (qvec, qvec, top_k),
            )
            rows = cur.fetchall()
        return [
            {
                "docId": r[0],
                "title": r[1],
                "snippet": r[2],
                "status": r[3] or "published",
                "score": round(float(r[4] or 0), 4),
            }
            for r in rows
        ]


def build_index() -> tuple[VectorIndex | PgVectorIndex, str]:
    pgvector_url = (
        os.environ.get("QZDA_PGVECTOR_URL")
        or os.environ.get("QZDA_DATABASE_URL")
        or ""
    ).strip()
    if pgvector_url:
        try:
            idx = PgVectorIndex(pgvector_url)
            return idx, "pgvector"
        except Exception as exc:  # noqa: BLE001
            print(f"pgvector unavailable ({exc}), falling back to vector-memory")
    return VectorIndex(), "vector-memory"
