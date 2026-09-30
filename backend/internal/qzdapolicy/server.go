package qzdapolicy

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
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/policy"
)

// Server is the de-policy microservice: evaluate locally, proxy store-backed routes to de-core.
type Server struct {
	Engine   *policy.Engine
	CoreURL  string
	Addr     string
	proxy    *httputil.ReverseProxy
	internal string // optional DE_POLICY_INTERNAL_TOKEN
}

func NewFromEnv() *Server {
	core := strings.TrimSpace(os.Getenv("DE_CORE_URL"))
	if core == "" {
		core = "http://127.0.0.1:8080"
	}
	s := &Server{
		Engine:   policy.New(),
		CoreURL:  strings.TrimRight(core, "/"),
		Addr:     envOr("DE_POLICY_ADDR", ":8094"),
		internal: strings.TrimSpace(os.Getenv("DE_POLICY_INTERNAL_TOKEN")),
	}
	u, err := url.Parse(s.CoreURL)
	if err == nil {
		s.proxy = httputil.NewSingleHostReverseProxy(u)
		orig := s.proxy.Director
		s.proxy.Director = func(r *http.Request) {
			orig(r)
			r.Host = u.Host
			r.Header.Set("X-De-Policy-Proxy", "1")
		}
		s.proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": false,
				"error":   map[string]any{"code": "E_POLICY_UPSTREAM", "message": err.Error()},
			})
		}
	}
	return s
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
		writeJSON(w, 200, map[string]any{"status": "ok", "service": "de-policy"})
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ready": true, "coreUrl": s.CoreURL})
	})
	mux.HandleFunc("/v1/evaluate", s.handleEvaluate)
	mux.HandleFunc("/api/zero-trust/evaluate", s.handleZTEvaluate)
	// Store-backed policy surfaces: proxy to de-core
	mux.HandleFunc("/api/access/", s.proxyOrNotFound)
	mux.HandleFunc("/api/access", s.proxyOrNotFound)
	mux.HandleFunc("/api/zero-trust/", s.proxyOrNotFound)
	mux.HandleFunc("/api/zero-trust", s.proxyOrNotFound)
	mux.HandleFunc("/api/governance", s.proxyOrNotFound)
	mux.HandleFunc("/api/governance/", s.proxyOrNotFound)
	return mux
}

func (s *Server) proxyOrNotFound(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/zero-trust/evaluate" && r.Method == http.MethodPost {
		s.handleZTEvaluate(w, r)
		return
	}
	if s.proxy == nil {
		http.Error(w, "DE_CORE_URL not configured", http.StatusServiceUnavailable)
		return
	}
	s.proxy.ServeHTTP(w, r)
}

type evaluateRequest struct {
	ActorID          string `json:"actorId"`
	ActorRole        string `json:"actorRole"`
	WorkspaceID      string `json:"workspaceId"`
	Resource         string `json:"resource"`
	Action           string `json:"action"`
	SubmitterID      string `json:"submitterId"`
	ApproverID       string `json:"approverId"`
	PublishedBinding bool   `json:"publishedBinding"`
	EgressExternal   bool   `json:"egressExternal"`
	DataClass        string `json:"dataClass"`
}

func (s *Server) handleEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.internal != "" && r.Header.Get("X-De-Policy-Token") != s.internal {
		writeJSON(w, 401, map[string]any{"success": false, "error": map[string]any{"code": "E_UNAUTHORIZED", "message": "invalid internal token"}})
		return
	}
	var req evaluateRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"success": false, "error": map[string]any{"code": "E_BAD_REQUEST", "message": "invalid json"}})
		return
	}
	dec := s.Engine.Evaluate(r.Context(), policy.Input{
		ActorID: req.ActorID, ActorRole: req.ActorRole, WorkspaceID: req.WorkspaceID,
		Resource: req.Resource, Action: req.Action,
		SubmitterID: req.SubmitterID, ApproverID: req.ApproverID,
		PublishedBinding: req.PublishedBinding, EgressExternal: req.EgressExternal, DataClass: req.DataClass,
	})
	writeJSON(w, 200, map[string]any{
		"success": true,
		"data": map[string]any{
			"allow": dec.Allow, "reason": dec.Reason, "policyId": dec.PolicyID,
			"requireDualSign": dec.RequireDualSign, "evaluatedAt": dec.EvaluatedAt,
		},
	})
}

