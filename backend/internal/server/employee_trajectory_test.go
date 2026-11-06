package server_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// TestEvaluateUsesRealTrajectoryScore covers the P7 change: the partner
// evaluation is computed from the partner's actual run trajectory instead of
// a hard-coded score.
func TestEvaluateUsesRealTrajectoryScore(t *testing.T) {
	st := store.New()
	st.Lock()
	st.Conversations = append([]map[string]any{{
		"id": "conv-traj", "workspaceId": "w1", "digitalPartnerId": "de-1",
	}}, st.Conversations...)
	st.Messages["conv-traj"] = []map[string]any{
		{
			"role": "assistant", "content": "查了制度", "correlationId": "corr-1",
			"toolCalls": []any{
				map[string]any{"id": "tc1", "name": "knowledge.retrieve", "status": "success", "durationMs": 10},
			},
		},
		{
			"role": "assistant", "content": "又试了一次", "correlationId": "corr-2",
			"toolCalls": []any{
				map[string]any{"id": "tc2", "name": "shell.exec", "status": "failed", "error": "命令被拒", "durationMs": 5},
				map[string]any{"id": "tc3", "name": "shell.exec", "status": "failed", "error": "命令被拒", "durationMs": 5},
			},
		},
	}
	st.Unlock()

	h := server.New(st).Handler()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-1/evaluate", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("evaluate %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	// 两次工具失败 → 轨迹分被扣 → 评测不通过(而不是硬编码的 93.5 通过)。
	if !containsAll(body, `"status":"failed"`) {
		t.Fatalf("expected failed evaluation from real trajectory: %s", body)
	}
	if containsAll(body, `"score":93.5`) {
		t.Fatalf("evaluation must not use the hard-coded score: %s", body)
	}
}

// TestEvaluatePassesWithHealthyTrajectory covers the healthy case.
func TestEvaluatePassesWithHealthyTrajectory(t *testing.T) {
	st := store.New()
	st.Lock()
	st.Conversations = append([]map[string]any{{
		"id": "conv-ok", "workspaceId": "w1", "digitalPartnerId": "de-1",
	}}, st.Conversations...)
	st.Messages["conv-ok"] = []map[string]any{
		{
			"role": "assistant", "content": "查了制度", "correlationId": "corr-1",
			"toolCalls": []any{
				map[string]any{"id": "tc1", "name": "knowledge.retrieve", "status": "success", "durationMs": 10},
			},
		},
	}
	st.Unlock()

	h := server.New(st).Handler()
	req := httptest.NewRequest(http.MethodPost, "/api/partners/de-1/evaluate", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("evaluate %d %s", rr.Code, rr.Body.String())
	}
	if !containsAll(rr.Body.String(), `"status":"passed"`) {
		t.Fatalf("expected passed evaluation: %s", rr.Body.String())
	}
}

func containsAll(hay, needle string) bool {
	return len(hay) >= len(needle) && indexOf(hay, needle) >= 0
}

func indexOf(hay, needle string) int {
	for i := 0; i+len(needle) <= len(hay); i++ {
		if hay[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
