package knowledge

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// RetryKnowledgeJob → POST /api/knowledge/processing-jobs/{id}/retry
//
// Marks the job queued and fires the run goroutine again. Stores the
// new startedAt + clears any prior error so the FE sees a clean retry.
func (s *Service) RetryKnowledgeJob(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		return nil, apperr.BadReq(apperr.BadRequest, "路径无效")
	}
	jobID := parts[3]
	ws := s.Deps.WorkspaceID(r)
	s.Store.Lock()
	jobs := knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
	var job map[string]any
	for i, j := range jobs {
		if str(j["id"]) == jobID {
			if str(j["workspaceId"]) != "" && str(j["workspaceId"]) != ws {
				s.Store.Unlock()
				return nil, apperr.Forbidden(apperr.WorkspaceScope, "任务不在当前工作区")
			}
			j["status"] = "queued"
			j["error"] = nil
			j["startedAt"] = time.Now().UTC().Format(time.RFC3339)
			jobs[i] = j
			job = j
			break
		}
	}
	if job == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "加工任务不存在")
	}
	s.Store.KnowledgeExtra["processingJobs"] = jobs
	s.appendKnowledgeAuditLocked(ws, id.Name, "重试知识加工任务", str(job["source"]), "success", "")
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	go s.RunKnowledgeJob(jobID)
	return job, nil
}

// RunKnowledgeJob is the chunking / embedding worker. Goroutine; not
// safe to call directly from a request handler (use RetryKnowledgeJob
// or the package publish + process actions). The job:
//  1. waits 300ms (debounce so a CreateDoc + immediate read sees status)
//  2. marks itself "running"
//  3. waits another 400ms (the simulated chunking work)
//  4. marks docs ready + stamps chunk counts + creates one graph
//     entity per doc; surfaces blob-write failures as "failed"
//  5. refreshes the global chunksTop (top-8 ready docs by score)
//
// Runs under Store.Lock for both read + write — same model the legacy
// server-side job used.
func (s *Service) RunKnowledgeJob(jobID string) {
	time.Sleep(300 * time.Millisecond)
	s.Store.Lock()
	jobs := knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
	var job map[string]any
	jidx := -1
	for i, j := range jobs {
		if str(j["id"]) == jobID {
			job = j
			jidx = i
			break
		}
	}
	if job == nil {
		s.Store.Unlock()
		return
	}
	job["status"] = "running"
	jobs[jidx] = job
	s.Store.KnowledgeExtra["processingJobs"] = jobs
	s.Store.Unlock()
	s.persistKnowledgeExtra()

	time.Sleep(400 * time.Millisecond)
	s.Store.Lock()
	jobs = knowledgeSliceMaps(s.Store.KnowledgeExtra["processingJobs"])
	for i, j := range jobs {
		if str(j["id"]) != jobID {
			continue
		}
		ws := str(j["workspaceId"])
		chunks := 0
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["workspaceId"]) != ws {
				continue
			}
			if str(d["status"]) == "indexing" || str(j["docId"]) == str(d["id"]) {
				text := coalesce(str(d["content"]), coalesce(str(d["snippet"]), str(d["title"])))
				if blob := s.readKnowledgeBlob(str(d["blobPath"])); blob != "" {
					text = blob
					d["content"] = blob
					if str(d["snippet"]) == "" {
						runes := []rune(blob)
						if len(runes) > 120 {
							d["snippet"] = string(runes[:120])
						} else {
							d["snippet"] = blob
						}
					}
				}
				if str(d["blobStatus"]) == "failed" {
					j["status"] = "failed"
					j["error"] = "对象存储写入失败，禁止假成功：" + str(d["blobError"])
					jobs[i] = j
					s.Store.KnowledgeExtra["processingJobs"] = jobs
					s.Store.Unlock()
					s.persistKnowledgeExtra()
					return
				}
				n := maxInt(1, len([]rune(text))/200)
				d["chunks"] = n
				d["status"] = "ready"
				d["sizeKb"] = maxInt(1, len(text)/1024)
				d["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
				chunks += n
				// graph entities from title
				ents := knowledgeSliceMaps(s.Store.KnowledgeExtra["graphEntities"])
				ent := map[string]any{
					"id": s.Store.ID("ge"), "workspaceId": ws, "name": str(d["title"]),
					"type": "runbook", "confidence": 0.86, "sourceDocId": d["id"], "sourceVersion": "v1",
				}
				s.Store.KnowledgeExtra["graphEntities"] = append([]map[string]any{ent}, ents...)
			}
		}
		j["status"] = "succeeded"
		j["chunkCount"] = chunks
		j["documentCount"] = maxInt(1, intFrom(j["documentCount"]))
		j["indexVersion"] = "idx-" + time.Now().Format("150405")
		jobs[i] = j
		s.Store.KnowledgeExtra["processingJobs"] = jobs
		// refresh chunksTop
		tops := []map[string]any{}
		idx := 1
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["workspaceId"]) != ws {
				continue
			}
			st := str(d["status"])
			if st != "ready" && st != "published" {
				continue
			}
			tops = append(tops, map[string]any{
				"idx": idx, "source": coalesce(str(d["source"]), str(d["title"])),
				"score": 0.85, "docId": d["id"],
				"text": coalesce(str(d["snippet"]), str(d["title"])),
			})
			idx++
			if idx > 8 {
				break
			}
		}
		s.Store.KnowledgeExtra["chunksTop"] = tops
		break
	}
	s.Store.Unlock()
	s.Store.Persist("knowledge_docs")
	s.persistKnowledgeExtra()
}

