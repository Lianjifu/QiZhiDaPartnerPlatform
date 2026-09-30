package server

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestRunRuntimeToolDoesNotRecurse(t *testing.T) {
	pkg := t.TempDir()
	if err := os.WriteFile(filepath.Join(pkg, "SKILL.md"), []byte("# docx skill"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: store.NewEmpty()}
	s.Store.Skills = []map[string]any{{
		"id": "sk-docx", "workspaceId": "w1", "name": "docx", "kind": "skill",
		"packagePath": pkg, "status": "installed",
	}}
	ctx := toolRunContext{
		Request:     httptest.NewRequest("POST", "/api/copilot/conversations/c1/stream", nil),
		WorkspaceID: "w1",
	}
	tool := &registeredTool{Name: "read_file", Kind: "tool", Key: "tool:read_file"}
	call := toolCallRequest{Name: "read_file", Args: map[string]any{"path": "SKILL.md"}}

	res := s.runRuntimeTool(ctx, tool, call, time.Now())
	if res.Status != "success" {
		t.Fatalf("read_file status=%s output=%s err=%s", res.Status, res.Output, res.Error)
	}
}

func TestRunRuntimeToolWriteFileRoutesToPilotdeck(t *testing.T) {
	pkg := t.TempDir()
	if err := os.MkdirAll(filepath.Join(pkg, ".copilot-ws"), 0o755); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: store.NewEmpty()}
	s.Store.Skills = []map[string]any{{
		"id": "sk-pptx", "workspaceId": "w1", "name": "pptx", "kind": "skill",
		"packagePath": pkg, "status": "installed", "producesArtifacts": true,
	}}
	ctx := toolRunContext{
		Request:     httptest.NewRequest("POST", "/api/copilot/conversations/c1/stream", nil),
		WorkspaceID: "w1",
	}
	tool := &registeredTool{Name: "write_file", Kind: "tool", Key: "tool:write_file"}
	call := toolCallRequest{Name: "write_file", Args: map[string]any{
		"path": ".copilot-ws/team_quarterly_review_ppt.mjs", "content": "console.log(1)",
	}}
	res := s.runRuntimeTool(ctx, tool, call, time.Now())
	if res.Status != "success" {
		t.Fatalf("write_file status=%s err=%s output=%s", res.Status, res.Error, res.Output)
	}
	if !strings.Contains(res.Output, "下一步可用 action=run command=.copilot-ws/team_quarterly_review_ppt.mjs") {
		t.Fatalf("expected next-run hint, got %s", res.Output)
	}
	if _, err := os.Stat(filepath.Join(pkg, ".copilot-ws", "team_quarterly_review_ppt.mjs")); err != nil {
		t.Fatalf("script not written: %v", err)
	}
}

func TestSandboxCopilotWsPaths(t *testing.T) {
	if !isSandboxCopilotWsPath(".copilot-ws/gen.mjs") {
		t.Fatal("expected .copilot-ws path")
	}
	if !isSandboxCopilotWsPath("node .copilot-ws/gen.mjs") {
		t.Fatal("expected node-prefixed path")
	}
	if isSandboxCopilotWsPath("scripts/thumbnail.py") {
		t.Fatal("scripts/ should not be treated as sandbox-ws for write exemption alone")
	}
}

func TestSandboxArtifactSkillInvocationCopilotWs(t *testing.T) {
	tool := &registeredTool{Name: "pptx", Kind: "skill"}
	sk := map[string]any{"name": "pptx", "producesArtifacts": true}
	writeCall := toolCallRequest{Name: "pptx", Args: map[string]any{
		"action": "write", "path": ".copilot-ws/gen.mjs", "content": "x",
	}}
	if !isSandboxArtifactSkillInvocation(tool, sk, writeCall, skillActionWrite) {
		t.Fatal("pptx write to .copilot-ws should be sandbox")
	}
	runCall := toolCallRequest{Name: "pptx", Args: map[string]any{
		"action": "run", "command": ".copilot-ws/gen.mjs",
	}}
	if !isSandboxArtifactSkillInvocation(tool, sk, runCall, skillActionRun) {
		t.Fatal("pptx run of .copilot-ws script should be sandbox")
	}
	if skillInvocationNeedsApproval(sessionModeExecute, tool, sk, runCall) {
		t.Fatal("sandbox pptx run should not need approval")
	}
}

