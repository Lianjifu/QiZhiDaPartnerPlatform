package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/metrics"
	"github.com/qizhida-partner-platform/backend/internal/store"
	"github.com/qizhida-partner-platform/backend/pkg/errors"
	"log"
)

// ExpertInbox sources (W3-D1). Helps dashboards filter by origin.
const (
	expertInboxSourceCopilot  = "copilot"
	expertInboxSourceSkill    = "skill"
	expertInboxSourceChannel  = "channel"
	expertInboxSourceManual   = "manual"
	expertInboxSourceEscalate = "escalate"
)

// ExpertInbox severities (W3-D1). Determines sort order in list.
const (
	expertInboxSeverityInfo  = "info"
	expertInboxSeverityWarn  = "warn"
	expertInboxSeverityBlock = "block"
)

// ExpertInbox statuses (W3-D1). Lifecycle in ADR-023.
const (
	expertInboxStatusPending   = "pending"
	expertInboxStatusApproved  = "approved"
	expertInboxStatusRejected  = "rejected"
	expertInboxStatusDismissed = "dismissed"
)

// ExpertInbox review decisions (W3-D1). The POST /:id/review body's
// decision field. Maps 1:1 to status except approve which becomes
// "approved".
const (
	expertInboxDecisionApprove = "approve"
	expertInboxDecisionReject  = "reject"
	expertInboxDecisionDismiss = "dismiss"
)

// listExpertInbox returns the inbox for the caller's workspace, with
// optional ?status= filter. Caller must have access.write (matching the
// pattern used by /api/access/reviews/complete).
func (s *Server) listExpertInbox(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "access.write") {
		return nil, errors.Forbidden(errors.ExpertInboxForbidden, "缺少 access.write")
	}
	wsID := expertInboxWS(r)
	if wsID == "" {
		return nil, errors.BadReq(errors.WorkspaceScope, "缺少工作区")
	}
	statusFilter := strings.TrimSpace(r.URL.Query().Get("status"))

	s.Store.RLock()
	defer s.Store.RUnlock()

	items := make([]map[string]any, 0, len(s.Store.ExpertInbox))
	for _, it := range s.Store.ExpertInbox {
		if it == nil {
			continue
		}
		if str(it["workspaceId"]) != wsID {
			continue
		}
		if statusFilter != "" && str(it["status"]) != statusFilter {
			continue
		}
		items = append(items, it)
	}

	pending := 0
	for _, it := range s.Store.ExpertInbox {
		if it == nil {
			continue
		}
		if str(it["workspaceId"]) == wsID && str(it["status"]) == expertInboxStatusPending {
			pending++
		}
	}
	metrics.Global.ExpertInbox.Set(uint64(pending))

	return map[string]any{
		"items":   items,
		"pending": pending,
		"total":   len(items),
		"filter":  statusFilter,
		"now":     time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// reviewExpertInbox records an approve / reject / dismiss decision on a
// single inbox item. Allowed decisions are listed in
// expertInboxDecision* constants. Items already resolved return 400
// BadReq to keep the lifecycle strict.
func (s *Server) reviewExpertInbox(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "access.write") {
		return nil, errors.Forbidden(errors.ExpertInboxForbidden, "缺少 access.write")
	}
	wsID := expertInboxWS(r)
	if wsID == "" {
		return nil, errors.BadReq(errors.WorkspaceScope, "缺少工作区")
	}

	itemID := expertInboxItemIDFromPath(r.URL.Path)
	if itemID == "" {
		return nil, errors.BadReq(errors.ExpertInboxInvalid, "缺少条目 ID")
	}

	body, _ := decodeMap(r)
	decision := strings.TrimSpace(str(body["decision"]))
	note := strings.TrimSpace(str(body["note"]))
	if decision == "" {
		return nil, errors.BadReq(errors.ExpertInboxInvalid, "缺少 decision")
	}
	if len(note) > 1024 {
		return nil, errors.BadReq(errors.ExpertInboxInvalid, "note 过长")
	}

	s.Store.Lock()
	defer s.Store.Unlock()

	var target map[string]any
	for _, it := range s.Store.ExpertInbox {
		if it == nil {
			continue
		}
		if str(it["id"]) == itemID && str(it["workspaceId"]) == wsID {
			target = it
			break
		}
	}
	if target == nil {
		return nil, errors.NotFoundErr(errors.ExpertInboxNotFound, "ExpertInbox 项不存在")
	}
	if str(target["status"]) != expertInboxStatusPending {
		return nil, errors.BadReq(errors.ExpertInboxInvalid, "条目已处理："+str(target["status"]))
	}

	var newStatus string
	switch decision {
	case expertInboxDecisionApprove:
		newStatus = expertInboxStatusApproved
	case expertInboxDecisionReject:
		newStatus = expertInboxStatusRejected
	case expertInboxDecisionDismiss:
		newStatus = expertInboxStatusDismissed
	default:
		return nil, errors.BadReq(errors.ExpertInboxInvalid, "未知 decision: "+decision)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	target["status"] = newStatus
	target["decision"] = decision
	target["note"] = note
	target["reviewer"] = id.Name
	target["reviewerId"] = id.ID
	target["reviewedAt"] = now

	s.Store.AppendAudit(wsID, id.Name, "审核 ExpertInbox 项", itemID, "success",
		decision+":"+newStatus+" reviewer="+id.Name)
	s.afterWriteLocked("expert_inbox")

	return target, nil
}

// createExpertInbox is the minimal admin-side ingestion path so ops can
// manually inject a test item and exercise the review flow without
// needing the full copilot / skill escalation wiring. Real ingestion
// from copilot turns lands in a later W6 phase — see ADR-023 §4.
func (s *Server) createExpertInbox(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "access.write") {
		return nil, errors.Forbidden(errors.ExpertInboxForbidden, "缺少 access.write")
	}
	wsID := expertInboxWS(r)
	if wsID == "" {
		return nil, errors.BadReq(errors.WorkspaceScope, "缺少工作区")
	}

	body, _ := decodeMap(r)
	title := strings.TrimSpace(str(body["title"]))
	if title == "" {
		return nil, errors.BadReq(errors.ExpertInboxInvalid, "缺少 title")
	}
	source := strings.TrimSpace(str(body["source"]))
	if source == "" {
		source = expertInboxSourceManual
	}
	severity := strings.TrimSpace(str(body["severity"]))
	switch severity {
	case "":
		severity = expertInboxSeverityInfo
	case expertInboxSeverityInfo, expertInboxSeverityWarn, expertInboxSeverityBlock:
		// ok
	default:
		return nil, errors.BadReq(errors.ExpertInboxInvalid, "未知 severity: "+severity)
	}

	item := map[string]any{
		"id":          s.Store.ID("inbox"),
		"workspaceId": wsID,
		"title":       title,
		"source":      source,
		"severity":    severity,
		"status":      expertInboxStatusPending,
		"createdAt":   time.Now().UTC().Format(time.RFC3339),
		"createdBy":   id.Name,
		"createdById": id.ID,
		"payload":     body["payload"],
	}

	s.Store.Lock()
	s.Store.ExpertInbox = append(s.Store.ExpertInbox, item)
	s.afterWriteLocked("expert_inbox")
	s.Store.Unlock()

	// Update the metric gauge for the caller's workspace.
	s.Store.RLock()
	pending := 0
	for _, it := range s.Store.ExpertInbox {
		if it == nil {
			continue
		}
		if str(it["workspaceId"]) == wsID && str(it["status"]) == expertInboxStatusPending {
			pending++
		}
	}
	s.Store.RUnlock()
	metrics.Global.ExpertInbox.Set(uint64(pending))

	s.Store.AppendAudit(wsID, id.Name, "创建 ExpertInbox 项", item["id"].(string), "success", source+":"+severity)
	log.Printf("expert_inbox: created id=%s ws=%s source=%s severity=%s by=%s",
		item["id"], wsID, source, severity, id.Name)
	return item, nil
}

