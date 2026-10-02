package server

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/copilot"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestNormalizeSkillActionAndScriptCommand(t *testing.T) {
	if normalizeSkillAction(map[string]any{"action": "OPEN"}) != skillActionOpen {
		t.Fatal("open")
	}
	if normalizeSkillAction(map[string]any{"action": "run"}) != skillActionRun {
		t.Fatal("run")
	}
	if !looksLikeSkillScriptCommand("scripts/echo.py") {
		t.Fatal("scripts/echo.py")
	}
	if !looksLikeSkillScriptCommand("node .copilot-ws/gen.js --out out.pptx") {
		t.Fatal(".copilot-ws")
	}
	if looksLikeSkillScriptCommand("请生成一份述职PPT") {
		t.Fatal("natural language must not look like script")
	}
}

func TestSkillInvocationNeedsApproval(t *testing.T) {
	tool := &registeredTool{Name: "pptx", Kind: "skill", Key: "skill:pptx", Mode: copilot.ToolModeRecommend}
	sk := map[string]any{"name": "pptx", "hasScripts": true, "producesArtifacts": true, "readOnly": false}
	callRun := toolCallRequest{Name: "pptx", Args: map[string]any{"action": "run", "command": "scripts/thumbnail.py"}}
	if !skillInvocationNeedsApproval(sessionModeExecute, tool, sk, callRun) {
		t.Fatal("artifact-producing run should need approval in execute")
	}
	callOpen := toolCallRequest{Name: "pptx", Args: map[string]any{"action": "open"}}
	if skillInvocationNeedsApproval(sessionModeExecute, tool, sk, callOpen) {
		t.Fatal("open should not need approval")
	}
	echo := map[string]any{"name": "hello-echo", "hasScripts": true, "producesArtifacts": false, "readOnly": true}
	echoTool := &registeredTool{Name: "hello-echo", Kind: "skill", Key: "skill:hello-echo"}
	if skillInvocationNeedsApproval(sessionModeExecute, echoTool, echo, callRun) {
		t.Fatal("readOnly echo should not need approval")
	}
}

func TestSkillWriteAndOpen(t *testing.T) {
	dir := t.TempDir()
	sk := map[string]any{
		"id": "sk-t", "name": "demo", "packagePath": dir,
		"hasScripts": true, "scripts": []string{"scripts/a.py"},
	}
	enrichSkillMetadata(sk)
	s := &Server{}
	res := s.skillWrite(sk, toolCallRequest{Args: map[string]any{
		"path": "gen.js", "content": "console.log(1)",
	}}, time.Now())
	if res.Status != "success" {
		t.Fatalf("%#v", res)
	}
	written := filepath.Join(dir, ".copilot-ws", "gen.js")
	if _, err := os.Stat(written); err != nil {
		t.Fatal(err)
	}

	tool := &registeredTool{Name: "demo", Kind: "skill", Key: "skill:demo"}
	open := s.skillOpen(toolRunContext{}, tool, sk, time.Now())
	if open.Status != "success" {
		t.Fatalf("%#v", open)
	}
	if !strings.Contains(open.Output, "skill.open") || !strings.Contains(open.Output, "scripts") {
		t.Fatalf("open output: %s", open.Output)
	}
}

func TestSkillRunNeedsInstructionWithoutScript(t *testing.T) {
	s := &Server{}
	sk := map[string]any{
		"id": "sk-t", "name": "pptx", "packagePath": t.TempDir(),
		"hasScripts": true, "scripts": []string{"scripts/thumbnail.py"},
		"producesArtifacts": true,
	}
	tool := &registeredTool{Name: "pptx", Kind: "skill", Key: "skill:pptx"}
	res := s.skillRun(toolRunContext{SessionMode: sessionModeExecute, WorkspaceID: "w1"}, tool, sk, toolCallRequest{
		Args: map[string]any{"action": "run", "command": "请生成PPT"},
	}, "请生成PPT", time.Now())
	if res.Status != "needs_instruction" {
		t.Fatalf("got %s: %s", res.Status, res.Output)
	}
}

