package skills

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
	"github.com/qizhida-partner-platform/backend/internal/skills/vetter"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func (s *Service) importSkillPackage(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	fileName, raw, err := readSkillPackageUpload(r)
	if err != nil {
		return nil, err
	}
	meta, files, err := parseSkillPackage(fileName, raw)
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, err.Error())
	}

	ws := s.WorkspaceID(r)

	// W1-D1 · vetter — content-level guard. Runs before signer so an attacker
	// can't probe signature internals via timing. Admins with the
	// `skill.vet.override` permission may bypass a Deny verdict; the bypass
	// is recorded in the audit trail (result=override) so it is observable.
	overrideVet := auth.Has(id, "skill.vet.override")
	if mode := vetterMode(); mode != "disabled" {
		report := vetter.RunBytes(files)
		switch mode {
		case "warn_only":
			if report.Decision != vetter.Allow {
				summary := vetterSummary(meta.Name, report)
				log.Printf("skill vetter warn_only: import=%s verdict=%s findings=%d",
					meta.Name, report.Verdict, len(report.Findings))
				for _, f := range report.Findings {
					log.Printf("  skill vetter finding: import=%s %s %s @%s:%d %s",
						meta.Name, f.Category, f.Pattern, f.File, f.Line, f.Snippet)
				}
				s.Store.AppendAudit(ws, id.Name, "skill 内容审查", meta.Name, "warn", summary)
			}
		default:
			if report.Decision == vetter.Deny {
				summary := vetterSummary(meta.Name, report)
				if overrideVet {
					s.Store.AppendAudit(ws, id.Name, "skill 内容审查",
						meta.Name, "override", "admin override via skill.vet.override: "+summary)
					break
				}
				s.Store.AppendAudit(ws, id.Name, "skill 内容审查", meta.Name, "denied", summary)
				return nil, apperr.BadReq(apperr.SkillVetDenied,
					"imported skill blocked by vetter: "+summary)
			}
		}
	}

	// W1-D2 · signer — provenance guard. Imported packages must carry a
	// signature whose KeyID is in the trust store (prod) or the dev keypair.
	// W2-D1 · extended to (wsID, meta, files): workspace-scoped KeyID
	// resolves first, then global trust as fallback. PolicyWorkspace
	// rejects non-workspace publishers.
	if err := s.verifyImportSignature(ws, meta, files); err != nil {
		// W1-D3 · audit. Foreign-package signature rejection must be
		// observable in the workspace's audit trail; the response itself
		// only shows the error code to the caller.
		s.Store.AppendAudit(ws, id.Name, "skill 签名验证",
			meta.Name, "denied", err.Error())
		return nil, err
	}
	skillID := ""
	s.Store.Lock()
	skillID = s.Store.ID("sk")
	s.Store.Unlock()

	dest, err := s.materializeSkillPackage(ws, skillID, meta.RootDir, files)
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, "落盘技能包失败: "+err.Error())
	}

	risk := meta.RiskLevel
	item := map[string]any{
		"id": skillID, "workspaceId": ws, "ownerId": id.ID, "owner": id.Name,
		"name": meta.Name, "kind": "skill",
		"description": meta.Description,
		"version":     meta.Version,
		"status":      ternary(risk == "high", "beta", "installed"),
		"rating":      0, "installCount": 0, "riskLevel": risk,
		"cacheable":       false,
		"lifecycleStatus": ternary(risk == "high", "pending_approval", "enabled"),
		"source":          "package", "environment": "sandbox", "classification": "internal",
		"lastVerifiedAt": "刚刚", "team": "当前工作区",
		"license": meta.License, "tags": meta.Tags,
		"signed": meta.KeyID != "", "publisher": id.Name,
		"publisherKeyId": meta.KeyID, "signerName": meta.SignerName,
		"packagePath": dest, "packageRoot": meta.RootDir,
		"skillMdPath": meta.SkillMDRel, "hasScripts": meta.HasScripts,
		"scripts": meta.Scripts, "packageFiles": meta.Files,
		"packageSha256": meta.SHA256, "packageSizeBytes": meta.SizeBytes,
		"packageFileName": fileName,
	}
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

	s.Store.Lock()
	// replace same-name package skill in workspace
	kept := make([]map[string]any, 0, len(s.Store.Skills)+1)
	removedSkillIDs := make([]string, 0)
	for _, sk := range s.Store.Skills {
		if str(sk["workspaceId"]) == ws && str(sk["name"]) == meta.Name && str(sk["source"]) == "package" {
			if oid := str(sk["id"]); oid != "" && oid != skillID {
				removedSkillIDs = append(removedSkillIDs, oid)
			}
			oldPath := str(sk["packagePath"])
			if oldPath != "" && oldPath != dest {
				_ = os.RemoveAll(oldPath)
			}
			continue
		}
		kept = append(kept, sk)
	}
	removedHealthIDs := make([]string, 0)
	if len(removedSkillIDs) > 0 {
		drop := map[string]struct{}{}
		for _, id := range removedSkillIDs {
			drop[id] = struct{}{}
		}
		healthKept := make([]map[string]any, 0, len(s.Store.SkillHealth))
		for _, h := range s.Store.SkillHealth {
			if _, gone := drop[str(h["skillId"])]; gone {
				if hid := str(h["id"]); hid != "" {
					removedHealthIDs = append(removedHealthIDs, hid)
				}
				continue
			}
			healthKept = append(healthKept, h)
		}
		s.Store.SkillHealth = healthKept
	}
	s.Store.Skills = append([]map[string]any{item}, kept...)
	s.ensureSkillHealthLocked(item)
	s.ensureSkillPermissionsLocked(skillID)
	s.ensureSkillGovernanceLocked(skillID)
	s.ensureSkillRuntimeLocked(item)
	s.Store.SkillIntegrations = append([]map[string]any{{
		"id": s.Store.ID("si"), "workspaceId": ws, "name": meta.Name, "type": "skill",
		"skillId":     skillID,
		"environment": "test", "status": "enabled", "owner": id.Name,
		"endpoint":       "package://" + meta.Name + "@" + meta.Version,
		"credentialRef":  "vault://skills/" + skillID + "/runtime",
		"lastVerifiedAt": "刚刚", "health": "healthy",
		"discoveredCapabilities": len(meta.Scripts),
		"writeApprovalRequired":  risk == "high",
		"allowedEgress":          []string{},
	}}, s.Store.SkillIntegrations...)
	s.Store.AppendAudit(ws, id.Name, "导入技能包", meta.Name+"@"+meta.Version, "success", "sha256="+meta.SHA256+";scripts="+itoaPolicy(len(meta.Scripts))+";signer="+meta.SignerName+";keyId="+meta.KeyID)
	if meta.KeyID != "" {
		s.Store.AppendAudit(ws, id.Name, "skill 签名验证", meta.Name, "success", "keyId="+meta.KeyID+";signer="+meta.SignerName)
	}
	s.Store.Unlock()
	if len(removedSkillIDs) > 0 {
		s.Store.PersistDelete("skills", removedSkillIDs...)
	}
	if len(removedHealthIDs) > 0 {
		s.Store.PersistDelete("skill_health", removedHealthIDs...)
	}
	s.persistSkills()
	go s.persistSkillExtra()

	out := s.normalizeSkillItem(item)
	out["packagePreview"] = map[string]any{
		"files": meta.Files, "scripts": meta.Scripts, "hasScripts": meta.HasScripts,
		"sha256": meta.SHA256, "markdownBytes": len(meta.Markdown),
	}
	return out, nil
}

