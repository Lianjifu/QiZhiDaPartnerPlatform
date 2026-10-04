package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// peerGET calls another deployment unit over HTTP. With the coarse split
// retired it is no longer used internally for catalog fetches, but the
// partners.Deps wiring still exposes it for downstream consumers that
// want to reach an external service (e.g. a remote RAG sidecar).
func (s *Server) peerGET(r *http.Request, base, path string) (any, error) {
	url := strings.TrimRight(base, "/") + path
	ctx := r.Context()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	for _, h := range []string{"Authorization", "x-workspace-id", "x-tenant-id", "x-correlation-id", "x-mock-role", "x-mock-actor", "x-mock-user-id", "x-mock-permissions"} {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}
	if req.Header.Get("x-workspace-id") == "" {
		req.Header.Set("x-workspace-id", s.workspaceID(r))
	}
	client := &http.Client{Timeout: 8 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("peer %s %d: %s", path, res.StatusCode, strings.TrimSpace(string(body)))
	}
	var envelope struct {
		OK   bool `json:"ok"`
		Data any  `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Data != nil {
		return envelope.Data, nil
	}
	var raw any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// fetchCapCatalogParts assembles the five catalog partitions used by the
// digital-employee assembly surface (skills / tools / knowledge / channels
// / models) from the local store directly. Before the coarse split was
// retired, this called qzda-cap over HTTP; in the qzda-app monolith the
// store is authoritative, so we just read it.
//
// History: relocated from handlers_capability_catalog.go during M05 P2,
// then made in-process during the Phase-2 collapse of qzda-sys /
// qzda-collab / qzda-cap / qzda-workflow into qzda-app.
func (s *Server) fetchCapCatalogParts(r *http.Request, ws string) (skills, tools, knowledge, channels, models []map[string]any, err error) {
	if s.Store == nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("store unavailable")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()

	seenSkill, seenTool := map[string]bool{}, map[string]bool{}
	for _, item := range s.Store.Skills {
		if str(item["workspaceId"]) != "" && str(item["workspaceId"]) != ws {
			continue
		}
		if !skillAssemblable(item) {
			continue
		}
		kind := strings.ToLower(coalesce(str(item["kind"]), "skill"))
		name := str(item["name"])
		meta := fmt.Sprintf("%s · %s", kindLabel(kind), coalesce(str(item["version"]), "—"))
		opt := map[string]any{"id": coalesce(str(item["id"]), name), "name": name, "meta": meta}
		if kind == "tool" || kind == "mcp" {
			if name == "" || seenTool[name] {
				continue
			}
			seenTool[name] = true
			tools = append(tools, opt)
		} else {
			if name == "" || seenSkill[name] {
				continue
			}
			seenSkill[name] = true
			skills = append(skills, opt)
		}
	}

	for _, pkg := range s.Store.KnowledgeDocs {
		if str(pkg["workspaceId"]) != "" && str(pkg["workspaceId"]) != ws {
			continue
		}
		if str(pkg["status"]) != "published" {
			continue
		}
		ver := "—"
		if cv, ok := pkg["currentVersion"].(map[string]any); ok {
			ver = coalesce(str(cv["version"]), ver)
		}
		knowledge = append(knowledge, map[string]any{
			"id":   pkg["id"],
			"name": str(pkg["name"]),
			"meta": fmt.Sprintf("%s · v%s", coalesce(str(pkg["domain"]), "知识"), ver),
		})
	}

	seenModel := map[string]bool{}
	addModel := func(id, name, meta string) {
		key := strings.TrimSpace(name)
		if key == "" || seenModel[key] {
			return
		}
		seenModel[key] = true
		models = append(models, map[string]any{"id": coalesce(id, key), "name": key, "meta": meta})
	}
	modelNameByID := map[string]string{}
	for _, p := range s.Store.ModelProviders {
		if str(p["workspaceId"]) != "" && str(p["workspaceId"]) != ws {
			continue
		}
		for _, m := range providerModels(p) {
			mid := str(m["id"])
			mname := coalesce(str(m["name"]), mid)
			if mid != "" {
				modelNameByID[mid] = mname
			}
		}
		st := str(p["status"])
		if st != "" && st != "active" && st != "standby" {
			continue
		}
		for _, m := range providerModels(p) {
			if str(m["status"]) != "" && str(m["status"]) != "available" {
				continue
			}
			caps := stringSlice(m["capabilities"])
			if len(caps) > 0 && !hasCapability(caps, "chat") && !hasCapability(caps, "reasoning") {
				continue
			}
			meta := "对话模型 · " + coalesce(str(p["name"]), "供应商")
			if region := str(m["cloudRegion"]); region != "" {
				meta += " · " + region
			}
			addModel(str(m["id"]), coalesce(str(m["name"]), str(m["id"])), meta)
		}
	}
	for _, pol := range s.Store.RoutingPolicies {
		if str(pol["workspaceId"]) != "" && str(pol["workspaceId"]) != ws {
			continue
		}
		if str(pol["status"]) != "published" {
			continue
		}
		primary := str(pol["primaryModelId"])
		modelName := coalesce(modelNameByID[primary], primary)
		level := coalesce(str(pol["level"]), "P1")
		routeName := coalesce(str(pol["name"]), level+" 路由")
		addModel(str(pol["id"]), routeName, fmt.Sprintf("已发布策略 %s · 主模型 %s", level, modelName))
	}

	seenCh := map[string]bool{}
	addCh := func(id, name, meta string) {
		key := strings.TrimSpace(name)
		if key == "" || seenCh[key] {
			return
		}
		seenCh[key] = true
		channels = append(channels, map[string]any{"id": coalesce(id, key), "name": key, "meta": meta})
	}
	addCh("ch-web", "Web", "渠道 · web")
	for _, ch := range s.Store.ChannelDeploys {
		if str(ch["workspaceId"]) != "" && str(ch["workspaceId"]) != ws {
			continue
		}
		if ch["enabled"] == false {
			continue
		}
		addCh(str(ch["id"]), str(ch["name"]), fmt.Sprintf("渠道 · %s", coalesce(str(ch["kind"]), "channel")))
	}

	return skills, tools, knowledge, channels, models, nil
}

// fetchWorkflowCatalogParts assembles workflow + workflow-skill catalog
// options from the local store directly. Before the coarse split was
// retired, this called qzda-workflow over HTTP.
func (s *Server) fetchWorkflowCatalogParts(r *http.Request, ws string) ([]map[string]any, error) {
	if s.Store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	s.Store.RLock()
	defer s.Store.RUnlock()

	out := make([]map[string]any, 0)
	for _, wf := range s.Store.WorkflowSkills {
		if str(wf["workspaceId"]) != "" && str(wf["workspaceId"]) != ws {
			continue
		}
		if st := str(wf["status"]); st != "" && st != "published" && st != "active" {
			continue
		}
		out = append(out, map[string]any{
			"id":   wf["id"],
			"name": str(wf["name"]),
			"meta": fmt.Sprintf("流程技能 · %s", coalesce(str(wf["version"]), coalesce(str(wf["sourceVersionId"]), "—"))),
		})
	}
	for _, wf := range s.Store.Workflows {
		if str(wf["workspaceId"]) != "" && str(wf["workspaceId"]) != ws {
			continue
		}
		st := coalesce(str(wf["status"]), str(wf["lifecycleStatus"]))
		if st != "" && st != "active" && st != "published" {
			continue
		}
		out = append(out, map[string]any{
			"id":   wf["id"],
			"name": str(wf["name"]),
			"meta": "工作流 · " + coalesce(st, "active"),
		})
	}
	return out, nil
}

// skillAssemblable returns true when a skill is in a state where the UI
// can offer it as an assemblable capability. The partners package has its
// own copy in capability_catalog.go for its buildCapabilityCatalogFromStoreLocked
// caller; this duplicate stays so the server-side fetchCapCatalogParts still
// compiles.
func skillAssemblable(sk map[string]any) bool {
	life := strings.ToLower(strings.TrimSpace(coalesce(str(sk["lifecycleStatus"]), str(sk["status"]))))
	if life == "" {
		return true
	}
	switch life {
	case "enabled", "installed", "active", "available":
		return true
	default:
		return false
	}
}

// kindLabel renders a human-friendly Chinese label for a capability
// kind (tool / mcp / skill).
func kindLabel(kind string) string {
	switch strings.ToLower(kind) {
	case "tool":
		return "工具"
	case "mcp":
		return "MCP"
	default:
		return "技能"
	}
}

// mapsFromAny coerces JSON list responses (sometimes raw arrays,
// sometimes {items: [...]}) into []map[string]any.
func mapsFromAny(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, item := range t {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	case map[string]any:
		if items, ok := t["items"]; ok {
			return mapsFromAny(items)
		}
		return nil
	default:
		return nil
	}
}