func TestPreviewPptxArtifact(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DE_SANDBOX_ARTIFACT_DIR", dir)
	storage, _, err := generatePptxArtifactLocal("团队季度考评", "# 封面\n## 目录\n- A\n- B\n")
	if err != nil {
		t.Fatal(err)
	}
	payload, err := previewPptxArtifact(storage)
	if err != nil {
		t.Fatal(err)
	}
	if str(payload["kind"]) != "pptx" {
		t.Fatalf("kind=%v", payload["kind"])
	}
	if intFrom(payload["pageCount"]) < 2 {
		t.Fatalf("pageCount=%v", payload["pageCount"])
	}
	slides, ok := payload["slides"].([]map[string]any)
	if !ok || len(slides) < 2 {
		if raw, ok := payload["slides"].([]any); !ok || len(raw) < 2 {
			t.Fatalf("slides missing: %#v", payload["slides"])
		}
	} else if str(slides[0]["title"]) == "" {
		t.Fatalf("empty slide title: %#v", slides[0])
	}
	blocks, _ := payload["blocks"].([]map[string]any)
	if len(blocks) == 0 {
		if raw, ok := payload["blocks"].([]any); !ok || len(raw) == 0 {
			t.Fatalf("empty blocks: %#v", payload["blocks"])
		}
	}
}

func TestEnsureSkillArtifactsSkipsWhenPptxPresent(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DE_SANDBOX_ARTIFACT_DIR", dir)
	out := "已生成 PPT\n下载链接：/api/skill-artifacts/abc-团队季度考评.pptx"
	got := ensureSkillArtifactsInOutput(out, "团队季度考评", "## 目录\n- 一项\n"+strings.Repeat("正文内容足够长以通过结构化检测。", 10))
	if strings.Contains(got, ".docx") {
		t.Fatalf("should not invent docx beside pptx: %s", got)
	}
	if !strings.Contains(got, ".pptx") {
		t.Fatalf("pptx link lost: %s", got)
	}
}

func TestGeneratePptxArtifactLocal(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DE_SANDBOX_ARTIFACT_DIR", dir)
	storage, download, err := generatePptxArtifactLocal("团队季度考评", "# 封面\n## 目录\n- A\n- B\n")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(storage, ".pptx") {
		t.Fatalf("storage=%s", storage)
	}
	if !strings.Contains(download, "/api/skill-artifacts/") {
		t.Fatalf("download=%s", download)
	}
	if !skillArtifactExists(storage) {
		t.Fatal("file missing")
	}
	path := skillArtifactFilePath(storage)
	if err := validatePptxOOXMLLoose(path); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	// Production PptxGenJS decks are typically >> 40KB; stdlib fallback is ~8–20KB.
	if st.Size() < 40_000 {
		t.Logf("warning: pptx size=%d looks like fallback generator", st.Size())
	}
	zr, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	haveTheme, haveMaster := false, false
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, "ppt/theme/") {
			haveTheme = true
		}
		if strings.HasPrefix(f.Name, "ppt/slideMasters/") {
			haveMaster = true
		}
	}
	if !haveTheme || !haveMaster {
		t.Fatal("missing theme/master")
	}
}

func TestGeneratePdfArtifactLocal(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DE_SANDBOX_ARTIFACT_DIR", dir)
	storage, download, err := generatePdfArtifactLocal("测试PDF", "一、概述\n内容A\n二、结论\n内容B")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(storage, ".pdf") {
		t.Fatalf("storage=%s", storage)
	}
	if !strings.Contains(download, "/api/skill-artifacts/") {
		t.Fatalf("download=%s", download)
	}
	raw, err := os.ReadFile(skillArtifactFilePath(storage))
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 8 || string(raw[:4]) != "%PDF" {
		t.Fatalf("bad pdf magic")
	}
}

func TestLooksLikeClarificationSpeech(t *testing.T) {
	if !looksLikeClarificationSpeech("请告诉我考评对象，并请补充周期，方便提供模板。") {
		t.Fatal("expected clarification")
	}
	if looksLikeClarificationSpeech("一、基本信息\n岗位名称：人事专员\n二、岗位职责\n1. 招聘\n2. 入职") {
		t.Fatal("structured body should pass")
	}
}