func (s *Server) handleZTEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body map[string]any
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body)
	resource, _ := body["resource"].(string)
	action, _ := body["action"].(string)
	if resource == "" || action == "" {
		writeJSON(w, 400, map[string]any{"success": false, "error": map[string]any{"code": "E_ZERO_TRUST_EVAL_INVALID", "message": "缺少 resource/action"}})
		return
	}
	classification, _ := body["classification"].(string)
	external, _ := body["external"].(bool)
	role := r.Header.Get("X-De-Actor-Role")
	if role == "" {
		role = "user"
	}
	// Map ZT facts into write-path engine + ZT-shaped response.
	dataClass := classification
	if dataClass == "" {
		dataClass = "internal"
	}
	dec := s.Engine.Evaluate(r.Context(), policy.Input{
		ActorRole: role, Resource: resource, Action: action,
		EgressExternal: external, DataClass: dataClass,
	})
	decision := "allow"
	reason, policyID := dec.Reason, dec.PolicyID
	// Preserve FE-facing approval_required for user publish (parity with de-core ZT).
	if role == "user" && strings.EqualFold(action, "publish") {
		decision = "approval_required"
		reason = "生产发布已转为管理员审批"
		policyID = "zt-user-production"
	} else if !dec.Allow {
		decision = "deny"
	}
	corr, _ := body["correlationId"].(string)
	if corr == "" {
		corr = fmt.Sprintf("corr-%d", time.Now().UnixNano())
	}
	writeJSON(w, 200, map[string]any{
		"success": true,
		"data": map[string]any{
			"decision": decision, "reason": reason, "policyId": policyID,
			"correlationId": corr, "resource": resource, "action": action,
			"source": "de-policy",
		},
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// Client calls remote de-policy /v1/evaluate.
type Client struct {
	Base  string
	Token string
	HTTP  *http.Client
}

func NewClientFromEnv() *Client {
	base := strings.TrimSpace(os.Getenv("DE_POLICY_URL"))
	if base == "" {
		return nil
	}
	return &Client{
		Base:  strings.TrimRight(base, "/"),
		Token: strings.TrimSpace(os.Getenv("DE_POLICY_INTERNAL_TOKEN")),
		HTTP:  &http.Client{Timeout: 3 * time.Second},
	}
}

func (c *Client) Available() bool { return c != nil && c.Base != "" }

func (c *Client) Evaluate(ctx context.Context, in policy.Input) (policy.Decision, error) {
	payload := evaluateRequest{
		ActorID: in.ActorID, ActorRole: in.ActorRole, WorkspaceID: in.WorkspaceID,
		Resource: in.Resource, Action: in.Action,
		SubmitterID: in.SubmitterID, ApproverID: in.ApproverID,
		PublishedBinding: in.PublishedBinding, EgressExternal: in.EgressExternal, DataClass: in.DataClass,
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Base+"/v1/evaluate", bytes.NewReader(raw))
	if err != nil {
		return policy.Decision{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("X-De-Policy-Token", c.Token)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return policy.Decision{}, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return policy.Decision{}, fmt.Errorf("de-policy %d: %s", res.StatusCode, string(body))
	}
	var wrap struct {
		Success bool `json:"success"`
		OK      bool `json:"ok"`
		Data    struct {
			Allow           bool   `json:"allow"`
			Reason          string `json:"reason"`
			PolicyID        string `json:"policyId"`
			RequireDualSign bool   `json:"requireDualSign"`
			EvaluatedAt     string `json:"evaluatedAt"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		return policy.Decision{}, err
	}
	return policy.Decision{
		Allow: wrap.Data.Allow, Reason: wrap.Data.Reason, PolicyID: wrap.Data.PolicyID,
		RequireDualSign: wrap.Data.RequireDualSign, EvaluatedAt: wrap.Data.EvaluatedAt,
	}, nil
}

// ListenAndServe starts the HTTP server (blocking).
func (s *Server) ListenAndServe() error {
	log.Printf("de-policy listening on %s (core=%s opa=%s)", s.Addr, s.CoreURL, os.Getenv("DE_OPA_URL"))
	return http.ListenAndServe(s.Addr, s.Handler())
}