func TestRunPilotdeckToolReadFileDoesNotRecurse(t *testing.T) {
	pkg := t.TempDir()
	if err := os.WriteFile(filepath.Join(pkg, "SKILL.md"), []byte("# docx skill"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: store.NewEmpty()}
	s.Store.Skills = []map[string]any{{
		"id": "sk-docx", "workspaceId": "w1", "name": "docx", "kind": "skill",
		"packagePath": pkg, "status": "installed",
	}}
	ctx := toolRunContext{
		Request:     httptest.NewRequest("POST", "/api/copilot/conversations/c1/stream", nil),
		WorkspaceID: "w1",
	}
	tool := &registeredTool{Name: "read_file", Kind: "tool", Key: "tool:read_file"}
	call := toolCallRequest{Name: "read_file", Args: map[string]any{"path": "SKILL.md"}}

	res := s.runPilotdeckTool(ctx, tool, call, time.Now())
	if res.Status != "success" {
		t.Fatalf("read_file status=%s output=%s err=%s", res.Status, res.Output, res.Error)
	}
}

// TestEnsureWSDepsWritten guards the bash-auto-write fix: when a bash call's command
// references a .copilot-ws/<file>.md via --outline-file and the file is not yet on disk,
// ensureWSDepsWritten must create it from call.Args["content"] before the run dispatches.
// Previously the preflight would fail with "缺少依赖文件" and the user saw the bash step
// turn red in the steps panel.
func TestEnsureWSDepsWritten(t *testing.T) {
	pkg := t.TempDir()
	if err := os.MkdirAll(filepath.Join(pkg, ".copilot-ws"), 0o755); err != nil {
		t.Fatal(err)
	}
	sk := map[string]any{"name": "pptx", "packagePath": pkg}

	t.Run("writes outline using args.content when provided", func(t *testing.T) {
		call := toolCallRequest{
			Args: map[string]any{
				"command": "bash scripts/pptx.sh node scripts/build_from_outline.mjs --outline-file .copilot-ws/foo.md --out .copilot-ws/foo.pptx",
				"content": "# 真实大纲\n\n- 实际内容",
			},
		}
		res, handled := ensureWSDepsWritten(sk, str(call.Args["command"]), call)
		if !handled || res.Status != "success" {
			t.Fatalf("expected handled+success, got handled=%v res=%+v", handled, res)
		}
		got, err := os.ReadFile(filepath.Join(pkg, ".copilot-ws", "foo.md"))
		if err != nil {
			t.Fatalf("outline not written: %v", err)
		}
		if !strings.Contains(string(got), "真实大纲") {
			t.Fatalf("outline content wrong: %s", got)
		}
	})

	t.Run("infers outline from user message when content absent", func(t *testing.T) {
		call := toolCallRequest{
			Args: map[string]any{
				"_userMessage": "输出 Q3 研发季度汇报 PPT",
				"command":      "bash scripts/pptx.sh node scripts/build_from_outline.mjs --outline-file .copilot-ws/q3.md --out .copilot-ws/q3.pptx",
			},
		}
		res, handled := ensureWSDepsWritten(sk, str(call.Args["command"]), call)
		if !handled || res.Status != "success" {
			t.Fatalf("expected handled+success, got handled=%v res=%+v", handled, res)
		}
		got, err := os.ReadFile(filepath.Join(pkg, ".copilot-ws", "q3.md"))
		if err != nil {
			t.Fatalf("outline not written: %v", err)
		}
		if !strings.Contains(string(got), "#") {
			t.Fatalf("inferred outline looks empty: %s", got)
		}
	})

	t.Run("skips files that already exist", func(t *testing.T) {
		existing := filepath.Join(pkg, ".copilot-ws", "already.md")
		if err := os.WriteFile(existing, []byte("keep me"), 0o644); err != nil {
			t.Fatal(err)
		}
		call := toolCallRequest{
			Args: map[string]any{
				"command": "bash scripts/pptx.sh node scripts/build_from_outline.mjs --outline-file .copilot-ws/already.md --out .copilot-ws/already.pptx",
				"content": "OVERWRITE",
			},
		}
		_, handled := ensureWSDepsWritten(sk, str(call.Args["command"]), call)
		if !handled {
			t.Fatalf("expected handled=true even when no writes happen")
		}
		got, _ := os.ReadFile(existing)
		if string(got) != "keep me" {
			t.Fatalf("existing file was clobbered: %s", got)
		}
	})

	t.Run("returns false when cmd has no .copilot-ws deps", func(t *testing.T) {
		call := toolCallRequest{
			Args: map[string]any{"command": "ls /tmp"},
		}
		_, handled := ensureWSDepsWritten(sk, str(call.Args["command"]), call)
		if handled {
			t.Fatalf("expected handled=false for non-dep command")
		}
	})

	t.Run("uses _userMessage to infer outline when content absent (P2)", func(t *testing.T) {
		// Mirrors the screenshot-1 regression where a bare bash call (no Skill Turn) was
		// missing _userMessage → inferOfficeOutline returned nothing → file stayed missing.
		// P2: runtimeBash now pipes ctx.UserMessage into args._userMessage before calling
		// ensureWSDepsWritten, so the inference branch fires and a real outline lands on disk.
		call := toolCallRequest{
			Args: map[string]any{
				"_userMessage": "Q3 研发季度汇报 PPT",
				"command":      "bash scripts/pptx.sh node scripts/build_from_outline.mjs --outline-file .copilot-ws/p2.md --out .copilot-ws/p2.pptx",
			},
		}
		res, handled := ensureWSDepsWritten(sk, str(call.Args["command"]), call)
		if !handled || res.Status != "success" {
			t.Fatalf("expected handled+success, got handled=%v res=%+v", handled, res)
		}
		got, err := os.ReadFile(filepath.Join(pkg, ".copilot-ws", "p2.md"))
		if err != nil {
			t.Fatalf("outline not written from _userMessage: %v", err)
		}
		if !strings.Contains(string(got), "#") {
			t.Fatalf("inferred outline looks empty: %s", got)
		}
	})
}