func TestLooksLikePptxGenerateRequest(t *testing.T) {
	if !looksLikePptxGenerateRequest("生成团队季度考评 PPT") {
		t.Fatal("expected true")
	}
	if looksLikePptxGenerateRequest("PPT 和 Word 有什么区别") {
		t.Fatal("question should not count as generate")
	}
}

func TestOfficeSkillRejectsTitleContentShortcut(t *testing.T) {
	s := &Server{}
	sk := map[string]any{
		"id": "sk-pptx", "name": "pptx", "packagePath": t.TempDir(),
		"hasScripts": true, "scripts": []string{"scripts/build_from_outline.mjs"},
		"producesArtifacts": true,
	}
	tool := &registeredTool{Name: "pptx", Kind: "skill", Key: "skill:pptx"}
	res := s.skillRun(toolRunContext{SessionMode: sessionModeExecute, WorkspaceID: "w1"}, tool, sk, toolCallRequest{
		Args: map[string]any{
			"action": "run", "title": "团队季度考评", "content": "## 目录\n- A",
		},
	}, "生成 PPT", time.Now())
	if res.Status != "needs_instruction" {
		t.Fatalf("expected needs_instruction, got %s: %s", res.Status, res.Output)
	}
	if !strings.Contains(res.Output, "禁止平台内置快捷生成") {
		t.Fatalf("output=%s", res.Output)
	}
	docSk := map[string]any{
		"id": "sk-docx", "name": "docx", "packagePath": t.TempDir(),
		"hasScripts": true, "scripts": []string{"scripts/docx.sh"},
	}
	docTool := &registeredTool{Name: "docx", Kind: "skill", Key: "skill:docx"}
	docRes := s.skillRun(toolRunContext{WorkspaceID: "w1"}, docTool, docSk, toolCallRequest{
		Args: map[string]any{"action": "run", "title": "通知", "content": "一、材料\n1. 身份证"},
	}, "", time.Now())
	if docRes.Status != "needs_instruction" {
		t.Fatalf("docx shortcut should be rejected: %#v", docRes)
	}
}

func TestOfficeSkillNotFoundWhenUnbound(t *testing.T) {
	s := New(store.New())
	tool := &registeredTool{Name: "pptx", Kind: "skill", Key: "skill:pptx"}
	res := s.runSkillTool(toolRunContext{WorkspaceID: "w-none"}, tool, toolCallRequest{
		Name: "pptx", Args: map[string]any{"action": "open"},
	}, time.Now())
	if res.Status != "failed" || !strings.Contains(res.Output, "未装配") {
		t.Fatalf("got %#v", res)
	}
}

func TestInvestigateDeniesSkillRunWithoutScript(t *testing.T) {
	s := &Server{}
	tool := &registeredTool{Name: "pptx", Kind: "skill", Key: "skill:pptx"}
	res := s.runSkillTool(toolRunContext{WorkspaceID: "w-none", SessionMode: sessionModeInvestigate}, tool, toolCallRequest{
		Name: "pptx", Args: map[string]any{"action": "run", "command": "scripts/a.py"},
	}, time.Now())
	if res.Status != "denied" || res.Permission != "session_mode" {
		t.Fatalf("expected session_mode deny, got %#v", res)
	}
}

func TestInvestigateRejectsOfficeBuiltinShortcut(t *testing.T) {
	s := New(store.New())
	sk := map[string]any{
		"id": "sk-docx", "name": "docx", "packagePath": t.TempDir(),
		"hasScripts": true, "scripts": []string{"scripts/docx.sh"},
	}
	tool := &registeredTool{Name: "docx", Kind: "skill", Key: "skill:docx", Mode: copilot.ToolModeExecute, Enabled: true}
	res := s.skillRun(toolRunContext{
		WorkspaceID: "w1", SessionMode: sessionModeInvestigate,
		Viewer: &auth.Identity{ID: "u1", Name: "测试"},
	}, tool, sk, toolCallRequest{
		Args: map[string]any{
			"action": "run", "title": "入职材料清单通知", "content": "一、材料清单\n1. 身份证",
		},
	}, "生成入职材料", time.Now())
	if res.Status != "needs_instruction" {
		t.Fatalf("builtin shortcut must be rejected, got %#v", res)
	}
}
