package workflows

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// builtinWorkflowManifest mirrors the JSON layout at
// backend/builtin/workflows/manifest.json. Packs reference directories
// next to manifest.json that hold template.json files; the loader
// flattens them into the WorkflowTpls slice.
type builtinWorkflowManifest struct {
	Version         string   `json:"version"`
	FactoryDefaults []string `json:"factoryDefaults"`
	Advanced        []string `json:"advanced"`
	Packs           []struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		Version       string `json:"version"`
		Certification string `json:"certification"`
		Library       string `json:"library"`
		Department    string `json:"department"`
	} `json:"packs"`
}

var (
	builtinWFOnce   sync.Once
	builtinWFPacks  []map[string]any
	builtinWFErr    error
)

// builtinWorkflowsRoot resolves the on-disk location of the platform
// builtin workflow packs. Walks up from cwd so the same code works in
// `backend/...` test runs and in the production container.
func builtinWorkflowsRoot() string {
	if v := strings.TrimSpace(os.Getenv("DE_BUILTIN_WORKFLOWS_DIR")); v != "" {
		return v
	}
	candidates := []string{
		filepath.Join("backend", "builtin", "workflows"),
		filepath.Join("..", "backend", "builtin", "workflows"),
		filepath.Join("..", "..", "builtin", "workflows"),
		filepath.Join("builtin", "workflows"),
	}
	// walk up from cwd
	if wd, err := os.Getwd(); err == nil {
		dir := wd
		for i := 0; i < 6; i++ {
			candidates = append(candidates, filepath.Join(dir, "backend", "builtin", "workflows"))
			candidates = append(candidates, filepath.Join(dir, "builtin", "workflows"))
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return filepath.Join("backend", "builtin", "workflows")
}

// loadBuiltinWorkflowPacks loads manifest.json + every pack's
// template.json once (sync.Once). The result is cached so the
// /api/workflow-templates handler stays fast.
func loadBuiltinWorkflowPacks() ([]map[string]any, error) {
	builtinWFOnce.Do(func() {
		root := builtinWorkflowsRoot()
		raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
		if err != nil {
			builtinWFErr = err
			return
		}
		var man builtinWorkflowManifest
		if err := json.Unmarshal(raw, &man); err != nil {
			builtinWFErr = err
			return
		}
		out := make([]map[string]any, 0, len(man.Packs))
		for _, meta := range man.Packs {
			path := filepath.Join(root, meta.ID, "template.json")
			body, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			var pack map[string]any
			if err := json.Unmarshal(body, &pack); err != nil {
				continue
			}
			pack["builtin"] = true
			pack["source"] = "platform"
			// API 兼容字段
			if _, ok := pack["installs"]; !ok {
				pack["installs"] = 0
			}
			if _, ok := pack["rating"]; !ok {
				pack["rating"] = 5.0
			}
			pack["health"] = evaluateBuiltinTemplateHealth(pack)
			out = append(out, pack)
		}
		builtinWFPacks = out
	})
	return builtinWFPacks, builtinWFErr
}

// LoadBuiltinWorkflowPacksForTest exposes loadBuiltinWorkflowPacks to
// the legacy builtin_workflows_test.go that still lives in
// internal/server/ after the M06 P2 deep move. The pre-move test
// reaches into the package-private loader; the post-move test must
// call through this wrapper because the unexported symbol is no
// longer accessible from the server/ test binary.
func LoadBuiltinWorkflowPacksForTest() ([]map[string]any, error) {
	return loadBuiltinWorkflowPacks()
}

// WorkflowTemplateOriginForTest exposes workflowTemplateOrigin to
// the legacy builtin_workflows_test.go.
func WorkflowTemplateOriginForTest(item map[string]any) string {
	return workflowTemplateOrigin(item)
}

// EvaluateBuiltinTemplateHealthForTest exposes evaluateBuiltinTemplateHealth
// to the legacy builtin_workflows_test.go.
func EvaluateBuiltinTemplateHealthForTest(pack map[string]any) string {
	return evaluateBuiltinTemplateHealth(pack)
}

// evaluateBuiltinTemplateHealth：缺必填槽位 → 需授权；可降级槽位缺失则仍健康并带 degrade 提示。
func evaluateBuiltinTemplateHealth(pack map[string]any) string {
	connectors, _ := pack["connectors"].([]any)
	degrade, _ := pack["degrade"].(map[string]any)
	whenSet := map[string]bool{}
	if degrade != nil {
		when, _ := degrade["whenMissingSlots"].([]any)
		for _, w := range when {
			if s, ok := w.(string); ok {
				whenSet[s] = true
			}
		}
	}
	missingRequired := []string{}
	missingDegrade := []string{}
	for _, raw := range connectors {
		c, _ := raw.(map[string]any)
		required, _ := c["required"].(bool)
		slot, _ := c["slot"].(string)
		// 平台内置默认：通知与知识检索视为可满足
		if slot == "notify.send" || slot == "knowledge.retrieve" {
			continue
		}
		if def, _ := c["defaultBinding"].(string); strings.TrimSpace(def) != "" {
			continue
		}
		if whenSet[slot] {
			missingDegrade = append(missingDegrade, slot)
			if !required {
				continue
			}
		}
		if !required {
			continue
		}
		missingRequired = append(missingRequired, slot)
	}
	hard := make([]string, 0, len(missingRequired))
	for _, m := range missingRequired {
		if !whenSet[m] {
			hard = append(hard, m)
		}
	}
	if len(hard) > 0 {
		blockers := make([]string, 0, len(hard))
		for _, m := range hard {
			blockers = append(blockers, m+"：未绑定连接器槽位")
		}
		pack["blockers"] = blockers
		return "需授权"
	}
	if len(missingDegrade) > 0 && degrade != nil {
		pack["healthHint"] = strOr(degrade["hint"], "部分连接器未绑定，已降级可用")
		pack["degraded"] = true
	}
	return "健康"
}

// EnsureBuiltinWorkflowsReady 用平台内置包覆盖/补齐 WorkflowTpls（出厂默认）。
// Boot path: called by apprun/run.go (DomainWorkflow) and by
// builtin_workflows_test.go + builtin_office_test.go on the workflowSvc
// field of the freshly-built Server.
func (s *Service) EnsureBuiltinWorkflowsReady() {
	packs, err := loadBuiltinWorkflowPacks()
	if err != nil || len(packs) == 0 {
		return
	}
	s.Store.Lock()
	defer s.Store.Unlock()
	// 保留非 builtin 的工作区自定义模板（若有）
	custom := make([]map[string]any, 0)
	for _, item := range s.Store.WorkflowTpls {
		if b, _ := item["builtin"].(bool); b {
			continue
		}
		if src, _ := item["source"].(string); src == "platform" {
			continue
		}
		// 旧种子 id（tpl-* / 裸 wft-* / wf.* 平台包）让位给内置包；个人模板 wft-user-* 保留
		id, _ := item["id"].(string)
		if strings.HasPrefix(id, "tpl-") || strings.HasPrefix(id, "wf.") {
			continue
		}
		if strings.HasPrefix(id, "wft-") && !strings.HasPrefix(id, "wft-user-") {
			continue
		}
		custom = append(custom, item)
	}
	merged := append([]map[string]any{}, packs...)
	merged = append(merged, custom...)
	s.Store.WorkflowTpls = merged
}

// listWorkflowTemplates → GET /api/workflow-templates
func (s *Service) listWorkflowTemplates(r *http.Request) (any, error) {
	s.EnsureBuiltinWorkflowsReady()
	id := s.identityFrom(r.Context())
	ws := s.Deps.WorkspaceID(r)
	originFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("origin")))
	s.Store.RLock()
	defer s.Store.RUnlock()
	out := make([]map[string]any, 0, len(s.Store.WorkflowTpls))
	for _, item := range s.Store.WorkflowTpls {
		origin := workflowTemplateOrigin(item)
		if origin == "personal" {
			ownerID, _ := item["ownerId"].(string)
			itemWS, _ := item["workspaceId"].(string)
			if itemWS != "" && itemWS != ws {
				continue
			}
			if ownerID != "" && ownerID != id.ID && id.Role != "admin" && id.Role != "auditor" {
				continue
			}
		}
		if originFilter == "platform" && origin != "platform" {
			continue
		}
		if originFilter == "personal" && origin != "personal" {
			continue
		}
		cp := map[string]any{}
		for k, v := range item {
			cp[k] = v
		}
		cp["source"] = origin
		cp["builtin"] = origin == "platform"
		out = append(out, cp)
	}
	return out, nil
}

