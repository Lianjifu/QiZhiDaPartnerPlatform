package policy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// RemoteURL returns QZDA_OPA_URL when set (e.g. http://127.0.0.1:8181).
func RemoteURL() string {
	return strings.TrimSpace(os.Getenv("QZDA_OPA_URL"))
}

// Evaluate prefers remote OPA when QZDA_OPA_URL is set; falls back to embedded rules.
func (e *Engine) Evaluate(ctx context.Context, in Input) Decision {
	if url := RemoteURL(); url != "" {
		if d, err := evaluateOPA(ctx, url, in); err == nil {
			if d.EvaluatedAt == "" {
				d.EvaluatedAt = time.Now().UTC().Format(time.RFC3339)
			}
			return d
		}
	}
	return e.evaluateLocal(ctx, in)
}

func (e *Engine) evaluateLocal(_ context.Context, in Input) Decision {
	now := time.Now().UTC().Format(time.RFC3339)
	if in.ActorRole == "auditor" && !isReadAction(in.Action) {
		return Decision{Allow: false, Reason: "审计角色只读", PolicyID: "baseline.auditor_readonly", EvaluatedAt: now}
	}
	if in.DataClass == "restricted" && in.EgressExternal && (in.Resource == "model" || in.Resource == "channel") {
		return Decision{Allow: false, Reason: "受限数据禁止外部出口", PolicyID: "baseline.restricted_egress", EvaluatedAt: now}
	}
	if strings.EqualFold(in.Action, "approve") || strings.EqualFold(in.Action, "publish") || strings.EqualFold(in.Action, "release") {
		if in.SubmitterID != "" && in.ApproverID != "" && in.SubmitterID == in.ApproverID {
			return Decision{Allow: false, Reason: "职责分离：提交人不可自批", PolicyID: "baseline.sod", EvaluatedAt: now, RequireDualSign: true}
		}
		if in.ActorRole != "admin" {
			return Decision{Allow: false, Reason: "发布/批准需要管理员", PolicyID: "baseline.release_admin", EvaluatedAt: now, RequireDualSign: true}
		}
	}
	if (in.Resource == "employee_binding" || in.Resource == "capability") && in.Action == "bind" && !in.PublishedBinding {
		return Decision{Allow: false, Reason: "仅可绑定已发布能力版本", PolicyID: "baseline.published_binding", EvaluatedAt: now}
	}
	return Decision{Allow: true, Reason: "allow", PolicyID: "baseline.default_allow", EvaluatedAt: now}
}

func evaluateOPA(ctx context.Context, base string, in Input) (Decision, error) {
	payload := map[string]any{
		"input": map[string]any{
			"actorId":          in.ActorID,
			"actorRole":        in.ActorRole,
			"workspaceId":      in.WorkspaceID,
			"resource":         in.Resource,
			"action":           in.Action,
			"submitterId":      in.SubmitterID,
			"approverId":       in.ApproverID,
			"publishedBinding": in.PublishedBinding,
			"egressExternal":   in.EgressExternal,
			"dataClass":        in.DataClass,
		},
	}
	body, _ := json.Marshal(payload)
	url := strings.TrimRight(base, "/") + "/v1/data/de/authz/result"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return Decision{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 2 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return Decision{}, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return Decision{}, fmt.Errorf("opa %d: %s", res.StatusCode, string(raw))
	}
	var wrap struct {
		Result *Decision `json:"result"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return Decision{}, err
	}
	if wrap.Result == nil {
		return Decision{}, fmt.Errorf("opa empty result")
	}
	return *wrap.Result, nil
}
