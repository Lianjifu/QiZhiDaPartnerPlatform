package server

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/runtimeenv"
	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
	"github.com/qizhida-partner-platform/backend/internal/skills/vetter"
	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// General pack — single default job pack「通用」.
var generalPackSkillNames = []string{
	"weather", "summarize", "github", "docx", "pdf", "pptx",
	"frontend-design", "web-design-guidelines", "diagram-maker", "gog",
	"general-logic-thinking-assistant",
	"general-problem-solving-analysis-assistant",
	"general-creative-decision-assistant",
}

var tierDOptInSkillNames = []string{"browser-use", "1password"}

var generalPackPlatformTools = []string{
	"knowledge.retrieve", "memory.recall", "skill.read", "time.now",
}

var generalPackRuntimeTools = []string{
	"read_file", "glob", "grep", "bash",
}

type builtinManifest struct {
	PackID            string                    `json:"packId"`
	PackName          string                    `json:"packName"`
	Version           string                    `json:"version"`
	GeneralPackSkills []string                  `json:"generalPackSkills"`
	TierDOptIn        []string                  `json:"tierDOptIn"`
	// PR2:临时剔除某个 builtin skill(例如 Node.js 脚本的 pptx/spreadsheets
	// 在 sandbox 解释器白名单收缩到 .py/.sh 后无法执行)。DisabledSkills
	// 里的名字会从 GeneralPackSkills / packs.*.skills 中过滤掉,且 EnsureBuiltinSkillsReady
	// 不会 seed 这些 skill。等替代实现到位后,从 manifest 移除并重新签发。
	DisabledSkills []string                  `json:"disabledSkills,omitempty"`
	DisabledReason string                    `json:"disabledReason,omitempty"`
	Packs             map[string]skillPackDef   `json:"packs"`
	SkillMeta         map[string]map[string]any `json:"skillMeta"`
	PlatformTools     []map[string]any          `json:"platformTools"`
	RuntimeTools      []map[string]any          `json:"runtimeTools"`
	// W1-D2 · 发布者公钥指纹 → TrustedKey 记录。signing.DevKeyStore 会把
	// 自动生成的 keypair 自动挂进来；prod 用 LoadTrustFile 加载静态信任锚。
	Signers map[string]signing.TrustedKey `json:"signers,omitempty"`
	// W1-D2 · builtin name → per-skill signature block。
	SkillSignatures map[string]builtinSkillSignature `json:"skillSignatures,omitempty"`
}

// builtinSkillSignature 是 builtin/skills/manifest.json 中每个 skill 的签名条目。
type builtinSkillSignature struct {
	KeyID      string `json:"keyId"`
	Signature  string `json:"signature"`  // base64 of 64-byte Ed25519 signature
	SignedAt   string `json:"signedAt"`   // ISO8601 UTC
	SignerName string `json:"signerName"`
}

func builtinSkillsRoot() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_BUILTIN_SKILLS_DIR")); v != "" {
		return v
	}
	candidates := []string{
		filepath.Join("backend", "builtin", "skills"),
		filepath.Join("..", "backend", "builtin", "skills"),
		filepath.Join("builtin", "skills"),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return filepath.Join("backend", "builtin", "skills")
}

func loadBuiltinManifest() builtinManifest {
	root := builtinSkillsRoot()
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return builtinManifest{
			PackID: "general", PackName: "通用", Version: "1.0.0",
			GeneralPackSkills: generalPackSkillNames,
			TierDOptIn:        tierDOptInSkillNames,
			PlatformTools:     platformToolsRegistryFallback(),
			RuntimeTools:      runtimeToolsRegistryFallback(),
		}
	}
	var m builtinManifest
	if json.Unmarshal(raw, &m) != nil {
		m = builtinManifest{PackID: "general", PackName: "通用", Version: "1.0.0"}
	}
	if len(m.GeneralPackSkills) == 0 {
		m.GeneralPackSkills = generalPackSkillNames
	}
	if len(m.PlatformTools) == 0 {
		m.PlatformTools = platformToolsRegistryFallback()
	}
	if len(m.RuntimeTools) == 0 {
		m.RuntimeTools = runtimeToolsRegistryFallback()
	}
	// PR2:应用 manifest.disabledSkills 过滤 — 临时剔除的 skill
	// (例如 Node.js 脚本的 pptx/spreadsheets)不在 catalog 出现,也不进
	// 任何 workspace 的 installed skills。等替代实现到位后,从 manifest 移除。
	if len(m.DisabledSkills) > 0 {
		m.GeneralPackSkills = filterOut(m.GeneralPackSkills, m.DisabledSkills)
		m.TierDOptIn = filterOut(m.TierDOptIn, m.DisabledSkills)
		for packID, def := range m.Packs {
			def.Skills = filterOut(def.Skills, m.DisabledSkills)
			m.Packs[packID] = def
		}
	}
	return m
}

