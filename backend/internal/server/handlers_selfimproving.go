package server

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/metrics"
	"github.com/qizhida-partner-platform/backend/internal/selfimproving"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
	"github.com/qizhida-partner-platform/backend/pkg/response"
)

// selfimprovingGenerateHandler accepts a small JSON body to drive the
// SOP engine and returns the generated SOP. When the body includes
// "write": true and the caller has knowledge.write, the handler also
// submits the SOP to the knowledge doc pipeline (status=indexing then
// ready after the standard runKnowledgeJob).
//
// Body fields (all optional):
//   - workspaceId: filter traces by workspace; empty = workspace from token.
//   - window:      duration string ("5m", "1h") or "all".
//   - titleHint:   free-text snippet used in the title.
//   - write:       boolean; default false.
func (s *Server) selfimprovingGenerateHandler(w http.ResponseWriter, r *http.Request) {
	if s.TraceRecorder == nil {
		writeErr(w, apperr.Unavailable(apperr.Unknown, "trace recorder 未启用"))
		return
	}
	engine := selfimproving.New(s.TraceRecorder)

	body, _ := decodeMap(r)
	ws := strings.TrimSpace(str(body["workspaceId"]))
	hdrWS := strings.TrimSpace(s.workspaceID(r))
	if hdrWS != "" && ws != "" && hdrWS != ws {
		writeErr(w, apperr.Forbidden(apperr.WorkspaceScope, "请求工作区与 token 工作区不一致"))
		return
	}
	if ws == "" {
		ws = hdrWS
	}
	window := strings.TrimSpace(str(body["window"]))
	if window == "" {
		window = "all"
	}
	titleHint := strings.TrimSpace(str(body["titleHint"]))
	wantWrite, _ := body["write"].(bool)

	sop, err := engine.Generate(selfimproving.Options{
		WorkspaceID: ws,
		Window:      window,
		TitleHint:   titleHint,
	})
	if err == nil {
		metrics.Global.SelfImproving.Inc(string(sop.Verdict))
	} else if errors.Is(err, selfimproving.ErrSampleTooSmall) {
		metrics.Global.SelfImproving.Inc(string(selfimproving.VerdictRejected))
	}
	if errors.Is(err, selfimproving.ErrSampleTooSmall) {
		// Callers benefit from a structured 200 with the rejected verdict
		// so dashboards can count it; no SOP body to return yet.
		response.OK(w, map[string]any{
			"verdict":     selfimproving.VerdictRejected,
			"reason":      selfimproving.ReasonSampleTooSmall,
			"sampleSize":  0,
			"workspaceId": ws,
			"window":      window,
		})
		return
	}
	if err != nil {
		writeErr(w, apperr.BadReq(apperr.BadRequest, "SOP 生成失败: "+err.Error()))
		return
	}

	out := map[string]any{
		"verdict":     sop.Verdict,
		"reason":      sop.Reason,
		"title":       sop.Title,
		"markdown":    sop.Markdown,
		"tags":        sop.Tags,
		"sampleSize":  sop.SampleSize,
		"window":      sop.Window,
		"workspaceId": ws,
		"patterns":    sop.Patterns,
		"summary":     sop.Summary,
	}

	if wantWrite && sop.Verdict == selfimproving.VerdictCreated {
		id := identityFrom(r.Context())
		if id == nil || !auth.Has(id, "knowledge.write") {
			out["write"] = "denied"
			out["writeReason"] = "需要 knowledge.write 权限"
		} else {
			docID, pkgID, writeErr := s.submitSOPKnowledgeDoc(ws, id, sop)
			if writeErr != nil {
				out["write"] = "failed"
				out["writeError"] = writeErr.Error()
			} else {
				out["write"] = "ok"
				out["docId"] = docID
				out["packageId"] = pkgID
			}
		}
	}
	response.OK(w, out)
}

// submitSOPKnowledgeDoc writes the SOP into the knowledge doc pipeline
// under the workspace's draft package. Mirrors the layout used by
// createKnowledgeDoc (status=indexing, then runKnowledgeJob flips to
// ready). Returns the docID and the package it landed in.
func (s *Server) submitSOPKnowledgeDoc(ws string, id *auth.Identity, sop selfimproving.SOP) (string, string, error) {
	content := sop.Markdown
	if strings.TrimSpace(content) == "" {
		return "", "", apperr.BadReq(apperr.BadRequest, "SOP 正文为空")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	item := map[string]any{
		"id":          s.Store.ID("kd"),
		"workspaceId": ws,
		"title":       sop.Title,
		"source":      "self-improving",
		"tags":        sop.Tags,
		"fileName":    "",
		"status":      "indexing",
		"ownerId":     id.ID,
		"sizeKb":      len([]rune(content))/1024 + 1,
		"chunks":      0,
		"citeCount":   0,
		"snippet":     truncateRunes(content, 160),
		"content":     content,
		"createdAt":   now,
		"updatedAt":   now,
		"verdict":     string(sop.Verdict),
		"sopReason":   string(sop.Reason),
		"sopPatterns": len(sop.Patterns),
		"quality":     map[string]any{"completeness": 80, "freshness": 90, "citationAccuracy": 80},
	}
	if blobPath, err := s.writeKnowledgeBlob(ws, str(item["id"]), content); err == nil {
		item["blobPath"] = blobPath
		item["blobStatus"] = "stored"
	} else {
		item["blobStatus"] = "failed"
		item["blobError"] = err.Error()
	}
	s.Store.Lock()
	s.Store.KnowledgeDocs = append([]map[string]any{item}, s.Store.KnowledgeDocs...)
	s.appendKnowledgeAuditLocked(ws, id.Name, "self-improving 写入 SOP", sop.Title, "success", string(sop.Reason))
	pkgID := s.ensureDraftPackageLocked(ws, id.Name)
	item["packageId"] = pkgID
	s.attachDocsToPackageLocked(ws, pkgID, []string{str(item["id"])}, false)
	job := map[string]any{
		"id": s.Store.ID("kj"), "workspaceId": ws, "packageId": pkgID,
		"source": sop.Title, "strategy": "semantic", "status": "queued",
		"documentCount": 1, "chunkCount": 0, "indexVersion": "idx-pending",
		"startedAt": now, "docId": item["id"],
	}
	jobs := knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
	s.Store.KnowledgeExtra["processingJobs"] = append([]map[string]any{job}, jobs...)
	s.Store.Unlock()
	s.Store.Persist("knowledge_docs")
	s.persistKnowledgeExtra()
	go s.runKnowledgeJob(str(job["id"]))
	return str(item["id"]), pkgID, nil
}