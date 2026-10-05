package artifacts

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/gateway"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
)

// Cross-format package vars shared between DOCX / PPTX / XLSX files.
// Type-specific regexes live in artifacts_docx.go, artifacts_pptx.go,
// artifacts_xlsx.go respectively.

var (
	reArtifactIDPref  = regexp.MustCompile(`(?i)^[a-z0-9]{6,12}-`)
	reMultiSpace      = regexp.MustCompile(`\s+`)
	reMultiUnderscore = regexp.MustCompile(`_+`)
)

// SkillArtifactDir returns the configured local directory for
// generated artifacts (DOCX / PPTX / XLSX / PDF). Honors the
// QZDA_SANDBOX_ARTIFACT_DIR env override so the sandbox-runtime
// container can reuse the same volume as the API server.
func SkillArtifactDir() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_SANDBOX_ARTIFACT_DIR")); v != "" {
		return v
	}
	return "/tmp/qzda-stack/artifacts"
}

// IsDocxSkillName classifies a tool/skill name as belonging to the
// Word document family. Matches canonical English, Chinese aliases,
// and any substring containing "docx" / "word" so user-defined
// aliases still resolve.
func IsDocxSkillName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return n == "docx" || n == "word" || strings.Contains(n, "docx") || n == "文档生成" || n == "word文档"
}

// IsPptxSkillName mirrors IsDocxSkillName for the PowerPoint family.
func IsPptxSkillName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return n == "pptx" || n == "ppt" || strings.Contains(n, "pptx") ||
		strings.Contains(n, "幻灯") || n == "演示文稿" || n == "ppt生成"
}

// skillArtifactStorageName normalizes a user-supplied path tail down
// to the bare basename, stripping quotes + URL-encoding. Used as the
// canonical key for every artifact lookup (file path, registry row).
func skillArtifactStorageName(raw string) string {
	name := filepath.Base(strings.TrimSpace(raw))
	name = strings.Trim(name, "`\"'")
	if decoded, err := url.PathUnescape(name); err == nil && decoded != "" {
		name = decoded
	}
	return name
}

func skillArtifactFilePath(storageName string) string {
	return filepath.Join(SkillArtifactDir(), skillArtifactStorageName(storageName))
}

func skillArtifactExists(storageName string) bool {
	storageName = skillArtifactStorageName(storageName)
	if storageName == "" {
		return false
	}
	st, err := os.Stat(skillArtifactFilePath(storageName))
	return err == nil && !st.IsDir()
}

// fetchSkillArtifactFromRuntime pulls an artifact from the sandbox
// runtime over HTTP so the API server can serve it. Used when the
// artifact was generated in the runtime's container but has not yet
// been synced to the API server's local volume.
func fetchSkillArtifactFromRuntime(storageName string) error {
	storageName = skillArtifactStorageName(storageName)
	if storageName == "" {
		return fmt.Errorf("empty artifact name")
	}
	client := &http.Client{Timeout: 8 * time.Second}
	runtimeURL := strings.TrimRight(envOr("QZDA_SANDBOX_RUNTIME_URL", "http://127.0.0.1:8093"), "/")
	reqURL := runtimeURL + "/v1/artifacts/" + url.PathEscape(storageName)
	resp, err := client.Get(reqURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("runtime artifact status %d", resp.StatusCode)
	}
	dir := SkillArtifactDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	outPath := filepath.Join(dir, storageName)
	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, resp.Body); err != nil {
		_ = os.Remove(outPath)
		return err
	}
	return nil
}

// asciiFallbackFilename produces a safe ASCII filename for the legacy
// Content-Disposition "filename=" parameter when the display name
// contains Chinese / punctuation. The UTF-8 filename* parameter is
// always sent alongside it for modern browsers.
func asciiFallbackFilename(name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	var b strings.Builder
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else if r == ' ' {
			b.WriteByte('_')
		}
	}
	out := strings.Trim(b.String(), "._-")
	out = reMultiUnderscore.ReplaceAllString(out, "_")
	if out == "" {
		out = "download"
	}
	if ext == "" {
		ext = ".bin"
	}
	return out + ext
}