func readSkillPackageUpload(r *http.Request) (fileName string, raw []byte, err error) {
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(maxSkillPackageBytes + (1 << 20)); err != nil {
			return "", nil, apperr.BadReq(apperr.BadRequest, "无法解析上传表单")
		}
		file, hdr, err := r.FormFile("file")
		if err != nil {
			return "", nil, apperr.BadReq(apperr.BadRequest, "请上传 file 字段")
		}
		defer file.Close()
		raw, err = io.ReadAll(io.LimitReader(file, maxSkillPackageBytes+1))
		if err != nil {
			return "", nil, apperr.BadReq(apperr.BadRequest, "读取上传文件失败")
		}
		if len(raw) > maxSkillPackageBytes {
			return "", nil, apperr.BadReq(apperr.BadRequest, "技能包不能超过 10 MB")
		}
		return hdr.Filename, raw, nil
	}
	body, _ := decodeMap(r)
	fileName = strings.TrimSpace(str(body["fileName"]))
	b64 := strings.TrimSpace(str(body["contentBase64"]))
	if fileName == "" || b64 == "" {
		return "", nil, apperr.BadReq(apperr.BadRequest, "请上传 .skill / .zip / .tgz 文件（multipart file 或 contentBase64）")
	}
	raw, err = base64.StdEncoding.DecodeString(b64)
	if err != nil {
		// try raw URL encoding without padding issues
		raw, err = base64.RawStdEncoding.DecodeString(b64)
		if err != nil {
			return "", nil, apperr.BadReq(apperr.BadRequest, "contentBase64 无效")
		}
	}
	if len(raw) > maxSkillPackageBytes {
		return "", nil, apperr.BadReq(apperr.BadRequest, "技能包不能超过 10 MB")
	}
	return fileName, raw, nil
}

