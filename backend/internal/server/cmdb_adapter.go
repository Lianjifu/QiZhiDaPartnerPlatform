package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// isCMDBTool reports whether a registered tool is the CMDB read adapter.
func isCMDBTool(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return strings.Contains(n, "cmdb")
}

func cmdbExternalURL() string {
	return strings.TrimSpace(os.Getenv("QZDA_CMDB_URL"))
}

func cmdbRequireExternal() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_CMDB_REQUIRE_EXTERNAL")))
	return v == "1" || v == "true" || v == "yes"
}

// runCMDBLookup is a read-only asset/CI lookup for Copilot tools named like CMDB.
// Prefer QZDA_CMDB_URL when set; otherwise search the platform catalog (knowledge graph + demo CIs).
// When QZDA_CMDB_REQUIRE_EXTERNAL=1 and URL is unset, returns unavailable (honest failure).
func (s *Server) runCMDBLookup(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult {
	query := strings.TrimSpace(coalesce(
		str(call.Args["query"]),
		coalesce(str(call.Args["asset"]), coalesce(str(call.Args["ci"]), coalesce(str(call.Args["name"]), ctx.UserMessage))),
	))
	if query == "" {
		return toolExecResult{
			Status: "failed", DurationMs: int(time.Since(started).Milliseconds()),
			Error: "缺少查询参数", Output: "cmdb.lookup 需要 args.query / asset / ci",
		}
	}

	ext := cmdbExternalURL()
	if cmdbRequireExternal() && ext == "" {
		return toolExecResult{
			Status: "unavailable", DurationMs: int(time.Since(started).Milliseconds()),
			Permission: "unavailable",
			Error:      "CMDB 外部依赖未配置",
			Output:     "工具「" + t.Name + "」标记为需外部 CMDB（QZDA_CMDB_REQUIRE_EXTERNAL=1），但未设置 QZDA_CMDB_URL。",
		}
	}

	if ext != "" {
		hits, err := fetchExternalCMDB(ext, query, ctx.WorkspaceID)
		if err != nil {
			return toolExecResult{
				Status: "unavailable", DurationMs: int(time.Since(started).Milliseconds()),
				Permission: "unavailable",
				Error:      "CMDB 外部查询失败：" + err.Error(),
				Output:     "外部 CMDB 不可用：" + err.Error(),
			}
		}
		return formatCMDBResult(t.Name, query, "external", hits, started)
	}

	s.Store.RLock()
	hits := s.searchCMDBCatalogLocked(ctx.WorkspaceID, query)
	s.Store.RUnlock()
	return formatCMDBResult(t.Name, query, "platform-catalog", hits, started)
}

func formatCMDBResult(toolName, query, backend string, hits []map[string]any, started time.Time) toolExecResult {
	res := toolExecResult{
		Status: "success", DurationMs: int(time.Since(started).Milliseconds()),
		Hits: map[string]any{"backend": backend, "results": hits, "query": query},
	}
	if len(hits) == 0 {
		res.Output = fmt.Sprintf("%s：query=%q backend=%s 无命中", toolName, query, backend)
		return res
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("%s：query=%q backend=%s hits=%d\n", toolName, query, backend, len(hits)))
	for i, h := range hits {
		if i >= 8 {
			b.WriteString(fmt.Sprintf("…另有 %d 条\n", len(hits)-8))
			break
		}
		b.WriteString("- ")
		b.WriteString(coalesce(str(h["name"]), str(h["id"])))
		if typ := str(h["type"]); typ != "" {
			b.WriteString(" [")
			b.WriteString(typ)
			b.WriteString("]")
		}
		if owner := str(h["owner"]); owner != "" {
			b.WriteString(" · owner=")
			b.WriteString(owner)
		}
		if env := str(h["environment"]); env != "" {
			b.WriteString(" · env=")
			b.WriteString(env)
		}
		if note := str(h["summary"]); note != "" {
			b.WriteString(" — ")
			b.WriteString(note)
		}
		b.WriteString("\n")
	}
	res.Output = strings.TrimSpace(b.String())
	return res
}

func (s *Server) searchCMDBCatalogLocked(ws, query string) []map[string]any {
	q := strings.ToLower(strings.TrimSpace(query))
	var out []map[string]any
	match := func(fields ...string) bool {
		if q == "" {
			return true
		}
		blob := strings.ToLower(strings.Join(fields, " "))
		for _, token := range strings.Fields(q) {
			if token == "" {
				continue
			}
			if strings.Contains(blob, token) {
				return true
			}
		}
		return strings.Contains(blob, q)
	}

	for _, e := range knowledgeSliceMaps(s.Store.KnowledgeExtra["graphEntities"]) {
		if ws != "" && str(e["workspaceId"]) != "" && str(e["workspaceId"]) != ws {
			continue
		}
		typ := str(e["type"])
		if typ != "" && typ != "asset" && typ != "ci" && typ != "service" {
			// Still allow owner/runbook when query explicitly mentions them.
			if !strings.Contains(q, strings.ToLower(typ)) && !strings.Contains(q, "owner") && !strings.Contains(q, "runbook") {
				if typ != "asset" && typ != "ci" {
					continue
				}
			}
		}
		name := str(e["name"])
		id := str(e["id"])
		if !match(name, id, typ, str(e["sourceDocId"])) {
			continue
		}
		out = append(out, map[string]any{
			"id": id, "name": name, "type": coalesce(typ, "asset"),
			"summary":    "知识图谱实体 · source=" + coalesce(str(e["sourceDocId"]), "—"),
			"confidence": e["confidence"],
		})
	}

	for _, demo := range builtinCMDBDemoAssets(ws) {
		if !match(str(demo["name"]), str(demo["id"]), str(demo["type"]), str(demo["owner"]), str(demo["summary"]), str(demo["environment"])) {
			continue
		}
		// Dedupe by name against graph hits.
		dup := false
		for _, h := range out {
			if strings.EqualFold(str(h["name"]), str(demo["name"])) {
				dup = true
				break
			}
		}
		if !dup {
			out = append(out, demo)
		}
	}
	return out
}

func builtinCMDBDemoAssets(ws string) []map[string]any {
	_ = ws
	return []map[string]any{
		{"id": "ci-prod-redis-01", "name": "prod-redis-01", "type": "cache", "environment": "production", "owner": "SRE 值班组", "summary": "Redis 集群 · maxmemory 风险资产"},
		{"id": "ci-redis-prod-01", "name": "redis-prod-01", "type": "cache", "environment": "production", "owner": "SRE 值班组", "summary": "与 prod-redis-01 同族别名"},
		{"id": "ci-ws-042", "name": "workstation-042", "type": "endpoint", "environment": "office", "owner": "桌面运维", "summary": "终端资产 · user-svc-018"},
		{"id": "ci-frontend", "name": "prod-frontend-7d8", "type": "deployment", "environment": "production", "owner": "前端平台", "summary": "Kubernetes Deployment"},
		{"id": "ci-cache-prd", "name": "PRD-CACHE-019", "type": "asset", "environment": "production", "owner": "基础架构组", "summary": "缓存类配置项目录编号"},
	}
}

func fetchExternalCMDB(base, query, workspaceID string) ([]map[string]any, error) {
	u, err := url.Parse(base)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("query", query)
	if workspaceID != "" {
		q.Set("workspaceId", workspaceID)
	}
	u.RawQuery = q.Encode()
	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var parsed any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	switch v := parsed.(type) {
	case []any:
		out := make([]map[string]any, 0, len(v))
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out, nil
	case map[string]any:
		if results, ok := v["results"].([]any); ok {
			out := make([]map[string]any, 0, len(results))
			for _, item := range results {
				if m, ok := item.(map[string]any); ok {
					out = append(out, m)
				}
			}
			return out, nil
		}
		return []map[string]any{v}, nil
	default:
		return nil, fmt.Errorf("无法解析 CMDB 响应")
	}
}