// filterOut 返回 haystack 中不在 needles 里的元素(顺序保留)。
func filterOut(haystack, needles []string) []string {
	if len(needles) == 0 {
		return haystack
	}
	skip := make(map[string]struct{}, len(needles))
	for _, n := range needles {
		skip[n] = struct{}{}
	}
	out := make([]string, 0, len(haystack))
	for _, h := range haystack {
		if _, drop := skip[h]; drop {
			continue
		}
		out = append(out, h)
	}
	return out
}

// removeCatalogItem 按 builtinSkillName 字段移除 catalog 条目(PR2 disabled rollback)。
// 不做深度比较:同一 builtinSkillName 至多 1 个 catalog 条目;用 builtinSkillName
// 单值过滤就够。
func removeCatalogItem(slice []map[string]any, builtinName string) []map[string]any {
	out := make([]map[string]any, 0, len(slice))
	for _, item := range slice {
		if str(item["builtinSkillName"]) == builtinName {
			continue
		}
		out = append(out, item)
	}
	return out
}

func runtimeToolsRegistryFallback() []map[string]any {
	return []map[string]any{
		{"name": "read_file", "kind": "runtime", "mode": copilot.ToolModeExecute, "description": "读取技能包内文件", "executor": "skill.open", "removable": false},
		{"name": "glob", "kind": "runtime", "mode": copilot.ToolModeExecute, "description": "列出技能包文件", "executor": "skill.open", "removable": false},
		{"name": "grep", "kind": "runtime", "mode": copilot.ToolModeExecute, "description": "搜索技能包内容", "executor": "skill.open", "removable": false},
		{"name": "bash", "kind": "runtime", "mode": copilot.ToolModeApproval, "description": "沙箱命令执行", "executor": "skill.run", "removable": false},
		{"name": "write_file", "kind": "runtime", "phase": "P1", "mode": copilot.ToolModeApproval, "description": "写入 .copilot-ws", "executor": "skill.write", "removable": false},
		{"name": "edit_file", "kind": "runtime", "phase": "P1", "mode": copilot.ToolModeApproval, "description": "Patch 编辑", "executor": "patch", "removable": false},
		{"name": "web_search", "kind": "runtime", "phase": "P1", "mode": copilot.ToolModeExecute, "description": "Web 搜索", "executor": "http", "availability": "opt_in", "removable": false},
		{"name": "web_fetch", "kind": "runtime", "phase": "P2", "mode": copilot.ToolModeExecute, "description": "HTTP GET", "executor": "http", "availability": "opt_in", "removable": false},
	}
}

func platformToolsRegistryFallback() []map[string]any {
	return []map[string]any{
		{"name": "knowledge.retrieve", "kind": "platform", "mode": copilot.ToolModeExecute, "description": "检索已发布知识库", "harness": "go", "removable": false},
		{"name": "memory.recall", "kind": "platform", "mode": copilot.ToolModeExecute, "description": "跨会话记忆检索", "harness": "go", "removable": false},
		{"name": "skill.read", "kind": "platform", "mode": copilot.ToolModeExecute, "description": "加载 SKILL.md 全文", "harness": "go", "removable": false},
		{"name": "time.now", "kind": "platform", "mode": copilot.ToolModeExecute, "description": "当前时间（ISO8601）", "harness": "go", "removable": false},
	}
}

func runtimeToolsRegistryItems() []map[string]any {
	m := loadBuiltinManifest()
	if len(m.RuntimeTools) > 0 {
		return m.RuntimeTools
	}
	return runtimeToolsRegistryFallback()
}

func platformToolsRegistryItems() []map[string]any {
	m := loadBuiltinManifest()
	if len(m.PlatformTools) > 0 {
		return m.PlatformTools
	}
	return platformToolsRegistryFallback()
}

func listBuiltinSkillDirNames() []string {
	root := builtinSkillsRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() || e.Name() == "." || e.Name() == ".." {
			continue
		}
		if _, err := os.Stat(filepath.Join(root, e.Name(), "SKILL.md")); err != nil {
			continue
		}
		out = append(out, e.Name())
	}
	return out
}