func (s *Service) skillPackageInfo(r *http.Request, id *auth.Identity, ws, skillID string) (any, error) {
	if err := requireSkillRead(id); err != nil {
		return nil, err
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	_, sk := s.findSkillLocked(ws, skillID)
	if sk == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "技能不存在")
	}
	pkgPath := str(sk["packagePath"])
	md := ""
	if pkgPath != "" {
		mdBytes, _ := os.ReadFile(filepath.Join(pkgPath, coalesce(str(sk["skillMdPath"]), "SKILL.md")))
		md = string(mdBytes)
	}
	return map[string]any{
		"skillId":           skillID,
		"name":              sk["name"],
		"version":           sk["version"],
		"hasPackage":        pkgPath != "",
		"packagePath":       pkgPath,
		"packageRoot":       sk["packageRoot"],
		"skillMdPath":       sk["skillMdPath"],
		"hasScripts":        boolFrom(sk["hasScripts"]),
		"scripts":           sk["scripts"],
		"entrypoints":       sk["entrypoints"],
		"readOnly":          boolFrom(sk["readOnly"]),
		"producesArtifacts": boolFrom(sk["producesArtifacts"]),
		"packageFiles":      sk["packageFiles"],
		"packageSha256":     sk["packageSha256"],
		"packageSizeBytes":  sk["packageSizeBytes"],
		"packageFileName":   sk["packageFileName"],
		"skillMarkdown":     md,
	}, nil
}

func skillPackagePayload(sk map[string]any) map[string]any {
	pkgPath := str(sk["packagePath"])
	if pkgPath == "" {
		return nil
	}
	mdPath := filepath.Join(pkgPath, coalesce(str(sk["skillMdPath"]), "SKILL.md"))
	md, _ := os.ReadFile(mdPath)
	scripts, _ := sk["scripts"].([]string)
	if scripts == nil {
		if raw, ok := sk["scripts"].([]any); ok {
			scripts = make([]string, 0, len(raw))
			for _, x := range raw {
				if s := str(x); s != "" {
					scripts = append(scripts, s)
				}
			}
		}
	}
	return map[string]any{
		"packagePath":       pkgPath,
		"skillMarkdown":     string(md),
		"scripts":           scripts,
		"hasScripts":        boolFrom(sk["hasScripts"]),
		"name":              str(sk["name"]),
		"version":           str(sk["version"]),
		"entrypoints":       decodeStringSlice(sk["entrypoints"]),
		"readOnly":          boolFrom(sk["readOnly"]),
		"producesArtifacts": boolFrom(sk["producesArtifacts"]),
	}
}