// expertInboxItemIDFromPath pulls the ":id" segment from a path like
// `/api/expert-inbox/abc-123/review`. Returns "" when shape is wrong.
func expertInboxItemIDFromPath(path string) string {
	rest := strings.TrimPrefix(path, "/api/expert-inbox/")
	if rest == path {
		return ""
	}
	parts := strings.Split(rest, "/")
	if len(parts) == 0 {
		return ""
	}
	id := strings.TrimSpace(parts[0])
	// Reject traversal chars before lookup.
	if id == "" || strings.ContainsAny(id, "/\\.") {
		return ""
	}
	return id
}

// expertInboxWS returns the workspace id from the resolved
// WorkspaceCtx (preferred) or the X-Workspace-Id header (legacy
// fallback used by tests that don't run the workspace middleware).
func expertInboxWS(r *http.Request) string {
	if r == nil {
		return ""
	}
	if ws := workspaceFrom(r.Context()); ws != nil {
		return strings.TrimSpace(ws.WorkspaceID)
	}
	return strings.TrimSpace(r.Header.Get("X-Workspace-Id"))
}

// ensureExpertInboxSeeded is a small helper used by tests + the dev
// demo bootstrap to guarantee the field is non-nil before iteration.
// Safe to call multiple times.
func ensureExpertInboxSeeded(s *store.Store) {
	if s == nil {
		return
	}
	s.Lock()
	defer s.Unlock()
	if s.ExpertInbox == nil {
		s.ExpertInbox = []map[string]any{}
	}
}
