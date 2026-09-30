package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// capabilityCatalogAligned builds the digital-employee assembly catalog from
// live workspace assets. In split deploy (qzda-collab), skills / knowledge / models /
// channels are owned by qzda-cap and workflow skills by qzda-workflow — so collab
// aggregates via peer HTTP instead of its local (often empty) store shards.
func (s *Server) capabilityCatalogAligned(r *http.Request) (any, error) {
	ws := s.workspaceID(r)

	var (
		skills    []map[string]any
		tools     []map[string]any
		workflows []map[string]any
		knowledge []map[string]any
		channels  []map[string]any
		models    []map[string]any
	)

	if s.Mode == ModeCollab {
		peerSkills, peerTools, peerKnowledge, peerChannels, peerModels, err := s.fetchCapCatalogParts(r, ws)
		if err != nil {
			// Soft-fail: still try local + workflow so the UI is not blank.
			_ = err
		} else {
			skills, tools, knowledge, channels, models = peerSkills, peerTools, peerKnowledge, peerChannels, peerModels
		}
		peerWF, err := s.fetchWorkflowCatalogParts(r, ws)
		if err == nil {
			workflows = peerWF
		}
	} else if s.Mode == ModeApp && strings.TrimSpace(os.Getenv("DE_WORKFLOW_URL")) != "" {
		peerWF, err := s.fetchWorkflowCatalogParts(r, ws)
		if err == nil {
			workflows = peerWF
		}
	}

	// Local store fill / ModeAll / peer miss fallback.
	s.Store.RLock()
	local := s.buildCapabilityCatalogFromStoreLocked(ws)
	s.Store.RUnlock()

	skills = mergeCatalogOptions(skills, asOptionMaps(local["skills"]))
	tools = mergeCatalogOptions(tools, asOptionMaps(local["tools"]))
	workflows = mergeCatalogOptions(workflows, asOptionMaps(local["workflows"]))
	knowledge = mergeCatalogOptions(knowledge, asOptionMaps(local["knowledge"]))
	channels = mergeCatalogOptions(channels, asOptionMaps(local["channels"]))
	models = mergeCatalogOptions(models, asOptionMaps(local["models"]))

	// Web console channel is always assemblable.
	channels = mergeCatalogOptions(channels, []map[string]any{
		{"id": "ch-web", "name": "Web", "meta": "渠道 · web"},
	})

	return map[string]any{
		"models":         models,
		"skills":         skills,
		"tools":          tools,
		"workflows":      workflows,
		"knowledge":      knowledge,
		"channels":       channels,
		"platformTools": catalogPlatformTools(),
		"runtimeTools":  catalogRuntimeTools(nil),
	}, nil
}

func asOptionMaps(v any) []map[string]any {
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
	default:
		return nil
	}
}

func mergeCatalogOptions(base, extra []map[string]any) []map[string]any {
	seen := map[string]bool{}
	out := make([]map[string]any, 0, len(base)+len(extra))
	add := func(items []map[string]any) {
		for _, item := range items {
			name := strings.TrimSpace(str(item["name"]))
			id := strings.TrimSpace(str(item["id"]))
			key := name
			if key == "" {
				key = id
			}
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, item)
		}
	}
	add(base)
	add(extra)
	return out
}

