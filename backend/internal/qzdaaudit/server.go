package qzdaaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/infra"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Server is the de-audit microservice: durable append/list + audit-center API.
type Server struct {
	Addr     string
	CoreURL  string
	Sink     *infra.AuditSink
	Bus      *infra.AuditBus
	Kafka    *infra.KafkaAuditBus
	Search   *infra.OpenSearchAudit
	internal string
	proxy    *httputil.ReverseProxy
}

func NewFromEnv(ctx context.Context) (*Server, error) {
	pg, err := infra.OpenPostgres(ctx)
	if err != nil {
		return nil, err
	}
	if pg == nil {
		return nil, fmt.Errorf("DE_DATABASE_URL required for de-audit")
	}
	rdb, errRedis := infra.OpenRedis(ctx)
	if errRedis != nil {
		log.Printf("de-audit redis optional: %v", errRedis)
	}
	search := infra.NewOpenSearchAuditFromEnv()
	if search != nil {
		if err := search.EnsureIndex(ctx); err != nil {
			log.Printf("opensearch ensure index: %v", err)
		}
	}
	core := strings.TrimSpace(os.Getenv("DE_CORE_URL"))
	if core == "" {
		core = "http://127.0.0.1:8080"
	}
	s := &Server{
		Addr:     envOr("DE_AUDIT_ADDR", ":8095"),
		CoreURL:  strings.TrimRight(core, "/"),
		Sink:     &infra.AuditSink{Pool: pg},
		Bus:      infra.NewAuditBus(rdb),
		Kafka:    infra.NewKafkaAuditBusFromEnv(),
		Search:   search,
		internal: strings.TrimSpace(os.Getenv("DE_AUDIT_INTERNAL_TOKEN")),
	}
	if u, err := url.Parse(s.CoreURL); err == nil {
		s.proxy = httputil.NewSingleHostReverseProxy(u)
		orig := s.proxy.Director
		s.proxy.Director = func(r *http.Request) {
			orig(r)
			r.Host = u.Host
			r.Header.Set("X-De-Audit-Proxy", "1")
		}
	}
	_ = pg // keep pool alive via Sink
	return s, nil
}

func envOr(k, d string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return d
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "ok", "service": "de-audit"})
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ok := s.Sink != nil && s.Sink.Pool != nil
		writeJSON(w, map[bool]int{true: 200, false: 503}[ok], map[string]any{"ready": ok, "pg": ok})
	})
	mux.HandleFunc("/v1/events", s.handleEvents)
	mux.HandleFunc("/v1/events/by-correlation", s.handleByCorrelation)
	mux.HandleFunc("/api/audit-center", s.handleAuditCenter)
	mux.HandleFunc("/api/audit-center/", s.proxyOrAudit)
	mux.HandleFunc("/api/audit", s.proxyOrAudit)
	mux.HandleFunc("/api/audit/", s.proxyOrAudit)
	return mux
}

func (s *Server) proxyOrAudit(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/audit-center" && r.Method == http.MethodGet {
		s.handleAuditCenter(w, r)
		return
	}
	if s.proxy == nil {
		http.Error(w, "DE_CORE_URL not configured", http.StatusServiceUnavailable)
		return
	}
	s.proxy.ServeHTTP(w, r)
}

func (s *Server) checkInternal(r *http.Request) bool {
	if s.internal == "" {
		return true
	}
	return r.Header.Get("X-De-Audit-Token") == s.internal
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if !s.checkInternal(r) {
		writeJSON(w, 401, map[string]any{"success": false, "error": map[string]any{"code": "E_UNAUTHORIZED", "message": "invalid internal token"}})
		return
	}
	switch r.Method {
	case http.MethodPost:
		s.appendEvent(w, r)
	case http.MethodGet:
		s.listEvents(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) appendEvent(w http.ResponseWriter, r *http.Request) {
	var ev map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&ev); err != nil {
		writeJSON(w, 400, map[string]any{"success": false, "error": map[string]any{"code": "E_BAD_REQUEST", "message": "invalid json"}})
		return
	}
	if err := s.ingest(r.Context(), ev); err != nil {
		writeJSON(w, 500, map[string]any{"success": false, "error": map[string]any{"code": "E_AUDIT_WRITE", "message": err.Error()}})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"id": str(ev["id"]), "source": "de-audit"}})
}

func (s *Server) ingest(ctx context.Context, ev map[string]any) error {
	if str(ev["id"]) == "" {
		ev["id"] = fmt.Sprintf("audit-%d", time.Now().UnixNano())
	}
	if str(ev["time"]) == "" {
		ev["time"] = time.Now().UTC().Format(time.RFC3339)
	}
	if err := s.Sink.Append(ctx, ev); err != nil {
		return err
	}
	if s.Bus != nil {
		s.Bus.Publish(ctx, ev)
	}
	if s.Kafka != nil {
		s.Kafka.Publish(ctx, ev)
	}
	if s.Search != nil {
		_ = s.Search.IndexEvent(ctx, ev)
	}
	return nil
}