func loadBuiltinSkillPackage(skillName string) (*skillPackageManifest, map[string][]byte, error) {
	root := filepath.Join(builtinSkillsRoot(), skillName)
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		return nil, nil, fmt.Errorf("内置技能目录不存在: %s", skillName)
	}
	files := map[string][]byte{}
	prefix := skillName + "/"
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if shouldSkipSkillPackagePath(rel) {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files[prefix+rel] = b
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	if len(files) == 0 {
		return nil, nil, fmt.Errorf("内置技能包为空: %s", skillName)
	}
	rootDir, skillRel, mdBytes, err := locateSkillMarkdown(files)
	if err != nil {
		return nil, nil, err
	}
	meta, body, err := parseSkillFrontmatter(string(mdBytes))
	if err != nil {
		return nil, nil, err
	}
	if meta.Name == "" {
		meta.Name = skillName
	}
	if meta.Description == "" {
		return nil, nil, fmt.Errorf("SKILL.md 缺少 description: %s", skillName)
	}
	meta.Markdown = body
	meta.RootDir = rootDir
	meta.SkillMDRel = skillRel
	if meta.Version == "" {
		meta.Version = "1.0.0"
	}
	if meta.RiskLevel == "" {
		meta.RiskLevel = builtinSkillRiskLevel(skillName)
	}
	relFiles := make([]string, 0, len(files))
	scripts := make([]string, 0)
	for path := range files {
		rel := path
		if rootDir != "" && rootDir != "." {
			if !strings.HasPrefix(path, rootDir+"/") && path != rootDir {
				continue
			}
			rel = strings.TrimPrefix(path, rootDir+"/")
		}
		if rel == "" || shouldSkipSkillPackagePath(rel) {
			continue
		}
		relFiles = append(relFiles, rel)
		if isSkillScriptPath(rel) {
			scripts = append(scripts, rel)
		}
	}
	meta.Files = relFiles
	meta.Scripts = scripts
	meta.HasScripts = len(scripts) > 0
	return &meta, files, nil
}

func builtinSkillRiskLevel(name string) string {
	low := strings.ToLower(name)
	for _, d := range tierDOptInSkillNames {
		if low == d {
			return "high"
		}
	}
	if strings.Contains(low, "shell") || strings.Contains(low, "browser") {
		return "high"
	}
	if low == "docx" || low == "pptx" || low == "pdf" {
		return "low"
	}
	return "low"
}

func builtinSkillTier(name string, manifest builtinManifest) string {
	for _, n := range manifest.GeneralPackSkills {
		if n == name {
			return "A"
		}
	}
	for _, n := range manifest.TierDOptIn {
		if n == name {
			return "D"
		}
	}
	switch name {
	case "docx", "pdf", "pptx", "spreadsheets":
		return "B"
	case "skill-creator", "pilotdeck-skills-migration":
		return "C"
	case "frontend-design", "web-design-guidelines", "diagram-maker", "karpathy-guidelines", "react-next-best-practices":
		return "E"
	default:
		return "A"
	}
}

