package server

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxSkillPackageBytes     = 10 << 20 // 10 MiB compressed
	maxSkillPackageUnpacked  = 50 << 20 // 50 MiB
	maxSkillPackageFileCount = 200
	skillpkgSignatureFile    = ".skillpkg.signature.json" // W2-D1 · 包内签名 sidecar
)

var (
	reSkillName     = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)
	reFrontmatterKV = regexp.MustCompile(`(?m)^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$`)
)

type skillPackageManifest struct {
	Name              string
	Description       string
	Version           string
	License           string
	RiskLevel         string
	Tags              []string
	Entrypoints       []string
	ReadOnly          *bool
	ProducesArtifacts *bool
	Markdown          string
	RootDir           string
	SkillMDRel        string
	Files             []string
	Scripts           []string
	HasScripts        bool
	SHA256            string
	SizeBytes         int
	// W1-D2 · 发布者 Ed25519 签名（base64 64B）。覆盖 manifest + files
	// canonical JSON，verify 在 attachBuiltinPackageToSkill / importSkillPackage
	// 两个入口强制执行。
	Signature  string    `json:"signature,omitempty"`
	KeyID      string    `json:"keyId,omitempty"`
	SignedAt   time.Time `json:"signedAt,omitempty"`
	SignerName string    `json:"signerName,omitempty"`
}

// GetName / GetVersion / GetSkillMDRel / GetEntrypoints / GetRiskLevel 实现
// signing.SkillMeta，让 server 包不直接 import signing 包的同时签 manifest。
func (m *skillPackageManifest) GetName() string         { return m.Name }
func (m *skillPackageManifest) GetVersion() string      { return m.Version }
func (m *skillPackageManifest) GetSkillMDRel() string   { return m.SkillMDRel }
func (m *skillPackageManifest) GetEntrypoints() []string {
	out := make([]string, len(m.Entrypoints))
	copy(out, m.Entrypoints)
	return out
}
func (m *skillPackageManifest) GetRiskLevel() string { return m.RiskLevel }

func skillPackageAllowedExt(name string) bool {
	n := strings.ToLower(name)
	return strings.HasSuffix(n, ".skill") ||
		strings.HasSuffix(n, ".zip") ||
		strings.HasSuffix(n, ".tgz") ||
		strings.HasSuffix(n, ".tar.gz")
}

func parseSkillPackage(fileName string, raw []byte) (*skillPackageManifest, map[string][]byte, error) {
	if len(raw) == 0 {
		return nil, nil, fmt.Errorf("空文件")
	}
	if len(raw) > maxSkillPackageBytes {
		return nil, nil, fmt.Errorf("技能包不能超过 10 MB")
	}
	if !skillPackageAllowedExt(fileName) {
		return nil, nil, fmt.Errorf("仅支持 .skill / .zip / .tgz / .tar.gz")
	}
	sum := sha256.Sum256(raw)
	files, err := extractSkillArchive(fileName, raw)
	if err != nil {
		return nil, nil, err
	}
	root, skillRel, mdBytes, err := locateSkillMarkdown(files)
	if err != nil {
		return nil, nil, err
	}
	meta, body, err := parseSkillFrontmatter(string(mdBytes))
	if err != nil {
		return nil, nil, err
	}

	// W2-D1 · 读 .skillpkg.signature.json sidecar（如有）。解析失败不阻断 parse，
	// 留给 verifyImportSignature 走 SkillSignatureMissing。sidecar 永不落盘，
	// 仅作 verify 输入；malformed JSON 也兼容（向后兼容既有未签名包）。
	if sigBytes, ok := files[filepath.Join(root, skillpkgSignatureFile)]; ok {
		var sig struct {
			KeyID      string    `json:"keyId"`
			Signature  string    `json:"signature"`
			SignedAt   time.Time `json:"signedAt"`
			SignerName string    `json:"signerName"`
		}
		if err := json.Unmarshal(sigBytes, &sig); err == nil && sig.Signature != "" && sig.KeyID != "" {
			meta.Signature = sig.Signature
			meta.KeyID = sig.KeyID
			meta.SignedAt = sig.SignedAt
			meta.SignerName = sig.SignerName
		}
		// sidecar 自身不能进入 manifest digest —— digest 反映 *content*，
		// 把签名产物算进 digest 会自我引用导致永远验不过。
		delete(files, filepath.Join(root, skillpkgSignatureFile))
	}

	if meta.Name == "" {
		meta.Name = filepath.Base(root)
	}
	if !reSkillName.MatchString(meta.Name) {
		return nil, nil, fmt.Errorf("技能 name 必须为小写字母/数字/连字符（≤64）: %q", meta.Name)
	}
	if meta.Description == "" {
		return nil, nil, fmt.Errorf("SKILL.md 缺少 description")
	}
	if utf8.RuneCountInString(meta.Description) > 1024 {
		return nil, nil, fmt.Errorf("description 不能超过 1024 字符")
	}
	if root != "." && root != meta.Name && !strings.EqualFold(filepath.Base(root), meta.Name) {
		// Soft check: warn by rejecting common mistake where zip root != name
		if root != "" && root != "." {
			return nil, nil, fmt.Errorf("包根目录 %q 应与 name %q 一致", root, meta.Name)
		}
	}
	relFiles := make([]string, 0, len(files))
	scripts := make([]string, 0)
	for path := range files {
		rel := path
		if root != "" && root != "." {
			if !strings.HasPrefix(path, root+"/") && path != root {
				continue
			}
			rel = strings.TrimPrefix(path, root+"/")
			if rel == "" || rel == path && path == root {
				continue
			}
		}
		if shouldSkipSkillPackagePath(rel) {
			continue
		}
		if rel == skillpkgSignatureFile {
			continue // W2-D1 · sidecar 不出现在 meta.Files（仅作 verify 用）
		}
		relFiles = append(relFiles, rel)
		if isSkillScriptPath(rel) {
			scripts = append(scripts, rel)
		}
	}
	if meta.Version == "" {
		meta.Version = "0.1.0"
	}
	if meta.RiskLevel == "" {
		if len(scripts) > 0 {
			meta.RiskLevel = "mid"
		} else {
			meta.RiskLevel = "low"
		}
	}
	meta.RiskLevel = normalizeRiskLevel(meta.RiskLevel)
	meta.Markdown = body
	meta.RootDir = root
	meta.SkillMDRel = skillRel
	meta.Files = relFiles
	meta.Scripts = scripts
	meta.HasScripts = len(scripts) > 0
	meta.SHA256 = hex.EncodeToString(sum[:])
	meta.SizeBytes = len(raw)
	return &meta, files, nil
}

