// Package memory — pgvector-backed vector store for memory records.
//
// Schema: deploy/migrations/0005_memory_vectors.sql
//   record_id    TEXT PRIMARY KEY
//   workspace_id TEXT NOT NULL
//   vector       vector(64) NOT NULL
//   model        TEXT NOT NULL DEFAULT 'pgvector-dense-v1'
//   updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
//
// Used for semantic recall: 1 - (vector <=> query_vec) ORDER BY ... LIMIT k.
// 启动期 record 数 < 5k 时 sequential cosine scan 足够(同 qzda-rag 决策)。
package memory

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VectorStore is the function-value Deps contract — Server wires it
// to (*VectorStoreClient).Upsert/Search/Delete. Stub for tests.
type (
	VectorUpsertFn func(ctx context.Context, recordID, workspaceID string, vec []float32) error
	VectorSearchFn func(ctx context.Context, workspaceID string, vec []float32, topK int) ([]VectorHit, error)
	VectorDeleteFn func(ctx context.Context, recordID string) error
)

// VectorHit is one semantic recall result.
type VectorHit struct {
	RecordID  string  `json:"recordId"`
	Workspace  string  `json:"workspaceId"`
	Score      float32 `json:"score"` // 1 - cosine distance, 0..1
	CosineDist float32 `json:"cosineDist"`
}

// VectorStoreClient is the pgx-backed implementation. Pool is shared
// with the control plane's existing pgxpool (no separate connection).
type VectorStoreClient struct {
	Pool *pgxpool.Pool
}

// NewVectorStore binds the client to an existing pool.
func NewVectorStore(pool *pgxpool.Pool) *VectorStoreClient {
	return &VectorStoreClient{Pool: pool}
}

// Upsert writes (or updates) the vector for a record. ON CONFLICT
// updates workspace_id / vector / model / updated_at, keeping
// record_id stable. Empty vec is a no-op.
func (c *VectorStoreClient) Upsert(ctx context.Context, recordID, workspaceID string, vec []float32) error {
	if recordID == "" {
		return errors.New("vectorstore.upsert: empty recordID")
	}
	if len(vec) == 0 {
		return nil
	}
	_, err := c.Pool.Exec(ctx, `
		INSERT INTO memory_vectors (record_id, workspace_id, vector, model, updated_at)
		VALUES ($1, $2, $3::vector, 'pgvector-dense-v1', NOW())
		ON CONFLICT (record_id) DO UPDATE SET
			workspace_id = EXCLUDED.workspace_id,
			vector       = EXCLUDED.vector,
			model        = EXCLUDED.model,
			updated_at   = NOW()
	`, recordID, workspaceID, pgVectorLiteral(vec))
	return err
}

// Search returns the top-K most similar records within the workspace.
// Score = 1 - cosine_distance (cosine_operator <=>), so 1 = identical,
// 0 = orthogonal. Empty vec returns nil.
func (c *VectorStoreClient) Search(ctx context.Context, workspaceID string, vec []float32, topK int) ([]VectorHit, error) {
	if len(vec) == 0 || topK <= 0 {
		return nil, nil
	}
	rows, err := c.Pool.Query(ctx, `
		SELECT record_id, workspace_id,
		       1 - (vector <=> $1::vector) AS score,
		       (vector <=> $1::vector) AS dist
		  FROM memory_vectors
		 WHERE workspace_id = $2
		 ORDER BY vector <=> $1::vector
		 LIMIT $3
	`, pgVectorLiteral(vec), workspaceID, topK)
	if err != nil {
		return nil, fmt.Errorf("vectorstore.search: %w", err)
	}
	defer rows.Close()
	var out []VectorHit
	for rows.Next() {
		var h VectorHit
		if err := rows.Scan(&h.RecordID, &h.Workspace, &h.Score, &h.CosineDist); err != nil {
			return nil, fmt.Errorf("vectorstore.search scan: %w", err)
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// Delete removes the vector for a record. Missing row is not an error
// (idempotent: call this on record soft-revoke without an embedder call).
func (c *VectorStoreClient) Delete(ctx context.Context, recordID string) error {
	if recordID == "" {
		return nil
	}
	_, err := c.Pool.Exec(ctx, `DELETE FROM memory_vectors WHERE record_id = $1`, recordID)
	return err
}

// pgVectorLiteral serializes a float32 slice into pgvector's text
// representation: '[f1,f2,...,fN]'. Empty slice returns the empty
// vector literal (pgvector treats '[]' as zero-vector; callers that
// pass a zero-length vec should skip Upsert/Search instead).
func pgVectorLiteral(vec []float32) string {
	if len(vec) == 0 {
		return "[]"
	}
	out := make([]byte, 0, 2+20*len(vec))
	out = append(out, '[')
	for i, v := range vec {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, fmt.Sprintf("%g", v)...)
	}
	out = append(out, ']')
	return string(out)
}

// _ = pgx.Row — kept to silence unused-import for type assertions
// when callers wrap the pool via interface{}.
var _ pgx.Row