func (s *Server) attachBuiltinPackageToSkill(item map[string]any, ws, skillID, builtinName string) error {
	meta, files, err := loadBuiltinSkillPackage(builtinName)
	if err != nil {
		return err
	}

	// W1-D1 · Skill Vetter. Run static analysis on the package bytes before
	// materializing them onto disk. mode=enabled (default) blocks SevBlock
	// findings; warn_only logs but admits; disabled skips entirely.
	if mode := vetterMode(); mode != "disabled" {
		report := vetter.RunBytes(files)
		switch mode {
		case "warn_only":
			if report.Decision != vetter.Allow {
				summary := vetterSummary(builtinName, report)
				log.Printf("skill vetter warn_only: builtin=%s verdict=%s findings=%d", builtinName, report.Verdict, len(report.Findings))
				for _, f := range report.Findings {
					log.Printf("  skill vetter finding: builtin=%s %s %s @%s:%d %s", builtinName, f.Category, f.Pattern, f.File, f.Line, f.Snippet)
				}
				s.Store.AppendAudit(ws, "系统", "skill 内容审查", builtinName, "warn", summary)
			}
		default: // "enabled"
			if report.Decision == vetter.Deny {
				summary := vetterSummary(builtinName, report)
				s.Store.AppendAudit(ws, "系统", "skill 内容审查", builtinName, "denied", summary)
				return apperr.BadReq(apperr.SkillVetDenied,
					"builtin skill blocked by vetter: "+summary)
			}
		}
	}

	// W1-D2 · Ed25519 发布者签名 verify。先 vetter 再 signer，避免给
	// 攻击者透露未签名 manifest 内容。env 关闭后整段跳过。
	if err := s.verifyBuiltinSignature(builtinName, meta, files); err != nil {
		// W1-D3 · audit. Signature rejections are the highest-signal
		// security observation in the skill install pipeline — log them
		// even when the request is allowed to bubble up as an error.
		s.Store.AppendAudit(ws, "系统", "skill 签名验证",
			builtinName, "denied", err.Error())
		return err
	}

	dest, err := s.materializeSkillPackage(ws, skillID, meta.RootDir, files)
	if err != nil {
		return err
	}
	item["packagePath"] = dest
	item["packageRoot"] = meta.RootDir
	item["skillMdPath"] = meta.SkillMDRel
	item["hasScripts"] = meta.HasScripts
	item["scripts"] = meta.Scripts
	item["packageFiles"] = meta.Files
	item["packageSha256"] = meta.SHA256
	item["packageSizeBytes"] = meta.SizeBytes
	item["builtinSkillName"] = builtinName
	if len(meta.Entrypoints) > 0 {
		item["entrypoints"] = meta.Entrypoints
	} else if len(meta.Scripts) > 0 {
		item["entrypoints"] = meta.Scripts
	}
	if meta.ReadOnly != nil {
		item["readOnly"] = *meta.ReadOnly
	}
	if meta.ProducesArtifacts != nil {
		item["producesArtifacts"] = *meta.ProducesArtifacts
	}
	enrichSkillMetadata(item)
	return nil
}

// vetterMode reads QZDA_SANDBOX_VETTER. Default is "enabled". Values:
//   - "enabled"   (default) — block SevBlock findings
//   - "warn_only"           — log findings but allow the package through
//   - "disabled"            — skip the vetter entirely
func vetterMode() string {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_SANDBOX_VETTER"))) {
	case "disabled", "off", "false", "0":
		return "disabled"
	case "warn", "warn_only":
		return "warn_only"
	default:
		return "enabled"
	}
}

// vetterSummary renders a compact human-readable one-line summary used in
// SkillVetDenied error messages. Kept short so it fits in the audit log
// without truncation.
func vetterSummary(builtinName string, r vetter.Result) string {
	parts := make([]string, 0, 3+len(r.Findings))
	parts = append(parts, "builtin="+builtinName, "verdict="+r.Verdict, "findings="+fmt.Sprintf("%d", len(r.Findings)))
	for i, f := range r.Findings {
		if i >= 3 {
			parts = append(parts, "…")
			break
		}
		parts = append(parts, string(f.Category)+":"+f.Pattern+"@"+f.File+":"+fmt.Sprintf("%d", f.Line))
	}
	return strings.Join(parts, " ")
}

// skillSignatureRequired reads QZDA_REQUIRE_SKILL_SIGNATURE. Default = required
// (true). Values that turn it off: "disabled", "off", "warn_only", "warn".
//
// W2-D1: thin wrapper over skillSignaturePolicy() (defined in
// skill_signature_policy.go) so existing call sites and tests keep working.
func skillSignatureRequired() bool {
	return skillSignaturePolicy() != PolicyOff
}

