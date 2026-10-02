package copilot

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDecideCognitiveFramework_BypassShort(t *testing.T) {
	d := decideCognitiveFramework("你好", modeDirect, "P2", nil)
	if !d.Bypass {
		t.Fatalf("expected bypass for short chitchat, got %+v", d)
	}
}

func TestDecideCognitiveFramework_BypassArtifact(t *testing.T) {
	d := decideCognitiveFramework("请生成一份产品介绍 PPT", modeReact, "P2", nil)
	if !d.Bypass {
		t.Fatalf("expected bypass for pure ppt generate, got %+v", d)
	}
}

func TestDecideCognitiveFramework_ProblemRoute(t *testing.T) {
	d := decideCognitiveFramework("线上故障根因是什么，怎么推进修复并止损？", modeReact, "P1", nil)
	if d.Bypass {
		t.Fatalf("unexpected bypass: %+v", d)
	}
	if d.Primary != cognitiveProblem {
		t.Fatalf("want problem, got %s reasons=%v", d.Primary, d.Reasons)
	}
	if d.DigestText == "" {
		t.Fatal("expected digest injection text")
	}
}

func TestDecideCognitiveFramework_CreativeRoute(t *testing.T) {
	d := decideCognitiveFramework("帮我头脑风暴三个活动创意并做方案对比与选型", modePlanExec, "P0", nil)
	if d.Bypass {
		t.Fatalf("unexpected bypass: %+v", d)
	}
	if d.Primary != cognitiveCreative {
		t.Fatalf("want creative, got %s", d.Primary)
	}
	if d.Mode != cognitiveModeDeep {
		t.Fatalf("want deep mode for plan_exec/P0, got %s", d.Mode)
	}
}

func TestDecideCognitiveFramework_Disabled(t *testing.T) {
	emp := map[string]any{
		"capabilities": map[string]any{
			"cognitive": map[string]any{"enabled": false},
		},
	}
	d := decideCognitiveFramework("请分析这个观点是否成立", modeReact, "P2", emp)
	if !d.Bypass || d.BypassReason != "cognitive_disabled" {
		t.Fatalf("expected cognitive_disabled, got %+v", d)
	}
}

func TestLoadCognitiveDigest(t *testing.T) {
	root := filepath.Join("..", "..", "builtin", "skills")
	if _, err := os.Stat(root); err != nil {
		root = filepath.Join("backend", "builtin", "skills")
		if _, err := os.Stat(root); err != nil {
			t.Skip("builtin skills not found from test cwd")
		}
		t.Setenv("DE_BUILTIN_SKILLS_DIR", root)
	} else {
		t.Setenv("DE_BUILTIN_SKILLS_DIR", root)
	}
	text := loadCognitiveDigest("general-logic-thinking-assistant")
	if !strings.Contains(text, "逻辑思考") {
		t.Fatalf("digest missing expected content: %q", truncateRunes(text, 80))
	}
}

func TestEnsureEmployeeCognitiveSkills(t *testing.T) {
	emp := map[string]any{"capabilities": map[string]any{"skills": []string{"docx"}}}
	ensureEmployeeCognitiveSkills(emp)
	caps := emp["capabilities"].(map[string]any)
	skills := decodeStringSlice(caps["skills"])
	found := 0
	for _, name := range cognitiveSkillNames {
		for _, s := range skills {
			if s == name {
				found++
			}
		}
	}
	if found != len(cognitiveSkillNames) {
		t.Fatalf("skills=%v found=%d", skills, found)
	}
	cog, _ := caps["cognitive"].(map[string]any)
	if cog == nil || cog["enabled"] != true {
		t.Fatalf("cognitive config missing: %+v", cog)
	}
}

func TestDecideCognitiveFramework_UserForce(t *testing.T) {
	d := decideCognitiveFramework("请用创意决策帮我看这个活动怎么做", modeReact, "P1", nil)
	if d.Bypass || d.Primary != cognitiveCreative {
		t.Fatalf("want creative force, got %+v", d)
	}
}

func TestDecideCognitiveFramework_MaxFrameworksOne(t *testing.T) {
	emp := map[string]any{
		"capabilities": map[string]any{
			"cognitive": map[string]any{"enabled": true, "maxFrameworksPerTurn": 1},
		},
	}
	d := decideCognitiveFramework("线上故障根因是什么，同时该选哪个修复方案？", modeReact, "P1", emp)
	if d.Bypass {
		t.Fatalf("unexpected bypass: %+v", d)
	}
	if d.Secondary != "" {
		t.Fatalf("expected secondary trimmed when max=1, got %s", d.Secondary)
	}
}

func TestDecideCognitiveFramework_AnalyzeWithTranslateNotBypass(t *testing.T) {
	d := decideCognitiveFramework("请分析这段英文论证是否成立，必要时可翻译关键句帮助理解", modeReact, "P1", nil)
	if d.Bypass {
		t.Fatalf("should not bypass analysis+translate: %+v", d)
	}
}

func TestEstimateCognitiveDigestTokens(t *testing.T) {
	if estimateCognitiveDigestTokens("") != 0 {
		t.Fatal("empty should be 0")
	}
	n := estimateCognitiveDigestTokens("一二三四五六七八九十")
	if n <= 0 {
		t.Fatalf("want positive estimate, got %d", n)
	}
}

