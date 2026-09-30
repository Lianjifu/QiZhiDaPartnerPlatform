"""Vector index backends: in-memory and optional Milvus."""
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

_TOKEN = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)
COLLECTION = "de_published_docs"
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
    """Deterministic hashing trick → fixed-dim unit vector for Milvus."""
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


class MilvusIndex:
    """Optional Milvus / Milvus-Lite backend (DE_MILVUS_URI)."""

    def __init__(self, uri: str) -> None:
        from pymilvus import DataType, MilvusClient  # type: ignore

        self.client = MilvusClient(uri)
        self.uri = uri
        if COLLECTION in self.client.list_collections():
            self.client.drop_collection(COLLECTION)
        schema = self.client.create_schema(auto_id=False, enable_dynamic_field=True)
        schema.add_field("id", DataType.VARCHAR, is_primary=True, max_length=64)
        schema.add_field("title", DataType.VARCHAR, max_length=512)
        schema.add_field("snippet", DataType.VARCHAR, max_length=2048)
        schema.add_field("status", DataType.VARCHAR, max_length=32)
        schema.add_field("vector", DataType.FLOAT_VECTOR, dim=DIM)
        idx = self.client.prepare_index_params()
        idx.add_index(field_name="vector", index_type="AUTOINDEX", metric_type="COSINE")
        self.client.create_collection(COLLECTION, schema=schema, index_params=idx)
        self.reindex(DEFAULT_PUBLISHED)

    def reindex(self, docs: list[dict]) -> int:
        published = [d for d in docs if (d.get("status") or "published") == "published"]
        if COLLECTION in self.client.list_collections():
            self.client.drop_collection(COLLECTION)
            schema = self.client.create_schema(auto_id=False, enable_dynamic_field=True)
            from pymilvus import DataType  # type: ignore

            schema.add_field("id", DataType.VARCHAR, is_primary=True, max_length=64)
            schema.add_field("title", DataType.VARCHAR, max_length=512)
            schema.add_field("snippet", DataType.VARCHAR, max_length=2048)
            schema.add_field("status", DataType.VARCHAR, max_length=32)
            schema.add_field("vector", DataType.FLOAT_VECTOR, dim=DIM)
            idx = self.client.prepare_index_params()
            idx.add_index(field_name="vector", index_type="AUTOINDEX", metric_type="COSINE")
            self.client.create_collection(COLLECTION, schema=schema, index_params=idx)
        if not published:
            return 0
        rows = []
        for d in published:
            text = f"{d.get('title', '')} {d.get('snippet', '')}"
            rows.append(
                {
                    "id": str(d.get("docId") or d.get("id")),
                    "title": str(d.get("title") or "")[:512],
                    "snippet": str(d.get("snippet") or "")[:2048],
                    "status": "published",
                    "vector": dense_embed(text),
                }
            )
        self.client.insert(COLLECTION, rows)
        return len(rows)

    def search(self, query: str, top_k: int = 8) -> list[dict]:
        res = self.client.search(
            COLLECTION,
            data=[dense_embed(query)],
            limit=top_k,
            output_fields=["title", "snippet", "status"],
        )
        hits: list[dict] = []
        for batch in res:
            for row in batch:
                ent = row.get("entity") or {}
                hits.append(
                    {
                        "docId": row.get("id"),
                        "title": ent.get("title"),
                        "snippet": ent.get("snippet"),
                        "status": ent.get("status") or "published",
                        "score": round(float(row.get("distance") or 0), 4),
                    }
                )
        return hits


def build_index() -> tuple[VectorIndex | MilvusIndex, str]:
    uri = (os.environ.get("DE_MILVUS_URI") or "").strip()
    if uri:
        try:
            idx = MilvusIndex(uri)
            return idx, "milvus"
        except Exception as exc:  # noqa: BLE001
            print(f"milvus unavailable ({exc}), falling back to vector-memory")
    return VectorIndex(), "vector-memory"
