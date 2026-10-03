// Package knowledge is the M07 知识中心 (Knowledge Center) module — the
// HTTP-route façade that owns knowledge-doc CRUD + retrieve, package
// versioning + publish governance, source connections + sync, processing
// jobs + retry, evaluation runs + retrieval profiles + bindings, graph +
// citation-trace, audit, and the Connect-RPC RagService binding
// (Retrieve + SyncPublished) consumed by the M02 expert-collaboration
// module and external Connect clients.
//
// Prior to M07 P2 all M07 handlers lived in internal/server/ as
// `(s *Server)` receiver methods across handlers_knowledge.go (1926L — the
// backend's largest source file at extraction time), builtin_knowledge.go
// (office builtin knowledge packs + EnsureBuiltinKnowledgeReady), and the
// M07 segment of connect_services.go (ragConnect binding for qzda.rag.v1).
//
// Phase 2 of the M07 知识中心整合方案
// (docs/整合方案/知识中心模块整合方案.md §3.2 + §四 D2-D7) extracts that
// M07 code into internal/knowledge/ with the same function-value façade
// pattern that M02 copilot, M03 tasks, M05 partners, M06 workflows, and
// M08 models use:
//
//   - Service struct holds Store + a Vault-free configuration surface
//     (knowledge doesn't store credentials — the package is purely
//     control-plane metadata + RAG projection).
//   - Deps holds ~12 cross-package Server-only helpers (workspace,
//     identity, decodeMap, evaluateWrite, governance gates, audit sink,
//     usage recorder, afterWrite, persist, durable delete sync, scope
//     guards, production-like env).
//   - NewService(store, deps) constructs the façade.
//   - Route dispatch goes through `s.knowledgeSvc.<Method>(r)` in
//     server.go. Connect-RPC dispatch goes through `knowledge.NewConnect`
//     wrapping the Service in mountConnectRPCForMode.
//
// The cross-module wiring:
//
//   - session_panel.go → internal/knowledge/citation + citationlog via
//     `Deps.CitationFn / CitationlogFn / CitationQuoteFn` callbacks (no
//     more direct citation/citationlog import from the server package).
//
//   - M02 copilot's `knowledge.retrieve` builtin tool is implemented as
//     `Service.RetrieveBuiltin`; server.go wires the method value into
//     `copilot.Deps.RetrieveBuiltinFn` so the tool registry can call
//     back without a cycle (copilot → knowledge, not the reverse).
//
//   - Connect-RPC binding lives in connect.go (mirrors
//     internal/partners/connect.go) — service.go exposes
//     RetrieveConnect + SyncPublishedConnect methods that the ragConnect
//     wrapper translates to qzda.rag.v1.RagService RPC shapes.
//
//   - The EnsureBuiltinKnowledgeReady boot path stays public on
//     `*Server` (apprun/run.go calls it directly) but delegates to
//     `*Service.EnsureBuiltinKnowledgeReady` so the loader lives with
//     the data model.
//
// The package boundary stays one-way: internal/knowledge/ never imports
// internal/server/ (it MAY import internal/copilot for citation
// tier classification, and the existing citation / citationlog / eval /
// scope sub-packages for control-plane helpers).
//
// Citation audit + log: the per-server `*citationlog.Log` and the
// `LogCitation` accessor that handlers_c.go and the test fixtures rely
// on stay attached to the Service so server code (session_panel.go +
// any future chat handler) can record citations via a Deps callback
// (CitationlogFn + CitationQuoteFn) — the legacy `s.citationLog()` /
// `s.LogCitation(...)` methods stay on `*Server` as thin delegators
// over the Service so the existing tests in
// session_panel_p0p2_fix_test.go keep working.
package knowledge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/scope"
	"github.com/qizhida-partner-platform/backend/internal/policy"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// requireKnowledgeRead is the M07 read gate — wraps the existing