// verifyBuiltinSignature verifies that the builtin package bytes were signed
// by a publisher listed in builtinManifest.Signers. Returns nil when signing
// is disabled (env) or the package has no signature record (legacy build),
// since then vetter alone is the gate. Returns SkillSignatureInvalid / _Missing /
// _UnknownKey otherwise.
//
// Order of checks:
//  1. Env gate (skillSignatureRequired). Disabled → return nil.
//  2. Pull builtinSkillSignature from pack-level manifest. Missing →
//     SkillSignatureMissing.
//  3. Lookup TrustedKey by KeyID in manifest.Signers. Unknown →
//     SkillSignatureUnknownKey.
//  4. Decode signature base64 → run ed25519.Verify over canonical manifest
//     bytes. Mismatch → SkillSignatureInvalid.
func (s *Server) verifyBuiltinSignature(builtinName string, meta *skillPackageManifest, files map[string][]byte) error {
	if !skillSignatureRequired() {
		return nil
	}
	pack := loadBuiltinManifest()
	packSig, ok := pack.SkillSignatures[builtinName]
	if !ok || packSig.Signature == "" {
		return apperr.BadReq(apperr.SkillSignatureMissing,
			"builtin skill missing signature: "+builtinName)
	}
	signerRec, ok := pack.Signers[packSig.KeyID]
	if !ok {
		return apperr.New(apperr.SkillSignatureUnknownKey, 400,
			"unknown publisher keyID "+packSig.KeyID+" for builtin "+builtinName)
	}
	pub, err := base64.StdEncoding.DecodeString(signerRec.PublicKey)
	if err != nil {
		return apperr.BadReq(apperr.SkillSignatureUnknownKey,
			"malformed publisher public key: "+err.Error())
	}
	if len(pub) != ed25519.PublicKeySize {
		return apperr.BadReq(apperr.SkillSignatureUnknownKey,
			"invalid publisher public key size for "+packSig.KeyID)
	}
	sigBytes, err := base64.StdEncoding.DecodeString(packSig.Signature)
	if err != nil {
		return apperr.BadReq(apperr.SkillSignatureInvalid,
			"malformed signature base64: "+err.Error())
	}
	if err := signing.VerifyManifest(pub, sigBytes, signing.DigestInputs{
		Meta: meta, Files: files,
	}); err != nil {
		return apperr.BadReq(apperr.SkillSignatureInvalid,
			"builtin "+builtinName+" signature mismatch: "+err.Error())
	}
	return nil
}

// Mode is referenced here so the package compiles when runtimeenv helpers
// are unused outside this file. The variable binding is never read but the
// import is required by the verifier bootstrap path on cold start.
var _ = runtimeenv.FromEnv

func catalogBuiltinName(cat map[string]any) string {
	if bn := strings.TrimSpace(str(cat["builtinSkillName"])); bn != "" {
		return bn
	}
	name := strings.TrimSpace(str(cat["name"]))
	if name == "" {
		return ""
	}
	slug := strings.ToLower(strings.ReplaceAll(name, " ", "-"))
	if _, err := os.Stat(filepath.Join(builtinSkillsRoot(), slug, "SKILL.md")); err == nil {
		return slug
	}
	if _, err := os.Stat(filepath.Join(builtinSkillsRoot(), name, "SKILL.md")); err == nil {
		return name
	}
	return ""
}

var deprecatedSkillCatalogIDs = map[string]struct{}{
	"sc-1": {}, "sc-2": {},
}

var deprecatedInstalledSkillIDs = map[string]struct{}{
	"sk-1": {}, "sk-2": {}, "tool-cmdb": {},
}

var deprecatedSkillNames = map[string]struct{}{
	"mysql-cli": {}, "日志检索": {}, "kubectl 只读": {}, "loki-query": {}, "cmdb 查询": {},
}

func isDeprecatedSkillName(name string) bool {
	n := strings.TrimSpace(name)
	if n == "" {
		return false
	}
	if _, ok := deprecatedSkillNames[strings.ToLower(n)]; ok {
		return true
	}
	_, ok := deprecatedSkillNames[n]
	return ok
}

func isDeprecatedCatalogItem(item map[string]any) bool {
	if _, ok := deprecatedSkillCatalogIDs[str(item["id"])]; ok {
		return true
	}
	return isDeprecatedSkillName(str(item["name"]))
}

func (s *Server) pruneDeprecatedSeedSkillsLocked() (removedCatalog, removedInstalled, removedHealth []string) {
	keptCatalog := make([]map[string]any, 0, len(s.Store.SkillCatalog))
	for _, item := range s.Store.SkillCatalog {
		if isDeprecatedCatalogItem(item) {
			removedCatalog = append(removedCatalog, str(item["id"]))
			continue
		}
		keptCatalog = append(keptCatalog, item)
	}
	s.Store.SkillCatalog = keptCatalog

	removedSet := map[string]struct{}{}
	keptSkills := make([]map[string]any, 0, len(s.Store.Skills))
	for _, sk := range s.Store.Skills {
		id := str(sk["id"])
		if _, ok := deprecatedInstalledSkillIDs[id]; ok || isDeprecatedSkillName(str(sk["name"])) {
			removedInstalled = append(removedInstalled, id)
			removedSet[id] = struct{}{}
			continue
		}
		keptSkills = append(keptSkills, sk)
	}
	s.Store.Skills = keptSkills

	keptHealth := make([]map[string]any, 0, len(s.Store.SkillHealth))
	for _, h := range s.Store.SkillHealth {
		if _, ok := removedSet[str(h["skillId"])]; ok {
			if hid := str(h["id"]); hid != "" {
				removedHealth = append(removedHealth, hid)
			}
			continue
		}
		keptHealth = append(keptHealth, h)
	}
	s.Store.SkillHealth = keptHealth

	if extra := s.Store.SkillExtra; extra != nil {
		raw, _ := extra["bindings"].([]any)
		if len(raw) > 0 {
			kept := make([]any, 0, len(raw))
			for _, b := range raw {
				m, _ := b.(map[string]any)
				if m == nil {
					continue
				}
				if _, ok := removedSet[str(m["capabilityId"])]; ok {
					continue
				}
				kept = append(kept, m)
			}
			extra["bindings"] = kept
		}
	}
	return removedCatalog, removedInstalled, removedHealth
}

