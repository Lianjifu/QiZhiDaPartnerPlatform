-- 0004_pgvector.sql
-- RAG 向量库:pgvector 扩展 + 文档表
-- 单进程 Docker 部署:用 PG 自身的 vector 扩展承载 RAG,不再依赖 Milvus 容器。
-- DIM 必须与 services/qzda-rag/app/vector.py:DIM 保持一致(当前 64)。

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_published_docs (
    id          TEXT PRIMARY KEY,
    title       TEXT        NOT NULL,
    snippet     TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'published',
    vector      vector(64)  NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 启动期数据量 < 10k,sequential cosine scan 已足够;超过再加 ivfflat。
-- 索引建立规则:当 row_count > 5000 时手动跑
--   CREATE INDEX rag_published_docs_vector_idx
--     ON rag_published_docs USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);
