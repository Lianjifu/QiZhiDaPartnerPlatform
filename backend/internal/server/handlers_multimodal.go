package server

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/multimodal"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
)

// initMultimodal builds the registry + registers the built-in stub
// providers. Real providers (Tesseract, Whisper, vendor SDKs) plug in
// here when QZDA_MULTIMODAL_OCR / QZDA_MULTIMODAL_ASR are configured.
func (s *Server) initMultimodal() {
	r := multimodal.New()
	r.SetCacheDir(strings.TrimSpace(lookupEnv("QZDA_MULTIMODAL_CACHE_DIR")))
	if dir := strings.TrimSpace(lookupEnv("QZDA_MULTIMODAL_CACHE_DIR")); dir != "" {
		log.Printf("multimodal: cache dir=%s", dir)
	}

	// Stub OCR provider: deterministic, no external dep. The
	// QZDA_MULTIMODAL_OCR switch (off | stub | tesseract) decides what
	// runs at boot. Default "off" = no provider registered.
	modeOCR := strings.ToLower(strings.TrimSpace(lookupEnv("QZDA_MULTIMODAL_OCR")))
	if modeOCR == "stub" {
		r.Register(&ocrStubProvider{})
		log.Printf("multimodal: OCR provider=stub (no real extraction)")
	}
	modeASR := strings.ToLower(strings.TrimSpace(lookupEnv("QZDA_MULTIMODAL_ASR")))
	if modeASR == "stub" {
		r.Register(&asrStubProvider{})
		log.Printf("multimodal: ASR provider=stub (no real extraction)")
	}

	s.Multimodal = r
	go s.multimodalJanitor(context.Background())
}

// multimodalJanitor evicts cached entries hourly.
func (s *Server) multimodalJanitor(ctx context.Context) {
	if s.Multimodal == nil {
		return
	}
	tick := time.NewTicker(1 * time.Hour)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if n, err := s.Multimodal.EvictOlderThan(); err == nil && n > 0 {
				log.Printf("multimodal: evicted %d cached entries", n)
			}
		}
	}
}

// multimodalExtractHandler accepts a multipart upload (field "file")
// plus a query/form field "kind" ∈ {"ocr", "asr", "image-caption"}.
// Returns the cached or freshly-computed Extraction as JSON.
func (s *Server) multimodalExtractHandler(w http.ResponseWriter, r *http.Request) {
	if s.Multimodal == nil {
		writeErr(w, apperr.Unavailable(apperr.Unknown, "多模态提取未启用"))
		return
	}
	if !auth.Has(identityFrom(r.Context()), "access.write") {
		writeErr(w, apperr.Forbidden(apperr.RoleForbidden, "需要 access.write 权限"))
		return
	}
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "无法解析上传文件"))
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "缺少 file 字段"))
		return
	}
	defer file.Close()

	kind := multimodal.Kind(strings.ToLower(strings.TrimSpace(r.FormValue("kind"))))
	if kind == "" {
		kind = multimodal.KindOCR
	}

	mime := hdr.Header.Get("Content-Type")
	if mime == "" {
		mime = multimodal.MimeForExt(hdr.Filename)
	}

	data, err := io.ReadAll(io.LimitReader(file, 20<<20))
	if err != nil {
		writeErr(w, apperr.New(apperr.Unknown, 500, "读取上传失败"))
		return
	}

	ext, err := s.Multimodal.Extract(r.Context(), kind, data, mime)
	if err != nil {
		var noProv multimodal.ErrNoProvider
		if errors.As(err, &noProv) {
			writeErr(w, apperr.New(apperr.Unknown, 501, "多模态能力 "+string(kind)+" 未配置"))
			return
		}
		var unav multimodal.ErrProviderUnavailable
		if errors.As(err, &unav) {
			writeErr(w, apperr.Unavailable(apperr.Unknown, "provider "+unav.Provider+" 不可用"))
			return
		}
		writeErr(w, apperr.BadReq(apperr.BadRequest, "提取失败: "+err.Error()))
		return
	}
	response.OK(w, ext)
}

// ocrStubProvider echoes input bytes as text. Documented in ADR-026
// as the "QZDA_MULTIMODAL_OCR=stub" mode used in CI and dev.
type ocrStubProvider struct{}

func (p *ocrStubProvider) Name() string                  { return "ocr-stub" }
func (p *ocrStubProvider) Kind() multimodal.Kind          { return multimodal.KindOCR }
func (p *ocrStubProvider) Available() bool                { return true }
func (p *ocrStubProvider) Extract(_ context.Context, input []byte, mime string) (multimodal.Extraction, error) {
	return multimodal.Extraction{
		Text: "[ocr-stub] " + string(input),
		Meta: map[string]any{"mime": mime, "bytes": len(input)},
	}, nil
}

// asrStubProvider pretends to transcribe audio. Returns a single
// segment with the file size as the duration hint.
type asrStubProvider struct{}

func (p *asrStubProvider) Name() string                  { return "asr-stub" }
func (p *asrStubProvider) Kind() multimodal.Kind          { return multimodal.KindASR }
func (p *asrStubProvider) Available() bool                { return true }
func (p *asrStubProvider) Extract(_ context.Context, input []byte, mime string) (multimodal.Extraction, error) {
	dur := time.Duration(len(input)) * time.Millisecond
	return multimodal.Extraction{
		Text: "[asr-stub] transcribed " + mime,
		Segments: []multimodal.Segment{
			{StartMS: 0, EndMS: dur.Milliseconds(), Text: "[asr-stub] transcribed " + mime},
		},
		Meta: map[string]any{"mime": mime, "bytes": len(input)},
	}, nil
}