// workflowTemplateOrigin classifies a template as "platform" or
// "personal" so the list + delete endpoints can apply the right gate.
func workflowTemplateOrigin(item map[string]any) string {
	if b, ok := item["builtin"].(bool); ok && !b {
		return "personal"
	}
	src, _ := item["source"].(string)
	switch strings.ToLower(strings.TrimSpace(src)) {
	case "personal", "user", "workspace":
		return "personal"
	case "platform":
		return "platform"
	}
	id, _ := item["id"].(string)
	if strings.HasPrefix(id, "wft-user-") || strings.HasPrefix(id, "personal.") || strings.HasPrefix(id, "user.") {
		return "personal"
	}
	if b, ok := item["builtin"].(bool); ok && b {
		return "platform"
	}
	if strings.HasPrefix(id, "wf.") {
		return "platform"
	}
	return "platform"
}

// createWorkflowTemplate → POST /api/workflow-templates
// Requires workflow.write. Persists a personal template derived from the
// current canvas; refuses empty canvas + the platform id prefix.
func (s *Service) createWorkflowTemplate(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if !auth.Has(id, "workflow.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权创建流程模板")
	}
	body, err := s.Deps.DecodeMap(r)
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, "请求体无效")
	}
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "模板名称不能为空")
	}
	ws := s.Deps.WorkspaceID(r)
	now := time.Now().UTC().Format(time.RFC3339)
	tplID := str(body["id"])
	if tplID == "" {
		tplID = s.Store.ID("wft-user")
	}
	if strings.HasPrefix(tplID, "wf.") {
		return nil, apperr.BadReq(apperr.BadRequest, "个人模板不可使用平台内置 ID 前缀")
	}

	dept := strings.TrimSpace(str(body["department"]))
	if dept == "" {
		dept = "it"
	}
	seq := body["sequence"]
	graph := body["graph"]
	nodes := body["nodes"]
	if nodes == nil {
		if g, ok := graph.(map[string]any); ok {
			nodes = g["nodes"]
		}
	}
	nodeCount := 0
	switch n := nodes.(type) {
	case []any:
		nodeCount = len(n)
	case []map[string]any:
		nodeCount = len(n)
	}
	if nodeCount == 0 {
		if arr, ok := seq.([]any); ok {
			nodeCount = len(arr)
		}
	}
	if nodeCount == 0 {
		return nil, apperr.BadReq(apperr.BadRequest, "空画布不能保存为个人模板")
	}

	tpl := map[string]any{
		"id":               tplID,
		"name":             name,
		"description":      coalesce(str(body["description"]), "由当前画布另存的个人模板"),
		"version":          coalesce(str(body["version"]), "1.0.0"),
		"category":         coalesce(str(body["category"]), "business"),
		"department":       dept,
		"audience":         coalesce(str(body["audience"]), "本人 / 协作同事"),
		"owner":            coalesce(str(body["owner"]), id.Name),
		"ownerId":          id.ID,
		"workspaceId":      ws,
		"library":          "default",
		"certification":    "preview",
		"builtin":          false,
		"source":           "personal",
		"risk":             coalesce(str(body["risk"]), "L2"),
		"health":           "健康",
		"successRate":      "Personal",
		"installs":         0,
		"rating":           0,
		"nodes":            nodeCount,
		"sequence":         seq,
		"graph":            graph,
		"connectors":       body["connectors"],
		"variables":        body["variables"],
		"permissions":      body["permissions"],
		"dependencies":     body["dependencies"],
		"dependencyStatus": body["dependencyStatus"],
		"blockers":         []any{},
		"industryTags":     body["industryTags"],
		"changelog": []any{
			map[string]any{"version": coalesce(str(body["version"]), "1.0.0"), "date": now[:10], "note": "个人创建"},
		},
		"recentRuns": []any{},
		"verifiedAt": now[:10],
		"createdAt":  now,
		"updatedAt":  now,
	}
	if tpl["connectors"] == nil {
		tpl["connectors"] = []any{}
	}
	if tpl["industryTags"] == nil {
		tpl["industryTags"] = []any{"all"}
	}
	if tpl["variables"] == nil {
		tpl["variables"] = []any{}
	}
	if tpl["permissions"] == nil {
		tpl["permissions"] = []any{}
	}
	if tpl["dependencies"] == nil {
		tpl["dependencies"] = []any{}
	}
	if tpl["dependencyStatus"] == nil {
		tpl["dependencyStatus"] = []any{}
	}

	s.Store.Lock()
	defer s.Store.Unlock()
	for _, existing := range s.Store.WorkflowTpls {
		if str(existing["id"]) == tplID {
			return nil, apperr.Conflict(apperr.BadRequest, "模板 ID 已存在")
		}
	}
	s.Store.WorkflowTpls = append(s.Store.WorkflowTpls, tpl)
	s.Store.AppendAudit(ws, id.Name, "创建个人流程模板", tplID, "success", "")
	s.Deps.AfterWriteLocked("workflow_templates")
	return tpl, nil
}

