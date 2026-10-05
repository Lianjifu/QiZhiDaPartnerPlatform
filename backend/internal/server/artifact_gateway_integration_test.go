package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// countAuditRows is a race-safe tally helper for store.Store audit rows.
// actionContains matches substring of action; result matches exactly.
func countAuditRows(t *testing.T, st *store.Store, actionContains, result string) int {
	t.Helper()
	if st == nil {
		return 0
	}
	st.RLock()
	defer st.RUnlock()
	n := 0
	for _, ev := range st.Audits {
		if a, _ := ev["action"].(string); actionContains == "" || (a != "" && strings.Contains(a, actionContains)) {
			if r, _ := ev["result"].(string); r == result {
				n++
			}
		}
	}
	return n
}

// withArtifactFixture swaps skillArtifactDir()'s base via env, writes a
// fixture file, and returns the path + cleanup. We mutate QZDA_ARTIFACT_DIR
// through runtimeenv rather than monkey-patching the package func.
func withArtifactFixture(t *testing.T, name string, size int) (root, absPath string, cleanup func()) {
	t.Helper()
	dir := t.TempDir()
	prev := os.Getenv("QZDA_SANDBOX_ARTIFACT_DIR")
	_ = os.Setenv("QZDA_SANDBOX_ARTIFACT_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, name), make([]byte, size), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir, filepath.Join(dir, name), func() { _ = os.Setenv("QZDA_SANDBOX_ARTIFACT_DIR", prev) }
}

// serverWithIdentity spins up the artifact handler stack with an
// identity pre-attached to the request context. Mirrors the auth
// middleware's identity parsing for the carve-out paths.
func serverWithIdentity(t *testing.T, h http.HandlerFunc, path string, id *auth.Identity) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	if id != nil {
		ctx := auth.WithIdentity(r.Context(), id)
		r = r.WithContext(ctx)
	}
	h.ServeHTTP(w, r)
	return w
}

func newArtifactServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	st := store.New()
	srv := &Server{Store: st}
	return srv, st
}

func TestArtifactGatewayRejectsBadExtension(t *testing.T) {
	srv, st := newArtifactServer(t)
	withArtifactFixture(t, "evil.exe", 64)

	w := serverWithIdentity(t, srv.serveSkillArtifact, "/api/skill-artifacts/evil.exe", &auth.Identity{ID: "u1", Name: "alice", WorkspaceID: "w1"})
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415 from gateway, got %d body=%s", w.Code, w.Body.String())
	}
	if got := countAuditRows(t, st, "skill 产物下载", "denied"); got != 1 {
		t.Fatalf("expected 1 denied audit row, got %d", got)
	}
}

func TestArtifactGatewayRejectsOversize(t *testing.T) {
	srv, st := newArtifactServer(t)
	withArtifactFixture(t, "huge.docx", 4096)
	t.Setenv("QZDA_ARTIFACT_MAX_BYTES", "256")

	w := serverWithIdentity(t, srv.serveSkillArtifact, "/api/skill-artifacts/huge.docx", &auth.Identity{ID: "u1", Name: "alice", WorkspaceID: "w1"})
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d body=%s", w.Code, w.Body.String())
	}
	if got := countAuditRows(t, st, "skill 产物下载", "denied"); got != 1 {
		t.Fatalf("expected 1 denied audit row, got %d", got)
	}
}

func TestArtifactGatewayRejectsTraversal(t *testing.T) {
	srv, st := newArtifactServer(t)
	withArtifactFixture(t, "ok.docx", 32)

	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/skill-artifacts/..%2Fetc%2Fpasswd", nil)
	ctx := auth.WithIdentity(r.Context(), &auth.Identity{ID: "u1", Name: "alice", WorkspaceID: "w1"})
	srv.serveSkillArtifact(rec, r.WithContext(ctx))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on traversal, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := countAuditRows(t, st, "skill 产物下载", "denied"); got != 1 {
		t.Fatalf("expected 1 denied audit row, got %d", got)
	}
}

func TestArtifactGatewayRejectsMissingAuth(t *testing.T) {
	srv, st := newArtifactServer(t)
	withArtifactFixture(t, "ok.docx", 32)

	// No identity on context.
	w := serverWithIdentity(t, srv.serveSkillArtifact, "/api/skill-artifacts/ok.docx", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", w.Code, w.Body.String())
	}
	if got := countAuditRows(t, st, "skill 产物下载", "denied"); got != 1 {
		t.Fatalf("expected 1 denied audit row, got %d", got)
	}
}

func TestArtifactGatewayAcceptsGoodDocxAndAuditsSuccess(t *testing.T) {
	srv, st := newArtifactServer(t)
	withArtifactFixture(t, "report.docx", 128)

	w := serverWithIdentity(t, srv.serveSkillArtifact, "/api/skill-artifacts/report.docx", &auth.Identity{ID: "u1", Name: "alice", WorkspaceID: "w1"})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	if got := countAuditRows(t, st, "skill 产物下载", "success"); got != 1 {
		t.Fatalf("expected 1 success audit row, got %d", got)
	}
}

func TestArtifactGatewayPreviewRespectsBadExtension(t *testing.T) {
	srv, st := newArtifactServer(t)
	withArtifactFixture(t, "evil.exe", 64)

	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/skill-artifacts/evil.exe/preview", nil)
	ctx := auth.WithIdentity(r.Context(), &auth.Identity{ID: "u1", Name: "alice", WorkspaceID: "w1"})
	srv.serveSkillArtifactPreview(rec, r.WithContext(ctx))

	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := countAuditRows(t, st, "skill 产物下载", "denied"); got != 1 {
		t.Fatalf("expected 1 denied audit row, got %d", got)
	}
}

func TestArtifactGatewaySlidePNGRespectsBadExtension(t *testing.T) {
	srv, st := newArtifactServer(t)
	withArtifactFixture(t, "deck.pptx", 256)

	// `evil.exe` isn't on the allow-list; gateway must reject before
	// parts parsing matters.
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/skill-artifacts/evil.exe/slides/1.png", nil)
	ctx := auth.WithIdentity(r.Context(), &auth.Identity{ID: "u1", Name: "alice", WorkspaceID: "w1"})
	srv.serveSkillArtifactSlidePNG(rec, r.WithContext(ctx))

	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := countAuditRows(t, st, "skill 产物下载", "denied"); got != 1 {
		t.Fatalf("expected 1 denied audit row, got %d", got)
	}
}

func TestArtifactGatewaySkipsAuthWhenDisabled(t *testing.T) {
	srv, _ := newArtifactServer(t)
	withArtifactFixture(t, "report.docx", 128)
	t.Setenv("QZDA_ARTIFACT_REQUIRE_AUTH", "false")

	w := serverWithIdentity(t, srv.serveSkillArtifact, "/api/skill-artifacts/report.docx", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (auth disabled), got %d body=%s", w.Code, w.Body.String())
	}
}

// silence unused import warnings when tests are pruned.
var (
	_ = (*apperr.AppError)(nil)
	_ sync.Mutex
)