func extractSkillArchive(fileName string, raw []byte) (map[string][]byte, error) {
	lower := strings.ToLower(fileName)
	switch {
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		return extractTarGz(raw)
	default:
		return extractZip(raw)
	}
}

func extractZip(raw []byte) (map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, fmt.Errorf("无法解析 zip/skill 包: %w", err)
	}
	out := make(map[string][]byte)
	total := 0
	for _, f := range zr.File {
		name := normalizeArchivePath(f.Name)
		if name == "" || strings.HasSuffix(f.Name, "/") {
			continue
		}
		if shouldSkipSkillPackagePath(name) {
			continue
		}
		if len(out) >= maxSkillPackageFileCount {
			return nil, fmt.Errorf("技能包文件数超过 %d", maxSkillPackageFileCount)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(rc, int64(maxSkillPackageUnpacked-total+1)))
		_ = rc.Close()
		if err != nil {
			return nil, err
		}
		total += len(data)
		if total > maxSkillPackageUnpacked {
			return nil, fmt.Errorf("解压后超过 50 MB")
		}
		out[name] = data
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("压缩包为空")
	}
	return out, nil
}

func extractTarGz(raw []byte) (map[string][]byte, error) {
	gr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("无法解析 gzip: %w", err)
	}
	defer gr.Close()
	tr := tar.NewReader(gr)
	out := make(map[string][]byte)
	total := 0
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		name := normalizeArchivePath(hdr.Name)
		if name == "" || shouldSkipSkillPackagePath(name) {
			continue
		}
		if len(out) >= maxSkillPackageFileCount {
			return nil, fmt.Errorf("技能包文件数超过 %d", maxSkillPackageFileCount)
		}
		data, err := io.ReadAll(io.LimitReader(tr, int64(maxSkillPackageUnpacked-total+1)))
		if err != nil {
			return nil, err
		}
		total += len(data)
		if total > maxSkillPackageUnpacked {
			return nil, fmt.Errorf("解压后超过 50 MB")
		}
		out[name] = data
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("压缩包为空")
	}
	return out, nil
}

func normalizeArchivePath(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = strings.TrimPrefix(name, "./")
	name = strings.TrimPrefix(name, "/")
	if name == "" || strings.Contains(name, "..") {
		return ""
	}
	return name
}

func shouldSkipSkillPackagePath(path string) bool {
	// W2-D1 · 签名 sidecar 必须能进 files map（用于解析），但只允许这一个 dotfile。
	if filepath.Base(path) == ".skillpkg.signature.json" {
		return false
	}
	base := filepath.Base(path)
	if base == ".DS_Store" || base == ".env" || strings.HasPrefix(base, ".") && base != ".gitkeep" {
		if strings.Contains(path, "/.") || strings.HasPrefix(path, ".") {
			if base == ".gitkeep" {
				return false
			}
		}
	}
	lower := strings.ToLower(path)
	if strings.Contains(lower, "/.git/") || strings.HasPrefix(lower, ".git/") {
		return true
	}
	if strings.Contains(lower, "__pycache__") {
		return true
	}
	if base == ".env" || strings.HasSuffix(lower, ".pem") || strings.HasSuffix(lower, ".key") {
		return true
	}
	return false
}

func isSkillScriptPath(rel string) bool {
	rel = strings.ReplaceAll(rel, "\\", "/")
	if !strings.HasPrefix(rel, "scripts/") {
		return false
	}
	lower := strings.ToLower(rel)
	return strings.HasSuffix(lower, ".py") ||
		strings.HasSuffix(lower, ".sh") ||
		strings.HasSuffix(lower, ".js") ||
		strings.HasSuffix(lower, ".mjs") ||
		strings.HasSuffix(lower, ".ts")
}