// deleteWorkflowTemplate → DELETE /api/workflow-templates/{id}
// Requires workflow.write. Refuses to delete platform templates or
// templates owned by another user; durable delete + audit are wired.
func (s *Service) deleteWorkflowTemplate(r *http.Request) (any, error) {
	id := s.identityFrom(r.Context())
	if !auth.Has(id, "workflow.write") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "无权删除流程模板")
	}
	tplID := strings.TrimPrefix(r.URL.Path, "/api/workflow-templates/")
	tplID = strings.Trim(tplID, "/")
	if tplID == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少模板 ID")
	}
	ws := s.Deps.WorkspaceID(r)
	s.Store.Lock()
	idx := -1
	var item map[string]any
	for i, t := range s.Store.WorkflowTpls {
		if str(t["id"]) == tplID {
			idx = i
			item = t
			break
		}
	}
	if idx < 0 {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "模板不存在")
	}
	if workflowTemplateOrigin(item) != "personal" {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.RoleForbidden, "平台内置模板不可删除")
	}
	ownerID, _ := item["ownerId"].(string)
	itemWS, _ := item["workspaceId"].(string)
	if itemWS != "" && itemWS != ws {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "无权删除其他工作区模板")
	}
	if ownerID != "" && ownerID != id.ID && id.Role != "admin" {
		s.Store.Unlock()
		return nil, apperr.Forbidden(apperr.RoleForbidden, "仅可删除本人创建的个人模板")
	}
	s.Store.WorkflowTpls = append(s.Store.WorkflowTpls[:idx], s.Store.WorkflowTpls[idx+1:]...)
	s.Store.AppendAudit(ws, id.Name, "删除个人流程模板", tplID, "success", "")
	s.Store.Unlock()
	s.Deps.DurableDeleteSync("workflow_templates", tplID)
	s.Deps.AfterWrite("workflow_templates")
	return map[string]any{"ok": true, "id": tplID}, nil
}