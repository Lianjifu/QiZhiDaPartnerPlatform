package qzdaworkflow

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// CallTrialActivities invokes runtime (+ optional RAG) so trial runs are observable
// beyond pure in-memory simulation.
func CallTrialActivities(ctx context.Context, workflowID string) []string {
	steps := []string{"simulate_nodes"}
	runtimeURL := strings.TrimSpace(os.Getenv("DE_AGENT_RUNTIME_URL"))
	if runtimeURL == "" {
		runtimeURL = "http://127.0.0.1:8091"
	}
	ragURL := strings.TrimSpace(os.Getenv("DE_RAG_URL"))
	if ragURL == "" {
		ragURL = "http://127.0.0.1:8092"
	}

	client := &http.Client{Timeout: 2 * time.Second}
	prompt := fmt.Sprintf("workflow trial %s", workflowID)

	if pingOK(ctx, client, runtimeURL+"/healthz") {
		if out := postInvoke(ctx, client, runtimeURL+"/v1/invoke", map[string]any{"input": prompt}); out != "" {
			steps = append(steps, "runtime_invoke:ok")
		} else {
			steps = append(steps, "runtime_invoke:fallback")
		}
	} else {
		steps = append(steps, "runtime_invoke:skipped")
	}

	if pingOK(ctx, client, ragURL+"/healthz") {
		if postInvoke(ctx, client, ragURL+"/v1/retrieve", map[string]any{
			"query": prompt, "correlationId": "wf-" + workflowID,
		}) != "" {
			steps = append(steps, "rag_retrieve:ok")
		} else {
			steps = append(steps, "rag_retrieve:fallback")
		}
	} else {
		steps = append(steps, "rag_retrieve:skipped")
	}
	return steps
}

func pingOK(ctx context.Context, client *http.Client, url string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode < 300
}

func postInvoke(ctx context.Context, client *http.Client, url string, body map[string]any) string {
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return ""
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return ""
	}
	b, _ := io.ReadAll(resp.Body)
	if len(b) == 0 {
		return ""
	}
	return string(b)
}