func builtinSkillInstallID(skillName string) string {
	return "sk-builtin-" + strings.ToLower(strings.TrimSpace(skillName))
}

// normalizeInstalledSkillsLocked assigns stable IDs to builtin installs and drops duplicate rows.
// Returns orphan skill ids that should be PersistDeleted (duplicate rows or pre-normalize ids).
func (s *Server) normalizeInstalledSkillsLocked() (removedSkillIDs []string) {
	seenBuiltin := map[string]map[string]any{}
	out := make([]map[string]any, 0, len(s.Store.Skills))
	beforeIDs := map[string]struct{}{}
	for _, sk := range s.Store.Skills {
		if id := str(sk["id"]); id != "" {
			beforeIDs[id] = struct{}{}
		}
		item := sk
		ws := str(sk["workspaceId"])
		bn := strings.TrimSpace(str(sk["builtinSkillName"]))
		if bn != "" {
			bkey := ws + "|" + strings.ToLower(bn)
			if _, dup := seenBuiltin[bkey]; dup {
				continue
			}
			item["id"] = builtinSkillInstallID(bn)
			seenBuiltin[bkey] = item
		}
		out = append(out, item)
	}
	s.Store.Skills = store.DedupeMapsByID(out)
	afterIDs := map[string]struct{}{}
	for _, sk := range s.Store.Skills {
		if id := str(sk["id"]); id != "" {
			afterIDs[id] = struct{}{}
		}
	}
	for id := range beforeIDs {
		if _, ok := afterIDs[id]; !ok {
			removedSkillIDs = append(removedSkillIDs, id)
		}
	}
	return removedSkillIDs
}

// EnsureBuiltinSkillsReady seeds catalog, installs general pack to every workspace, binds de-general.
func (s *Server) EnsureBuiltinSkillsReady() {
	manifest := loadBuiltinManifest()
	s.Store.Lock()
	removedCatalog, removedInstalled, removedHealth := s.pruneDeprecatedSeedSkillsLocked()
	removedNormalized := s.normalizeInstalledSkillsLocked()
	s.ensureBuiltinCatalogLocked(manifest)
	workspaces := map[string]struct{}{"w1": {}}
	for _, w := range s.Store.Workspaces {
		if id := str(w["id"]); id != "" {
			workspaces[id] = struct{}{}
		}
	}
	for _, sk := range s.Store.Skills {
		if id := str(sk["workspaceId"]); id != "" {
			workspaces[id] = struct{}{}
		}
	}
	for ws := range workspaces {
		s.ensureGeneralPackInstalledLocked(ws, manifest)
		for packID, def := range manifest.normalizePacks() {
			if !def.AutoInstall || packID == "general" {
				continue
			}
			s.ensurePackInstalledLocked(ws, packID, manifest)
		}
	}
	s.Store.Unlock()
	s.ensureAllEmployeesCognitiveSkills()
	if len(removedCatalog) > 0 {
		s.Store.PersistDelete("skill_catalog", removedCatalog...)
	}
	if len(removedInstalled) > 0 {
		s.Store.PersistDelete("skills", removedInstalled...)
	}
	if len(removedNormalized) > 0 {
		s.Store.PersistDelete("skills", removedNormalized...)
	}
	if len(removedHealth) > 0 {
		s.Store.PersistDelete("skill_health", removedHealth...)
	}
	go s.persistSkills()
}