// ReviewKnowledgeDocs → POST /api/knowledge/docs/review
//
// Move docs from "indexing" to "ready" so they enter the published
// corpus. Idempotent: a doc already in "ready" stays put.
func (s *Service) ReviewKnowledgeDocs(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	body, _ := s.Deps.DecodeMap(r)
	ids := stringSlice(body["ids"])
	ws := s.Deps.WorkspaceID(r)
	s.Store.Lock()
	reviewed := []string{}
	for _, docID := range ids {
		for _, d := range s.Store.KnowledgeDocs {
			if str(d["id"]) == docID && str(d["workspaceId"]) == ws {
				d["status"] = "ready"
				d["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
				reviewed = append(reviewed, docID)
			}
		}
	}
	s.appendKnowledgeAuditLocked(ws, id.Name, "发起知识复核", strings.Join(reviewed, ","), "success", "")
	s.Store.Unlock()
	s.Store.Persist("knowledge_docs")
	s.persistKnowledgeExtra()
	return map[string]any{"ids": reviewed}, nil
}

// ReindexKnowledge → POST /api/knowledge/reindex
//
// Triggers a sidecar /v1/ingest (or /v1/sync) POST with the workspace's
// published + ready docs and records the affected count. Auth gate is
// knowledge.write; high-risk-change approval is enforced by the
// underlying evaluateWrite helper when governance.highRiskChangeApproval
// is on (which it is by default — see normalizeGovernance).
func (s *Service) ReindexKnowledge(r *http.Request) (any, error) {
	id := identityFromCtx(r)
	if err := requireKnowledgeWrite(id); err != nil {
		return nil, err
	}
	ws := s.Deps.WorkspaceID(r)
	n, err := s.SyncRAGIndexStrict(ws)
	s.Store.Lock()
	result := "success"
	reason := formatAffected(n)
	if err != nil {
		result = "failed"
		reason = err.Error()
		s.appendKnowledgeAuditLocked(ws, id.Name, "重建知识索引", ws, result, reason)
		s.Store.Unlock()
		s.persistKnowledgeExtra()
		return nil, apperr.BadReq(apperr.BadRequest, "索引重建失败: "+err.Error())
	}
	s.appendKnowledgeAuditLocked(ws, id.Name, "重建知识索引", ws, result, reason)
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return map[string]any{"status": "ok", "affected": n}, nil
}

// RescoreKnowledgeChunks → POST /api/knowledge/chunks/rescore
//
// Refreshes the global chunksTop row with the latest top-10 docs (by
// status "ready" or "published"). Auth gate is knowledge.write.
func (s *Service) RescoreKnowledgeChunks(r *http.Request) (any, error) {
	if err := requireKnowledgeWrite(identityFromCtx(r)); err != nil {
		return nil, err
	}
	ws := s.Deps.WorkspaceID(r)
	s.Store.Lock()
	tops := []map[string]any{}
	idx := 1
	for _, d := range s.Store.KnowledgeDocs {
		if str(d["workspaceId"]) != ws {
			continue
		}
		if str(d["status"]) != "ready" && str(d["status"]) != "published" {
			continue
		}
		tops = append(tops, map[string]any{
			"idx": idx, "source": coalesce(str(d["source"]), str(d["title"])),
			"score": 0.9 - float64(idx)*0.02, "docId": d["id"],
			"text": coalesce(str(d["snippet"]), str(d["title"])),
		})
		idx++
		if idx > 10 {
			break
		}
	}
	s.Store.KnowledgeExtra["chunksTop"] = tops
	s.Store.Unlock()
	s.persistKnowledgeExtra()
	return tops, nil
}

// SyncRAGIndexStrict POSTs the workspace's published + ready docs to
// the sidecar's /v1/ingest (falling back to /v1/sync) so the RAG
// corpus picks up new content. Returns the number of docs the sidecar
// reported indexed (or len(docs) if the sidecar returns 0). nil-safe:
// returns 0, nil when RAGURL is not configured.
func (s *Service) SyncRAGIndexStrict(workspaceID string) (int, error) {
	url := ""
	if s.Deps.RAGURL != nil {
		url = s.Deps.RAGURL()
	}
	if url == "" {
		return 0, nil
	}
	client := &http.Client{Timeout: 3 * time.Second}
	s.Store.RLock()
	var docs []map[string]any
	for _, d := range s.Store.KnowledgeDocs {
		st := str(d["status"])
		if str(d["workspaceId"]) == workspaceID && (st == "published" || st == "ready") {
			docs = append(docs, map[string]any{
				"docId": d["id"], "title": d["title"],
				"snippet": coalesce(str(d["snippet"]), coalesce(str(d["content"]), "已发布："+str(d["title"]))),
				"score":   0.9, "status": "published",
			})
		}
	}
	s.Store.RUnlock()
	if len(docs) == 0 {
		return 0, nil
	}
	payload, _ := json.Marshal(map[string]any{"docs": docs, "workspaceId": workspaceID})
	resp, err := client.Post(url+"/v1/ingest", "application/json", strings.NewReader(string(payload)))
	if err != nil {
		resp, err = client.Post(url+"/v1/sync", "application/json", strings.NewReader(string(payload)))
	}
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("rag status %d", resp.StatusCode)
	}
	var out struct {
		Indexed int `json:"indexed"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.Indexed > 0 {
		return out.Indexed, nil
	}
	return len(docs), nil
}

// formatAffected — "affected=N" for the reindex audit row.
func formatAffected(n int) string { return "affected=" + itoa(n) }

// itoa — small wrapper around strconv.Itoa without pulling strconv
// into the top-level imports.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := [20]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