func (s *Server) buildCapabilityCatalogFromStoreLocked(ws string) map[string]any {
	models := make([]map[string]any, 0)
	seenModel := map[string]bool{}
	addModel := func(id, name, meta string) {
		key := strings.TrimSpace(name)
		if key == "" || seenModel[key] {
			return
		}
		seenModel[key] = true
		models = append(models, map[string]any{"id": coalesce(id, key), "name": key, "meta": meta})
	}

	// Prefer published routes as first-class options (name = route display name).
	for _, route := range s.Store.ModelRoutes {
		if str(route["workspaceId"]) != "" && str(route["workspaceId"]) != ws {
			continue
		}
		if str(route["status"]) != "published" {
			continue
		}
		primary := str(route["primaryModelId"])
		modelName := primary
		if m, _ := s.modelByIDLocked(primary); m != nil {
			modelName = coalesce(str(m["name"]), primary)
		}
		level := coalesce(str(route["level"]), "P1")
		routeName := coalesce(str(route["name"]), level+" 路由")
		addModel(str(route["id"]), routeName, fmt.Sprintf("已发布路由 %s · 主模型 %s", level, modelName))
	}
	for _, pol := range s.Store.RoutingPolicies {
		if str(pol["workspaceId"]) != "" && str(pol["workspaceId"]) != ws {
			continue
		}
		if str(pol["status"]) != "published" {
			continue
		}
		primary := str(pol["primaryModelId"])
		modelName := primary
		if m, _ := s.modelByIDLocked(primary); m != nil {
			modelName = coalesce(str(m["name"]), primary)
		}
		level := coalesce(str(pol["level"]), "P1")
		routeName := coalesce(str(pol["name"]), level+" 路由")
		addModel(str(pol["id"]), routeName, fmt.Sprintf("已发布策略 %s · 主模型 %s", level, modelName))
	}
	for _, p := range s.Store.ModelProviders {
		if str(p["workspaceId"]) != "" && str(p["workspaceId"]) != ws {
			continue
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
			meta := coalesce(str(p["name"]), "供应商")
			if region := str(m["cloudRegion"]); region != "" {
				meta += " · " + region
			}
			addModel(str(m["id"]), coalesce(str(m["name"]), str(m["id"])), "对话模型 · "+meta)
		}
	}

	skills := make([]map[string]any, 0)
	tools := make([]map[string]any, 0)
	seenSkill := map[string]bool{}
	seenTool := map[string]bool{}
	addAsset := func(kind, id, name, meta string) {
		key := strings.TrimSpace(name)
		if key == "" {
			return
		}
		item := map[string]any{"id": coalesce(id, key), "name": key, "meta": meta}
		switch strings.ToLower(kind) {
		case "tool", "mcp":
			if seenTool[key] {
				return
			}
			seenTool[key] = true
			tools = append(tools, item)
		default:
			if seenSkill[key] {
				return
			}
			seenSkill[key] = true
			skills = append(skills, item)
		}
	}
	for _, sk := range s.Store.Skills {
		if str(sk["workspaceId"]) != "" && str(sk["workspaceId"]) != ws {
			continue
		}
		if !skillAssemblable(sk) {
			continue
		}
		kind := strings.ToLower(coalesce(str(sk["kind"]), "skill"))
		ver := coalesce(str(sk["version"]), "—")
		addAsset(kind, str(sk["id"]), str(sk["name"]), fmt.Sprintf("%s · %s", kindLabel(kind), ver))
	}
	for _, sc := range s.Store.SkillCatalog {
		if wid := str(sc["workspaceId"]); wid != "" && wid != ws && wid != "*" {
			continue
		}
		if st := str(sc["status"]); st != "" && st != "available" && st != "enabled" {
			continue
		}
		kind := strings.ToLower(coalesce(str(sc["kind"]), "skill"))
		if kind != "tool" && kind != "mcp" {
			continue
		}
		ver := coalesce(str(sc["version"]), "—")
		addAsset(kind, str(sc["id"]), str(sc["name"]), fmt.Sprintf("%s · %s", kindLabel(kind), ver))
	}

	workflows := make([]map[string]any, 0)
	for _, wf := range s.Store.WorkflowSkills {
		if str(wf["workspaceId"]) != "" && str(wf["workspaceId"]) != ws {
			continue
		}
		if st := str(wf["status"]); st != "" && st != "published" && st != "active" {
			continue
		}
		workflows = append(workflows, map[string]any{
			"id": wf["id"], "name": wf["name"],
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
		workflows = append(workflows, map[string]any{
			"id": wf["id"], "name": wf["name"],
			"meta": "工作流 · " + coalesce(st, "active"),
		})
	}

	knowledge := make([]map[string]any, 0)
	for _, pkg := range knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"]) {
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
			"id": pkg["id"], "name": pkg["name"],
			"meta": fmt.Sprintf("%s · v%s", coalesce(str(pkg["domain"]), "知识"), ver),
		})
	}
	if len(knowledge) == 0 {
		seenDoc := map[string]bool{}
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["workspaceId"]) != "" && str(d["workspaceId"]) != ws {
				continue
			}
			if str(d["status"]) != "published" {
				continue
			}
			name := coalesce(str(d["title"]), str(d["name"]))
			if name == "" || seenDoc[name] {
				continue
			}
			seenDoc[name] = true
			knowledge = append(knowledge, map[string]any{
				"id": d["id"], "name": name, "meta": "已发布文档",
			})
		}
	}

	channels := make([]map[string]any, 0)
	seenCh := map[string]bool{}
	addChannel := func(id, name, meta string) {
		key := strings.TrimSpace(name)
		if key == "" || seenCh[key] {
			return
		}
		seenCh[key] = true
		channels = append(channels, map[string]any{"id": coalesce(id, key), "name": key, "meta": meta})
	}
	addChannel("ch-web", "Web", "渠道 · web")
	for _, ch := range s.Store.Channels {
		if str(ch["workspaceId"]) != "" && str(ch["workspaceId"]) != ws {
			continue
		}
		if ch["enabled"] == false {
			continue
		}
		addChannel(str(ch["id"]), str(ch["name"]), fmt.Sprintf("渠道 · %s", coalesce(str(ch["kind"]), "channel")))
	}
	for _, d := range s.Store.ChannelDeploys {
		if str(d["workspaceId"]) != "" && str(d["workspaceId"]) != ws {
			continue
		}
		if st := str(d["status"]); st != "" && st != "active" {
			continue
		}
		addChannel(str(d["id"]), str(d["name"]), fmt.Sprintf("投递 · %s", coalesce(str(d["kind"]), "channel")))
	}

	return map[string]any{
		"models": models, "skills": skills, "tools": tools,
		"workflows": workflows, "knowledge": knowledge, "channels": channels,
	}
}

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

func workflowBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("DE_WORKFLOW_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://127.0.0.1:8103"
}

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

func (s *Server) fetchCapCatalogParts(r *http.Request, ws string) (skills, tools, knowledge, channels, models []map[string]any, err error) {
	base := capBaseURL()
	skillsRaw, e1 := s.peerGET(r, base, "/api/skills")
	pkgsRaw, e2 := s.peerGET(r, base, "/api/knowledge/packages")
	providersRaw, e3 := s.peerGET(r, base, "/api/model-providers")
	policiesRaw, e4 := s.peerGET(r, base, "/api/model-routing/policies")
	channelsRaw, e5 := s.peerGET(r, base, "/api/channels")
	if e1 != nil && e2 != nil && e3 != nil && e4 != nil && e5 != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("cap unreachable: %v", e1)
	}

	seenSkill, seenTool := map[string]bool{}, map[string]bool{}
	for _, item := range mapsFromAny(skillsRaw) {
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

	for _, pkg := range mapsFromAny(pkgsRaw) {
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
			"id": pkg["id"], "name": pkg["name"],
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
	for _, p := range mapsFromAny(providersRaw) {
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
	for _, pol := range mapsFromAny(policiesRaw) {
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
	for _, ch := range mapsFromAny(channelsRaw) {
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

func (s *Server) fetchWorkflowCatalogParts(r *http.Request, ws string) ([]map[string]any, error) {
	base := workflowBaseURL()
	wfsRaw, err1 := s.peerGET(r, base, "/api/workflow-skills")
	wfRaw, err2 := s.peerGET(r, base, "/api/workflows")
	if err1 != nil && err2 != nil {
		return nil, err1
	}
	out := make([]map[string]any, 0)
	for _, wf := range mapsFromAny(wfsRaw) {
		if str(wf["workspaceId"]) != "" && str(wf["workspaceId"]) != ws {
			continue
		}
		if st := str(wf["status"]); st != "" && st != "published" && st != "active" {
			continue
		}
		out = append(out, map[string]any{
			"id": wf["id"], "name": wf["name"],
			"meta": fmt.Sprintf("流程技能 · %s", coalesce(str(wf["version"]), coalesce(str(wf["sourceVersionId"]), "—"))),
		})
	}
	for _, wf := range mapsFromAny(wfRaw) {
		if str(wf["workspaceId"]) != "" && str(wf["workspaceId"]) != ws {
			continue
		}
		st := coalesce(str(wf["status"]), str(wf["lifecycleStatus"]))
		if st != "" && st != "active" && st != "published" {
			continue
		}
		out = append(out, map[string]any{
			"id": wf["id"], "name": wf["name"],
			"meta": "工作流 · " + coalesce(st, "active"),
		})
	}
	return out, nil
}

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
		// some list endpoints wrap { items: [...] }
		if items, ok := t["items"]; ok {
			return mapsFromAny(items)
		}
		return nil
	default:
		return nil
	}
}