// ensureAllEmployeesCognitiveSkills merges base cognitive skills into every employee.
func (s *Server) ensureAllEmployeesCognitiveSkills() {
	s.Store.Lock()
	defer s.Store.Unlock()
	changed := false
	for _, emp := range s.Store.Employees {
		before := ""
		if caps, _ := emp["capabilities"].(map[string]any); caps != nil {
			before = fmt.Sprintf("%v", caps["skills"])
		}
		copilot.EnsureEmployeeCognitiveSkills(emp)
		after := ""
		if caps, _ := emp["capabilities"].(map[string]any); caps != nil {
			after = fmt.Sprintf("%v", caps["skills"])
		}
		if before != after {
			changed = true
		}
	}
	if changed {
		go s.Store.Persist("employees")
	}
}

func (s *Server) ensureBuiltinCatalogLocked(manifest builtinManifest) {
	existing := map[string]map[string]any{}
	for _, c := range s.Store.SkillCatalog {
		key := strings.ToLower(str(c["name"]))
		if key == "" {
			key = str(c["id"])
		}
		existing[key] = c
	}
	// PR2:disabled skills 不出现在 catalog(已禁用,不向 workspace
	// 暴露,即使它们仍在 builtin/skills/ 目录里)。
	disabled := make(map[string]struct{}, len(manifest.DisabledSkills))
	for _, d := range manifest.DisabledSkills {
		disabled[d] = struct{}{}
	}
	for _, dirName := range listBuiltinSkillDirNames() {
		if _, drop := disabled[dirName]; drop {
			// 把之前 seed 的 catalog 项移除(防止 reload 后残留旧条目)
			s.Store.SkillCatalog = removeCatalogItem(s.Store.SkillCatalog, dirName)
			continue
		}
		meta, _, err := loadBuiltinSkillPackage(dirName)
		if err != nil {
			continue
		}
		key := strings.ToLower(meta.Name)
		tier := builtinSkillTier(dirName, manifest)
		inGeneral := false
		for _, g := range manifest.GeneralPackSkills {
			if g == dirName || g == meta.Name {
				inGeneral = true
				break
			}
		}
		packIds := skillInAnyPack(manifest, dirName)
		catID := "sc-builtin-" + dirName
		dep := skillDependencyReport(dirName)
		entry := map[string]any{
			"id": catID, "workspaceId": "w1", "name": meta.Name, "kind": "skill",
			"version": coalesce(meta.Version, "1.0.0"),
			"description": meta.Description, "status": "available",
			"rating": 4.5, "installCount": 0, "riskLevel": meta.RiskLevel,
			"cacheable": tier == "E", "publisher": "企业能力商店 · 平台内置",
			"signed": true, "dependencies": []string{}, "license": coalesce(meta.License, "内部许可"),
			"lastScannedAt": "平台同步", "vulnerabilityCount": 0,
			"supportedEnvironments": []string{"测试", "生产"},
			"environment": "production", "classification": "internal",
			"channel": "builtin", "syncedAt": "平台同步",
			"visibilityScope": "global", "releaseChannel": "stable",
			"builtinSkillName": dirName, "tier": tier,
			"defaultPack": inGeneral, "defaultPackId": manifest.PackID,
			"packIds": packIds, "hasScripts": meta.HasScripts,
			"cognitive": copilot.IsCognitiveSkillName(dirName),
			"producesArtifacts": meta.HasScripts,
			"availability": dep["availability"], "externalBins": dep["externalBins"],
		}
		if old, ok := existing[key]; ok {
			for k, v := range entry {
				old[k] = v
			}
			continue
		}
		s.Store.SkillCatalog = append(s.Store.SkillCatalog, entry)
	}
}

func (s *Server) ensureGeneralPackInstalledLocked(ws string, manifest builtinManifest) {
	s.ensurePackInstalledLocked(ws, "general", manifest)
}