// contentDispositionAttachment builds the Content-Disposition header
// for a downloaded artifact, stripping the storage-id prefix and
// honoring format-specific display-name conventions (DOCX uses
// docxDisplayNameFromStorage; PPTX/PDF strip the id inline).
func contentDispositionAttachment(name string) string {
	display := name
	if strings.HasSuffix(strings.ToLower(name), ".docx") {
		display = docxDisplayNameFromStorage(name)
	} else if strings.HasSuffix(strings.ToLower(name), ".pptx") {
		if i := strings.Index(name, "-"); i > 0 && i < len(name)-1 {
			display = name[i+1:]
		}
	} else if strings.HasSuffix(strings.ToLower(name), ".pdf") {
		if i := strings.Index(name, "-"); i > 0 && i < len(name)-1 {
			display = name[i+1:]
		}
	}
	ascii := asciiFallbackFilename(display)
	return fmt.Sprintf(
		"attachment; filename=\"%s\"; filename*=UTF-8''%s",
		ascii,
		url.PathEscape(display),
	)
}

// serveSkillArtifactPreview dispatches /api/skill-artifacts/<name>/preview
// to the format-specific preview function (DOCX / PPTX / XLSX / PDF).
// Runs every call through gateway.ValidateArtifactRequest so the
// authorization + audit + zero-trust checks are consistent across
// formats.
func (s *Service) serveSkillArtifactPreview(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/skill-artifacts/")
	path = strings.TrimSuffix(path, "/preview")
	name, ok := gateway.ValidateArtifactRequest(w, r, path, SkillArtifactDir(), s.artifactPolicy(), s.identityAdapter(r), s.appendAuditFn())
	if !ok {
		return
	}
	name = skillArtifactStorageName(name)
	if name == "" {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "无效产物名"))
		return
	}
	low := strings.ToLower(name)
	switch {
	case strings.HasSuffix(low, ".docx"):
		payload, err := previewDocxArtifact(name)
		if err != nil {
			writeErr(w, apperr.NotFoundErr(apperr.NotFound, err.Error()))
			return
		}
		writeJSON(w, payload)
	case strings.HasSuffix(low, ".pptx"):
		payload, err := previewPptxArtifact(name)
		if err != nil {
			writeErr(w, apperr.NotFoundErr(apperr.NotFound, err.Error()))
			return
		}
		writeJSON(w, payload)
	case strings.HasSuffix(low, ".xlsx"):
		payload, err := previewXlsxArtifact(name)
		if err != nil {
			writeErr(w, apperr.NotFoundErr(apperr.NotFound, err.Error()))
			return
		}
		writeJSON(w, payload)
	case strings.HasSuffix(low, ".pdf"):
		payload, err := previewPdfArtifact(name)
		if err != nil {
			writeErr(w, apperr.NotFoundErr(apperr.NotFound, err.Error()))
			return
		}
		writeJSON(w, payload)
	default:
		writeErr(w, apperr.BadReq(apperr.BadRequest, "该文件类型暂不支持在线预览，请下载后打开"))
	}
}

// writeJSON / writeErr are thin wrappers around response.OK / response.Fail
// that also stamp the preview-sandbox CSP headers so iframe embeds stay
// sandboxed.
func writeJSON(w http.ResponseWriter, payload any) {
	writePreviewSandboxHeaders(w)
	response.OK(w, payload)
}

func writeErr(w http.ResponseWriter, err error) {
	response.Fail(w, err)
}

// serveSkillArtifact streams the binary artifact body back to the
// caller. Sets the correct Content-Type per format, no-store caching
// (artifacts may be re-generated by the next turn), and honors the
// ?inline=1 query flag for browser preview embeds.
func (s *Service) serveSkillArtifact(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/api/skill-artifacts/")
	name, ok := gateway.ValidateArtifactRequest(w, r, raw, SkillArtifactDir(), s.artifactPolicy(), s.identityAdapter(r), s.appendAuditFn())
	if !ok {
		return
	}
	path := filepath.Clean(filepath.Join(SkillArtifactDir(), name))
	if st, err := os.Stat(path); err != nil || st.IsDir() {
		// gateway already 404'd; this is a defense-in-depth recheck.
		return
	}
	if strings.HasSuffix(strings.ToLower(name), ".docx") {
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	} else if strings.HasSuffix(strings.ToLower(name), ".pptx") {
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
	} else if strings.HasSuffix(strings.ToLower(name), ".xlsx") {
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	} else if strings.HasSuffix(strings.ToLower(name), ".pdf") {
		w.Header().Set("Content-Type", "application/pdf")
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	// W3-D3 iframe sandbox: same-origin frame embed only, no MIME
	// guessing, no shared cache. ?inline=1 flips disposition to inline
	// so the browser can render the artifact without forcing download.
	writePreviewSandboxHeaders(w)
	w.Header().Set("Cache-Control", "private, max-age=0, no-store")
	if wantInline(r) {
		w.Header().Set("Content-Disposition", inlineContentDisposition(name))
	} else {
		w.Header().Set("Content-Disposition", contentDispositionAttachment(name))
	}
	http.ServeFile(w, r, path)
}
