-- 0005_memory_vectors.sql
-- 记忆 / 上下文向量表:每条 memory record 一行 64-dim dense 向量,
-- 与 qzda-rag 同口径(pgvector dense_embed 哈希)。Go 控制面在
-- IngestRuntimeMemory / createMemory 时调 /v1/embed 算向量后写入,
-- 语义召回时用 cosine distance。

CREATE TABLE IF NOT EXISTS memory_vectors (
    record_id    TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    vector       vector(64) NOT NULL,
    model        TEXT        NOT NULL DEFAULT 'pgvector-dense-v1',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 跨工作区按 record 隔离,workspace 查询走 workspace_id 索引。
CREATE INDEX IF NOT EXISTS memory_vectors_ws_idx
    ON memory_vectors (workspace_id);

-- 注:启动期记录数 < 5k 时 sequential cosine scan 已足够;超过时手动建
--   CREATE INDEX memory_vectors_vec_idx
--     ON memory_vectors USING ivfflat (vector vector_cosine_ops) WITH (lists = 50);
