package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func knowledgeDo(t *testing.T, h http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("X-Workspace-Id", "w1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr
}

func TestKnowledgeP0AuthEvalIsolation(t *testing.T) {
	h := server.New(store.New()).Handler()

	rr := knowledgeDo(t, h, http.MethodGet, "/api/knowledge/eval", "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatalf("eval %d %s", rr.Code, rr.Body.String())
	}
	var env struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil || !env.OK {
		t.Fatalf("eval envelope %s", rr.Body.String())
	}
	for _, key := range []string{"recall", "precision", "p95Latency", "hitRate"} {
		if _, ok := env.Data[key]; !ok {
			t.Fatalf("eval missing %s: %#v", key, env.Data)
		}
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/packages", "mock-auditor-token", `{"name":"x"}`)
	if rr.Code != 403 {
		t.Fatalf("auditor write expected 403 got %d %s", rr.Code, rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodGet, "/api/knowledge/packages", "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatalf("packages %d %s", rr.Code, rr.Body.String())
	}
	var pkgsEnv struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pkgsEnv)
	for _, p := range pkgsEnv.Data {
		if ws, _ := p["workspaceId"].(string); ws != "" && ws != "w1" {
			t.Fatalf("package leaked workspace %s", ws)
		}
	}

	rr = knowledgeDo(t, h, http.MethodGet, "/api/knowledge/doc/missing-id", "mock-admin-token", "")
	if rr.Code != 404 {
		t.Fatalf("missing doc expected 404 got %d %s", rr.Code, rr.Body.String())
	}
}

func TestKnowledgeP1WritePipeline(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DE_KNOWLEDGE_BLOB_DIR", dir)
	h := server.New(store.New()).Handler()

	rr := knowledgeDo(t, h, http.MethodPost, "/api/knowledge/packages", "mock-admin-token",
		`{"name":"测试知识包","description":"d","domain":"SRE","classification":"internal"}`)
	if rr.Code != 200 {
		t.Fatalf("create package %d %s", rr.Code, rr.Body.String())
	}
	var pkgEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pkgEnv)
	pkgID, _ := pkgEnv.Data["id"].(string)
	if pkgID == "" {
		t.Fatalf("package id missing: %s", rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/docs", "mock-admin-token",
		`{"title":"Redis OOM 手册","source":"Runbook","content":"Redis 内存超限时先降连接再扩容，确认主从切换。"}`)
	if rr.Code != 200 {
		t.Fatalf("upload doc %d %s", rr.Code, rr.Body.String())
	}
	var docEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &docEnv)
	docID, _ := docEnv.Data["id"].(string)
	blobPath, _ := docEnv.Data["blobPath"].(string)
	if blobPath == "" {
		t.Fatalf("expected blobPath: %s", rr.Body.String())
	}
	if _, err := os.Stat(blobPath); err != nil {
		t.Fatalf("blob missing: %v path=%s", err, blobPath)
	}
	if !strings.HasPrefix(blobPath, dir) {
		t.Fatalf("blob outside sandbox: %s", blobPath)
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		rr = knowledgeDo(t, h, http.MethodGet, "/api/knowledge/docs", "mock-admin-token", "")
		var docsEnv struct {
			Data []map[string]any `json:"data"`
		}
		_ = json.Unmarshal(rr.Body.Bytes(), &docsEnv)
		ready := false
		for _, d := range docsEnv.Data {
			if d["id"] == docID && d["status"] == "ready" {
				ready = true
				break
			}
		}
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("doc not ready in time: %s", rr.Body.String())
		}
		time.Sleep(100 * time.Millisecond)
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/packages/"+pkgID+"/publish", "mock-admin-token", `{}`)
	if rr.Code != 200 {
		t.Fatalf("publish %d %s", rr.Code, rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/retrieve", "mock-admin-token",
		`{"query":"Redis"}`)
	if rr.Code != 200 {
		t.Fatalf("retrieve %d %s", rr.Code, rr.Body.String())
	}
	var retrieveEnv struct {
		Data struct {
			Results []map[string]any `json:"results"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &retrieveEnv)
	if len(retrieveEnv.Data.Results) == 0 {
		t.Fatalf("expected retrieve hits: %s", rr.Body.String())
	}
	hit := retrieveEnv.Data.Results[0]
	for _, key := range []string{"idx", "source", "text", "score"} {
		if _, ok := hit[key]; !ok {
			t.Fatalf("retrieve hit missing %s: %#v", key, hit)
		}
	}
}

func TestKnowledgeP3EvalGraphCitation(t *testing.T) {
	h := server.New(store.New()).Handler()

	rr := knowledgeDo(t, h, http.MethodPost, "/api/knowledge/evaluations/run", "mock-admin-token",
		`{"packageId":"pkg-ops","profileId":"rp-default"}`)
	if rr.Code != 200 {
		t.Fatalf("eval run %d %s", rr.Code, rr.Body.String())
	}
	var evalEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &evalEnv)
	for _, key := range []string{"recallAtK", "citationAccuracy", "p95LatencyMs", "status", "evaluatedAt"} {
		if _, ok := evalEnv.Data[key]; !ok {
			t.Fatalf("evaluation missing %s: %#v", key, evalEnv.Data)
		}
	}

	rr = knowledgeDo(t, h, http.MethodGet, "/api/knowledge/graph/entities", "mock-admin-token", "")
	var ents struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &ents)
	if len(ents.Data) == 0 {
		t.Fatal("expected graph entities")
	}
	if _, ok := ents.Data[0]["type"]; !ok {
		t.Fatalf("entity missing type: %#v", ents.Data[0])
	}

	rr = knowledgeDo(t, h, http.MethodGet, "/api/knowledge/citation-trace", "mock-admin-token", "")
	var cites struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &cites)
	if len(cites.Data) == 0 || cites.Data[0]["citeCount"] == nil {
		t.Fatalf("citationTrace citeCount missing: %s", rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPatch, "/api/knowledge/governance", "mock-admin-token",
		`{"versionRetention":false}`)
	if rr.Code != 200 {
		t.Fatalf("governance patch %d %s", rr.Code, rr.Body.String())
	}
}

func TestKnowledgeDocDelete(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DE_KNOWLEDGE_BLOB_DIR", dir)
	h := server.New(store.New()).Handler()

	rr := knowledgeDo(t, h, http.MethodPost, "/api/knowledge/docs", "mock-admin-token",
		`{"title":"待删除手册","source":"Runbook","content":"删除前正文，用于校验 blob 与列表清理。"}`)
	if rr.Code != 200 {
		t.Fatalf("upload %d %s", rr.Code, rr.Body.String())
	}
	var docEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &docEnv)
	docID, _ := docEnv.Data["id"].(string)
	blobPath, _ := docEnv.Data["blobPath"].(string)
	if docID == "" || blobPath == "" {
		t.Fatalf("upload missing id/blob: %s", rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodDelete, "/api/knowledge/doc/"+docID, "mock-auditor-token", "")
	if rr.Code != 403 {
		t.Fatalf("auditor delete expected 403 got %d %s", rr.Code, rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodDelete, "/api/knowledge/doc/"+docID, "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatalf("delete %d %s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(blobPath); !os.IsNotExist(err) {
		t.Fatalf("blob should be removed: path=%s err=%v", blobPath, err)
	}

	rr = knowledgeDo(t, h, http.MethodGet, "/api/knowledge/doc/"+docID, "mock-admin-token", "")
	if rr.Code != 404 {
		t.Fatalf("detail after delete expected 404 got %d %s", rr.Code, rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/docs", "mock-admin-token",
		`{"title":"批量A","source":"Runbook","content":"正文 A"}`)
	_ = json.Unmarshal(rr.Body.Bytes(), &docEnv)
	idA, _ := docEnv.Data["id"].(string)
	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/docs", "mock-admin-token",
		`{"title":"批量B","source":"Runbook","content":"正文 B"}`)
	_ = json.Unmarshal(rr.Body.Bytes(), &docEnv)
	idB, _ := docEnv.Data["id"].(string)

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/docs/delete", "mock-admin-token",
		`{"ids":["`+idA+`","`+idB+`"]}`)
	if rr.Code != 200 {
		t.Fatalf("bulk delete %d %s", rr.Code, rr.Body.String())
	}
	var delEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &delEnv)
	if int(delEnv.Data["deleted"].(float64)) != 2 {
		t.Fatalf("expected deleted=2: %s", rr.Body.String())
	}
}

func TestKnowledgePackageAttachAndPublishScope(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DE_KNOWLEDGE_BLOB_DIR", dir)
	h := server.New(store.New()).Handler()

	rr := knowledgeDo(t, h, http.MethodPost, "/api/knowledge/packages", "mock-admin-token",
		`{"name":"交付包A","description":"scope","domain":"SRE","classification":"internal"}`)
	if rr.Code != 200 {
		t.Fatalf("create package %d %s", rr.Code, rr.Body.String())
	}
	var pkgEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pkgEnv)
	pkgID, _ := pkgEnv.Data["id"].(string)

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/packages/"+pkgID+"/publish", "mock-admin-token", `{}`)
	if rr.Code != 400 {
		t.Fatalf("empty publish expected 400 got %d %s", rr.Code, rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/docs", "mock-admin-token",
		`{"title":"包内手册","source":"Runbook","content":"包作用域发布测试正文。","packageId":"`+pkgID+`"}`)
	if rr.Code != 200 {
		t.Fatalf("upload %d %s", rr.Code, rr.Body.String())
	}
	var docEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &docEnv)
	docID, _ := docEnv.Data["id"].(string)
	if docEnv.Data["packageId"] != pkgID {
		t.Fatalf("expected packageId stamped: %s", rr.Body.String())
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		rr = knowledgeDo(t, h, http.MethodGet, "/api/knowledge/docs", "mock-admin-token", "")
		var docsEnv struct {
			Data []map[string]any `json:"data"`
		}
		_ = json.Unmarshal(rr.Body.Bytes(), &docsEnv)
		ready := false
		for _, d := range docsEnv.Data {
			if d["id"] == docID && (d["status"] == "ready" || d["status"] == "published") {
				ready = true
				break
			}
		}
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("doc not ready: %s", rr.Body.String())
		}
		time.Sleep(100 * time.Millisecond)
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/packages/"+pkgID+"/process", "mock-admin-token", `{"strategy":"semantic"}`)
	if rr.Code != 200 {
		t.Fatalf("process %d %s", rr.Code, rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/packages/"+pkgID+"/publish", "mock-admin-token", `{}`)
	if rr.Code != 200 {
		t.Fatalf("publish %d %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pkgEnv)
	if pkgEnv.Data["status"] != "published" {
		t.Fatalf("expected published: %s", rr.Body.String())
	}
	cur, _ := pkgEnv.Data["currentVersion"].(map[string]any)
	if str, _ := cur["version"].(string); str == "0.1.0" {
		t.Fatalf("expected version bump away from 0.1.0: %s", rr.Body.String())
	}
}

func TestKnowledgeSourceConnectAndSync(t *testing.T) {
	h := server.New(store.New()).Handler()

	rr := knowledgeDo(t, h, http.MethodPost, "/api/knowledge/packages", "mock-admin-token",
		`{"name":"源接入包","domain":"SRE","classification":"internal"}`)
	if rr.Code != 200 {
		t.Fatalf("create package %d %s", rr.Code, rr.Body.String())
	}
	var pkgEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pkgEnv)
	pkgID, _ := pkgEnv.Data["id"].(string)
	if pkgID == "" {
		t.Fatalf("package id missing: %s", rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/sources", "mock-admin-token",
		`{"name":"变更记录库","kind":"REST API","schedule":"每 1 小时"}`)
	if rr.Code != 400 {
		t.Fatalf("missing endpoint expected 400 got %d %s", rr.Code, rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/sources", "mock-admin-token",
		`{"name":"变更记录库","kind":"REST API","schedule":"每 1 小时","endpoint":"https://api.example.com/changes","credentialHint":"Bearer demo","packageId":"`+pkgID+`"}`)
	if rr.Code != 200 {
		t.Fatalf("create source %d %s", rr.Code, rr.Body.String())
	}
	var srcEnv struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &srcEnv)
	srcID, _ := srcEnv.Data["id"].(string)
	if srcID == "" {
		t.Fatalf("source id missing: %s", rr.Body.String())
	}
	if srcEnv.Data["packageId"] != pkgID {
		t.Fatalf("expected packageId stamped: %s", rr.Body.String())
	}
	if srcEnv.Data["status"] != "attention" {
		t.Fatalf("expected attention pending sync: %s", rr.Body.String())
	}
	if srcEnv.Data["endpoint"] != "https://api.example.com/changes" {
		t.Fatalf("endpoint not persisted: %s", rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/sources/"+srcID+"/sync", "mock-admin-token", `{}`)
	if rr.Code != 200 {
		t.Fatalf("sync %d %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &srcEnv)
	if srcEnv.Data["status"] != "healthy" {
		t.Fatalf("expected healthy after sync: %s", rr.Body.String())
	}
	if int(srcEnv.Data["documents"].(float64)) < 1 {
		t.Fatalf("expected documents after sync: %s", rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodGet, "/api/knowledge/docs", "mock-admin-token", "")
	if rr.Code != 200 {
		t.Fatalf("docs %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), pkgID) {
		t.Fatalf("expected synced doc stamped with packageId: %s", rr.Body.String())
	}

	rr = knowledgeDo(t, h, http.MethodPost, "/api/knowledge/sources", "mock-admin-token",
		`{"name":"SIEM 推送","kind":"Webhook","packageId":"`+pkgID+`"}`)
	if rr.Code != 200 {
		t.Fatalf("create webhook %d %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &srcEnv)
	endpoint, _ := srcEnv.Data["endpoint"].(string)
	if !strings.HasPrefix(endpoint, "/hooks/knowledge/") {
		t.Fatalf("expected signed webhook endpoint: %s", rr.Body.String())
	}
}