func locateSkillMarkdown(files map[string][]byte) (root, skillRel string, content []byte, err error) {
	candidates := make([]string, 0)
	for path := range files {
		base := strings.ToLower(filepath.Base(path))
		if base == "skill.md" {
			candidates = append(candidates, path)
		}
	}
	if len(candidates) == 0 {
		return "", "", nil, fmt.Errorf("缺少 SKILL.md（Agent Skills 规范要求）")
	}
	// Prefer */SKILL.md at depth 1
	best := candidates[0]
	bestScore := 99
	for _, c := range candidates {
		depth := strings.Count(c, "/")
		score := depth
		if strings.HasSuffix(strings.ToLower(c), "/skill.md") || strings.EqualFold(c, "SKILL.md") {
			if depth <= 1 {
				score = depth
			}
		}
		if score < bestScore {
			bestScore = score
			best = c
		}
	}
	if bestScore > 1 {
		return "", "", nil, fmt.Errorf("SKILL.md 必须位于包根或一级技能目录下")
	}
	content = files[best]
	if strings.Contains(best, "/") {
		root = filepath.Dir(best)
		skillRel = filepath.Base(best)
	} else {
		root = "."
		skillRel = best
		return "", "", nil, fmt.Errorf("请将技能目录作为压缩包根（例如 my-skill/SKILL.md），不要把文件直接放在 zip 根目录")
	}
	return root, skillRel, content, nil
}

func parseSkillFrontmatter(raw string) (meta skillPackageManifest, body string, err error) {
	text := strings.TrimSpace(raw)
	if !strings.HasPrefix(text, "---") {
		return meta, "", fmt.Errorf("SKILL.md 必须以 YAML frontmatter（---）开头")
	}
	rest := strings.TrimPrefix(text, "---")
	rest = strings.TrimLeft(rest, "\r\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return meta, "", fmt.Errorf("SKILL.md frontmatter 未正确闭合")
	}
	fm := rest[:end]
	body = strings.TrimSpace(rest[end+4:])
	for _, m := range reFrontmatterKV.FindAllStringSubmatch(fm, -1) {
		key := strings.ToLower(strings.TrimSpace(m[1]))
		val := strings.TrimSpace(m[2])
		val = strings.Trim(val, `"'`)
		switch key {
		case "name":
			meta.Name = strings.ToLower(val)
		case "description":
			meta.Description = val
		case "version":
			meta.Version = val
		case "license":
			meta.License = val
		case "risk", "risklevel", "risk_level":
			meta.RiskLevel = val
		case "tags":
			for _, part := range strings.Split(val, ",") {
				part = strings.TrimSpace(strings.Trim(part, `"'[]`))
				if part != "" {
					meta.Tags = append(meta.Tags, part)
				}
			}
		case "entrypoints", "entrypoint":
			for _, part := range strings.Split(val, ",") {
				part = strings.TrimSpace(strings.Trim(part, `"'[]`))
				if part != "" {
					meta.Entrypoints = append(meta.Entrypoints, part)
				}
			}
		case "readonly", "read_only":
			v := strings.EqualFold(val, "true") || val == "1" || strings.EqualFold(val, "yes")
			meta.ReadOnly = &v
		case "producesartifacts", "produces_artifacts", "artifacts":
			v := strings.EqualFold(val, "true") || val == "1" || strings.EqualFold(val, "yes")
			meta.ProducesArtifacts = &v
		}
	}
	return meta, body, nil
}

func (s *Server) skillPackageDir(ws, skillID string) string {
	root := os.Getenv("DE_SANDBOX_PACKAGE_DIR")
	if root == "" {
		root = filepath.Join("data", "skill-packages")
	}
	return filepath.Join(root, ws, skillID)
}

func (s *Server) materializeSkillPackage(ws, skillID, rootDir string, files map[string][]byte) (string, error) {
	dest := s.skillPackageDir(ws, skillID)
	if err := os.RemoveAll(dest); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return "", err
	}
	prefix := rootDir + "/"
	for path, data := range files {
		rel := path
		if rootDir != "" && rootDir != "." {
			if path == rootDir {
				continue
			}
			if !strings.HasPrefix(path, prefix) {
				continue
			}
			rel = strings.TrimPrefix(path, prefix)
		}
		if rel == "" || shouldSkipSkillPackagePath(rel) {
			continue
		}
		if rel == skillpkgSignatureFile {
			continue // W2-D1 · sidecar 不落盘，仅作 verify 用
		}
		target := filepath.Join(dest, filepath.FromSlash(rel))
		if !strings.HasPrefix(target, dest+string(os.PathSeparator)) && target != dest {
			return "", fmt.Errorf("非法路径: %s", rel)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return "", err
		}
		mode := os.FileMode(0o644)
		if isSkillScriptPath(rel) {
			mode = 0o755
		}
		if err := os.WriteFile(target, data, mode); err != nil {
			return "", err
		}
	}
	return dest, nil
}