// ensure JSON round-trip of string slices remains usable after persist
func decodeStringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s := str(x); s != "" {
				out = append(out, s)
			}
		}
		return out
	case json.RawMessage:
		var arr []string
		_ = json.Unmarshal(t, &arr)
		return arr
	default:
		return nil
	}
}

// verifyImportSignature is the user-upload counterpart to verifyBuiltinSignature.
// The skill package's manifest carries Signature/KeyID/SignerName (added W1-D2);
// the server consults TrustStore + DevKeyStore to resolve a public key and runs
// ed25519.Verify against the canonical manifest bytes.
//
// W2-D1 · policy gate (skillSignaturePolicy):
//   - PolicyAny → workspace key OR global trust store (dev default)
//   - PolicyWorkspace → must be a workspace key (active or rotated); global
//     + dev-auto trust is rejected
//
// Caller must NOT have already replaced meta.KeyID/Signature from sidecar
// parsing — that happens earlier in parseSkillPackage.
func (s *Service) verifyImportSignature(wsID string, meta *skillPackageManifest, files map[string][]byte) error {
	policy := skillSignaturePolicy()
	if meta.Signature == "" || meta.KeyID == "" {
		return apperr.BadReq(apperr.SkillSignatureMissing,
			"imported skill missing signature: "+meta.Name)
	}
	pub, trust, err := s.ResolvePublisherKey(wsID, meta.KeyID)
	if err != nil {
		return err
	}
	if policy == PolicyWorkspace && trust != "workspace-active" && trust != "workspace-rotated" {
		return apperr.New(apperr.SkillSignatureUnknownKey, 400,
			"workspace policy rejects non-workspace publisher (trust="+trust+")")
	}
	sig, err := base64.StdEncoding.DecodeString(meta.Signature)
	if err != nil {
		return apperr.BadReq(apperr.SkillSignatureInvalid,
			"malformed signature base64: "+err.Error())
	}
	pubBytes, ok := pub.([]byte)
	if !ok {
		return apperr.BadReq(apperr.SkillSignatureInvalid,
			"publisher key resolved to unexpected type")
	}
	if err := signing.VerifyManifest(pubBytes, sig, signing.DigestInputs{
		Meta: meta, Files: files,
	}); err != nil {
		return apperr.BadReq(apperr.SkillSignatureInvalid,
			"imported skill signature mismatch: "+err.Error())
	}
	return nil
}

// trustStoreForSkillVerify returns a TrustStore that includes the dev keypair
// (auto-provisioned on first read) when AutoProvisionsSkillKeys is true. In
// prod the caller is expected to have loaded trusted-publishers.json via
// EnsureTrustStoreLoaded — this helper is a fallback that includes the dev
// key so local `go test` flows continue to work without an extra bootstrap.
func (s *Service) trustStoreForSkillVerify() (*signing.TrustStore, error) {
	ts := s.resolveSkillTrustStore()
	if ts != nil {
		return ts, nil
	}
	fresh := signing.NewTrustStore(signing.TrustFile{})
	if s.resolveSkillDevKey() != nil {
		tk, _ := s.resolveSkillDevKey().TrustedKey("")
		tk.AddedAt = timeNow()
		tk.AddedBy = "dev-keypair"
		fresh.Add(tk)
	}
	return fresh, nil
}

// resolveSkillTrustStore returns the loaded trust store from the
// Deps.SkillTrustStore callback (post-boot), or nil when not bound.
func (s *Service) resolveSkillTrustStore() *signing.TrustStore {
	if s.SkillTrustStore == nil {
		return nil
	}
	raw := s.SkillTrustStore()
	ts, _ := raw.(*signing.TrustStore)
	return ts
}

// resolveSkillDevKey returns the dev keypair from Deps.SkillDevKey, or nil.
func (s *Service) resolveSkillDevKey() *signing.DevKeyStore {
	if s.SkillDevKey == nil {
		return nil
	}
	raw := s.SkillDevKey()
	dv, _ := raw.(*signing.DevKeyStore)
	return dv
}

// timeNow is a tiny seam so tests can stub clock without importing time
// at every call site.
func timeNow() time.Time { return time.Now().UTC() }
