package partners

import (
	"fmt"
	"net/http"
	"os"
	"strings"
)

// capabilityCatalogAligned builds the digital-employee assembly catalog
// from live workspace assets. In split deploy (qzda-collab), skills /
// knowledge / models / channels are owned by qzda-cap and workflow
// skills by qzda-workflow — so collab aggregates via peer HTTP instead
// of its local (often empty) store shards.
//
// History: prior to M05 P2 this method lived in
// internal/server/handlers_capability_catalog.go alongside the catalog
// builder. The plan (D5) says not to split the 596L catalog into two
// files; this file preserves the merged shape.
func (s *Service) capabilityCatalogAligned(r *http.Request) (any, error) {
	ws := s.Deps.WorkspaceID(r)

	var (
		skills    []map[string]any
		tools     []map[string]any
		workflows []map[string]any
		knowledge []map[string]any
		channels  []map[string]any
		models    []map[string]any
	)

	if s.Deps.FetchCapCatalogParts != nil {
		peerSkills, peerTools, peerKnowledge, peerChannels, peerModels, err := s.Deps.FetchCapCatalogParts(r, ws)
		if err == nil {
			skills, tools, knowledge, channels, models = peerSkills, peerTools, peerKnowledge, peerChannels, peerModels
		}
	}
	if s.Deps.FetchWorkflowCatalogParts != nil && strings.TrimSpace(os.Getenv("DE_WORKFLOW_URL")) != "" {
		peerWF, err := s.Deps.FetchWorkflowCatalogParts(r, ws)
		if err == nil {
			workflows = peerWF
		}
	}

	// Local store fill (fallback for ModeAll / single-tenant / peer miss).
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

	platform := []map[string]any{}
	if s.Deps.CatalogPlatformTools != nil {
		platform = s.Deps.CatalogPlatformTools()
	}
	runtime := []map[string]any{}
	if s.Deps.CatalogRuntimeTools != nil {
		runtime = s.Deps.CatalogRuntimeTools(nil)
	}

	return map[string]any{
		"models":        models,
		"skills":        skills,
		"tools":         tools,
		"workflows":     workflows,
		"knowledge":     knowledge,
		"channels":      channels,
		"platformTools": platform,
		"runtimeTools":  runtime,
	}, nil
}

// asOptionMaps converts an arbitrary slice-shaped value to
// []map[string]any, accepting []map[string]any or []any (with element
// assertions). Used to coerce JSON-deserialized catalog slices into the
// shape mergeCatalogOptions expects.
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

// mergeCatalogOptions deduplicates two slices of catalog options by
// their (name, id) tuple, preferring the first occurrence. Used to fold
// peer-fetched + local store-derived options without surfacing the same
// entry twice.
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

// buildCapabilityCatalogFromStoreLocked reads the local in-memory store
// for every catalog-domain collection (model providers, policies,
// routes, skills, tool catalogs, workflow skills/workflows, knowledge
// docs, channels) and folds them into a single map keyed by catalog
// section. Caller MUST hold Store.RLock or Lock.
func (s *Service) buildCapabilityCatalogFromStoreLocked(ws string) map[string]any {
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
		if s.Deps.ModelByIDLocked != nil {
			if m, _ := s.Deps.ModelByIDLocked(primary); m != nil {
				modelName = coalesce(str(m["name"]), primary)
			}
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
		if s.Deps.ModelByIDLocked != nil {
			if m, _ := s.Deps.ModelByIDLocked(primary); m != nil {
				modelName = coalesce(str(m["name"]), primary)
			}
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
		var providerModelList []map[string]any
		if s.Deps.ProviderModels != nil {
			providerModelList = s.Deps.ProviderModels(p)
		}
		for _, m := range providerModelList {
			if str(m["status"]) != "" && str(m["status"]) != "available" {
				continue
			}
			caps := stringSlice(m["capabilities"])
			if len(caps) > 0 && !s.hasCapability(caps, "chat") && !s.hasCapability(caps, "reasoning") {
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
	var knowledgePkgs []map[string]any
	if s.Deps.KnowledgeSliceMaps != nil {
		knowledgePkgs = s.Deps.KnowledgeSliceMaps(s.Store.KnowledgeExtra["packages"])
	}
	for _, pkg := range knowledgePkgs {
		if pkg == nil {
			continue
		}
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

// skillAssemblable returns true when a skill is in a state where the UI
// can offer it as an assemblable capability.
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

// hasCapability returns true when caps contains want. Delegates to
// Deps.HasCapability when supplied; otherwise falls back to a
// package-local scan so capability_catalog.go remains usable in
// isolation (e.g. integration tests that don't wire Deps).
func (s *Service) hasCapability(caps []string, want string) bool {
	if s.Deps.HasCapability != nil {
		return s.Deps.HasCapability(caps, want)
	}
	for _, c := range caps {
		if strings.EqualFold(c, want) {
			return true
		}
	}
	return false
}