func (s *Server) listEvents(w http.ResponseWriter, r *http.Request) {
	ids := r.URL.Query()["workspaceId"]
	if len(ids) == 0 {
		if h := r.Header.Get("X-De-Workspace-Ids"); h != "" {
			ids = strings.Split(h, ",")
		}
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := s.listRecent(r.Context(), ids, limit)
	if err != nil {
		writeJSON(w, 500, map[string]any{"success": false, "error": map[string]any{"code": "E_AUDIT_READ", "message": err.Error()}})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": rows})
}

func (s *Server) listRecent(ctx context.Context, workspaceIDs []string, limit int) ([]map[string]any, error) {
	seen := map[string]bool{}
	var out []map[string]any
	if s.Search != nil && s.Search.Available() {
		if rows, err := s.Search.SearchRecent(ctx, workspaceIDs, limit); err == nil {
			for _, a := range rows {
				aid := str(a["id"])
				if aid != "" {
					seen[aid] = true
				}
				out = append(out, a)
			}
		}
	}
	pgRows, err := s.Sink.ListRecent(ctx, workspaceIDs, limit)
	if err != nil {
		return out, err
	}
	for _, a := range pgRows {
		aid := str(a["id"])
		if aid != "" && seen[aid] {
			continue
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *Server) handleByCorrelation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.checkInternal(r) {
		writeJSON(w, 401, map[string]any{"success": false, "error": map[string]any{"code": "E_UNAUTHORIZED", "message": "invalid internal token"}})
		return
	}
	corr := r.URL.Query().Get("id")
	if corr == "" {
		writeJSON(w, 400, map[string]any{"success": false, "error": map[string]any{"code": "E_BAD_REQUEST", "message": "missing id"}})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := s.Sink.ListByCorrelation(r.Context(), corr, limit)
	if err != nil {
		writeJSON(w, 500, map[string]any{"success": false, "error": map[string]any{"code": "E_AUDIT_READ", "message": err.Error()}})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": rows})
}

func (s *Server) handleAuditCenter(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.proxyOrAudit(w, r)
		return
	}
	id, err := identityFromRequest(r)
	if err != nil || id == nil {
		writeJSON(w, 401, map[string]any{"success": false, "error": map[string]any{"code": "E_UNAUTHORIZED", "message": "未登录"}})
		return
	}
	if !auth.Has(id, "audit.read") {
		writeJSON(w, 403, map[string]any{"success": false, "error": map[string]any{"code": "E_AUDIT_READ_FORBIDDEN", "message": "缺少 audit.read"}})
		return
	}
	rows, err := s.listRecent(r.Context(), id.WorkspaceIDs, 200)
	if err != nil {
		writeJSON(w, 500, map[string]any{"success": false, "error": map[string]any{"code": "E_AUDIT_READ", "message": err.Error()}})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": rows})
}

func identityFromRequest(r *http.Request) (*auth.Identity, error) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return nil, fmt.Errorf("missing auth")
	}
	token := strings.TrimPrefix(h, "Bearer ")
	token = strings.TrimPrefix(token, "bearer ")
	return auth.Parse(strings.TrimSpace(token))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// Client calls remote de-audit.
type Client struct {
	Base  string
	Token string
	HTTP  *http.Client
}

func NewClientFromEnv() *Client {
	base := strings.TrimSpace(os.Getenv("DE_AUDIT_URL"))
	if base == "" {
		return nil
	}
	return &Client{
		Base:  strings.TrimRight(base, "/"),
		Token: strings.TrimSpace(os.Getenv("DE_AUDIT_INTERNAL_TOKEN")),
		HTTP:  &http.Client{Timeout: 3 * time.Second},
	}
}

func (c *Client) Available() bool { return c != nil && c.Base != "" }

func (c *Client) Append(ctx context.Context, ev map[string]any) error {
	raw, _ := json.Marshal(ev)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Base+"/v1/events", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("X-De-Audit-Token", c.Token)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
		return fmt.Errorf("de-audit %d: %s", res.StatusCode, string(b))
	}
	return nil
}

func (c *Client) ListRecent(ctx context.Context, workspaceIDs []string, limit int) ([]map[string]any, error) {
	q := url.Values{}
	for _, id := range workspaceIDs {
		q.Add("workspaceId", id)
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Base+"/v1/events?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	if c.Token != "" {
		req.Header.Set("X-De-Audit-Token", c.Token)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("de-audit list %d: %s", res.StatusCode, string(body))
	}
	var wrap struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		return nil, err
	}
	return wrap.Data, nil
}

func (s *Server) ListenAndServe() error {
	log.Printf("de-audit listening on %s (pg configured)", s.Addr)
	return http.ListenAndServe(s.Addr, s.Handler())
}

// Pool exposes PG for tests.
func (s *Server) Pool() *pgxpool.Pool {
	if s.Sink == nil {
		return nil
	}
	return s.Sink.Pool
}