func (s *Server) ensureOneBuiltinInstalledLocked(ws, skillName string, manifest builtinManifest, packID string) {
	if s.Store.SkillSuppressedUnlocked(ws, skillName) {
		return
	}
	meta, _, err := loadBuiltinSkillPackage(skillName)
	if err != nil {
		return
	}
	for _, sk := range s.Store.Skills {
		if str(sk["workspaceId"]) != ws {
			continue
		}
		canonID := builtinSkillInstallID(skillName)
		if str(sk["id"]) == canonID || str(sk["builtinSkillName"]) == skillName || strings.EqualFold(str(sk["name"]), meta.Name) {
			// Rematerialize when package missing or builtin content changed (sha mismatch).
			needPkg := str(sk["packagePath"]) == "" || str(sk["packageSha256"]) != meta.SHA256
			if needPkg {
				_ = s.attachBuiltinPackageToSkill(sk, ws, str(sk["id"]), skillName)
			}
			sk["lifecycleStatus"] = "enabled"
			sk["status"] = "installed"
			sk["source"] = "builtin"
			sk["defaultPack"] = packID == "general" || str(sk["defaultPackId"]) == "general"
			sk["defaultPackId"] = coalesce(packID, str(sk["defaultPackId"]))
			if packID != "" {
				pids := decodeStringSlice(sk["packIds"])
				found := false
				for _, p := range pids {
					if p == packID {
						found = true
						break
					}
				}
				if !found {
					sk["packIds"] = append(pids, packID)
				}
			}
			return
		}
	}
	skillID := builtinSkillInstallID(skillName)
	for _, sk := range s.Store.Skills {
		if str(sk["id"]) == skillID && str(sk["workspaceId"]) != ws {
			skillID = s.Store.ID("sk")
			break
		}
	}
	inGeneral := packID == "" || packID == "general"
	item := map[string]any{
		"id": skillID, "workspaceId": ws, "ownerId": "u1", "owner": "平台管理员", "team": "岗位包·" + packID,
		"name": meta.Name, "kind": "skill", "description": meta.Description,
		"version": coalesce(meta.Version, "1.0.0"), "status": "installed",
		"rating": 4.5, "installCount": 0, "riskLevel": meta.RiskLevel,
		"cacheable": true, "lifecycleStatus": "enabled", "source": "builtin",
		"environment": "production", "classification": "internal", "lastVerifiedAt": "刚刚",
		"catalogId": "sc-builtin-" + skillName, "catalogChannel": "builtin",
		"releaseChannel": "stable", "builtinSkillName": skillName,
		"defaultPack": inGeneral, "defaultPackId": coalesce(packID, manifest.PackID),
		"packIds": []string{packID}, "tier": builtinSkillTier(skillName, manifest),
	}
	_ = s.attachBuiltinPackageToSkill(item, ws, skillID, skillName)
	s.Store.Skills = append([]map[string]any{item}, s.Store.Skills...)
	s.ensureSkillHealthLocked(item)
}

func (s *Server) platformToolsRegistry(_ *http.Request) (any, error) {
	manifest := loadBuiltinManifest()
	return map[string]any{
		"packId": manifest.PackID, "packName": manifest.PackName,
		"platformTools": manifest.PlatformTools,
		"runtimeTools":  manifest.RuntimeTools,
		"pilotdeckTools": pilotdeckToolsForAPI(),
		"alignmentScore": alignmentScore(),
	}, nil
}

func (s *Server) applyGeneralPack(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	ws := s.workspaceID(r)
	manifest := loadBuiltinManifest()
	s.Store.Lock()
	s.ensureBuiltinCatalogLocked(manifest)
	s.ensureGeneralPackInstalledLocked(ws, manifest)
	s.Store.Unlock()
	s.persistSkills()
	return map[string]any{
		"packId": manifest.PackID, "packName": manifest.PackName,
		"skills": manifest.GeneralPackSkills, "workspaceId": ws,
		"installed": len(manifest.GeneralPackSkills),
	}, nil
}

func catalogPlatformTools() []map[string]any {
	out := make([]map[string]any, 0, len(platformToolsRegistryItems()))
	for _, t := range platformToolsRegistryItems() {
		out = append(out, map[string]any{
			"id": "pt-" + str(t["name"]), "name": t["name"],
			"meta": fmt.Sprintf("平台工具 · %s", str(t["description"])),
			"kind": "platform", "mode": t["mode"], "removable": false, "builtin": true, "autoBind": true,
		})
	}
	return out
}

func catalogRuntimeTools(_ []string) []map[string]any {
	out := make([]map[string]any, 0)
	for _, t := range runtimeToolsRegistryItems() {
		name := str(t["name"])
		out = append(out, map[string]any{
			"id": "rt-" + name, "name": name,
			"meta": fmt.Sprintf("运行时工具 · %s", str(t["description"])),
			"kind": "runtime", "mode": t["mode"], "executor": t["executor"],
			"availability": coalesce(str(t["availability"]), "default"), "removable": false,
			"builtin": true, "autoBind": coalesce(str(t["availability"]), "default") != "opt_in",
		})
	}
	return out
}
