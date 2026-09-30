package server

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func attachmentRoot() string {
	base := strings.TrimSpace(os.Getenv("DE_SKILL_ARTIFACT_DIR"))
	if base == "" {
		base = "/tmp/de-stack/artifacts"
	}
	dir := filepath.Join(base, "attachments")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func (s *Server) uploadConversationAttachment(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if id == nil {
		return nil, apperr.UnauthorizedErr("请先登录")
	}
	ws := s.workspaceID(r)
	cid := conversationIDFromPath(r.URL.Path)
	if cid == "" {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少会话 ID")
	}
	s.Store.RLock()
	bucket := s.resolveMessageBucketID(ws, cid)
	inWS := s.conversationInWorkspaceLocked(ws, bucket, cid)
	s.Store.RUnlock()
	if !inWS {
		return nil, apperr.Forbidden(apperr.WorkspaceScope, "当前会话不在您的工作区范围内")
	}
	cid = bucket

	if err := r.ParseMultipartForm(12 << 20); err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, "无法解析上传文件")
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		return nil, apperr.BadReq(apperr.BadRequest, "缺少 file 字段")
	}
	defer file.Close()

	attID := s.Store.ID("att")
	ext := filepath.Ext(hdr.Filename)
	storage := attID + ext
	path := filepath.Join(attachmentRoot(), storage)
	out, err := os.Create(path)
	if err != nil {
		return nil, apperr.New(apperr.Unknown, 500, "保存附件失败")
	}
	defer out.Close()
	n, err := io.Copy(out, io.LimitReader(file, 10<<20))
	if err != nil {
		return nil, apperr.New(apperr.Unknown, 500, "写入附件失败")
	}

	item := map[string]any{
		"id": attID, "workspaceId": ws, "conversationId": cid,
		"name": hdr.Filename, "size": n, "contentType": hdr.Header.Get("Content-Type"),
		"storageName": storage, "downloadPath": "/api/attachments/" + storage,
		"uploadedBy": id.ID, "createdAt": time.Now().UTC().Format(time.RFC3339),
	}
	s.Store.Lock()
	s.Store.Actions[attID] = item
	s.Store.AppendAudit(ws, id.Name, "上传会话附件", hdr.Filename, "success", cid)
	s.Store.Unlock()
	s.Store.Persist("actions")

	return item, nil
}

func (s *Server) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())
	if id == nil {
		writeErr(w, apperr.UnauthorizedErr("请先登录"))
		return
	}
	ws := s.workspaceID(r)
	name := strings.TrimPrefix(r.URL.Path, "/api/attachments/")
	name = filepath.Base(name)
	if name == "" || name == "." {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "附件不存在"))
		return
	}

	s.Store.RLock()
	var meta map[string]any
	for _, item := range s.Store.Actions {
		if str(item["storageName"]) == name || str(item["id"])+filepath.Ext(str(item["name"])) == name {
			meta = item
			break
		}
		if str(item["downloadPath"]) == "/api/attachments/"+name {
			meta = item
			break
		}
	}
	s.Store.RUnlock()
	if meta == nil || !strings.HasPrefix(str(meta["id"]), "att") {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "附件不存在"))
		return
	}
	if str(meta["workspaceId"]) != "" && str(meta["workspaceId"]) != ws && id.Role != "admin" {
		writeErr(w, apperr.Forbidden(apperr.WorkspaceScope, "无权下载该附件"))
		return
	}

	path := filepath.Join(attachmentRoot(), name)
	f, err := os.Open(path)
	if err != nil {
		writeErr(w, apperr.NotFoundErr(apperr.NotFound, "附件不存在"))
		return
	}
	defer f.Close()
	ct := coalesce(str(meta["contentType"]), "application/octet-stream")
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+coalesce(str(meta["name"]), name)+"\"")
	_, _ = io.Copy(w, f)
}

func (s *Server) attachmentSummaries(ids []string, expectedCID string) string {
	if len(ids) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n[附件]")
	s.Store.RLock()
	defer s.Store.RUnlock()
	for _, id := range ids {
		item := s.Store.Actions[id]
		if item == nil {
			continue
		}
		if expectedCID != "" && str(item["conversationId"]) != "" && str(item["conversationId"]) != expectedCID {
			continue
		}
		b.WriteString("\n- ")
		b.WriteString(str(item["name"]))
		b.WriteString(" (")
		b.WriteString(str(item["downloadPath"]))
		b.WriteString(")")
		storage := str(item["storageName"])
		if storage != "" {
			path := filepath.Join(attachmentRoot(), storage)
			if raw, err := os.ReadFile(path); err == nil && len(raw) < 8000 {
				ct := strings.ToLower(str(item["contentType"]))
				name := strings.ToLower(str(item["name"]))
				if strings.HasPrefix(ct, "text/") || strings.HasSuffix(name, ".txt") || strings.HasSuffix(name, ".md") || strings.HasSuffix(name, ".csv") {
					b.WriteString("\n内容摘要：\n")
					b.WriteString(string(raw))
				}
			}
		}
	}
	return b.String()
}
