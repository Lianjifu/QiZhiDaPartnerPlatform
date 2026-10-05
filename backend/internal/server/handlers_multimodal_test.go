package server_test

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestMultimodalOCRStub(t *testing.T) {
	t.Setenv("QZDA_ENV", "test")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("QZDA_MULTIMODAL_CACHE_DIR", t.TempDir())
	t.Setenv("QZDA_MULTIMODAL_OCR", "stub")
	h := server.New(store.New()).Handler()

	// Build a tiny PNG.
	img := image.NewRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			img.Set(x, y, color.RGBA{R: 200, A: 255})
		}
	}
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		t.Fatal(err)
	}

	// Multipart body.
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "test.png")
	_, _ = fw.Write(pngBuf.Bytes())
	_ = mw.WriteField("kind", "ocr")
	_ = mw.Close()

	req := httptest.NewRequest("POST", "/api/multimodal/extract", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != 200 {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	data, _ := out["data"].(map[string]any)
	if data == nil {
		t.Fatalf("missing data: %+v", out)
	}
	if data["provider"] != "ocr-stub" {
		t.Fatalf("provider: %v", data["provider"])
	}
	if data["kind"] != "ocr" {
		t.Fatalf("kind: %v", data["kind"])
	}
}

func TestMultimodalASRStub(t *testing.T) {
	t.Setenv("QZDA_ENV", "test")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("QZDA_MULTIMODAL_CACHE_DIR", t.TempDir())
	t.Setenv("QZDA_MULTIMODAL_OCR", "stub")
	t.Setenv("QZDA_MULTIMODAL_ASR", "stub")
	h := server.New(store.New()).Handler()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "speech.wav")
	_, _ = fw.Write([]byte("RIFF....WAVEfmt fake audio bytes"))
	_ = mw.WriteField("kind", "asr")
	_ = mw.Close()

	req := httptest.NewRequest("POST", "/api/multimodal/extract", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != 200 {
		t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestMultimodalKindNotConfigured(t *testing.T) {
	t.Setenv("QZDA_ENV", "test")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	t.Setenv("QZDA_MULTIMODAL_CACHE_DIR", t.TempDir())
	// OCR stub disabled — request ASR (also disabled).
	t.Setenv("QZDA_MULTIMODAL_OCR", "")
	t.Setenv("QZDA_MULTIMODAL_ASR", "")
	h := server.New(store.New()).Handler()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "x.png")
	_, _ = fw.Write([]byte("fake"))
	_ = mw.WriteField("kind", "ocr")
	_ = mw.Close()

	req := httptest.NewRequest("POST", "/api/multimodal/extract", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 501 {
		t.Fatalf("want 501, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestMultimodalNoAuth(t *testing.T) {
	t.Setenv("QZDA_ENV", "test")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "false")
	h := server.New(store.New()).Handler()

	req := httptest.NewRequest("POST", "/api/multimodal/extract", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestMultimodalCacheHit(t *testing.T) {
	t.Setenv("QZDA_ENV", "test")
	t.Setenv("QZDA_ALLOW_MOCK_IDENTITY", "true")
	cacheDir := t.TempDir()
	t.Setenv("QZDA_MULTIMODAL_CACHE_DIR", cacheDir)
	t.Setenv("QZDA_MULTIMODAL_OCR", "stub")
	h := server.New(store.New()).Handler()

	doPost := func() map[string]any {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("file", "test.png")
		_, _ = fw.Write([]byte("same bytes both times"))
		_ = mw.WriteField("kind", "ocr")
		_ = mw.Close()

		req := httptest.NewRequest("POST", "/api/multimodal/extract", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("X-Workspace-Id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatalf("want 200, got %d body=%s", rr.Code, rr.Body.String())
		}
		var out map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &out)
		return out["data"].(map[string]any)
	}

	first := doPost()
	if cached, _ := first["cached"].(bool); cached {
		t.Fatal("first call should not be cached")
	}
	second := doPost()
	if cached, _ := second["cached"].(bool); !cached {
		t.Fatal("second call should be cached")
	}
}