// internal/auth.Has check for the "knowledge.read" capability. Kept as a
// package-private helper so every M07 handler can call it directly
// without bouncing through the server package.
func requireKnowledgeRead(id *auth.Identity) error {
	if id == nil || !auth.Has(id, "knowledge.read") {
		return apperr.Forbidden(apperr.KnowledgeReadForbidden, "缺少 knowledge.read")
	}
	return nil
}

// requireKnowledgeWrite is the M07 write gate — analogous to
// requireKnowledgeRead but for the "knowledge.write" capability.
func requireKnowledgeWrite(id *auth.Identity) error {
	if id == nil || !auth.Has(id, "knowledge.write") {
		return apperr.Forbidden(apperr.KnowledgeWriteForbidden, "缺少 knowledge.write")
	}
	return nil
}

// knowledgeSliceMaps coerces a `any` from Store.KnowledgeExtra (which the
// snapshot round-trip types as either []map[string]any or []any) into a
// uniform []map[string]any slice. Used by every list / filter handler
// in handlers_*.go so the same code path works for fresh writes (which
// store []map[string]any directly) and JSON-roundtripped snapshots
// (which decode as []any).
func knowledgeSliceMaps(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, x := range t {
			if m, ok := x.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

// knowledgeSliceAny is the inverse of knowledgeSliceMaps — used by
// scopeDocFromMap which needs to accept either a slice of maps (with
// role id strings) or a slice of strings (legacy seeds).
func knowledgeSliceAny(v any) []any {
	switch x := v.(type) {
	case []any:
		return x
	case []map[string]any:
		out := make([]any, 0, len(x))
		for _, m := range x {
			out = append(out, m)
		}
		return out
	}
	return nil
}

// maxInt / minInt / minFloat — small arithmetic helpers used by the
// chunking math in runKnowledgeJob and the recall scaling in
// retrievePublishedNormalized. Kept package-local so neither handler
// pulls in a utils dependency.
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// truncateRunes caps a string at n runes, appending an ellipsis when it
// overflows. Used by createKnowledgeDoc for the doc snippet field and
// by runKnowledgeJob for the snippet fallback when the blob didn't
// carry an explicit snippet.
func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if n <= 0 || len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

// bumpSemverPatch increments the patch component of a semver-ish
// version string ("1.2.3" → "1.2.4", "v1" → "v1.0.1"). Falls back to
// "<input>.1" when the body isn't a clean numeric semver.
func bumpSemverPatch(version string) string {
	raw := strings.TrimSpace(version)
	if raw == "" {
		return "0.1.1"
	}
	prefix := ""
	body := raw
	if strings.HasPrefix(body, "v") || strings.HasPrefix(body, "V") {
		prefix = body[:1]
		body = body[1:]
	}
	parts := strings.Split(body, ".")
	nums := make([]int, 0, 3)
	ok := true
	for _, p := range parts {
		n := 0
		if _, err := fmt.Sscanf(p, "%d", &n); err != nil {
			ok = false
			break
		}
		nums = append(nums, n)
	}
	if !ok || len(nums) == 0 {
		return prefix + body + ".1"
	}
	for len(nums) < 3 {
		nums = append(nums, 0)
	}
	nums[len(nums)-1]++
	out := make([]string, len(nums))
	for i, n := range nums {
		out[i] = fmt.Sprintf("%d", n)
	}
	return prefix + strings.Join(out, ".")
}

// packageDocumentIDs / syncPackageDocumentCount — the package's
// membership bookkeeping. Reads `documentIds` (possibly roundtripped as
// a []interface{} after JSON) and keeps `documentCount` in sync.
func packageDocumentIDs(pkg map[string]any) []string {
	return stringSlice(pkg["documentIds"])
}

func syncPackageDocumentCount(pkg map[string]any) {
	ids := packageDocumentIDs(pkg)
	pkg["documentIds"] = ids
	pkg["documentCount"] = len(ids)
}

// stringSlice — the same coercion pattern as knowledgeSliceMaps but for
// the simpler []string shape used by request bodies (docIds lists,
// gold-set relevant doc IDs, etc.).
func stringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// scopeDocFromMap projects a KnowledgeDocs row onto the shape
// `internal/knowledge/scope.Source` expects. Used by runKnowledgeEvaluation
// (M07 retrieval gold eval) and the connect_gateway retrieve filter so
// the same ACL logic applies to both.
func scopeDocFromMap(d map[string]any) scope.Source {
	roles := []string{}
	for _, r := range knowledgeSliceMaps(d["roles"]) {
		roles = append(roles, str(r["id"]))
	}
	for _, r := range knowledgeSliceAny(d["roles"]) {
		if s, ok := r.(string); ok && s != "" {
			roles = append(roles, s)
		}
	}
	scopes := []string{}
	for _, s := range knowledgeSliceAny(d["scopes"]) {
		if v, ok := s.(string); ok && v != "" {
			scopes = append(scopes, v)
		}
	}
	tags := []string{}
	for _, t := range knowledgeSliceAny(d["scopeTags"]) {
		if v, ok := t.(string); ok && v != "" {
			tags = append(tags, v)
		}
	}
	return scope.Source{
		ID:        str(d["id"]),
		Workspace: str(d["workspaceId"]),
		Status:    str(d["status"]),
		Scopes:    scopes,
		ScopeTags: tags,
		OwnerID:   str(d["digitalPartnerId"]),
		Roles:     roles,
	}
}

// scopeViewerFromIdentity builds a `scope.Viewer` from an auth identity
// + workspace. Mirrors the legacy *Server.scopeViewerFromIdentity (lived
// in handlers_knowledge.go). Used by runKnowledgeEvaluation and the
// retrieve filter.
func scopeViewerFromIdentity(id *auth.Identity, ws string) scope.Viewer {
	if id == nil {
		return scope.Viewer{WorkspaceID: ws}
	}
	return scope.Viewer{
		IdentityID:  id.Name,
		WorkspaceID: ws,
		Roles:       append([]string{}, id.Permissions...),
	}
}

// knowledgeBlobDir resolves the per-workspace blob directory. Defaults
// to ./data/knowledge-blobs/<ws>; override with DE_KNOWLEDGE_BLOB_DIR.
func (s *Service) knowledgeBlobDir(ws string) string {
	root := os.Getenv("DE_KNOWLEDGE_BLOB_DIR")
	if root == "" {
		root = filepath.Join("data", "knowledge-blobs")
	}
	return filepath.Join(root, ws)
}

// writeKnowledgeBlob writes the markdown / text body of a knowledge doc
// to the per-workspace blob directory and returns the absolute path.
// The legacy server handler keeps the same logic but moves the
// implementation onto the Service so the package boundary stays clean.
func (s *Service) writeKnowledgeBlob(ws, docID, content string) (string, error) {
	dir := s.knowledgeBlobDir(ws)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, docID+".txt")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// readKnowledgeBlob loads a doc body from its blob path. Returns "" when
// the path is empty or the file is gone — the doc detail handler
// silently falls back to the in-memory snippet in that case.
func (s *Service) readKnowledgeBlob(path string) string {
	if path == "" {
		return ""
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

// ensureDraftPackageLocked attaches an upload to a draft package
// (creating one if none exists) so new docs always belong to a delivery
// unit. Caller MUST hold Store.Lock. Returns the package ID.
func (s *Service) ensureDraftPackageLocked(ws, owner string) string {
	pkgs := knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"])
	// Prefer an editable package so uploads do not silently attach to a published delivery unit.
	for _, status := range []string{"draft", "review"} {
		for _, p := range pkgs {
			if str(p["workspaceId"]) == ws && str(p["status"]) == status {
				return str(p["id"])
			}
		}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	ver := map[string]any{
		"id": s.Store.ID("kpv"), "version": "0.1.0", "status": "draft",
		"indexVersion": "idx-0", "qualityScore": 0, "changeSummary": "初始草稿",
	}
	pkg := map[string]any{
		"id": s.Store.ID("pkg"), "workspaceId": ws, "name": "默认知识包",
		"description": "自动创建的工作区知识包", "domain": "通用",
		"classification": "internal", "owner": owner, "ownerId": "",
		"status": "draft", "documentCount": 0, "documentIds": []string{}, "consumers": 0,
		"currentVersion": ver, "versions": []map[string]any{ver},
		"updatedAt": now,
	}
	s.Store.KnowledgeExtra["packages"] = append([]map[string]any{pkg}, pkgs...)
	return str(pkg["id"])
}

// packageExistsLocked — package lookup by id within the workspace
// (workspace match is optional on the store row, treating "" as
// "global seed").
func (s *Service) packageExistsLocked(ws, pkgID string) bool {
	for _, p := range knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"]) {
		if str(p["id"]) == pkgID && (str(p["workspaceId"]) == "" || str(p["workspaceId"]) == ws) {
			return true
		}
	}
	return false
}

// attachDocsToPackageLocked merges doc IDs into the package and stamps
// packageId on docs. When markReview is true and the package was
// published, status becomes review. Returns the number of newly-added
// members. Caller MUST hold Store.Lock.
func (s *Service) attachDocsToPackageLocked(ws, pkgID string, docIDs []string, markReview bool) int {
	pkgs := knowledgeSliceMaps(s.Store.KnowledgeExtra["packages"])
	var pkg map[string]any
	idx := -1
	for i, p := range pkgs {
		if str(p["id"]) == pkgID && (str(p["workspaceId"]) == "" || str(p["workspaceId"]) == ws) {
			pkg = p
			idx = i
			break
		}
	}
	if pkg == nil {
		return 0
	}
	existing := map[string]struct{}{}
	merged := packageDocumentIDs(pkg)
	for _, id := range merged {
		existing[id] = struct{}{}
	}
	added := 0
	want := map[string]struct{}{}
	for _, id := range docIDs {
		if id != "" {
			want[id] = struct{}{}
		}
	}
	for _, d := range s.Store.KnowledgeDocs {
		docID := str(d["id"])
		if _, ok := want[docID]; !ok || str(d["workspaceId"]) != ws {
			continue
		}
		d["packageId"] = pkgID
		if _, seen := existing[docID]; !seen {
			merged = append(merged, docID)
			existing[docID] = struct{}{}
			added++
		}
	}
	pkg["documentIds"] = merged
	syncPackageDocumentCount(pkg)
	pkg["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	if markReview && added > 0 && str(pkg["status"]) == "published" {
		pkg["status"] = "review"
	}
	pkgs[idx] = pkg
	s.Store.KnowledgeExtra["packages"] = pkgs
	return added
}

// persistKnowledgeExtra persists the KnowledgeExtra collection. Thin
// alias kept on the Service so handlers can call `s.persist()` style.
func (s *Service) persistKnowledgeExtra() {
	s.Store.Persist("knowledge_extra")
}

// appendKnowledgeAuditLocked writes one ka_ row to
// Store.KnowledgeExtra["audit"] AND mirrors it through Store.AppendAudit
// so the unified /api/audit log picks it up. Caller MUST hold Store.Lock.
func (s *Service) appendKnowledgeAuditLocked(ws, actor, action, target, result, reason string) {
	evt := map[string]any{
		"id": s.Store.ID("ka"), "workspaceId": ws, "time": time.Now().UTC().Format(time.RFC3339),
		"actor": actor, "action": action, "target": target, "result": result, "reason": reason,
	}
	arr, _ := s.Store.KnowledgeExtra["audit"].([]map[string]any)
	if arr == nil {
		if raw, ok := s.Store.KnowledgeExtra["audit"].([]any); ok {
			for _, x := range raw {
				if m, ok := x.(map[string]any); ok {
					arr = append(arr, m)
				}
			}
		}
	}
	s.Store.KnowledgeExtra["audit"] = append([]map[string]any{evt}, arr...)
	s.Store.AppendAudit(ws, actor, action, target, result, reason)
}

// loadGoldSetLocked reads a custom gold-set (if any) from
// KnowledgeExtra["goldSets"], filtered by workspace + package. Returns
// nil when no gold set matches.
func (s *Service) loadGoldSetLocked(ws, pkgID string) []evalGold {
	type goldShape struct {
		Items []struct {
			Query          string   `json:"query"`
			RelevantDocIDs []string `json:"relevantDocIds"`
		} `json:"items"`
	}
	for _, m := range knowledgeSliceMaps(s.Store.KnowledgeExtra["goldSets"]) {
		if str(m["workspaceId"]) != ws {
			continue
		}
		if pkgID != "" && str(m["packageId"]) != pkgID {
			continue
		}
		js, _ := json.Marshal(m["items"])
		var g goldShape
		if err := json.Unmarshal(js, &g); err != nil {
			continue
		}
		out := make([]evalGold, 0, len(g.Items))
		for _, it := range g.Items {
			if strings.TrimSpace(it.Query) == "" || len(it.RelevantDocIDs) == 0 {
				continue
			}
			out = append(out, evalGold{Query: it.Query, RelevantDocIDs: it.RelevantDocIDs})
		}
		if len(out) > 0 {
			return out
		}
	}
	return nil
}

// intFrom / toFloat — generic coercion helpers, copied
// from the server package's coercion helpers so the knowledge package
// doesn't import internal/server/ for them. Each is local to this file
// to avoid accidental leakage to other modules.
func intFrom(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

func toFloat(v any) float64 {
	f, _ := asFloat(v)
	return f
}

func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// str — generic coercion helper. Local to the package so handlers don't
// bounce through a global stringifier.
func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// identityFromCtx is the package-level alias used by the handler
// entry points (avoids `s.identityFromCtx(r)` boilerplate at every call
// site). Mirrors the legacy server.identityFrom helper signature:
// delegates to auth.IdentityFrom which reads the identity the auth
// middleware stamped onto the request context.
func identityFromCtx(r *http.Request) *auth.Identity {
	if r == nil {
		return nil
	}
	return auth.IdentityFrom(r.Context())
}

// actorIsAdmin — gate helper. Equivalent to the legacy
// server.actorIsAdmin / id.Role == "admin" check used inside the
// delete / publish / process code paths.
func actorIsAdmin(id *auth.Identity) bool {
	return id != nil && id.Role == "admin"
}

// policyInput — convenience builder for policy.Input (used by the
// high-risk-change approval gates around delete / publish).
func policyInput(approverID, submitterID string) policy.Input {
	return policy.Input{ApproverID: approverID, SubmitterID: submitterID}
}

// osRemove is a tiny wrapper over os.Remove so the doc-delete path
// doesn't need to import os at the call site.
func osRemove(path string) error {
	if path == "" {
		return nil
	}
	return os.Remove(path)
}

// removeFile is the public name for the doc-delete blob-cleanup
// helper. Identical to osRemove but used at the call sites to keep the
// intent obvious.
func removeFile(path string) error { return osRemove(path) }

// coalesce returns the first non-empty string in args. Used by every
// handler that reads optional request fields (query / source / docId
// fallbacks).
func coalesce(v ...string) string {
	for _, x := range v {
		if x != "" {
			return x
		}
	}
	return ""
}

// contextBackground is the context-package stand-in used by
// background goroutines (runKnowledgeJob) so we don't have to import
// "context" in every file.
func contextBackground() context.Context { return context.Background() }
