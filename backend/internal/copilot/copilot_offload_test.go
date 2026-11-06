package copilot

import (
	"strings"
	"testing"
)

// TestOffloadToolOutputStoresOversizedResults covers the P4 offload: a big
// tool output is stored as an artifact and the context keeps only a reference.
func TestOffloadToolOutputStoresOversizedResults(t *testing.T) {
	stored := 0
	svc := &Service{}
	svc.Deps.Tools.OffloadArtifactFn = func(in ArtifactInput) (map[string]any, error) {
		stored++
		return map[string]any{"id": "artifact-1"}, nil
	}

	small := strings.Repeat("x", 100)
	if ref := svc.offloadToolOutput(ArtifactInput{ToolName: "knowledge.retrieve", Content: small}); ref != nil {
		t.Fatalf("small output must not be offloaded: %#v", ref)
	}
	if stored != 0 {
		t.Fatalf("offload called for small output")
	}

	big := strings.Repeat("y", artifactOffloadMaxRunes+500)
	ref := svc.offloadToolOutput(ArtifactInput{ToolName: "knowledge.retrieve", Content: big})
	if ref == nil {
		t.Fatal("expected offload for oversized output")
	}
	if ref.ID != "artifact-1" {
		t.Fatalf("artifact id: %#v", ref)
	}
	if stored != 1 {
		t.Fatalf("offload calls = %d", stored)
	}
	text := artifactReferenceText(ref)
	if !strings.Contains(text, "artifact-1") || !strings.Contains(text, "artifact.read") {
		t.Fatalf("reference text: %q", text)
	}
}

// TestOffloadToolOutputNoopWhenUnwired keeps the copilot side nil-safe.
func TestOffloadToolOutputNoopWhenUnwired(t *testing.T) {
	svc := &Service{}
	big := strings.Repeat("z", artifactOffloadMaxRunes+10)
	if ref := svc.offloadToolOutput(ArtifactInput{ToolName: "x", Content: big}); ref != nil {
		t.Fatalf("expected no offload when unwired: %#v", ref)
	}
}

// TestArtifactReadToolResolvesStoredArtifact covers the retrieval half: the
// model can pull the full body back through the artifact.read tool.
func TestArtifactReadToolResolvesStoredArtifact(t *testing.T) {
	svc := &Service{}
	svc.Deps.Tools.ReadArtifactFn = func(id string) (map[string]any, bool) {
		if id != "artifact-1" {
			return nil, false
		}
		return map[string]any{"id": id, "content": "完整正文"}, true
	}
	reg := buildToolRegistry(nil, nil)
	tool := registryLookup(reg, "artifact.read")
	if tool == nil {
		t.Fatal("artifact.read must be registered")
	}
	res := svc.runCopilotTool(toolRunContext{}, tool, toolCallRequest{Name: "artifact.read", Args: map[string]any{"id": "artifact-1"}})
	if res.Status != "success" {
		t.Fatalf("status=%q error=%q", res.Status, res.Error)
	}
	if !strings.Contains(res.Output, "完整正文") {
		t.Fatalf("output=%q", res.Output)
	}
	missing := svc.runCopilotTool(toolRunContext{}, tool, toolCallRequest{Name: "artifact.read", Args: map[string]any{"id": "nope"}})
	if missing.Status != "failed" {
		t.Fatalf("missing artifact must fail, got %q", missing.Status)
	}
}
